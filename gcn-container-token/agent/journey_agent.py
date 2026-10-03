"""GCN Container Journey Audit Agent (Atomic Agents).

TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

Answers the two questions the traceability ledger exists for - where has this container
been, and how far has it gone - and, crucially, answers a third the questions imply:
how much of that do we actually know?

Design rule, same as container_agent.py: arithmetic and gap detection are deterministic
Python. The model never computes a distance, never fills a gap and never upgrades an
evidence tier. It writes the assessment paragraph a human reads, and it is given the
computed facts to write it from.
"""
from __future__ import annotations

import json
import math
from typing import Literal, Optional

import anthropic
import instructor
from pydantic import Field

from atomic_agents import AgentConfig, AtomicAgent, BaseIOSchema
from atomic_agents.context import BaseDynamicContextProvider, SystemPromptGenerator

R_EARTH_M = 6371008.8
M_PER_NM = 1852
M_PER_MI = 1609.344

# Mirrors shared/geo.js. The two must agree; test_journey_agent.py checks the shared cases.
MAX_SPEED_MPS = {"SEA": 15.5, "ROAD": 35.0, "RAIL": 45.0, "AIR": 300.0, "YARD": 3.0}
TIER_WEIGHT = {
    "TIER1_CONTAINER_TELEMETRY": 1.0,  # observed the box
    "TIER2_CARRIER_EDI": 0.7,          # observed the handling event
    "TIER3_VESSEL_AIS": 0.4,           # observed the ship
    "TIER4_MANUAL": 0.15,              # observed nothing; someone said so
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH_M * math.asin(min(1.0, math.sqrt(a)))


class Waypoint(BaseIOSchema):
    """One attested observation of a container's position."""

    at: str = Field(..., description="ISO 8601 UTC timestamp of the observation")
    lat: float = Field(..., ge=-90, le=90, description="WGS-84 latitude")
    lon: float = Field(..., ge=-180, le=180, description="WGS-84 longitude")
    event_type: str = Field(..., description="GATE_OUT, LOADED_VESSEL, VESSEL_POSITION, TRANSSHIPPED, DISCHARGED, GATE_IN, CUSTOMS_HOLD, DELIVERED")
    tier: str = Field(..., description="Evidence tier: TIER1_CONTAINER_TELEMETRY, TIER2_CARRIER_EDI, TIER3_VESSEL_AIS or TIER4_MANUAL")
    mode: str = Field("SEA", description="SEA, ROAD, RAIL, AIR or YARD")
    unlocode: Optional[str] = Field(None, description="UN/LOCODE if this happened at a port")
    evidence_hash: Optional[str] = Field(None, description="Hash of the source document or AIS/EDI record")


class JourneyAuditInput(BaseIOSchema):
    """A container's full attested waypoint log, for audit."""

    container_id: str = Field(..., description="ISO 6346 container id")
    waypoints: list[Waypoint] = Field(..., description="All attested waypoints, any order")
    declared_route: Optional[str] = Field(None, description="Route the paperwork claims, e.g. 'CNSHA-SGSIN-NLRTM'")


class JourneyAuditOutput(BaseIOSchema):
    """Audit of a container's traceability record. Not proof of physical movement."""

    confidence: Literal["strong", "partial", "weak", "unusable"] = Field(
        ..., description="How much the record supports a claim about where this container went"
    )
    assessment: str = Field(..., description="Plain assessment for a human reader, grounded only in the computed facts supplied")
    unexplained_gaps: list[str] = Field(default_factory=list, description="Periods or legs the record does not account for")
    follow_ups: list[str] = Field(default_factory=list, description="Specific evidence that would raise the confidence")


class TraceabilityDoctrine(BaseDynamicContextProvider):
    """What the ledger can and cannot establish. Kept in the prompt so the model cannot
    quietly promote an AIS position into proof about a container."""

    def get_info(self) -> str:
        return (
            "GCN TRACEABILITY DOCTRINE (testnet proof-of-concept):\n"
            "1. A token and a position log prove that identified observers committed to claims in a fixed "
            "order and cannot now alter them. They prove nothing about a physical steel box.\n"
            "2. Evidence tiers are not interchangeable. TIER1 container telemetry observes the container. "
            "TIER2 carrier/terminal EDI observes a handling event in a system of record. TIER3 vessel AIS "
            "observes the SHIP - it transfers to the container only while the container is demonstrably "
            "aboard that ship, between a LOADED_VESSEL and a DISCHARGED event for that voyage. TIER4 is a "
            "human assertion with no machine source.\n"
            "3. Distance is a sum of great-circle hops between attested positions: a LOWER BOUND. Ships do "
            "not sail great circles and the log is sparse. Never call it distance travelled.\n"
            "4. A gap in the log is a gap in knowledge, not a straight line. Say so.\n"
            "5. Pole Star MTI (https://www.polestarglobal.com/maritime-transparency-index/) scores a VESSEL "
            "0-5 across Vessel, Voyage, Emissions*, Border Security* and Supply Chain* (*in development), "
            "from 200+ data sources. It is a vessel risk signal, not container tracking, and a real score "
            "must come from Pole Star."
        )


def audit_facts(req: JourneyAuditInput) -> dict:
    """Deterministic analysis. Everything the model is allowed to reason from comes from here."""
    from datetime import datetime

    def ts(s: str) -> float:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

    wps = sorted(req.waypoints, key=lambda w: ts(w.at))
    legs, anomalies = [], []
    total = 0.0

    for i in range(1, len(wps)):
        a, b = wps[i - 1], wps[i]
        dt = ts(b.at) - ts(a.at)
        d = haversine_m(a.lat, a.lon, b.lat, b.lon)
        ceiling = MAX_SPEED_MPS.get(b.mode, MAX_SPEED_MPS["SEA"])
        if dt <= 0:
            anomalies.append(f"{b.at}: timestamp not after the previous waypoint")
        elif d / dt > ceiling:
            anomalies.append(
                f"{b.at}: {d/dt:.1f} m/s over a {b.mode} leg exceeds the {ceiling} m/s ceiling - bad coordinate or fabricated leg"
            )
        if dt > 14 * 86400:
            anomalies.append(f"{b.at}: {dt/86400:.0f} days with no attested position - the track between is unknown")
        if not b.evidence_hash:
            anomalies.append(f"{b.at}: no evidence hash; this waypoint is unsupported")
        total += d
        legs.append({"from": a.unlocode or f"{a.lat},{a.lon}", "to": b.unlocode or f"{b.lat},{b.lon}",
                     "mode": b.mode, "tier": b.tier, "days": round(dt / 86400, 1), "miles": round(d / M_PER_MI, 1)})

    # Does an AIS position actually sit inside a loaded voyage? If not, it is a ship's
    # position being presented as a container's, which is the error this whole tier
    # system exists to catch.
    aboard = False
    orphan_ais = 0
    for w in wps:
        if w.event_type == "LOADED_VESSEL":
            aboard = True
        elif w.event_type in ("DISCHARGED", "GATE_IN", "DELIVERED"):
            aboard = False
        elif w.tier == "TIER3_VESSEL_AIS" and not aboard:
            orphan_ais += 1
    if orphan_ais:
        anomalies.append(
            f"{orphan_ais} vessel-AIS waypoint(s) fall outside any LOADED_VESSEL..DISCHARGED window - "
            "a ship's position attributed to a container that was not shown to be aboard"
        )

    tiers = {}
    for w in wps:
        tiers[w.tier] = tiers.get(w.tier, 0) + 1
    coverage = sum(TIER_WEIGHT.get(w.tier, 0.0) for w in wps) / max(1, len(wps))
    ports = [w.unlocode for w in wps if w.unlocode]

    declared_missing = []
    if req.declared_route:
        for code in [c.strip().upper() for c in req.declared_route.replace("->", "-").split("-") if c.strip()]:
            if code not in ports:
                declared_missing.append(code)

    return {
        "container_id": req.container_id,
        "waypoints": len(wps),
        "span_days": round((ts(wps[-1].at) - ts(wps[0].at)) / 86400, 1) if len(wps) > 1 else 0,
        "first_seen": wps[0].at if wps else None,
        "last_seen": wps[-1].at if wps else None,
        "attested_distance_miles": round(total / M_PER_MI, 1),
        "attested_distance_nm": round(total / M_PER_NM, 1),
        "distance_basis": "sum of great-circle hops between attested positions - LOWER BOUND",
        "ports_in_order": ports,
        "legs": legs,
        "tier_counts": tiers,
        "container_level_observations": tiers.get("TIER1_CONTAINER_TELEMETRY", 0),
        "evidence_coverage_score": round(coverage, 2),
        "declared_route_ports_never_attested": declared_missing,
        "anomalies": anomalies,
    }


def _confidence(f: dict) -> str:
    if f["waypoints"] < 2 or not f["ports_in_order"]:
        return "unusable"
    if f["anomalies"] and f["evidence_coverage_score"] < 0.4:
        return "unusable"
    if f["container_level_observations"] > 0 and f["evidence_coverage_score"] >= 0.7 and not f["anomalies"]:
        return "strong"
    if f["evidence_coverage_score"] >= 0.5 and len(f["anomalies"]) <= 1:
        return "partial"
    return "weak"


class ComputedFacts(BaseDynamicContextProvider):
    """Injects this audit's deterministic results so the model never does the arithmetic."""

    def __init__(self, title: str):
        super().__init__(title)
        self.facts: dict = {}

    def get_info(self) -> str:
        if not self.facts:
            return "No computed facts supplied."
        return (
            "COMPUTED FACTS for this container - these are authoritative. Do not recompute, "
            "adjust or extrapolate any number here, and do not infer a position for a period "
            "the facts do not cover:\n" + json.dumps(self.facts, indent=2)
        )


def build_journey_agent(model: str = "claude-sonnet-4-5", api_key: Optional[str] = None, client=None):
    client = client or instructor.from_anthropic(anthropic.Anthropic(api_key=api_key))
    prompt = SystemPromptGenerator(
        background=[
            "You audit container traceability records for the GCN Exchange testnet proof-of-concept.",
            "Your reader is an operator or an investor deciding how much weight the record can carry.",
        ],
        steps=[
            "Read the computed facts. Treat every number there as final.",
            "Describe the route actually attested, and name what the record does not cover.",
            "Weigh the evidence tiers: say when positions came from a ship or a document rather than the container.",
            "List follow-ups that would raise confidence, each naming a specific piece of evidence.",
        ],
        output_instructions=[
            "Never state a distance as 'travelled'; it is attested great-circle distance and a lower bound.",
            "Never fill a gap with an assumption, and never treat a vessel AIS position as proof about the container.",
            "Concise and factual. Label the record testnet / proof-of-concept.",
            "Never use the words leverage, synergy, game-changing, disruptive or revolutionary.",
        ],
    )
    prompt.context_providers["doctrine"] = TraceabilityDoctrine(title="GCN traceability doctrine")
    facts = ComputedFacts(title="Computed facts for this audit")
    prompt.context_providers["facts"] = facts
    agent = AtomicAgent[JourneyAuditInput, JourneyAuditOutput](
        config=AgentConfig(
            client=client, model=model, system_prompt_generator=prompt,
            model_api_parameters={"max_tokens": 1200},
        )
    )
    agent._gcn_facts = facts  # the audit() helper fills this before each run
    return agent


def audit(agent, req: JourneyAuditInput, *, offline: bool = False) -> JourneyAuditOutput:
    """Compute the facts, then (unless offline) have the agent write the assessment.

    offline=True returns a deterministic report with no model call, so the numbers and the
    confidence grade can be produced and tested with no API key and no network.
    """
    if not req.waypoints:
        return JourneyAuditOutput(
            confidence="unusable",
            assessment="No waypoints attested for this container. The record establishes nothing about where it has been.",
            unexplained_gaps=["The entire journey is unattested."],
            follow_ups=["Log at least a GATE_OUT and a LOADED_VESSEL event with evidence hashes."],
        )
    f = audit_facts(req)
    grade = _confidence(f)
    if offline:
        ports = " -> ".join(f["ports_in_order"]) or "no ports attested"
        return JourneyAuditOutput(
            confidence=grade,
            assessment=(
                f"{f['container_id']} (testnet proof-of-concept): {f['waypoints']} attested waypoints over "
                f"{f['span_days']} days, {ports}. Attested great-circle distance {f['attested_distance_miles']} miles "
                f"({f['attested_distance_nm']} nm) - a lower bound, not distance sailed. "
                f"Evidence coverage {f['evidence_coverage_score']}; "
                f"{f['container_level_observations']} waypoint(s) observed the container itself."
            ),
            unexplained_gaps=f["anomalies"] + [
                f"Declared route port {p} never attested" for p in f["declared_route_ports_never_attested"]
            ],
            follow_ups=(
                ["Attach container-level telemetry (TIER1) for at least the loaded legs."]
                if f["container_level_observations"] == 0 else []
            ) + ["Obtain the carrying vessel's Pole Star MTI for each loaded leg."],
        )
    agent._gcn_facts.facts = f
    return agent.run(req)


if __name__ == "__main__":
    import sys
    from demo_route import DEMO  # noqa: E402

    req = JourneyAuditInput(**DEMO)
    print(audit(build_journey_agent(api_key="offline"), req, offline="--live" not in sys.argv).model_dump_json(indent=2))

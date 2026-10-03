"""Offline tests for the journey audit. No network, no API key."""
import math

import pytest

from demo_route import DEMO
from journey_agent import (
    JourneyAuditInput, audit, audit_facts, build_journey_agent, haversine_m, _confidence, TIER_WEIGHT,
)

REQ = JourneyAuditInput(**DEMO)


def test_haversine_agrees_with_published_distances():
    # Shanghai - Singapore, ~2,100 nm
    d = haversine_m(31.23, 121.47, 1.26, 103.84)
    assert math.isclose(d, 3_880_000, rel_tol=0.02)
    assert haversine_m(10, 20, 10, 20) == 0


def test_haversine_matches_the_javascript_implementation():
    # Values produced by shared/geo.js haversineMeters, to keep the two engines in step.
    for lat1, lon1, lat2, lon2, expected in [
        (31.23, 121.47, 1.26, 103.84, 3813577),
        (51.95, 4.14, 40.69, -74.04, 5834735),
        (0.0, 0.0, 0.0, 1.0, 111195),
    ]:
        # Metre-level agreement, not approximate: the on-chain geometric band and the
        # off-chain recomputation must not drift apart.
        assert abs(haversine_m(lat1, lon1, lat2, lon2) - expected) < 1.0


def test_facts_total_the_route_and_order_the_ports():
    f = audit_facts(REQ)
    assert f["waypoints"] == 5
    assert f["ports_in_order"] == ["CNSHA", "SGSIN", "AEJEA"]
    assert 6000 < f["attested_distance_miles"] < 9000
    assert "LOWER BOUND" in f["distance_basis"]
    assert f["legs"][0]["mode"] == "YARD"


def test_facts_catch_the_coverage_gap_and_the_orphan_ais_position():
    f = audit_facts(REQ)
    joined = " | ".join(f["anomalies"])
    assert "no attested position" in joined
    assert "not shown to be aboard" in joined


def test_declared_route_port_never_attested_is_reported():
    f = audit_facts(REQ)
    assert f["declared_route_ports_never_attested"] == ["NLRTM"]


def test_no_container_level_evidence_in_the_demo_route():
    f = audit_facts(REQ)
    assert f["container_level_observations"] == 0
    assert f["evidence_coverage_score"] < 0.7


def test_confidence_grading():
    f = audit_facts(REQ)
    assert _confidence(f) in ("weak", "partial")

    clean = audit_facts(JourneyAuditInput(
        container_id="CSQU3054383",
        waypoints=[
            {"at": "2026-03-01T00:00:00Z", "lat": 31.23, "lon": 121.47, "event_type": "LOADED_VESSEL",
             "tier": "TIER1_CONTAINER_TELEMETRY", "mode": "YARD", "unlocode": "CNSHA", "evidence_hash": "aa"},
            {"at": "2026-03-10T00:00:00Z", "lat": 1.26, "lon": 103.84, "event_type": "DISCHARGED",
             "tier": "TIER1_CONTAINER_TELEMETRY", "mode": "SEA", "unlocode": "SGSIN", "evidence_hash": "bb"},
        ],
    ))
    assert clean["anomalies"] == []
    assert _confidence(clean) == "strong"


def test_implausible_speed_is_flagged():
    f = audit_facts(JourneyAuditInput(
        container_id="CSQU3054383",
        waypoints=[
            {"at": "2026-03-01T00:00:00Z", "lat": 31.23, "lon": 121.47, "event_type": "LOADED_VESSEL",
             "tier": "TIER2_CARRIER_EDI", "mode": "SEA", "unlocode": "CNSHA", "evidence_hash": "aa"},
            {"at": "2026-03-01T02:00:00Z", "lat": 51.95, "lon": 4.14, "event_type": "DISCHARGED",
             "tier": "TIER2_CARRIER_EDI", "mode": "SEA", "unlocode": "NLRTM", "evidence_hash": "bb"},
        ],
    ))
    assert any("ceiling" in a for a in f["anomalies"])


def test_offline_audit_needs_no_api_key_and_keeps_the_caveat():
    out = audit(build_journey_agent(api_key="sk-ant-offline-test"), REQ, offline=True)
    assert out.confidence in ("weak", "partial")
    assert "lower bound" in out.assessment.lower()
    assert out.unexplained_gaps
    assert any("TIER1" in f or "MTI" in f for f in out.follow_ups)


def test_empty_log_is_unusable_not_an_error():
    out = audit(build_journey_agent(api_key="sk-ant-offline-test"),
                JourneyAuditInput(container_id="CSQU3054383", waypoints=[]), offline=True)
    assert out.confidence == "unusable"
    assert "establishes nothing" in out.assessment


def test_tier_weights_rank_container_above_ship():
    assert TIER_WEIGHT["TIER1_CONTAINER_TELEMETRY"] > TIER_WEIGHT["TIER2_CARRIER_EDI"] > \
           TIER_WEIGHT["TIER3_VESSEL_AIS"] > TIER_WEIGHT["TIER4_MANUAL"]


def test_waypoint_schema_rejects_impossible_coordinates():
    with pytest.raises(Exception):
        JourneyAuditInput(container_id="CSQU3054383", waypoints=[
            {"at": "2026-03-01T00:00:00Z", "lat": 95.0, "lon": 0.0, "event_type": "GATE_OUT",
             "tier": "TIER4_MANUAL", "evidence_hash": "aa"},
        ])

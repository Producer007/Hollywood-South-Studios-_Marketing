"""GCN Container Verification Agent (Atomic Agents).

TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT. Screens a container + carrying-vessel record
before an attester writes a vessel attestation to the container token.

Division of labour (deliberate):
  * Deterministic code validates the ISO 6346 id and the input ranges.
  * The LLM only explains risk, grounded in the MTI context below.
  * The agent NEVER invents an MTI score. A score must be supplied by the caller from
    an actual Pole Star result; if absent, the verdict is 'needs_mti'.
"""
from typing import Literal, Optional

import anthropic
import instructor
from pydantic import Field

from atomic_agents import AgentConfig, AtomicAgent, BaseIOSchema
from atomic_agents.context import BaseDynamicContextProvider, SystemPromptGenerator

_VAL = {}
_n = 10
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    if _n % 11 == 0:
        _n += 1
    _VAL[_c] = _n
    _n += 1


def iso6346_check(cid: str) -> tuple[bool, str]:
    """ISO 6346: 4 letters (owner 3 + category U/J/Z), 6 digits, 1 check digit."""
    cid = cid.strip().upper()
    if len(cid) != 11 or not cid[:4].isalpha() or not cid[4:].isdigit():
        return False, "must be 4 letters + 7 digits"
    if cid[3] not in "UJZ":
        return False, "4th letter must be U, J or Z"
    total = sum((_VAL[c] if c.isalpha() else int(c)) * (2 ** i) for i, c in enumerate(cid[:10]))
    expected = total % 11 % 10
    if expected != int(cid[10]):
        return False, f"check digit should be {expected}"
    return True, cid


class MTIKnowledge(BaseDynamicContextProvider):
    """Source: https://www.polestarglobal.com/maritime-transparency-index/ (Pole Star MTI)."""

    def get_info(self) -> str:
        return (
            "POLE STAR MARITIME TRANSPARENCY INDEX (MTI) - facts from the public product page:\n"
            "- Scores a VESSEL from 0 to 5; it does not score a container or a cargo.\n"
            "- Dimensions: Vessel, Voyage, Emissions*, Border Security*, Supply Chain* (*in development).\n"
            "- Draws on 200+ data sources.\n"
            "- A real score must be obtained from Pole Star; do not estimate one.\n"
            "GCN POLICY (testnet PoC): default minimum MTI for transfer while InTransit is 2 (configurable)."
        )


class ContainerScreenInput(BaseIOSchema):
    """A container and its carrying vessel, as supplied by an attester."""

    container_id: str = Field(..., description="ISO 6346 container id, e.g. CSQU3054383")
    vessel_imo: Optional[str] = Field(None, description="7-digit IMO number of the carrying vessel")
    mti_score: Optional[int] = Field(None, ge=0, le=5, description="Pole Star MTI 0-5, from a real Pole Star result")
    min_mti: int = Field(2, ge=0, le=5, description="Minimum MTI GCN allows for transfer while InTransit")
    notes: str = Field("", description="Free-text attester notes")


class ContainerScreenOutput(BaseIOSchema):
    """Screening result. Not a guarantee that the physical container exists."""

    verdict: Literal["clear", "hold", "needs_mti", "invalid_id"] = Field(..., description="Screening outcome")
    rationale: str = Field(..., description="Short grounded explanation referencing the MTI facts provided")
    follow_ups: list[str] = Field(default_factory=list, description="Concrete checks the attester should do next")


def build_agent(model: str = "claude-sonnet-4-5", api_key: Optional[str] = None, client=None):
    client = client or instructor.from_anthropic(anthropic.Anthropic(api_key=api_key))
    prompt = SystemPromptGenerator(
        background=[
            "You screen shipping-container records for the GCN Exchange testnet proof-of-concept.",
            "You explain risk using only the provided MTI context and the input. You never invent scores, IMO data or sanctions findings.",
        ],
        steps=[
            "Check the deterministic pre-checks in the input notes; if the id is invalid, verdict is invalid_id.",
            "If no MTI score is given, verdict is needs_mti.",
            "If MTI is below min_mti, verdict is hold; otherwise clear.",
            "State that clear means policy-compliant only, not proof of physical existence.",
        ],
        output_instructions=[
            "Be concise and factual. Label everything testnet / proof-of-concept.",
            "Never use the words leverage, synergy, game-changing, disruptive or revolutionary.",
        ],
    )
    prompt.context_providers["mti"] = MTIKnowledge(title="Pole Star MTI knowledge")
    return AtomicAgent[ContainerScreenInput, ContainerScreenOutput](
        config=AgentConfig(
            client=client,
            model=model,
            system_prompt_generator=prompt,
            model_api_parameters={"max_tokens": 700},
        )
    )


def screen(agent, req: ContainerScreenInput) -> ContainerScreenOutput:
    ok, detail = iso6346_check(req.container_id)
    if not ok:  # deterministic short-circuit, no LLM call
        return ContainerScreenOutput(
            verdict="invalid_id", rationale=f"ISO 6346 check failed: {detail}", follow_ups=["Re-confirm the id from the container door."]
        )
    if req.mti_score is None:
        return ContainerScreenOutput(
            verdict="needs_mti",
            rationale="No Pole Star MTI score supplied for the carrying vessel; none is estimated.",
            follow_ups=["Obtain the vessel's MTI from Pole Star for its IMO.", "Record the evidence hash with the attestation."],
        )
    return agent.run(req)


if __name__ == "__main__":
    import sys

    a = build_agent()
    print(screen(a, ContainerScreenInput(container_id=sys.argv[1] if len(sys.argv) > 1 else "CSQU3054383")).model_dump_json(indent=2))

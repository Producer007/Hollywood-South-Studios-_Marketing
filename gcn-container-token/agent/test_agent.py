"""Offline tests: no network, no API key. Uses a stub client for the LLM path."""
from container_agent import ContainerScreenInput as In, iso6346_check, screen, build_agent, MTIKnowledge


def test_iso():
    assert iso6346_check("CSQU3054383")[0]
    assert not iso6346_check("CSQU3054384")[0]
    assert not iso6346_check("CSQX3054383")[0]
    assert not iso6346_check("short")[0]


def test_short_circuits():
    a = build_agent(api_key="sk-ant-offline-test")
    assert screen(a, In(container_id="CSQU3054384")).verdict == "invalid_id"
    assert screen(a, In(container_id="CSQU3054383")).verdict == "needs_mti"


def test_context_mentions_vessel_scope():
    info = MTIKnowledge(title="x").get_info()
    assert "VESSEL" in info and "0 to 5" in info

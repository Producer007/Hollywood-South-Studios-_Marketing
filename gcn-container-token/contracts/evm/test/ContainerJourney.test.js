const { expect } = require("chai");
const { ethers } = require("hardhat");
const { haversineMeters, toE5 } = require("../../../shared/geo");
const { PORTS } = require("../../../shared/unlocode");

// Real route, real coordinates, real haversine distances computed by shared/geo.js.
// Nothing here uses a made-up distance: the expectations come from the same geodesy the
// off-chain indexer uses, which is the point - the contract and the indexer must agree.
const EV = { SEA: 0, ROAD: 1, RAIL: 2, AIR: 3, YARD: 4 };
const T = { TELEMETRY: 0, EDI: 1, AIS: 2, MANUAL: 3 };
const E = { GateOut: 0, LoadedVessel: 1, VesselPosition: 2, Transshipped: 3, Discharged: 4, GateIn: 5, CustomsHold: 6, Delivered: 7 };

const u = (c) => ethers.utils.hexlify(ethers.utils.toUtf8Bytes(c)); // bytes5 UN/LOCODE
const NO_PORT = "0x0000000000";
const hash = (s) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));

function seg(a, b) {
  return Math.round(haversineMeters(PORTS[a].lat, PORTS[a].lon, PORTS[b].lat, PORTS[b].lon));
}

describe("ContainerJourney (pre-audit traceability ledger)", () => {
  let token, journey, admin, observer, outsider, t0;

  beforeEach(async () => {
    [admin, observer, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("ContainerToken")).deploy(admin.address);
    await token.deployed();
    await token.register(admin.address, "CSQU3054383", "45G1", hash("docs"));
    journey = await (await ethers.getContractFactory("ContainerJourney")).deploy(token.address, admin.address);
    await journey.deployed();
    await journey.grantRole(await journey.OBSERVER_ROLE(), observer.address);
    t0 = (await ethers.provider.getBlock("latest")).timestamp - 60 * 86400;
  });

  const put = (o, { port, lat, lon, at, meters, type = E.VesselPosition, mode = EV.SEA, tier = T.AIS, ev = "ais" }) =>
    journey.connect(o).appendWaypoint(
      1, type, mode, tier,
      port ? u(port) : NO_PORT,
      toE5(lat ?? PORTS[port].lat), toE5(lon ?? PORTS[port].lon),
      at, meters, hash(ev)
    );

  it("rejects a non-zero segment on the first waypoint", async () => {
    await expect(put(observer, { port: "CNSHA", at: t0, meters: 5000 })).to.be.revertedWith("first waypoint has no segment");
  });

  it("accumulates a real Shanghai-Singapore-Jebel Ali route and reports a lower-bound total", async () => {
    const legs = [["CNSHA", null], ["SGSIN", "CNSHA"], ["AEJEA", "SGSIN"]];
    let at = t0, expected = 0;
    for (const [to, from] of legs) {
      const m = from ? seg(from, to) : 0;
      expected += m;
      at += 12 * 86400; // ~12 days per leg, comfortably inside the 30 kn ceiling
      await put(observer, { port: to, at, meters: m, type: from ? E.Discharged : E.LoadedVessel, tier: T.EDI, ev: `codeco-${to}` });
    }
    const s = await journey.journeySummary(1);
    expect(s.count).to.equal(3);
    expect(s.meters).to.equal(expected);
    expect(await journey.cumulativeMeters(1)).to.equal(expected);
    expect(s.lastLatE5).to.equal(toE5(PORTS.AEJEA.lat));
    // Sanity against the real world: Shanghai->Singapore->Jebel Ali is on the order of 11,000 km.
    expect(expected).to.be.greaterThan(9_000_000).and.lessThan(13_000_000);
    expect((await journey.portCalls(1)).map((b) => ethers.utils.toUtf8String(b))).to.deep.equal(["CNSHA", "SGSIN", "AEJEA"]);
  });

  it("rejects a distance claim outside the on-chain geometric band", async () => {
    await put(observer, { port: "CNSHA", at: t0, meters: 0 });
    const real = seg("CNSHA", "SGSIN");
    const at = t0 + 12 * 86400;
    await expect(put(observer, { port: "SGSIN", at, meters: Math.round(real * 0.2) }))
      .to.be.revertedWith("claimed distance below geometric minimum");
    await expect(put(observer, { port: "SGSIN", at, meters: Math.round(real * 3) }))
      .to.be.revertedWith("claimed distance above geometric maximum");
    await put(observer, { port: "SGSIN", at, meters: real }); // the honest value passes
  });

  it("rejects a leg no ship could sail in the elapsed time", async () => {
    await put(observer, { port: "CNSHA", at: t0, meters: 0 });
    await expect(put(observer, { port: "NLRTM", at: t0 + 3600, meters: seg("CNSHA", "NLRTM") }))
      .to.be.revertedWith("implausible speed for mode");
  });

  it("applies a per-mode ceiling, so a sea-speed leg can still be a legal rail leg", async () => {
    await put(observer, { port: "NLRTM", at: t0, meters: 0 });
    const m = seg("NLRTM", "BEANR");
    const fast = t0 + 1800; // ~95 km in 30 min: too fast for a ship, fine for rail
    await expect(put(observer, { port: "BEANR", at: fast, meters: m, mode: EV.SEA })).to.be.revertedWith("implausible speed for mode");
    await put(observer, { port: "BEANR", at: fast, meters: m, mode: EV.RAIL, type: E.GateIn, tier: T.EDI });
    expect((await journey.journeySummary(1)).count).to.equal(2);
  });

  it("enforces chronological order", async () => {
    await put(observer, { port: "CNSHA", at: t0 + 86400, meters: 0 });
    await expect(put(observer, { port: "SGSIN", at: t0, meters: seg("CNSHA", "SGSIN") }))
      .to.be.revertedWith("waypoint not after previous");
  });

  it("requires an evidence hash and refuses future timestamps", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await expect(
      journey.connect(observer).appendWaypoint(1, E.LoadedVessel, EV.SEA, T.AIS, u("CNSHA"), toE5(31.23), toE5(121.47), t0, 0, ethers.constants.HashZero)
    ).to.be.revertedWith("evidence hash required");
    await expect(put(observer, { port: "CNSHA", at: now + 7200, meters: 0 })).to.be.revertedWith("timestamp in the future");
  });

  it("counts container-level evidence separately from ship-level evidence", async () => {
    await put(observer, { port: "CNSHA", at: t0, meters: 0, tier: T.AIS });
    await put(observer, { port: "SGSIN", at: t0 + 12 * 86400, meters: seg("CNSHA", "SGSIN"), tier: T.AIS });
    expect(await journey.hasContainerLevelEvidence(1)).to.equal(false);
    expect((await journey.journeySummary(1)).containerObserved).to.equal(0);

    await put(observer, { port: "AEJEA", at: t0 + 24 * 86400, meters: seg("SGSIN", "AEJEA"), tier: T.TELEMETRY, ev: "tracker" });
    expect(await journey.hasContainerLevelEvidence(1)).to.equal(true);
    expect((await journey.journeySummary(1)).containerObserved).to.equal(1);
  });

  it("records a correction without altering the original waypoint", async () => {
    await put(observer, { port: "CNSHA", at: t0, meters: 0 });
    const before = await journey.waypointAt(1, 0);
    await journey.connect(observer).appendCorrection(1, 0, "AIS fix was the wrong vessel", hash("memo"));
    const after = await journey.waypointAt(1, 0);
    expect(after.latE5).to.equal(before.latE5);
    expect(after.at).to.equal(before.at);
    const c = await journey.corrections(1);
    expect(c.length).to.equal(1);
    expect(c[0].reason).to.equal("AIS fix was the wrong vessel");
    expect(c[0].waypointIndex).to.equal(0);
  });

  it("only lets an observer append, and only for a container that exists", async () => {
    await expect(put(outsider, { port: "CNSHA", at: t0, meters: 0 })).to.be.reverted;
    await expect(
      journey.connect(observer).appendWaypoint(99, E.LoadedVessel, EV.SEA, T.AIS, u("CNSHA"), toE5(31.23), toE5(121.47), t0, 0, hash("e"))
    ).to.be.reverted;
  });

  it("keeps the lower-bound caveat on-chain beside the number", async () => {
    const c = await journey.distanceCaveat();
    expect(c).to.contain("LOWER BOUND");
    expect(c).to.contain("evidence tier");
  });

  it("rejects out-of-range coordinates", async () => {
    await expect(
      journey.connect(observer).appendWaypoint(1, E.LoadedVessel, EV.SEA, T.AIS, NO_PORT, toE5(95), toE5(0), t0, 0, hash("e"))
    ).to.be.revertedWith("latitude out of range");
  });
});

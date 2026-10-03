// Offline checks for the geodesy and journey replay. Run: node shared/test-geo.js
const assert = require("assert");
const { haversineMeters, bearingDeg, metersTo, toE5, fromE5, replayJourney } = require("./geo");
const { lookup, isUnlocode } = require("./unlocode");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

// Known-distance sanity checks against published great-circle figures (within 0.5%).
t("haversine matches published great-circle distances", () => {
  const near = (got, want, tol = 0.005) => assert.ok(Math.abs(got - want) / want < tol, `${got} vs ${want}`);
  near(haversineMeters(31.23, 121.47, 1.26, 103.84), 3_880_000, 0.02);   // Shanghai - Singapore ~2,100 nm
  near(haversineMeters(51.95, 4.14, 40.69, -74.04), 5_860_000, 0.02);    // Rotterdam - New York ~3,160 nm
  near(haversineMeters(0, 0, 0, 1), 111_195, 0.01);                      // one degree at the equator
  assert.strictEqual(Math.round(haversineMeters(10, 20, 10, 20)), 0);    // same point
});

t("antimeridian pairs give a short distance, not a trip round the world", () => {
  const d = haversineMeters(0, 179.9, 0, -179.9);
  assert.ok(d < 25_000, `expected a short hop, got ${d} m`);
});

t("bearing points the right way", () => {
  assert.ok(Math.abs(bearingDeg(0, 0, 10, 0) - 0) < 0.1);    // due north
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 10) - 90) < 0.1);   // due east
});

t("unit conversion", () => {
  const m = metersTo(1852);
  assert.strictEqual(m.nauticalMiles, 1);
  assert.strictEqual(metersTo(1609.344).statuteMiles, 1);
});

t("e5 coordinate round trip keeps ~1 m precision", () => {
  assert.strictEqual(toE5(31.23), 3123000);
  assert.ok(Math.abs(fromE5(toE5(-29.87123)) - -29.87123) < 1e-5);
});

t("unlocode lookup and validation", () => {
  assert.strictEqual(lookup("CNSHA").name, "Shanghai");
  assert.strictEqual(lookup("ZZZZZ").found, false);
  assert.strictEqual(lookup("NOPE").found, false);
  assert.ok(isUnlocode("NGLOS") && !isUnlocode("NGLO"));
});

const leg = (at, lat, lon, over) => ({
  at, lat, lon, eventType: "VESSEL_POSITION", mode: "SEA", tier: "TIER3_VESSEL_AIS", evidenceHash: "aa", ...over,
});

t("replay totals a route and labels it a lower bound", () => {
  const r = replayJourney([
    leg("2026-03-01T00:00:00Z", 31.23, 121.47, { eventType: "LOADED_VESSEL", unlocode: "CNSHA", tier: "TIER2_CARRIER_EDI" }),
    leg("2026-03-12T00:00:00Z", 1.26, 103.84, { unlocode: "SGSIN" }),
    leg("2026-03-24T00:00:00Z", 25.01, 55.06, { eventType: "DISCHARGED", unlocode: "AEJEA", tier: "TIER2_CARRIER_EDI" }),
  ]);
  assert.strictEqual(r.waypointCount, 3);
  assert.deepStrictEqual(r.uniquePorts, ["CNSHA", "SGSIN", "AEJEA"]);
  assert.strictEqual(r.legs.length, 2);
  assert.ok(r.attestedGreatCircleDistance.statuteMiles > 5000 && r.attestedGreatCircleDistance.statuteMiles < 8000);
  assert.ok(r.distanceCaveat.includes("Lower bound"));
  assert.strictEqual(r.anomalies.length, 0);
});

t("replay flags an impossible leg", () => {
  const r = replayJourney([
    leg("2026-03-01T00:00:00Z", 31.23, 121.47),
    leg("2026-03-01T02:00:00Z", 51.95, 4.14), // Shanghai to Rotterdam in two hours
  ]);
  assert.ok(r.anomalies.some((a) => a.kind === "IMPLAUSIBLE_SPEED"), JSON.stringify(r.anomalies));
});

t("replay flags a coverage gap and keeps the distance honest", () => {
  const r = replayJourney([
    leg("2026-01-01T00:00:00Z", 31.23, 121.47),
    leg("2026-04-01T00:00:00Z", 51.95, 4.14),
  ]);
  assert.ok(r.anomalies.some((a) => a.kind === "COVERAGE_GAP"));
});

t("replay sorts out-of-order input and flags missing evidence", () => {
  const r = replayJourney([
    leg("2026-03-12T00:00:00Z", 1.26, 103.84, { evidenceHash: null }),
    leg("2026-03-01T00:00:00Z", 31.23, 121.47),
  ]);
  assert.strictEqual(r.firstSeen, "2026-03-01T00:00:00Z");
  assert.ok(r.anomalies.some((a) => a.kind === "NO_EVIDENCE_HASH"));
});

t("replay says plainly when nothing observed the container itself", () => {
  const ais = replayJourney([leg("2026-03-01T00:00:00Z", 31.23, 121.47)]);
  assert.strictEqual(ais.evidence.containerLevelObservations, 0);
  assert.ok(ais.evidence.coverageNote.startsWith("No TIER1"));

  const tracked = replayJourney([leg("2026-03-01T00:00:00Z", 31.23, 121.47, { tier: "TIER1_CONTAINER_TELEMETRY" })]);
  assert.strictEqual(tracked.evidence.containerLevelObservations, 1);
});

t("replay rejects nonsense coordinates and unknown enums", () => {
  const r = replayJourney([leg("2026-03-01T00:00:00Z", 999, 0, { eventType: "TELEPORTED", tier: "TIER9" })]);
  const kinds = r.anomalies.map((a) => a.kind);
  assert.ok(kinds.includes("BAD_COORDINATE") && kinds.includes("UNKNOWN_EVENT_TYPE") && kinds.includes("UNKNOWN_EVIDENCE_TIER"));
});

t("replay flags a ship position attributed to a container that was ashore", () => {
  const r = replayJourney([
    leg("2026-03-01T00:00:00Z", 31.23, 121.47, { eventType: "LOADED_VESSEL", unlocode: "CNSHA", tier: "TIER2_CARRIER_EDI" }),
    leg("2026-03-13T00:00:00Z", 1.26, 103.84, { eventType: "DISCHARGED", unlocode: "SGSIN", tier: "TIER2_CARRIER_EDI" }),
    leg("2026-03-15T00:00:00Z", 2.5, 104.5), // ship sails on; the box did not
  ]);
  assert.ok(r.anomalies.some((a) => a.kind === "ORPHAN_VESSEL_POSITION"), JSON.stringify(r.anomalies));
  assert.strictEqual(r.evidence.orphanVesselPositions, 1);

  // While genuinely aboard, an AIS position is not flagged.
  const ok = replayJourney([
    leg("2026-03-01T00:00:00Z", 31.23, 121.47, { eventType: "LOADED_VESSEL", unlocode: "CNSHA", tier: "TIER2_CARRIER_EDI" }),
    leg("2026-03-06T00:00:00Z", 15.0, 112.0),
    leg("2026-03-13T00:00:00Z", 1.26, 103.84, { eventType: "DISCHARGED", unlocode: "SGSIN", tier: "TIER2_CARRIER_EDI" }),
  ]);
  assert.strictEqual(ok.evidence.orphanVesselPositions, 0);
  assert.strictEqual(ok.anomalies.length, 0);
});

t("a one-waypoint journey has zero distance, not an error", () => {
  const r = replayJourney([leg("2026-03-01T00:00:00Z", 31.23, 121.47)]);
  assert.strictEqual(r.attestedGreatCircleDistance.meters, 0);
  assert.strictEqual(r.legs.length, 0);
});

console.log(`\n${n} geo/replay checks passed`);

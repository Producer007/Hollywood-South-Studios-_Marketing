// Offline end-to-end demonstration of the traceability report. No network, no keys.
//   node shared/demo-journey.js
//
// SAMPLE DATA. The route carries two deliberate defects - a 31-day coverage gap and a
// vessel position recorded after discharge - so the report has something to catch.

const { replayJourney } = require("./geo");
const { PORTS } = require("./unlocode");

const at = (s) => s;
const p = (code, over) => ({ lat: PORTS[code].lat, lon: PORTS[code].lon, unlocode: code, ...over });

const WAYPOINTS = [
  { at: at("2026-03-01T06:00:00Z"), lat: 31.18, lon: 121.52, eventType: "GATE_OUT", mode: "ROAD", tier: "TIER2_CARRIER_EDI", evidenceHash: "a1" },
  { at: at("2026-03-02T14:00:00Z"), ...p("CNSHA"), eventType: "LOADED_VESSEL", mode: "YARD", tier: "TIER2_CARRIER_EDI", evidenceHash: "b2" },
  { at: at("2026-03-13T09:00:00Z"), ...p("SGSIN"), eventType: "TRANSSHIPPED", mode: "SEA", tier: "TIER3_VESSEL_AIS", evidenceHash: "c3" },
  { at: at("2026-04-13T07:00:00Z"), ...p("AEJEA"), eventType: "DISCHARGED", mode: "SEA", tier: "TIER2_CARRIER_EDI", evidenceHash: "d4" },
  { at: at("2026-04-15T07:00:00Z"), lat: 26.2, lon: 56.3, eventType: "VESSEL_POSITION", mode: "SEA", tier: "TIER3_VESSEL_AIS", evidenceHash: "e5" },
];

const r = replayJourney(WAYPOINTS);
const d = r.attestedGreatCircleDistance;

console.log("\nGCN container traceability report - SAMPLE DATA, testnet proof-of-concept");
console.log("Container CSQU3054383\n");
console.log(`Waypoints   ${r.waypointCount}   ${r.firstSeen} -> ${r.lastSeen} (${r.elapsedDays} days)`);
console.log(`Route       ${r.uniquePorts.join(" -> ")}`);
console.log(`Distance    ${d.statuteMiles} miles / ${d.nauticalMiles} nm / ${d.km} km`);
console.log(`            ${r.distanceCaveat}\n`);
console.log("Legs:");
r.legs.forEach((l) =>
  console.log(
    `  ${(l.from.unlocode || "at sea").padEnd(6)} -> ${(l.to.unlocode || "at sea").padEnd(6)} ` +
    `${String(l.distance.statuteMiles).padStart(7)} mi  ${String(l.durationHours / 24).slice(0, 4).padStart(5)} d  ` +
    `${l.mode.padEnd(5)} ${l.tier}`
  )
);
console.log(`\nEvidence    ${r.evidence.coverageNote}`);
Object.entries(r.evidence.tierCounts).forEach(([t, n]) => console.log(`            ${n} x ${t}`));
console.log(`\nAnomalies   ${r.anomalies.length}`);
r.anomalies.forEach((a) => console.log(`  - [${a.kind}] ${a.at}\n      ${a.detail}`));
console.log(
  "\nWhat this is: a record of what identified observers committed to, in a fixed order,\n" +
  "that they cannot now alter. It is not proof the container existed or moved.\n"
);

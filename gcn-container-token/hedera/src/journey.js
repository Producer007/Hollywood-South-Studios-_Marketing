const { replayJourney, metersTo } = require("../../shared/geo");
const { validateIso6346 } = require("../../shared/iso6346");
const { waypointsFor, readState, sha256 } = require("./mirror");

// Reads the whole journey back from the Hedera TESTNET mirror node and replays it into a
// report: ports visited, distance, evidence quality, anomalies, hash-chain integrity.
//
// Reading from the mirror node rather than from local state.json is deliberate: this is
// the verification path. Anyone can run it against a topic id with no credentials and get
// the same answer, which is the only sense in which the record is worth anything.
//
// Usage: node src/journey.js CSQU3054383 [--topic 0.0.x] [--json]

async function journeyReport(iso, topicId) {
  const v = validateIso6346(iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);
  if (!topicId) throw new Error("no topic id - pass --topic or create one first");

  const decoded = await waypointsFor(topicId, v.id);
  if (!decoded.length) return { container: v.id, topicId, empty: true };

  // Verify the hash chain. A broken link means a message was written without reference to
  // the one before it: two writers racing, a stale local cache, or something worse.
  const chainBreaks = [];
  decoded.forEach((m, i) => {
    const expectPrev = i === 0 ? null : sha256(decoded[i - 1].body);
    if ((m.msg.prevMessageHash || null) !== expectPrev) {
      chainBreaks.push({ seq: m.seq, expected: expectPrev, found: m.msg.prevMessageHash || null });
    }
  });

  const report = replayJourney(
    decoded.map((m) => ({
      at: m.msg.at, lat: m.msg.lat, lon: m.msg.lon, eventType: m.msg.event, imo: m.msg.imo,
      mode: m.msg.mode, unlocode: m.msg.unlocode, tier: m.msg.tier, evidenceHash: m.msg.evidenceSha256,
    }))
  );
  const onChainClaimed = decoded.reduce((s, m) => s + (m.msg.segmentMeters || 0), 0);
  const mismatch = Math.abs(onChainClaimed - report.attestedGreatCircleDistance.meters) >
    Math.max(1000, report.attestedGreatCircleDistance.meters * 0.001);
  return { container: v.id, topicId, report, chainBreaks, onChainClaimed, mismatch, sequences: decoded.map((m) => m.seq) };
}

function printReport(r) {
  if (r.empty) {
    console.log(`No waypoints for ${r.container} on topic ${r.topicId}. Nothing has been attested about this container.`);
    return;
  }
  const { report } = r;
  const d = report.attestedGreatCircleDistance;
  console.log(`\nContainer ${r.container} - HCS topic ${r.topicId} (Hedera TESTNET, proof-of-concept)`);
  console.log(`https://hashscan.io/testnet/topic/${r.topicId}\n`);
  console.log(`Waypoints      ${report.waypointCount}  (${report.firstSeen} -> ${report.lastSeen}, ${report.elapsedDays} days)`);
  console.log(`Ports visited  ${report.uniquePorts.join(" -> ") || "none recorded"}`);
  console.log(`Distance       ${d.statuteMiles} miles / ${d.nauticalMiles} nm / ${d.km} km`);
  console.log(`               ${report.distanceCaveat}`);
  console.log(`Evidence       ${report.evidence.coverageNote}`);
  Object.entries(report.evidence.tierCounts).forEach(([t, n]) => console.log(`               ${n} x ${t}`));
  if (r.mismatch) {
    console.log(`\nMISMATCH       messages claim ${metersTo(r.onChainClaimed).statuteMiles} mi but recomputing from the`);
    console.log(`               attested coordinates gives ${d.statuteMiles} mi. Trust the recomputation.`);
  }
  console.log(r.chainBreaks.length
    ? `\nHASH CHAIN     ${r.chainBreaks.length} break(s): sequence ${r.chainBreaks.map((c) => c.seq).join(", ")}`
    : `\nHash chain     intact across ${report.waypointCount} message(s)`);
  if (report.anomalies.length) {
    console.log(`\nAnomalies (${report.anomalies.length}):`);
    report.anomalies.forEach((an) => console.log(`  - [${an.kind}] ${an.at}: ${an.detail}`));
  } else {
    console.log(`Anomalies      none detected`);
  }
  console.log(
    `\nThis is a record of what observers committed to, not proof the container existed or\n` +
    `travelled. Judge it by the evidence tiers above.\n`
  );
}

if (require.main === module) {
  (async () => {
    const argv = process.argv;
    const topicId = argv.includes("--topic") ? argv[argv.indexOf("--topic") + 1] : readState().topicId;
    const r = await journeyReport(argv[2], topicId);
    if (argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
    else printReport(r);
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { journeyReport, printReport };

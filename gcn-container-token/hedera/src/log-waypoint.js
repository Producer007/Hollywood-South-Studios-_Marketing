const fs = require("fs");
const { TopicMessageSubmitTransaction } = require("@hashgraph/sdk");
const { getClient } = require("./client");
const { validateIso6346 } = require("../../shared/iso6346");
const { haversineMeters, metersTo, validateCoord, EVENT_TYPES, EVIDENCE_TIERS, MAX_SPEED_MPS } = require("../../shared/geo");
const { lookup } = require("../../shared/unlocode");
const { readState, writeState, lastWaypoint, serialsFor, sha256, sleep, HCS_MESSAGE_LIMIT } = require("./mirror");

// HEDERA TESTNET ONLY. Appends one traceability waypoint to the container's HCS topic.
//
// Why HCS and not an HTS field: a journey is an ordered, append-only log, which is exactly
// what a consensus topic is. Messages get a consensus timestamp and sequence number from
// the network, so the ORDER of the log is attested by Hedera rather than by whoever wrote
// it. Nothing can be inserted behind an existing message or quietly removed.
//
// The previous waypoint is read from the mirror node, not from local state.json, so the
// hash chain links to what the network actually holds. A lost or stale state.json cannot
// break the chain; a mirror node that has not yet caught up is waited for.
//
// Usage:
//   node src/log-waypoint.js --iso CSQU3054383 --event LOADED_VESSEL --tier TIER2_CARRIER_EDI \
//        --port CNSHA --at 2026-03-01T08:00:00Z --mode SEA --evidence ./codeco.edi [--imo 9321483]
//   ... or --lat/--lon instead of --port for a position at sea.

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined || argv[i + 1].startsWith("--")) {
      throw new Error(`expected --flag value pairs, got "${argv[i]}"`);
    }
    a[argv[i].slice(2)] = argv[i + 1];
  }
  return a;
}

// Mirror nodes trail consensus by a few seconds. If our own cache says a newer waypoint
// exists than the mirror shows, wait for the mirror rather than chaining to a stale link.
async function settledPrev(topicId, iso, cached, { retries = 8, delayMs = 2500 } = {}) {
  for (let i = 0; ; i++) {
    const prev = await lastWaypoint(topicId, iso);
    const behind = cached && (!prev || prev.waypoints < cached.waypoints);
    if (!behind) return prev;
    if (i >= retries) {
      throw new Error(
        `mirror node shows ${prev ? prev.waypoints : 0} waypoint(s) for ${iso} but this machine wrote ` +
        `${cached.waypoints}. Wait a minute and retry; do not chain to a stale link.`
      );
    }
    await sleep(delayMs);
  }
}

function buildWaypoint(a, prev, evidenceBytes) {
  const v = validateIso6346(a.iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);
  if (!EVENT_TYPES.includes(a.event)) throw new Error(`--event must be one of ${EVENT_TYPES.join(", ")}`);
  if (!(a.tier in EVIDENCE_TIERS)) throw new Error(`--tier must be one of ${Object.keys(EVIDENCE_TIERS).join(", ")}`);
  const mode = a.mode || "SEA";
  if (!(mode in MAX_SPEED_MPS)) throw new Error(`--mode must be one of ${Object.keys(MAX_SPEED_MPS).join(", ")}`);
  if (a.tier === "TIER3_VESSEL_AIS" && !a.imo) throw new Error("TIER3_VESSEL_AIS observes a ship: --imo is required");
  if (a.imo && !/^[0-9]{7}$/.test(a.imo)) throw new Error("--imo must be 7 digits");

  let lat, lon, unlocode = null;
  if (a.port) {
    const p = lookup(a.port);
    if (!p.found) throw new Error(`--port ${a.port}: ${p.reason}`);
    ({ lat, lon } = p);
    unlocode = p.unlocode;
  } else {
    lat = Number(a.lat);
    lon = Number(a.lon);
  }
  const bad = validateCoord(lat, lon);
  if (bad) throw new Error(`position: ${bad}`);

  const at = a.at ? new Date(a.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be an ISO 8601 timestamp");
  if (at.getTime() > Date.now() + 3600_000) throw new Error("--at is in the future");

  // The evidence hash pins this claim to the AIS extract, EDI message or signed document it
  // came from. No file, no waypoint.
  if (!evidenceBytes) throw new Error("--evidence <file> is required; a waypoint with no evidence is hearsay");

  let segmentMeters = 0;
  if (prev) {
    const dt = (at.getTime() - new Date(prev.at).getTime()) / 1000;
    if (dt <= 0) throw new Error(`--at is not after the last waypoint (${prev.at})`);
    segmentMeters = Math.round(haversineMeters(prev.lat, prev.lon, lat, lon));
    const speed = segmentMeters / dt;
    if (speed > MAX_SPEED_MPS[mode]) {
      throw new Error(
        `implausible: ${segmentMeters} m in ${(dt / 3600).toFixed(1)} h = ${speed.toFixed(1)} m/s, ` +
        `over the ${mode} ceiling of ${MAX_SPEED_MPS[mode]} m/s. Check the coordinates or the mode.`
      );
    }
  }

  const msg = {
    t: "gcn_waypoint_v1",
    iso: v.id,
    event: a.event,
    tier: a.tier,
    mode,
    unlocode,
    lat: +lat.toFixed(5),
    lon: +lon.toFixed(5),
    at: at.toISOString(),
    imo: a.imo || null,
    segmentMeters,
    evidenceSha256: sha256(evidenceBytes),
    prevMessageHash: prev ? prev.messageHash : null,
    note: "segmentMeters is a great-circle lower bound, not distance sailed",
  };
  const body = JSON.stringify(msg);
  // Over the limit, HCS would chunk it and the journey reader would not reassemble it.
  if (Buffer.byteLength(body) > HCS_MESSAGE_LIMIT) throw new Error(`waypoint is ${Buffer.byteLength(body)} bytes; HCS limit is ${HCS_MESSAGE_LIMIT}`);
  return { iso: v.id, msg, body, messageHash: sha256(body), segmentMeters };
}

async function logWaypoint(a, { retries, delayMs } = {}) {
  const state = readState();
  if (!state.topicId) throw new Error("no topicId in state.json - run create-collection.js first");
  const v = validateIso6346(a.iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);

  // Same rule as ContainerJourney.sol: no journey for a container that has no token.
  if (!(await serialsFor(state.tokenId, v.id)).length) {
    throw new Error(`${v.id} has no token on ${state.tokenId}; mint it first`);
  }

  const evidenceBytes = a.evidence ? fs.readFileSync(a.evidence) : null;
  const cached = state.journeys?.[v.id] || null;
  const prev = await settledPrev(state.topicId, v.id, cached, { retries, delayMs });
  const w = buildWaypoint(a, prev, evidenceBytes);

  const { client } = getClient();
  let rcpt;
  try {
    rcpt = await (
      await new TopicMessageSubmitTransaction().setTopicId(state.topicId).setMessage(w.body).execute(client)
    ).getReceipt(client);
  } finally {
    client.close();
  }

  const cumulativeMeters = (prev?.cumulativeMeters || 0) + w.segmentMeters;
  (state.journeys ||= {})[w.iso] = {
    at: w.msg.at, lat: w.msg.lat, lon: w.msg.lon, messageHash: w.messageHash,
    cumulativeMeters, waypoints: (prev?.waypoints || 0) + 1,
  };
  writeState(state);
  return {
    ...w, topicId: state.topicId, cumulativeMeters,
    seq: rcpt.topicSequenceNumber?.toString(), status: rcpt.status.toString(),
  };
}

if (require.main === module) {
  (async () => {
    const r = await logWaypoint(parseArgs(process.argv.slice(2)));
    console.log(`Logged ${r.msg.event} for ${r.iso} on topic ${r.topicId} (seq ${r.seq}, ${r.status})`);
    console.log(`  this leg: ${metersTo(r.segmentMeters).statuteMiles} mi / ${metersTo(r.segmentMeters).nauticalMiles} nm`);
    console.log(`  attested total: ${metersTo(r.cumulativeMeters).statuteMiles} mi / ${metersTo(r.cumulativeMeters).nauticalMiles} nm (LOWER BOUND)`);
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { logWaypoint, buildWaypoint, parseArgs };

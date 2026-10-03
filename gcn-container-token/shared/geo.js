// Geodesy + journey replay for the GCN container traceability ledger.
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.
//
// HONESTY NOTE, read this before quoting any number this file produces:
// Distance is the sum of GREAT-CIRCLE hops between consecutive ATTESTED positions.
// That is a LOWER BOUND on the real distance travelled, for two reasons:
//   1. Ships do not sail great circles. They follow traffic lanes, canals, coastlines
//      and weather routing, so the sailed track is always longer than the arc.
//   2. The chain only knows the positions somebody attested. Positions between two
//      attestations are unknown, and a sparse log cuts corners off the real track.
// Call it "attested great-circle distance", never "distance travelled".

const R_EARTH_M = 6371008.8; // IUGG mean Earth radius, metres
const M_PER_NAUTICAL_MILE = 1852;
const M_PER_STATUTE_MILE = 1609.344;

// Plausibility ceilings per transport mode, metres/second. Used to reject a segment
// that no real conveyance could have covered in the elapsed time - a cheap integrity
// check against a mistyped coordinate or a fabricated leg. Generous on purpose.
const MAX_SPEED_MPS = {
  SEA: 15.5,   // ~30 kn; a container ship cruises 11-12 kn
  ROAD: 35,    // ~126 km/h
  RAIL: 45,    // ~162 km/h
  AIR: 300,    // ~1080 km/h
  YARD: 3,     // terminal handling / reefer plug moves
};

const EVENT_TYPES = [
  "GATE_OUT",       // left an inland depot or shipper site
  "LOADED_VESSEL",  // lifted aboard; container position == vessel position from here
  "VESSEL_POSITION",// position while aboard (inherited from the vessel)
  "TRANSSHIPPED",   // moved between vessels at a hub
  "DISCHARGED",     // lifted ashore
  "GATE_IN",        // entered a depot or consignee site
  "CUSTOMS_HOLD",
  "DELIVERED",
];

// Evidence tiers, strongest first. The tier is the honest answer to "how do we know?".
// Only TIER1 observes the CONTAINER. Tiers 2-4 observe paperwork or the SHIP.
const EVIDENCE_TIERS = {
  TIER1_CONTAINER_TELEMETRY: "GPS/BLE tracker fixed to this container - observes the box itself",
  TIER2_CARRIER_EDI: "Carrier/terminal system of record (CODECO, BAPLIE, B/L) - observes the handling event",
  TIER3_VESSEL_AIS: "Vessel AIS position - observes the SHIP, inherited by the box only while demonstrably aboard",
  TIER4_MANUAL: "Human attestation, no machine source - weakest; evidence hash should point at a document",
};

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two WGS-84 points (haversine). */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees, useful for sanity-checking a leg against a known lane. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function metersTo(m) {
  return {
    meters: Math.round(m),
    km: +(m / 1000).toFixed(1),
    nauticalMiles: +(m / M_PER_NAUTICAL_MILE).toFixed(1),
    statuteMiles: +(m / M_PER_STATUTE_MILE).toFixed(1),
  };
}

/** Coordinates are stored on-chain as int32 scaled by 1e5 (~1.1 m resolution). */
const E5 = 100000;
const toE5 = (deg) => Math.round(deg * E5);
const fromE5 = (i) => i / E5;

function validateCoord(lat, lon) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return "latitude out of range";
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return "longitude out of range";
  return null;
}

/**
 * Replay an attested waypoint log into a journey summary.
 * Input: waypoints [{ at (ISO or epoch s), lat, lon, eventType, mode, unlocode, tier, evidenceHash }]
 * Never silently drops a bad waypoint - everything questionable comes back in `anomalies`,
 * because a traceability record that hides its gaps is worse than no record.
 */
function replayJourney(waypointsIn, opts = {}) {
  const staleAfterDays = opts.staleAfterDays ?? 14;
  const wps = waypointsIn
    .map((w, i) => ({
      ...w,
      i,
      t: typeof w.at === "number" ? w.at : Math.floor(new Date(w.at).getTime() / 1000),
    }))
    .sort((a, b) => a.t - b.t);

  const anomalies = [];
  const legs = [];
  let cumulative = 0;

  wps.forEach((w, n) => {
    const bad = validateCoord(w.lat, w.lon);
    if (bad) anomalies.push({ at: w.at, kind: "BAD_COORDINATE", detail: bad });
    if (!EVENT_TYPES.includes(w.eventType)) {
      anomalies.push({ at: w.at, kind: "UNKNOWN_EVENT_TYPE", detail: String(w.eventType) });
    }
    if (!(w.tier in EVIDENCE_TIERS)) {
      anomalies.push({ at: w.at, kind: "UNKNOWN_EVIDENCE_TIER", detail: String(w.tier) });
    }
    if (!w.evidenceHash) {
      anomalies.push({ at: w.at, kind: "NO_EVIDENCE_HASH", detail: "event is unsupported by a document hash" });
    }
    if (n === 0) return;

    const p = wps[n - 1];
    if (w.t === p.t && w.lat === p.lat && w.lon === p.lon) {
      anomalies.push({ at: w.at, kind: "DUPLICATE_WAYPOINT", detail: "same time and position as previous" });
      return;
    }
    const dt = w.t - p.t;
    const d = haversineMeters(p.lat, p.lon, w.lat, w.lon);
    const mode = w.mode || "SEA";
    const ceiling = MAX_SPEED_MPS[mode] ?? MAX_SPEED_MPS.SEA;
    const speed = dt > 0 ? d / dt : Infinity;

    if (dt <= 0) {
      anomalies.push({ at: w.at, kind: "NON_MONOTONIC_TIME", detail: "timestamp not after previous waypoint" });
    } else if (speed > ceiling) {
      anomalies.push({
        at: w.at,
        kind: "IMPLAUSIBLE_SPEED",
        detail: `${(speed).toFixed(1)} m/s over ${mode} leg exceeds ceiling ${ceiling} m/s - coordinate error or fabricated leg`,
      });
    }
    if (dt > staleAfterDays * 86400) {
      anomalies.push({
        at: w.at,
        kind: "COVERAGE_GAP",
        detail: `${(dt / 86400).toFixed(1)} days with no attested position; the track between is unknown`,
      });
    }
    cumulative += d;
    legs.push({
      from: { at: p.at, unlocode: p.unlocode, lat: p.lat, lon: p.lon },
      to: { at: w.at, unlocode: w.unlocode, lat: w.lat, lon: w.lon },
      mode,
      eventType: w.eventType,
      tier: w.tier,
      bearingDeg: +bearingDeg(p.lat, p.lon, w.lat, w.lon).toFixed(1),
      durationHours: +(dt / 3600).toFixed(1),
      averageSpeedMps: dt > 0 ? +(d / dt).toFixed(2) : null,
      distance: metersTo(d),
    });
  });

  // A vessel AIS position only says anything about a container while the container is
  // demonstrably aboard that vessel - between a LOADED_VESSEL/TRANSSHIPPED and the next
  // DISCHARGED/GATE_IN/DELIVERED. Outside that window it is a ship's position being
  // presented as a container's, which is the exact confusion the tier system exists to
  // prevent, so it is flagged rather than quietly counted.
  let aboard = false;
  let orphanAis = 0;
  for (const w of wps) {
    if (w.eventType === "LOADED_VESSEL" || w.eventType === "TRANSSHIPPED") aboard = true;
    else if (["DISCHARGED", "GATE_IN", "DELIVERED"].includes(w.eventType)) aboard = false;
    else if (w.tier === "TIER3_VESSEL_AIS" && !aboard) {
      orphanAis++;
      anomalies.push({
        at: w.at,
        kind: "ORPHAN_VESSEL_POSITION",
        detail: "vessel AIS position outside any loaded voyage window - a ship's position attributed to a container not shown to be aboard",
      });
    }
  }

  const portCalls = wps
    .filter((w) => w.unlocode)
    .map((w) => ({ unlocode: w.unlocode, at: w.at, eventType: w.eventType, tier: w.tier }));
  const tierCounts = wps.reduce((m, w) => ((m[w.tier] = (m[w.tier] || 0) + 1), m), {});
  const containerObserved = wps.filter((w) => w.tier === "TIER1_CONTAINER_TELEMETRY").length;

  return {
    waypointCount: wps.length,
    firstSeen: wps[0]?.at ?? null,
    lastSeen: wps[wps.length - 1]?.at ?? null,
    elapsedDays: wps.length > 1 ? +((wps[wps.length - 1].t - wps[0].t) / 86400).toFixed(1) : 0,
    attestedGreatCircleDistance: metersTo(cumulative),
    distanceCaveat:
      "Lower bound. Sum of great-circle hops between attested positions; real sailed track is longer.",
    portCalls,
    uniquePorts: [...new Set(portCalls.map((p) => p.unlocode))],
    legs,
    evidence: {
      tierCounts,
      containerLevelObservations: containerObserved,
      orphanVesselPositions: orphanAis,
      coverageNote:
        containerObserved === 0
          ? "No TIER1 observations: nothing in this log observed the container itself. Every position is inherited from a ship or taken from paperwork."
          : `${containerObserved} of ${wps.length} waypoints observed the container directly.`,
    },
    anomalies,
    integrity: anomalies.length === 0 ? "no anomalies detected" : `${anomalies.length} anomalies - see list`,
  };
}

module.exports = {
  R_EARTH_M, M_PER_NAUTICAL_MILE, M_PER_STATUTE_MILE, MAX_SPEED_MPS, EVENT_TYPES, EVIDENCE_TIERS,
  haversineMeters, bearingDeg, metersTo, toE5, fromE5, E5, validateCoord, replayJourney,
};

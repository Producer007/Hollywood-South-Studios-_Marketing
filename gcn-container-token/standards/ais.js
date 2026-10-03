// Vessel AIS -> GCN waypoint adapter, provider-agnostic.
//
// READ THIS BEFORE WIRING FLEETMON
// --------------------------------
// FleetMon's public API is retired. FleetMon and MarineTraffic were both acquired by Kpler
// (February 2023) and FleetMon was phased out from January 2024 as the two merged; the
// developer portal and apiv2.fleetmon.com are gone. Building against FleetMon today means
// building against something that is not there.
//
// So this adapter is written against a NORMALISED position shape, with a per-provider
// mapping to get there. The FleetMon profile is kept because the field names persist in
// archived exports and in anything still running on a legacy contract, but MarineTraffic /
// Kpler is the live path, and `generic` covers a raw AIS decoder or any other feed.
// Switching provider is one argument, not a rewrite.
//
// The second thing this file enforces matters more than the provider question:
//
//   AN AIS POSITION IS THE SHIP'S POSITION.
//
// It describes a container only while that container is demonstrably aboard that ship -
// between a LOADED_VESSEL/TRANSSHIPPED and the next DISCHARGED/GATE_IN/DELIVERED, on the
// vessel named in those events. Outside that window the adapter refuses to emit a
// container waypoint. That refusal is the feature. Attributing a ship's track to a box
// that was already on a truck is the most common way container "tracking" misleads people.
//
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

const { validateImo, validateMmsi } = require("../shared/identifiers");
const { validateCoord, haversineMeters } = require("../shared/geo");

// AIS navigational status (ITU-R M.1371). Status matters: a vessel "moored" or "at anchor"
// reporting movement, or a position taken while not under command, deserves a second look.
const NAV_STATUS = {
  0: "under way using engine", 1: "at anchor", 2: "not under command", 3: "restricted manoeuvrability",
  4: "constrained by draught", 5: "moored", 6: "aground", 7: "engaged in fishing",
  8: "under way sailing", 11: "under tow astern", 12: "under tow alongside", 14: "AIS-SART/MOB/EPIRB",
  15: "undefined",
};
const STATIONARY_STATUS = new Set([1, 5, 6]);

/**
 * Per-provider field mapping onto the normalised shape.
 * Each entry maps a provider payload to { imo, mmsi, name, lat, lon, at, sog, cog, heading, navStatus, source }.
 *
 * These mappings follow each provider's documented field names. Field names change: verify
 * against the provider's current response before production, and add a profile rather than
 * editing call sites.
 */
const PROVIDERS = {
  // Retired - kept for archived data and legacy contracts. Do not plan new work on it.
  fleetmon: {
    status: "RETIRED - FleetMon was phased out from January 2024 after the Kpler acquisition; apiv2.fleetmon.com is gone",
    map: (r) => ({
      imo: r.imo_number ?? r.imo ?? null,
      mmsi: r.mmsi_number ?? r.mmsi ?? null,
      name: r.name ?? r.vessel_name ?? null,
      lat: num(r.latitude ?? r.lat ?? r.position?.latitude),
      lon: num(r.longitude ?? r.lon ?? r.position?.longitude),
      at: r.timestamp ?? r.last_position_epoch ?? r.position?.timestamp ?? null,
      sog: num(r.speed ?? r.sog),
      cog: num(r.course ?? r.cog),
      heading: num(r.heading ?? r.true_heading),
      navStatus: int(r.nav_status ?? r.navigational_status),
    }),
  },
  // Live successor path for former FleetMon users.
  marinetraffic: {
    status: "ACTIVE - successor to FleetMon; both are Kpler products",
    map: (r) => ({
      imo: r.IMO ?? r.imo ?? null,
      mmsi: r.MMSI ?? r.mmsi ?? null,
      name: r.SHIPNAME ?? r.shipname ?? null,
      lat: num(r.LAT ?? r.lat),
      lon: num(r.LON ?? r.lon),
      at: r.TIMESTAMP ?? r.timestamp ?? null,
      sog: num(r.SPEED ?? r.speed),
      cog: num(r.COURSE ?? r.course),
      heading: num(r.HEADING ?? r.heading),
      navStatus: int(r.STATUS ?? r.status),
    }),
  },
  // A raw AIS decoder, a national AIS feed, or any provider already in the normalised shape.
  generic: {
    status: "ACTIVE - pass positions already in the normalised shape",
    map: (r) => ({
      imo: r.imo ?? null, mmsi: r.mmsi ?? null, name: r.name ?? null,
      lat: num(r.lat), lon: num(r.lon), at: r.at ?? r.timestamp ?? null,
      sog: num(r.sog), cog: num(r.cog), heading: num(r.heading), navStatus: int(r.navStatus),
    }),
  },
};

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const int = (v) => (v === null || v === undefined || v === "" ? null : parseInt(v, 10));

/** Normalise and validate one provider position. */
function normalisePosition(raw, provider = "generic") {
  const p = PROVIDERS[provider];
  if (!p) return { valid: false, reason: `unknown provider "${provider}"; one of ${Object.keys(PROVIDERS).join(", ")}` };
  const n = p.map(raw);
  const warnings = [];

  if (!n.imo && !n.mmsi) return { valid: false, reason: "position identifies no vessel (no IMO and no MMSI)" };
  if (n.imo) {
    const v = validateImo(n.imo);
    if (!v.valid) return { valid: false, reason: `IMO: ${v.reason}` };
    n.imo = v.imo;
  }
  if (n.mmsi) {
    const v = validateMmsi(n.mmsi);
    if (!v.valid) warnings.push(`MMSI: ${v.reason}`);
    else {
      n.mmsi = v.mmsi;
      if (!v.isShipStation) warnings.push(v.warning);
    }
  }
  const bad = validateCoord(n.lat, n.lon);
  if (bad) return { valid: false, reason: `position: ${bad}` };

  const at = n.at === null ? null : new Date(typeof n.at === "number" ? n.at * (n.at < 1e11 ? 1000 : 1) : n.at);
  if (!at || Number.isNaN(at.getTime())) return { valid: false, reason: "position has no usable timestamp" };
  n.at = at.toISOString();

  if (n.navStatus !== null && !(n.navStatus in NAV_STATUS)) warnings.push(`unknown navigational status ${n.navStatus}`);
  if (n.sog !== null && n.sog > 40) warnings.push(`speed over ground ${n.sog} kn is implausible for a container vessel`);
  if (n.navStatus !== null && STATIONARY_STATUS.has(n.navStatus) && n.sog > 1) {
    warnings.push(`navigational status "${NAV_STATUS[n.navStatus]}" contradicts ${n.sog} kn speed over ground`);
  }

  return { valid: true, position: { ...n, providerStatus: p.status, provider }, warnings };
}

/**
 * Derive the windows during which the container was aboard a named vessel, from the
 * container's own event history. This is the gate every AIS position has to pass.
 */
function voyageWindows(containerEvents) {
  const sorted = containerEvents.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const windows = [];
  let open = null;
  for (const e of sorted) {
    if (["LOADED_VESSEL", "TRANSSHIPPED"].includes(e.eventType)) {
      open = { from: e.at, imo: e.vesselImo || null, to: null };
      windows.push(open);
    } else if (["DISCHARGED", "GATE_IN", "DELIVERED"].includes(e.eventType) && open) {
      open.to = e.at;
      open = null;
    }
  }
  return windows;
}

/**
 * Turn vessel AIS positions into TIER3 container waypoints - but only those that fall
 * inside a loaded voyage window on the right vessel.
 */
function aisToWaypoints(rawPositions, { provider = "generic", containerEvents = [], requireImoMatch = true } = {}) {
  const windows = voyageWindows(containerEvents);
  const waypoints = [];
  const rejected = [];
  const warnings = [];

  if (!windows.length) {
    return {
      waypoints: [], rejected: rawPositions.map(() => ({ reason: "no loaded voyage window" })), warnings,
      note: "The container has no LOADED_VESSEL event, so no AIS position can be attributed to it. " +
            "Record the load event first; a ship's track is not a container's track.",
    };
  }

  for (const raw of rawPositions) {
    const n = normalisePosition(raw, provider);
    if (!n.valid) { rejected.push({ reason: n.reason }); continue; }
    n.warnings.forEach((w) => warnings.push({ at: n.position.at, warning: w }));

    const t = new Date(n.position.at).getTime();
    const win = windows.find((w) => {
      const from = new Date(w.from).getTime();
      const to = w.to ? new Date(w.to).getTime() : Infinity;
      if (!(t >= from && t <= to)) return false;
      if (requireImoMatch && w.imo && n.position.imo && w.imo !== n.position.imo) return false;
      return true;
    });

    if (!win) {
      rejected.push({
        at: n.position.at, imo: n.position.imo,
        reason: "position falls outside any loaded voyage window for this container",
        detail: "This is the ship's position, not the container's. The box was not shown to be aboard at this time.",
      });
      continue;
    }
    if (requireImoMatch && win.imo && !n.position.imo) {
      warnings.push({ at: n.position.at, warning: "position has no IMO, so the vessel match could not be confirmed" });
    }

    waypoints.push({
      at: n.position.at,
      lat: n.position.lat, lon: n.position.lon,
      unlocode: null,
      eventType: "VESSEL_POSITION",
      mode: "SEA",
      tier: "TIER3_VESSEL_AIS",
      evidenceHash: null, // set by the caller to the hash of the stored provider response
      positionBasis: `AIS position of vessel ${n.position.imo || n.position.mmsi} (${provider}), inherited by the container while aboard`,
      vesselImo: n.position.imo,
      vesselMmsi: n.position.mmsi,
      navStatus: n.position.navStatus === null ? null : NAV_STATUS[n.position.navStatus] || String(n.position.navStatus),
      sogKnots: n.position.sog,
      source: { provider, providerStatus: n.position.providerStatus },
    });
  }

  return { waypoints, rejected, warnings,
    note: `${waypoints.length} of ${rawPositions.length} AIS positions attributable to this container; ` +
          `${rejected.length} rejected as not-aboard or invalid` };
}

/**
 * Thin out a dense AIS track. A feed can deliver a position every few minutes; writing all
 * of them to a chain is expensive and adds no information once the track is established.
 * Keeps a position when it is far enough, old enough, or turns sharply enough to matter.
 */
function thinTrack(waypoints, { minMeters = 50000, minMinutes = 360, minCourseChangeDeg = 25 } = {}) {
  const sorted = waypoints.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const kept = [];
  for (const w of sorted) {
    if (!kept.length) { kept.push(w); continue; }
    const prev = kept[kept.length - 1];
    const d = haversineMeters(prev.lat, prev.lon, w.lat, w.lon);
    const mins = (new Date(w.at) - new Date(prev.at)) / 60000;
    const turn = prev.cog !== undefined && w.cog !== undefined ? Math.abs(((w.cog - prev.cog + 540) % 360) - 180) : 0;
    if (d >= minMeters || mins >= minMinutes || turn >= minCourseChangeDeg) kept.push(w);
  }
  if (sorted.length && kept[kept.length - 1] !== sorted[sorted.length - 1]) kept.push(sorted[sorted.length - 1]);
  return kept;
}

module.exports = { PROVIDERS, NAV_STATUS, normalisePosition, voyageWindows, aisToWaypoints, thinTrack };

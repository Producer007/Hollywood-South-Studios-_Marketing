// DCSA Track & Trace <-> GCN waypoint adapter.
//
// DCSA (Digital Container Shipping Association) was founded by Maersk, MSC, CMA CGM and
// Hapag-Lloyd and now includes ONE, Evergreen, HMM, Yang Ming, ZIM and others. Its Track
// & Trace interface standard is the common event vocabulary those carriers publish, so it
// is the single most important thing for this ledger to speak. A GCN waypoint that cannot
// be expressed as a DCSA event cannot be exchanged with a major carrier.
//
// Implemented against the DCSA Interface Standard for Track and Trace 2.1 event model
// (equipment / transport / shipment events). Verify field-by-field against the carrier's
// own published API before production: carriers extend and constrain the standard.
//
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

const { lookup } = require("../shared/unlocode");
const { validateIso6346 } = require("../shared/iso6346");
const { validateImo, validateSizeType, validateFacility } = require("../shared/identifiers");

// DCSA equipment event codes -> GCN event types. Codes with no positional meaning for a
// journey (document and availability states) map to null and are carried as context, not
// as a position.
const EQUIPMENT_EVENT_MAP = {
  GTOT: "GATE_OUT",      // gate out
  GTIN: "GATE_IN",       // gate in
  LOAD: "LOADED_VESSEL", // loaded aboard
  DISC: "DISCHARGED",    // discharged ashore
  STUF: "GATE_OUT",      // stuffing - cargo into container at origin
  STRP: "GATE_IN",       // stripping - cargo out at destination
  PICK: "GATE_OUT",      // picked up
  DROP: "GATE_IN",       // dropped off
  CUSI: "CUSTOMS_HOLD",  // customs inspection
  CUSS: "CUSTOMS_HOLD",  // customs scan
  CUSR: "GATE_IN",       // customs released
  INSP: "CUSTOMS_HOLD",  // inspected
  WAYP: "VESSEL_POSITION", // waypoint crossed
  AVPU: null,            // available for pick-up - availability, not a movement
  AVDO: null,            // available for drop-off
  RSEA: null,            // resealed
  RMVD: null,            // seal removed
};

const TRANSPORT_EVENT_MAP = { ARRI: "DISCHARGED", DEPA: "LOADED_VESSEL" };

const MODE_MAP = { VESSEL: "SEA", BARGE: "SEA", RAIL: "RAIL", TRUCK: "ROAD", VESSEL_FEEDER: "SEA" };

// Reverse: GCN -> DCSA. Several GCN types collapse onto one DCSA code, which is lossless
// in the direction that matters (DCSA is the wire format, GCN is the ledger).
const GCN_TO_DCSA_EQUIPMENT = {
  GATE_OUT: "GTOT", GATE_IN: "GTIN", LOADED_VESSEL: "LOAD", DISCHARGED: "DISC",
  TRANSSHIPPED: "DISC", CUSTOMS_HOLD: "CUSI", VESSEL_POSITION: "WAYP", DELIVERED: "GTIN",
};

const FACILITY_TYPE_CODES = {
  BOCR: "border crossing", CLOC: "customs location", COFS: "container freight station",
  COYA: "container yard", OFFD: "off dock facility", DEPO: "depot", INTE: "inland terminal",
  POTE: "port terminal", RAMP: "ramp",
};

/**
 * Convert one DCSA event into a GCN waypoint.
 *
 * Two refusals are deliberate and are the point of this adapter:
 *
 *  1. Only eventClassifierCode "ACT" becomes a waypoint. "PLN" (planned) and "EST"
 *     (estimated) are forecasts. Writing a forecast into an append-only ledger as an
 *     attested position is precisely the dishonesty this ledger exists to prevent - and
 *     most of the event volume on a carrier feed is EST, so this matters in practice.
 *
 *  2. A DCSA event carries a UN/LOCODE, not a fix. The resulting position is a PORT
 *     CENTROID, accurate to kilometres, not a measured position of the container. The
 *     returned waypoint says so in positionBasis, and callers should not present it as a
 *     GPS fix.
 */
function dcsaEventToWaypoint(event, opts = {}) {
  const warnings = [];
  const classifier = event.eventClassifierCode;
  if (classifier !== "ACT") {
    return {
      accepted: false,
      reason: `eventClassifierCode "${classifier}" is a ${classifier === "PLN" ? "plan" : "estimate"}, not an observation`,
      detail: "Only ACT events are written to the ledger. Plans and estimates belong in a schedule view, not an append-only position record.",
    };
  }

  const type = event.eventType;
  let eventType = null;
  let equipmentReference = event.equipmentReference;

  if (type === "EQUIPMENT") {
    if (!(event.equipmentEventTypeCode in EQUIPMENT_EVENT_MAP)) {
      return { accepted: false, reason: `unknown equipmentEventTypeCode "${event.equipmentEventTypeCode}"` };
    }
    eventType = EQUIPMENT_EVENT_MAP[event.equipmentEventTypeCode];
    if (eventType === null) {
      return {
        accepted: false,
        reason: `equipment event "${event.equipmentEventTypeCode}" carries no movement`,
        detail: "Availability and seal events are status, not position. Record them alongside the journey, not in it.",
      };
    }
  } else if (type === "TRANSPORT") {
    if (!(event.transportEventTypeCode in TRANSPORT_EVENT_MAP)) {
      return { accepted: false, reason: `unknown transportEventTypeCode "${event.transportEventTypeCode}"` };
    }
    eventType = TRANSPORT_EVENT_MAP[event.transportEventTypeCode];
    // A transport event describes the CONVEYANCE, not the box. Without an equipment
    // reference it says nothing about any particular container.
    if (!equipmentReference) {
      return {
        accepted: false,
        reason: "transport event has no equipmentReference",
        detail: "A vessel arrival says where the ship is. It attaches to a container only when the event names one.",
      };
    }
  } else if (type === "SHIPMENT") {
    return {
      accepted: false,
      reason: "shipment events are document states, not positions",
      detail: "APPR/ISSU/SURR and similar describe paperwork. They belong in document references, not the journey.",
    };
  } else {
    return { accepted: false, reason: `unknown eventType "${type}"` };
  }

  const iso = validateIso6346(equipmentReference);
  if (!iso.valid) return { accepted: false, reason: `equipmentReference: ${iso.reason}` };

  const tc = event.transportCall || {};
  const unlocode = tc.UNLocationCode || event.eventLocation?.UNLocationCode;
  if (!unlocode) return { accepted: false, reason: "no UNLocationCode on the event or its transportCall" };
  const port = lookup(unlocode);
  if (!port.found) {
    return { accepted: false, reason: `UNLocationCode ${unlocode}: ${port.reason}`,
      detail: "Load the official UNECE UN/LOCODE list to resolve codes outside the demo table." };
  }

  // Size/type: DCSA calls it ISOEquipmentCode and expects the real ISO 6346 code.
  let sizeType = null;
  if (event.ISOEquipmentCode) {
    const st = validateSizeType(event.ISOEquipmentCode);
    if (!st.valid) warnings.push(`ISOEquipmentCode "${event.ISOEquipmentCode}": ${st.reason}`);
    else sizeType = st.sizeType;
  }

  let vesselImo = null;
  if (tc.vessel?.vesselIMONumber) {
    const v = validateImo(tc.vessel.vesselIMONumber);
    if (!v.valid) warnings.push(`vesselIMONumber: ${v.reason}`);
    else vesselImo = v.imo;
  }

  if (tc.facilityCode) {
    const f = validateFacility(tc.facilityCode, tc.facilityCodeListProvider);
    if (!f.valid) warnings.push(`facility: ${f.reason}`);
  }
  if (tc.facilityTypeCode && !(tc.facilityTypeCode in FACILITY_TYPE_CODES)) {
    warnings.push(`unknown facilityTypeCode "${tc.facilityTypeCode}"`);
  }

  if (!event.eventDateTime) return { accepted: false, reason: "eventDateTime is required" };
  const at = new Date(event.eventDateTime);
  if (Number.isNaN(at.getTime())) return { accepted: false, reason: "eventDateTime is not a valid ISO 8601 timestamp" };
  // DCSA requires an offset. A bare timestamp is ambiguous by up to 26 hours, which is
  // enough to reorder a port call.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(String(event.eventDateTime))) {
    warnings.push("eventDateTime has no UTC offset - DCSA requires one; treating as UTC");
  }

  return {
    accepted: true,
    waypoint: {
      at: at.toISOString(),
      lat: port.lat,
      lon: port.lon,
      unlocode: port.unlocode,
      eventType,
      mode: MODE_MAP[tc.modeOfTransport] || (tc.vessel ? "SEA" : "ROAD"),
      tier: opts.tier || "TIER2_CARRIER_EDI",
      evidenceHash: event.eventID || null,
      positionBasis: "UN/LOCODE port centroid, not a measured fix - accurate to kilometres",
      sizeType,
      vesselImo,
      emptyIndicatorCode: event.emptyIndicatorCode || null,
      carrierCode: tc.vessel?.vesselOperatorCarrierCode || null,
      documentReferences: event.documentReferences || [],
      source: { standard: "DCSA T&T 2.1", eventID: event.eventID, eventType: type,
        code: event.equipmentEventTypeCode || event.transportEventTypeCode },
    },
    warnings,
  };
}

/** Convert a whole DCSA event feed, keeping the rejections visible rather than dropping them. */
function dcsaFeedToWaypoints(events, opts = {}) {
  const waypoints = [];
  const rejected = [];
  const warnings = [];
  for (const e of events) {
    const r = dcsaEventToWaypoint(e, opts);
    if (r.accepted) {
      waypoints.push(r.waypoint);
      r.warnings.forEach((w) => warnings.push({ eventID: e.eventID, warning: w }));
    } else {
      rejected.push({ eventID: e.eventID, reason: r.reason, detail: r.detail });
    }
  }
  return { waypoints, rejected, warnings,
    note: `${waypoints.length} of ${events.length} events became waypoints; ${rejected.length} rejected (see list)` };
}

/**
 * GCN waypoint -> DCSA equipment event, so the ledger can publish into carrier and
 * forwarder systems rather than only consume from them.
 */
function waypointToDcsaEvent(wp, { containerId, eventID, sizeType, emptyIndicatorCode = "LADEN", vessel, facility } = {}) {
  const iso = validateIso6346(containerId);
  if (!iso.valid) throw new Error(`containerId: ${iso.reason}`);
  const code = GCN_TO_DCSA_EQUIPMENT[wp.eventType];
  if (!code) throw new Error(`no DCSA equipment code for GCN event type "${wp.eventType}"`);

  const out = {
    eventID: eventID || null,
    eventType: "EQUIPMENT",
    eventCreatedDateTime: new Date().toISOString(),
    eventDateTime: new Date(wp.at).toISOString(),
    // Everything this ledger writes is an observation, never a forecast.
    eventClassifierCode: "ACT",
    equipmentEventTypeCode: code,
    equipmentReference: iso.id,
    emptyIndicatorCode,
  };
  if (sizeType) {
    const st = validateSizeType(sizeType);
    if (!st.valid) throw new Error(`sizeType: ${st.reason}`);
    out.ISOEquipmentCode = st.sizeType;
  }
  if (wp.unlocode) {
    out.transportCall = {
      UNLocationCode: wp.unlocode,
      modeOfTransport: Object.keys(MODE_MAP).find((k) => MODE_MAP[k] === (wp.mode || "SEA")) || "VESSEL",
    };
    if (facility) {
      const f = validateFacility(facility.code, facility.provider);
      if (!f.valid) throw new Error(`facility: ${f.reason}`);
      out.transportCall.facilityCode = f.facilityCode;
      out.transportCall.facilityCodeListProvider = f.facilityCodeListProvider;
      if (facility.typeCode) out.transportCall.facilityTypeCode = facility.typeCode;
    }
    if (vessel?.imo) {
      const v = validateImo(vessel.imo);
      if (!v.valid) throw new Error(`vessel.imo: ${v.reason}`);
      out.transportCall.vessel = { vesselIMONumber: v.imo, vesselName: vessel.name || undefined,
        vesselOperatorCarrierCode: vessel.carrierCode || undefined };
    }
  }
  return out;
}

module.exports = {
  dcsaEventToWaypoint, dcsaFeedToWaypoints, waypointToDcsaEvent,
  EQUIPMENT_EVENT_MAP, TRANSPORT_EVENT_MAP, MODE_MAP, GCN_TO_DCSA_EQUIPMENT, FACILITY_TYPE_CODES,
};

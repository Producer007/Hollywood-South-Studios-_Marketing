// GS1 EPCIS 2.0 export for the GCN container journey.
//
// Why EPCIS matters here: DCSA and EDIFACT are shipping-industry formats. EPCIS is the
// cross-industry GS1 standard for supply-chain visibility - what, when, where, why - and
// it is what a shipper's own traceability stack, a retailer (Walmart and others mandate
// EPCIS 2.0 from suppliers), a customs system or a food/pharma chain will expect. Exporting
// EPCIS is what lets a GCN container journey land in a system that has never heard of GCN.
//
// EPCIS 2.0 is JSON-LD. Container equipment is identified by GIAI (Global Individual Asset
// Identifier); the ISO 6346 id is carried both inside the GIAI and as a plain property so
// a reader that does not resolve GIAIs can still see it.
//
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

const { validateIso6346 } = require("../shared/iso6346");
const { lookup } = require("../shared/unlocode");

const EPCIS_CONTEXT = "https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld";
const CBV = "https://ref.gs1.org/cbv/";

// GCN event type -> CBV business step + disposition.
const CBV_MAP = {
  GATE_OUT: { bizStep: "departing", disposition: "in_transit" },
  LOADED_VESSEL: { bizStep: "loading", disposition: "in_transit" },
  VESSEL_POSITION: { bizStep: "transporting", disposition: "in_transit" },
  TRANSSHIPPED: { bizStep: "transporting", disposition: "in_transit" },
  DISCHARGED: { bizStep: "unloading", disposition: "in_progress" },
  GATE_IN: { bizStep: "arriving", disposition: "in_progress" },
  CUSTOMS_HOLD: { bizStep: "inspecting", disposition: "non_sellable_other" },
  DELIVERED: { bizStep: "receiving", disposition: "in_progress" },
};

/**
 * GIAI for a container.
 * @param companyPrefix GS1 Company Prefix of the asset owner. There is no correct default:
 *        a fabricated prefix would be another company's identifier, so the caller must supply it.
 */
function containerGiai(companyPrefix, isoId) {
  if (!/^[0-9]{6,12}$/.test(String(companyPrefix || ""))) {
    throw new Error("a real GS1 Company Prefix (6-12 digits) is required; GIAIs must not be invented");
  }
  return `urn:epc:id:giai:${companyPrefix}.${isoId}`;
}

/** UN/LOCODE -> an SGLN-shaped location, or a geo URI when no GLN is available. */
function locationFor(unlocode, glnMap = {}) {
  const code = String(unlocode || "").toUpperCase();
  if (glnMap[code]) return { id: `urn:epc:id:sgln:${glnMap[code]}` };
  const p = lookup(code);
  // Honest fallback: without a GLN, name the place by UN/LOCODE and a geo URI rather than
  // minting a GLN, which would be someone else's identifier.
  return {
    id: `https://unlocode.gs1.org/${code}`,
    "gcn:unlocode": code,
    ...(p.found ? { "gcn:geo": `geo:${p.lat},${p.lon}`, "gcn:positionBasis": "approximate port centroid" } : {}),
  };
}

/**
 * Build an EPCIS 2.0 document from a GCN journey.
 *
 * Every event carries gcn:evidenceTier. That is a GCN extension, not GS1 vocabulary, and it
 * is deliberately prominent: an EPCIS reader that ignores it would treat an AIS-derived
 * position exactly like a scanned read, which is the confusion this whole design avoids.
 */
function journeyToEpcis(waypoints, { containerId, companyPrefix, glnMap = {}, sensorReadings = {} } = {}) {
  const iso = validateIso6346(containerId);
  if (!iso.valid) throw new Error(`containerId: ${iso.reason}`);
  const epc = containerGiai(companyPrefix, iso.id);

  const eventList = waypoints
    .slice()
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((w) => {
      const cbv = CBV_MAP[w.eventType];
      if (!cbv) throw new Error(`no CBV mapping for GCN event type "${w.eventType}"`);
      const at = new Date(w.at);
      const ev = {
        type: "ObjectEvent",
        eventTime: at.toISOString(),
        // EPCIS requires the offset the event was recorded in. The ledger stores UTC, so
        // the honest answer is +00:00 rather than a local offset that was never captured.
        eventTimeZoneOffset: "+00:00",
        epcList: [epc],
        action: "OBSERVE",
        bizStep: `${CBV}BizStep-${cbv.bizStep}`,
        disposition: `${CBV}Disp-${cbv.disposition}`,
        readPoint: locationFor(w.unlocode, glnMap),
        "gcn:evidenceTier": w.tier,
        "gcn:evidenceTierMeaning": tierMeaning(w.tier),
        "gcn:eventType": w.eventType,
        "gcn:modeOfTransport": w.mode || "SEA",
      };
      if (w.unlocode) ev.bizLocation = locationFor(w.unlocode, glnMap);
      if (w.evidenceHash) ev["gcn:evidenceHash"] = w.evidenceHash;
      if (w.vesselImo) ev["gcn:carryingVesselIMO"] = w.vesselImo;
      if (w.positionBasis) ev["gcn:positionBasis"] = w.positionBasis;

      // Reefer / shock / door telemetry rides along as EPCIS sensor data when present.
      const readings = sensorReadings[w.at];
      if (readings?.length) {
        ev.sensorElementList = [{
          sensorMetadata: { time: at.toISOString(), deviceID: readings[0].deviceId || undefined },
          sensorReport: readings.map((r) => ({ type: `gs1:${r.type}`, value: r.value, uom: r.uom })),
        }];
      }
      return ev;
    });

  return {
    "@context": [EPCIS_CONTEXT, { gcn: "https://gcn.exchange/epcis/ext/" }],
    type: "EPCISDocument",
    schemaVersion: "2.0",
    creationDate: new Date().toISOString(),
    epcisBody: { eventList },
    "gcn:disclaimer":
      "Testnet proof-of-concept. Positions are attested observations, not proof of physical movement. " +
      "Read gcn:evidenceTier on every event: only TIER1_CONTAINER_TELEMETRY observed the container itself.",
  };
}

function tierMeaning(tier) {
  return {
    TIER1_CONTAINER_TELEMETRY: "device on the container observed this position",
    TIER2_CARRIER_EDI: "carrier or terminal system of record reported this handling event",
    TIER3_VESSEL_AIS: "the SHIP's position, inherited by the container only while demonstrably aboard",
    TIER4_MANUAL: "human assertion, no machine source",
  }[tier] || "unknown evidence tier";
}

module.exports = { journeyToEpcis, containerGiai, locationFor, tierMeaning, CBV_MAP, EPCIS_CONTEXT };

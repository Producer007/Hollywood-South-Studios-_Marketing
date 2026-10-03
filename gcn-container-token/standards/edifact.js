// UN/EDIFACT CODECO / IFTSTA -> GCN waypoint adapter.
//
// Why this is here even though DCSA exists: DCSA is the modern REST standard, but the
// installed base still runs on EDIFACT. Terminal operators send CODECO (container gate-in
// / gate-out report) and carriers send IFTSTA (international multimodal status report),
// and a platform that cannot read them is cut off from most terminals in the world today.
//
// IMPORTANT, read before trusting output: every terminal and carrier publishes its own
// Message Implementation Guide (MIG). Qualifiers, segment groups and which DTM/LOC
// qualifier carries which meaning vary between partners. This parser handles the COMMON
// SUBSET and exposes its mapping tables so a partner-specific profile can override them.
// It is not a certified conformance implementation, and output must be validated against
// each partner's MIG before any production use.
//
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

const { validateIso6346 } = require("../shared/iso6346");
const { validateSizeType } = require("../shared/identifiers");
const { lookup } = require("../shared/unlocode");

// Default service characters (UNA can override them per interchange).
const DEFAULT_DELIMS = { segment: "'", element: "+", component: ":", decimal: ".", release: "?" };

/** Split an EDIFACT interchange into segments, honouring the release (escape) character. */
function tokenize(raw) {
  let s = String(raw).replace(/\r?\n/g, "").trim();
  const d = { ...DEFAULT_DELIMS };
  if (s.startsWith("UNA")) {
    const una = s.slice(3, 9);
    d.component = una[0]; d.element = una[1]; d.decimal = una[2]; d.release = una[3]; d.segment = una[5];
    s = s.slice(9);
  }
  const segments = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === d.release) { buf += s[++i] ?? ""; continue; }
    if (ch === d.segment) { if (buf.trim()) segments.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) segments.push(buf.trim());

  return segments.map((seg) => {
    const parts = [];
    let cur = "";
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (ch === d.release) { cur += seg[++i] ?? ""; continue; }
      if (ch === d.element) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    parts.push(cur);
    return { tag: parts[0], elements: parts.slice(1).map((e) => e.split(d.component)) };
  });
}

// BGM document-name codes commonly used on container movement messages. Terminals differ;
// when the code is unrecognised the parser falls back to the per-container movement
// qualifier rather than guessing.
const BGM_MOVEMENT = { 34: "GATE_IN", 36: "GATE_OUT", 998: "GATE_IN", 999: "GATE_OUT" };

// EQD data element 8169 - full/empty indicator.
const FULL_EMPTY = { 4: "EMPTY", 5: "LADEN" };

// LOC qualifiers that carry a place we can resolve to coordinates.
const LOC_QUALIFIERS = {
  9: "place of loading", 11: "place of discharge", 7: "place of delivery", 5: "place of departure",
  13: "place of transhipment", 92: "routing", 165: "place of delivery", 6: "place of arrival",
  88: "place of receipt", 164: "place of receipt",
};

// DTM qualifiers for an ACTUAL time. Planned/estimated qualifiers are deliberately absent:
// a forecast must not become an attested position. See dcsa.js for the same rule.
const DTM_ACTUAL = { 7: "effective", 178: "actual arrival", 186: "actual departure", 203: "execution",
  798: "actual gate in/out", 334: "actual" };
const DTM_FORECAST = { 132: "estimated arrival", 133: "estimated departure", 134: "planned", 2: "requested delivery" };

// IFTSTA status codes (UN/EDIFACT 4405 / 9601-family as commonly profiled) -> GCN events.
const IFTSTA_STATUS = {
  1: "GATE_IN", 2: "GATE_OUT", 3: "LOADED_VESSEL", 4: "DISCHARGED", 5: "DELIVERED",
  6: "CUSTOMS_HOLD", 7: "TRANSSHIPPED", 8: "GATE_OUT", 9: "VESSEL_POSITION",
};

function parseDateTime(el) {
  // DTM+qualifier:value:format - format 203 = CCYYMMDDHHMM, 102 = CCYYMMDD, 204 = +SS
  const [qualifier, value, format] = el;
  if (!value) return null;
  const f = String(format || "203");
  const y = value.slice(0, 4), mo = value.slice(4, 6), d = value.slice(6, 8);
  const h = f === "102" ? "00" : value.slice(8, 10) || "00";
  const mi = f === "102" ? "00" : value.slice(10, 12) || "00";
  const s = f === "204" ? value.slice(12, 14) || "00" : "00";
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : { qualifier: String(qualifier), at: dt.toISOString() };
}

/**
 * Parse a CODECO or IFTSTA interchange into GCN waypoints.
 *
 * Rejections are returned, never silently dropped: a message whose container id fails its
 * check digit, or whose only timestamp is an estimate, must be visible as a rejection
 * rather than vanishing from a traceability record.
 */
function parseEdifact(raw, opts = {}) {
  const segments = tokenize(raw);
  if (!segments.length) return { messageType: null, waypoints: [], rejected: [{ reason: "no segments found" }], warnings: [] };

  const unh = segments.find((s) => s.tag === "UNH");
  const messageType = unh?.elements?.[1]?.[0] || null;
  if (messageType && !["CODECO", "IFTSTA"].includes(messageType)) {
    return { messageType, waypoints: [], rejected: [{ reason: `unsupported message type ${messageType}; this parser handles CODECO and IFTSTA` }], warnings: [] };
  }

  const bgm = segments.find((s) => s.tag === "BGM");
  const defaultMovement = BGM_MOVEMENT[bgm?.elements?.[0]?.[0]] || null;

  const waypoints = [];
  const rejected = [];
  const warnings = [];

  // Walk the interchange, accumulating state per EQD group. EDIFACT is positional: an
  // LOC/DTM after an EQD belongs to that equipment until the next EQD.
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const iso = validateIso6346(cur.equipmentReference);
    if (!iso.valid) {
      rejected.push({ equipmentReference: cur.equipmentReference, reason: `ISO 6346: ${iso.reason}` });
      cur = null; return;
    }
    if (!cur.at) {
      const why = cur.forecastOnly
        ? "only estimated/planned times present; a forecast is not an observation"
        : "no usable DTM segment";
      rejected.push({ equipmentReference: iso.id, reason: why });
      cur = null; return;
    }
    if (!cur.unlocode) {
      rejected.push({ equipmentReference: iso.id, reason: "no resolvable LOC segment" });
      cur = null; return;
    }
    const port = lookup(cur.unlocode);
    if (!port.found) {
      rejected.push({ equipmentReference: iso.id, reason: `LOC ${cur.unlocode}: ${port.reason}` });
      cur = null; return;
    }
    const eventType = cur.eventType || defaultMovement;
    if (!eventType) {
      rejected.push({ equipmentReference: iso.id, reason: "cannot determine movement type from BGM or status code" });
      cur = null; return;
    }
    waypoints.push({
      at: cur.at,
      lat: port.lat, lon: port.lon, unlocode: port.unlocode,
      eventType,
      mode: cur.mode || "SEA",
      tier: opts.tier || "TIER2_CARRIER_EDI",
      evidenceHash: opts.evidenceHash || null,
      positionBasis: "UN/LOCODE port centroid from an EDI message, not a measured fix",
      sizeType: cur.sizeType || null,
      emptyIndicatorCode: cur.emptyIndicator || null,
      sealNumbers: cur.seals.length ? cur.seals : undefined,
      source: { standard: messageType || "EDIFACT", bgm: bgm?.elements?.[0]?.[0] || null },
    });
    cur = null;
  };

  for (const seg of segments) {
    switch (seg.tag) {
      case "EQD": {
        flush();
        const [kind, ref, sizeTypeEl, , , fullEmpty] = seg.elements;
        if (String(kind?.[0]) !== "CN" && String(kind?.[0]) !== "CX") {
          // CN = container. Anything else (chassis, trailer) is not what this ledger tracks.
          warnings.push(`EQD equipment qualifier "${kind?.[0]}" is not a container; skipped`);
          break;
        }
        cur = { equipmentReference: ref?.[0], at: null, unlocode: null, eventType: null, seals: [], forecastOnly: false };
        if (sizeTypeEl?.[0]) {
          const st = validateSizeType(sizeTypeEl[0]);
          if (st.valid) cur.sizeType = st.sizeType;
          else warnings.push(`EQD size/type "${sizeTypeEl[0]}": ${st.reason}`);
        }
        if (fullEmpty?.[0]) cur.emptyIndicator = FULL_EMPTY[fullEmpty[0]] || null;
        break;
      }
      case "LOC": {
        if (!cur) break;
        const q = String(seg.elements[0]?.[0]);
        const code = seg.elements[1]?.[0];
        if (q in LOC_QUALIFIERS && code && !cur.unlocode) cur.unlocode = String(code).toUpperCase();
        break;
      }
      case "DTM": {
        if (!cur) break;
        const parsed = parseDateTime(seg.elements[0] || []);
        if (!parsed) break;
        if (parsed.qualifier in DTM_ACTUAL) {
          if (!cur.at) cur.at = parsed.at;
        } else if (parsed.qualifier in DTM_FORECAST) {
          cur.forecastOnly = true;
        }
        break;
      }
      case "STS": {
        // IFTSTA status. Element 1 component 1 carries the status code in most profiles.
        if (!cur) break;
        const code = seg.elements[0]?.[0] ?? seg.elements[1]?.[0];
        if (code && IFTSTA_STATUS[code]) cur.eventType = IFTSTA_STATUS[code];
        break;
      }
      case "SEL": {
        if (cur && seg.elements[0]?.[0]) cur.seals.push(seg.elements[0][0]);
        break;
      }
      case "TDT": {
        // Mode of transport, element 2 (3 = road, 2 = rail, 1 = sea/maritime, 4 = air).
        const m = seg.elements[1]?.[0];
        const map = { 1: "SEA", 2: "RAIL", 3: "ROAD", 4: "AIR", 8: "SEA" };
        if (cur && map[m]) cur.mode = map[m];
        break;
      }
      default:
        break;
    }
  }
  flush();

  return { messageType, waypoints, rejected, warnings,
    note: "Common-subset parse. Validate against each partner's Message Implementation Guide before production use." };
}

module.exports = {
  parseEdifact, tokenize,
  BGM_MOVEMENT, FULL_EMPTY, LOC_QUALIFIERS, DTM_ACTUAL, DTM_FORECAST, IFTSTA_STATUS,
};

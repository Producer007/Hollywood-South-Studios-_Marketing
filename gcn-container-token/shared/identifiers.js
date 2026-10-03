// Industry identifier validation for the GCN container ledger.
//
// Why this file exists: the ledger is only interoperable if the identifiers in it are the
// ones the rest of the industry uses, spelled the way the rest of the industry spells
// them. A free-text "40HC" in a size/type field is not an ISO 6346 size/type code, and a
// 7-digit IMO with no check-digit test is not a validated IMO. Both look fine until a
// carrier's system rejects the record.
//
// TESTNET / PRE-AUDIT / PROOF-OF-CONCEPT.

// ---------------------------------------------------------------- IMO (ISO 6346's sibling)
// IMO ship number: 7 digits. The first 6 are weighted 7,6,5,4,3,2; the last digit of the
// sum is the check digit. Source: IMO Resolution A.600(15) / ISO 8713.
function validateImo(imo) {
  const s = String(imo || "").trim().replace(/^IMO\s*/i, "");
  if (!/^[0-9]{7}$/.test(s)) return { valid: false, reason: "IMO must be 7 digits" };
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(s[i]) * (7 - i);
  const expected = sum % 10;
  if (expected !== Number(s[6])) return { valid: false, reason: `IMO check digit should be ${expected}` };
  return { valid: true, imo: s };
}

// ---------------------------------------------------------------------------------- MMSI
// Maritime Mobile Service Identity: 9 digits. A ship station carries MID in positions 1-3,
// where MID is 201-775. Other prefixes identify things that are not ships, and attributing
// a container to one is a category error worth catching.
const MMSI_KINDS = [
  [/^0{2}[2-7][0-9]{2}[0-9]{4}$/, "coast station"],
  [/^0[2-7][0-9]{2}[0-9]{5}$/, "group of ships"],
  [/^111[2-7][0-9]{5}$/, "SAR aircraft"],
  [/^99[2-7][0-9]{6}$/, "aid to navigation"],
  [/^98[2-7][0-9]{6}$/, "craft associated with parent ship"],
  [/^8[2-7][0-9]{7}$/, "handheld VHF"],
  [/^97[0-9]{7}$/, "AIS-SART / MOB / EPIRB"],
];

function validateMmsi(mmsi) {
  const s = String(mmsi || "").trim();
  if (!/^[0-9]{9}$/.test(s)) return { valid: false, reason: "MMSI must be 9 digits" };
  for (const [re, kind] of MMSI_KINDS) {
    if (re.test(s)) {
      return { valid: true, mmsi: s, kind, isShipStation: false,
        warning: `MMSI identifies a ${kind}, not a ship station - a container position should not be derived from it` };
    }
  }
  const mid = Number(s.slice(0, 3));
  if (mid < 201 || mid > 775) return { valid: false, reason: `MID ${mid} outside the assigned 201-775 range` };
  return { valid: true, mmsi: s, mid, kind: "ship station", isShipStation: true };
}

// --------------------------------------------------------------- ISO 6346 size/type code
// Four characters: [length][height&width][type][type detail]. This is the code carriers
// exchange; "40HC", "40'HQ" and friends are yard shorthand, not ISO codes.
const LENGTH_CODES = {
  "1": "10 ft (2991 mm)", "2": "20 ft (6058 mm)", "3": "30 ft (9125 mm)", "4": "40 ft (12192 mm)",
  L: "45 ft", M: "48 ft", N: "53 ft",
};
const HEIGHT_WIDTH_CODES = {
  "0": "8 ft 0 in, width <= 2438 mm", "2": "8 ft 6 in, width <= 2438 mm", "4": "9 ft 0 in, width <= 2438 mm",
  "5": "9 ft 6 in, width <= 2438 mm (high cube)", "6": "> 9 ft 6 in, width <= 2438 mm",
  "8": "4 ft 3 in, width <= 2438 mm", "9": "<= 4 ft, width <= 2438 mm",
  C: "8 ft 6 in, width > 2438 mm", D: "9 ft 0 in, width > 2438 mm", E: "9 ft 6 in, width > 2438 mm",
};
const TYPE_CODES = {
  G: "general purpose, no ventilation", V: "general purpose, ventilated", B: "dry bulk",
  S: "named cargo (livestock, auto, etc.)", R: "refrigerated, integral reefer",
  H: "refrigerated or heated, insulated", U: "open top", P: "platform or platform-based (flat rack)",
  T: "tank", A: "air/surface",
};
// Yard shorthand people actually type, mapped to the ISO code a carrier expects.
const COLLOQUIAL = {
  "20GP": "22G1", "20DV": "22G1", "20FT": "22G1", "20STD": "22G1",
  "40GP": "42G1", "40DV": "42G1", "40FT": "42G1", "40STD": "42G1",
  "40HC": "45G1", "40HQ": "45G1", "40HCUBE": "45G1",
  "20RF": "22R1", "40RF": "42R1", "40RH": "45R1", "40HR": "45R1",
  "20OT": "22U1", "40OT": "42U1", "20FR": "22P1", "40FR": "42P1", "20TK": "22T1",
  "45HC": "L5G1",
};

function validateSizeType(code) {
  const raw = String(code || "").toUpperCase().replace(/[\s'"-]/g, "");
  if (!raw) return { valid: false, reason: "size/type code required" };

  const mapped = COLLOQUIAL[raw];
  if (mapped) {
    return { valid: true, sizeType: mapped, normalisedFrom: raw,
      note: `"${raw}" is yard shorthand; the ISO 6346 size/type code is ${mapped}`, ...describeSizeType(mapped) };
  }
  if (!/^[0-9A-Z]{4}$/.test(raw)) {
    return { valid: false, reason: "ISO 6346 size/type is 4 characters, e.g. 22G1 (20 ft GP) or 45G1 (40 ft high cube GP)" };
  }
  const d = describeSizeType(raw);
  if (!d.length) return { valid: false, reason: `unknown length code "${raw[0]}"` };
  if (!d.heightWidth) return { valid: false, reason: `unknown height/width code "${raw[1]}"` };
  if (!d.type) return { valid: false, reason: `unknown type code "${raw[2]}"` };
  return { valid: true, sizeType: raw, ...d };
}

function describeSizeType(code) {
  return {
    length: LENGTH_CODES[code[0]] || null,
    heightWidth: HEIGHT_WIDTH_CODES[code[1]] || null,
    type: TYPE_CODES[code[2]] || null,
    typeDetail: code[3],
  };
}

// ---------------------------------------------------------------------------------- SCAC
// Standard Carrier Alpha Code, assigned by NMFTA. 2-4 letters. A code ending in U is an
// ISO 6346 container-owner code, which is why container ids end in U/J/Z.
// The table below is the handful of ocean carriers this ledger is most likely to meet.
// It is a convenience lookup, NOT the NMFTA register - verify before relying on it.
const KNOWN_SCAC = {
  MAEU: "Maersk", MSCU: "MSC", CMDU: "CMA CGM", HLCU: "Hapag-Lloyd", ONEY: "Ocean Network Express",
  EGLV: "Evergreen", COSU: "COSCO Shipping", HDMU: "HMM", YMLU: "Yang Ming", ZIMU: "ZIM",
  OOLU: "OOCL", APLU: "APL", PABV: "PIL", WHLC: "Wan Hai",
};

function validateScac(scac) {
  const s = String(scac || "").toUpperCase().trim();
  if (!/^[A-Z]{2,4}$/.test(s)) return { valid: false, reason: "SCAC is 2-4 uppercase letters" };
  return {
    valid: true, scac: s,
    carrier: KNOWN_SCAC[s] || null,
    known: s in KNOWN_SCAC,
    note: s in KNOWN_SCAC ? undefined : "not in the local convenience table - verify against the NMFTA register",
  };
}

// ------------------------------------------------------------------- SMDG facility code
// DCSA carries a facility code plus the list provider that issued it (SMDG for terminals,
// BIC for depots). The code itself is partner-assigned, so only the shape is checked here.
const FACILITY_PROVIDERS = ["SMDG", "BIC"];

function validateFacility(code, provider) {
  const c = String(code || "").toUpperCase().trim();
  const p = String(provider || "SMDG").toUpperCase().trim();
  if (!FACILITY_PROVIDERS.includes(p)) {
    return { valid: false, reason: `facilityCodeListProvider must be one of ${FACILITY_PROVIDERS.join(", ")}` };
  }
  if (!/^[A-Z0-9]{1,6}$/.test(c)) return { valid: false, reason: "facility code is 1-6 alphanumeric characters" };
  return { valid: true, facilityCode: c, facilityCodeListProvider: p };
}

// ------------------------------------------------------- carrier document references
// DCSA documentReferences: BKG booking, TRD transport document (B/L), SHI shipping
// instruction, CBR carrier booking request, POR purchase order, DCR despatch advice.
const DOC_TYPES = { BKG: "booking", TRD: "transport document (B/L)", SHI: "shipping instruction",
  CBR: "carrier booking request", POR: "purchase order", DCR: "despatch advice" };

function validateDocumentReference(type, value) {
  const t = String(type || "").toUpperCase().trim();
  if (!(t in DOC_TYPES)) return { valid: false, reason: `documentReferenceType must be one of ${Object.keys(DOC_TYPES).join(", ")}` };
  const v = String(value || "").trim();
  if (!v || v.length > 100) return { valid: false, reason: "documentReferenceValue must be 1-100 characters" };
  return { valid: true, documentReferenceType: t, documentReferenceValue: v, meaning: DOC_TYPES[t] };
}

module.exports = {
  validateImo, validateMmsi, validateSizeType, describeSizeType, validateScac, validateFacility,
  validateDocumentReference, LENGTH_CODES, HEIGHT_WIDTH_CODES, TYPE_CODES, COLLOQUIAL, KNOWN_SCAC, DOC_TYPES,
};

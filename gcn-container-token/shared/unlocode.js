// Minimal UN/LOCODE port lookup for the traceability demo.
//
// THESE ARE APPROXIMATE PORT CENTROIDS typed by hand for a proof-of-concept, not an
// authoritative dataset. Before anything beyond a demo, replace this file with the
// official UNECE UN/LOCODE code list (https://unece.org/trade/cefact/unlocode-code-list-country-and-territory)
// loaded from disk, and keep the version/date of the edition you loaded.

const PORTS = {
  CNSHA: { name: "Shanghai", country: "CN", lat: 31.23, lon: 121.47 },
  SGSIN: { name: "Singapore", country: "SG", lat: 1.26, lon: 103.84 },
  MYPKG: { name: "Port Klang", country: "MY", lat: 3.0, lon: 101.39 },
  AEJEA: { name: "Jebel Ali", country: "AE", lat: 25.01, lon: 55.06 },
  EGSUZ: { name: "Suez", country: "EG", lat: 29.97, lon: 32.55 },
  NLRTM: { name: "Rotterdam", country: "NL", lat: 51.95, lon: 4.14 },
  BEANR: { name: "Antwerp", country: "BE", lat: 51.26, lon: 4.4 },
  ESALG: { name: "Algeciras", country: "ES", lat: 36.13, lon: -5.44 },
  MACAS: { name: "Casablanca", country: "MA", lat: 33.6, lon: -7.62 },
  NGLOS: { name: "Lagos (Apapa)", country: "NG", lat: 6.45, lon: 3.38 },
  NGONN: { name: "Onne", country: "NG", lat: 4.71, lon: 7.15 },
  GHTEM: { name: "Tema", country: "GH", lat: 5.63, lon: 0.02 },
  CIABJ: { name: "Abidjan", country: "CI", lat: 5.28, lon: -4.01 },
  SNDKR: { name: "Dakar", country: "SN", lat: 14.68, lon: -17.42 },
  ZADUR: { name: "Durban", country: "ZA", lat: -29.87, lon: 31.02 },
  KEMBA: { name: "Mombasa", country: "KE", lat: -4.05, lon: 39.67 },
  TZDAR: { name: "Dar es Salaam", country: "TZ", lat: -6.82, lon: 39.3 },
  USHOU: { name: "Houston", country: "US", lat: 29.73, lon: -95.27 },
  USSAV: { name: "Savannah", country: "US", lat: 32.08, lon: -81.09 },
  USNYC: { name: "New York", country: "US", lat: 40.69, lon: -74.04 },
  USLAX: { name: "Los Angeles", country: "US", lat: 33.73, lon: -118.26 },
  BRSSZ: { name: "Santos", country: "BR", lat: -23.96, lon: -46.32 },
};

/** UN/LOCODE is 5 chars: 2-letter country + 3-letter location. */
function isUnlocode(code) {
  return /^[A-Z]{2}[A-Z2-9]{3}$/.test(String(code || "").toUpperCase());
}

function lookup(code) {
  const c = String(code || "").toUpperCase();
  if (!isUnlocode(c)) return { found: false, reason: "not a 5-character UN/LOCODE" };
  const p = PORTS[c];
  if (!p) return { found: false, reason: `${c} not in this demo table - load the official UN/LOCODE list` };
  return { found: true, unlocode: c, ...p, precision: "approximate port centroid, demo data" };
}

module.exports = { PORTS, lookup, isUnlocode };

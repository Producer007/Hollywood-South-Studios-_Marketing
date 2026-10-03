// Offline checks for the interoperability layer. Run: node standards/test-standards.js
const assert = require("assert");
const ids = require("../shared/identifiers");
const { dcsaEventToWaypoint, dcsaFeedToWaypoints, waypointToDcsaEvent } = require("./dcsa");
const { parseEdifact, tokenize } = require("./edifact");
const { journeyToEpcis, containerGiai } = require("./epcis");
const { normalisePosition, voyageWindows, aisToWaypoints, thinTrack } = require("./ais");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const throws = (fn, re) => assert.throws(fn, re);

// ------------------------------------------------------------------------ identifiers
t("IMO check digit validates real numbers and rejects a bad one", () => {
  assert.ok(ids.validateImo("9321483").valid);
  assert.ok(ids.validateImo("9074729").valid);
  assert.ok(ids.validateImo("IMO 9321483").valid);
  assert.strictEqual(ids.validateImo("9321484").valid, false);
  assert.strictEqual(ids.validateImo("932148").valid, false);
});

t("MMSI distinguishes a ship station from everything else", () => {
  const ship = ids.validateMmsi("636019825");
  assert.ok(ship.valid && ship.isShipStation && ship.mid === 636);
  const coast = ids.validateMmsi("003669145");
  assert.ok(coast.valid && !coast.isShipStation);
  assert.ok(coast.warning.includes("not a ship station"));
  assert.strictEqual(ids.validateMmsi("123456789").valid, false); // MID 123 unassigned
});

t("ISO 6346 size/type normalises yard shorthand to the carrier code", () => {
  const hc = ids.validateSizeType("40HC");
  assert.ok(hc.valid);
  assert.strictEqual(hc.sizeType, "45G1");
  assert.ok(hc.note.includes("yard shorthand"));
  assert.strictEqual(ids.validateSizeType("22G1").sizeType, "22G1");
  assert.ok(ids.validateSizeType("45R1").type.includes("efrigerated"));
  assert.strictEqual(ids.validateSizeType("99Z9").valid, false);
  assert.strictEqual(ids.validateSizeType("").valid, false);
});

t("SCAC and facility codes", () => {
  assert.strictEqual(ids.validateScac("MAEU").carrier, "Maersk");
  assert.strictEqual(ids.validateScac("ZZZZ").known, false);
  assert.strictEqual(ids.validateScac("toolongcode").valid, false);
  assert.ok(ids.validateFacility("APMT1", "SMDG").valid);
  assert.strictEqual(ids.validateFacility("APMT1", "NOPE").valid, false);
});

// ------------------------------------------------------------------------------- DCSA
const dcsaEvent = (over = {}) => ({
  eventID: "11111111-1111-1111-1111-111111111111",
  eventType: "EQUIPMENT",
  eventClassifierCode: "ACT",
  eventDateTime: "2026-03-02T14:00:00+08:00",
  equipmentEventTypeCode: "LOAD",
  equipmentReference: "CSQU3054383",
  ISOEquipmentCode: "45G1",
  emptyIndicatorCode: "LADEN",
  transportCall: {
    UNLocationCode: "CNSHA", modeOfTransport: "VESSEL", facilityCode: "SGHPT",
    facilityCodeListProvider: "SMDG", facilityTypeCode: "POTE",
    vessel: { vesselIMONumber: "9321483", vesselName: "SAMPLE VESSEL", vesselOperatorCarrierCode: "MAEU" },
  },
  ...over,
});

t("DCSA equipment event becomes a waypoint with a port-centroid caveat", () => {
  const r = dcsaEventToWaypoint(dcsaEvent());
  assert.ok(r.accepted, r.reason);
  assert.strictEqual(r.waypoint.eventType, "LOADED_VESSEL");
  assert.strictEqual(r.waypoint.unlocode, "CNSHA");
  assert.strictEqual(r.waypoint.tier, "TIER2_CARRIER_EDI");
  assert.strictEqual(r.waypoint.vesselImo, "9321483");
  assert.strictEqual(r.waypoint.sizeType, "45G1");
  assert.ok(r.waypoint.positionBasis.includes("centroid"));
  assert.strictEqual(r.waypoint.at, "2026-03-02T06:00:00.000Z"); // +08:00 honoured
});

t("DCSA forecasts are refused, not written to the ledger", () => {
  for (const c of ["EST", "PLN"]) {
    const r = dcsaEventToWaypoint(dcsaEvent({ eventClassifierCode: c }));
    assert.strictEqual(r.accepted, false);
    assert.ok(/estimate|plan/.test(r.reason), r.reason);
  }
});

t("DCSA shipment events and availability events carry no position", () => {
  assert.strictEqual(dcsaEventToWaypoint(dcsaEvent({ eventType: "SHIPMENT" })).accepted, false);
  const avail = dcsaEventToWaypoint(dcsaEvent({ equipmentEventTypeCode: "AVPU" }));
  assert.strictEqual(avail.accepted, false);
  assert.ok(avail.reason.includes("no movement"));
});

t("DCSA transport event without an equipmentReference is refused", () => {
  const r = dcsaEventToWaypoint({
    eventType: "TRANSPORT", eventClassifierCode: "ACT", eventDateTime: "2026-03-02T14:00:00Z",
    transportEventTypeCode: "ARRI", transportCall: { UNLocationCode: "SGSIN", modeOfTransport: "VESSEL" },
  });
  assert.strictEqual(r.accepted, false);
  assert.ok(r.reason.includes("no equipmentReference"));
});

t("DCSA event with a bad container check digit is refused", () => {
  const r = dcsaEventToWaypoint(dcsaEvent({ equipmentReference: "CSQU3054384" }));
  assert.strictEqual(r.accepted, false);
  assert.ok(r.reason.includes("check digit"));
});

t("DCSA feed keeps rejections visible", () => {
  const feed = [dcsaEvent(), dcsaEvent({ eventClassifierCode: "EST" }), dcsaEvent({ equipmentEventTypeCode: "AVDO" })];
  const r = dcsaFeedToWaypoints(feed);
  assert.strictEqual(r.waypoints.length, 1);
  assert.strictEqual(r.rejected.length, 2);
});

t("DCSA timestamp without an offset is flagged", () => {
  const r = dcsaEventToWaypoint(dcsaEvent({ eventDateTime: "2026-03-02T14:00:00" }));
  assert.ok(r.accepted);
  assert.ok(r.warnings.some((w) => w.includes("offset")));
});

t("GCN waypoint round-trips back out to a DCSA event", () => {
  const wp = { at: "2026-03-02T06:00:00.000Z", unlocode: "CNSHA", eventType: "LOADED_VESSEL", mode: "SEA" };
  const ev = waypointToDcsaEvent(wp, {
    containerId: "CSQU3054383", sizeType: "40HC", vessel: { imo: "9321483", carrierCode: "MAEU" },
    facility: { code: "SGHPT", provider: "SMDG", typeCode: "POTE" },
  });
  assert.strictEqual(ev.equipmentEventTypeCode, "LOAD");
  assert.strictEqual(ev.eventClassifierCode, "ACT"); // never a forecast
  assert.strictEqual(ev.ISOEquipmentCode, "45G1");   // shorthand normalised on the way out
  assert.strictEqual(ev.transportCall.vessel.vesselIMONumber, "9321483");
  const back = dcsaEventToWaypoint({ ...ev, eventID: "x" });
  assert.ok(back.accepted);
  assert.strictEqual(back.waypoint.eventType, "LOADED_VESSEL");
  assert.strictEqual(back.waypoint.at, wp.at);
});

t("DCSA export refuses a bad IMO rather than emitting it", () => {
  throws(() => waypointToDcsaEvent(
    { at: "2026-03-02T06:00:00Z", unlocode: "CNSHA", eventType: "LOADED_VESSEL" },
    { containerId: "CSQU3054383", vessel: { imo: "9321484" } }
  ), /check digit/);
});

// ---------------------------------------------------------------------------- EDIFACT
const CODECO =
  "UNB+UNOA:2+TERMINAL+GCN+260302:1400+1'" +
  "UNH+1+CODECO:D:95B:UN:SMDG20'" +
  "BGM+36+GATEOUT001+9'" +
  "TDT+20+V123+1'" +
  "EQD+CN+CSQU3054383+45G1+++5'" +
  "LOC+9+CNSHA'" +
  "DTM+7:202603021400:203'" +
  "SEL+SEAL12345'" +
  "EQD+CN+MSCU1234566+22G1+++4'" +
  "LOC+9+SGSIN'" +
  "DTM+7:202603150800:203'" +
  "UNT+12+1'";

t("EDIFACT tokenizer splits segments, elements and components", () => {
  const segs = tokenize("UNH+1+CODECO:D:95B:UN'EQD+CN+CSQU3054383'");
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].tag, "UNH");
  assert.deepStrictEqual(segs[0].elements[1], ["CODECO", "D", "95B", "UN"]);
});

t("CODECO parses into waypoints with size/type and seals", () => {
  const r = parseEdifact(CODECO);
  assert.strictEqual(r.messageType, "CODECO");
  assert.strictEqual(r.waypoints.length, 2);
  const [a, b] = r.waypoints;
  assert.strictEqual(a.eventType, "GATE_OUT"); // BGM 36
  assert.strictEqual(a.unlocode, "CNSHA");
  assert.strictEqual(a.sizeType, "45G1");
  assert.strictEqual(a.emptyIndicatorCode, "LADEN");
  assert.deepStrictEqual(a.sealNumbers, ["SEAL12345"]);
  assert.strictEqual(a.at, "2026-03-02T14:00:00.000Z");
  assert.strictEqual(b.emptyIndicatorCode, "EMPTY");
  assert.strictEqual(b.unlocode, "SGSIN");
});

t("CODECO rejects a container whose check digit fails, and says so", () => {
  const bad = CODECO.replace("CSQU3054383", "CSQU3054384");
  const r = parseEdifact(bad);
  assert.strictEqual(r.waypoints.length, 1);
  assert.ok(r.rejected.some((x) => /check digit/.test(x.reason)));
});

t("EDIFACT refuses to turn an estimated time into an attested position", () => {
  const est = CODECO.replace("DTM+7:202603021400:203'", "DTM+132:202603021400:203'");
  const r = parseEdifact(est);
  assert.ok(r.rejected.some((x) => /forecast is not an observation/.test(x.reason)), JSON.stringify(r.rejected));
});

t("IFTSTA status codes drive the event type", () => {
  const iftsta =
    "UNH+1+IFTSTA:D:95B:UN'BGM+23+STAT1+9'EQD+CN+CSQU3054383+45G1'STS+3'LOC+9+CNSHA'DTM+7:202603021400:203'UNT+7+1'";
  const r = parseEdifact(iftsta);
  assert.strictEqual(r.messageType, "IFTSTA");
  assert.strictEqual(r.waypoints.length, 1);
  assert.strictEqual(r.waypoints[0].eventType, "LOADED_VESSEL"); // STS 3
});

t("EDIFACT handles UNA-overridden service characters", () => {
  const una = "UNA:+.? 'UNH+1+CODECO:D:95B:UN'BGM+36+X+9'EQD+CN+CSQU3054383+45G1'LOC+9+CNSHA'DTM+7:202603021400:203'UNT+5+1'";
  const r = parseEdifact(una);
  assert.strictEqual(r.waypoints.length, 1);
});

t("EDIFACT skips non-container equipment and refuses an unsupported message", () => {
  const chassis = CODECO.replace("EQD+CN+CSQU3054383", "EQD+CZ+CHASSIS001");
  const r = parseEdifact(chassis);
  assert.ok(r.warnings.some((w) => w.includes("not a container")));
  const other = parseEdifact("UNH+1+BAPLIE:D:95B:UN'UNT+2+1'");
  assert.ok(other.rejected.some((x) => /unsupported message type/.test(x.reason)));
});

// ------------------------------------------------------------------------------ EPCIS
const JOURNEY = [
  { at: "2026-03-02T14:00:00Z", lat: 31.23, lon: 121.47, unlocode: "CNSHA", eventType: "LOADED_VESSEL", mode: "SEA", tier: "TIER2_CARRIER_EDI", evidenceHash: "aa" },
  { at: "2026-03-13T09:00:00Z", lat: 1.26, lon: 103.84, unlocode: "SGSIN", eventType: "TRANSSHIPPED", mode: "SEA", tier: "TIER3_VESSEL_AIS", evidenceHash: "bb" },
  { at: "2026-04-13T07:00:00Z", lat: 25.01, lon: 55.06, unlocode: "AEJEA", eventType: "DISCHARGED", mode: "SEA", tier: "TIER1_CONTAINER_TELEMETRY", evidenceHash: "cc" },
];

t("EPCIS 2.0 export produces a valid-shaped document with CBV steps", () => {
  const doc = journeyToEpcis(JOURNEY, { containerId: "CSQU3054383", companyPrefix: "0614141" });
  assert.strictEqual(doc.type, "EPCISDocument");
  assert.strictEqual(doc.schemaVersion, "2.0");
  assert.ok(doc["@context"][0].includes("epcis"));
  const evs = doc.epcisBody.eventList;
  assert.strictEqual(evs.length, 3);
  assert.strictEqual(evs[0].type, "ObjectEvent");
  assert.strictEqual(evs[0].action, "OBSERVE");
  assert.ok(evs[0].bizStep.includes("loading"));
  assert.ok(evs[2].bizStep.includes("unloading"));
  assert.ok(evs[0].epcList[0].startsWith("urn:epc:id:giai:0614141.CSQU3054383"));
  assert.strictEqual(evs[0].eventTimeZoneOffset, "+00:00");
});

t("EPCIS carries the evidence tier through so a reader cannot flatten it", () => {
  const doc = journeyToEpcis(JOURNEY, { containerId: "CSQU3054383", companyPrefix: "0614141" });
  const tiers = doc.epcisBody.eventList.map((e) => e["gcn:evidenceTier"]);
  assert.deepStrictEqual(tiers, ["TIER2_CARRIER_EDI", "TIER3_VESSEL_AIS", "TIER1_CONTAINER_TELEMETRY"]);
  assert.ok(doc.epcisBody.eventList[1]["gcn:evidenceTierMeaning"].includes("SHIP"));
  assert.ok(doc["gcn:disclaimer"].includes("not proof of physical movement"));
});

t("EPCIS refuses to invent a GS1 company prefix", () => {
  throws(() => containerGiai("", "CSQU3054383"), /must not be invented/);
  throws(() => journeyToEpcis(JOURNEY, { containerId: "CSQU3054383" }), /Company Prefix/);
});

t("EPCIS sorts events and falls back honestly when no GLN is known", () => {
  const doc = journeyToEpcis(JOURNEY.slice().reverse(), { containerId: "CSQU3054383", companyPrefix: "0614141" });
  assert.strictEqual(doc.epcisBody.eventList[0].eventTime, "2026-03-02T14:00:00.000Z");
  assert.ok(doc.epcisBody.eventList[0].readPoint["gcn:geo"].startsWith("geo:"));
  const withGln = journeyToEpcis(JOURNEY, { containerId: "CSQU3054383", companyPrefix: "0614141", glnMap: { CNSHA: "0614141000012" } });
  assert.ok(withGln.epcisBody.eventList[0].readPoint.id.startsWith("urn:epc:id:sgln:"));
});

// -------------------------------------------------------------------------------- AIS
const CONTAINER_EVENTS = [
  { at: "2026-03-02T14:00:00Z", eventType: "LOADED_VESSEL", vesselImo: "9321483" },
  { at: "2026-04-13T07:00:00Z", eventType: "DISCHARGED" },
];
const pos = (at, lat, lon, over = {}) => ({ imo: "9321483", mmsi: "636019825", lat, lon, at, sog: 12, cog: 210, navStatus: 0, ...over });

t("AIS provider profiles normalise to one shape, and FleetMon is marked retired", () => {
  const fm = normalisePosition(
    { imo_number: "9321483", mmsi_number: "636019825", latitude: "10.5", longitude: "110.2", timestamp: "2026-03-10T00:00:00Z", speed: "12.1", nav_status: "0" },
    "fleetmon"
  );
  assert.ok(fm.valid);
  assert.strictEqual(fm.position.lat, 10.5);
  assert.ok(fm.position.providerStatus.startsWith("RETIRED"));

  const mt = normalisePosition(
    { IMO: "9321483", MMSI: "636019825", LAT: "10.5", LON: "110.2", TIMESTAMP: "2026-03-10T00:00:00Z", SPEED: "12.1", STATUS: "0" },
    "marinetraffic"
  );
  assert.ok(mt.valid);
  assert.strictEqual(mt.position.lat, 10.5);
  assert.ok(mt.position.providerStatus.startsWith("ACTIVE"));
  assert.strictEqual(normalisePosition({}, "nope").valid, false);
});

t("AIS rejects a bad IMO and an unusable timestamp", () => {
  assert.strictEqual(normalisePosition(pos("2026-03-10T00:00:00Z", 10, 110, { imo: "9321484" })).valid, false);
  assert.strictEqual(normalisePosition(pos(null, 10, 110)).valid, false);
  assert.strictEqual(normalisePosition(pos("2026-03-10T00:00:00Z", 999, 110)).valid, false);
});

t("AIS flags a navigational status that contradicts the speed", () => {
  const r = normalisePosition(pos("2026-03-10T00:00:00Z", 10, 110, { navStatus: 5, sog: 14 }));
  assert.ok(r.valid);
  assert.ok(r.warnings.some((w) => w.includes("contradicts")));
});

t("AIS accepts positions inside the loaded voyage and refuses those outside it", () => {
  const r = aisToWaypoints(
    [pos("2026-03-10T00:00:00Z", 10, 110), pos("2026-04-20T00:00:00Z", 26.2, 56.3)],
    { containerEvents: CONTAINER_EVENTS }
  );
  assert.strictEqual(r.waypoints.length, 1);
  assert.strictEqual(r.waypoints[0].tier, "TIER3_VESSEL_AIS");
  assert.strictEqual(r.rejected.length, 1);
  assert.ok(r.rejected[0].detail.includes("not the container's"));
});

t("AIS refuses everything when the container was never loaded", () => {
  const r = aisToWaypoints([pos("2026-03-10T00:00:00Z", 10, 110)], { containerEvents: [] });
  assert.strictEqual(r.waypoints.length, 0);
  assert.ok(r.note.includes("not a container's track"));
});

t("AIS refuses a position from a different vessel during the voyage", () => {
  const r = aisToWaypoints([pos("2026-03-10T00:00:00Z", 10, 110, { imo: "9074729" })], { containerEvents: CONTAINER_EVENTS });
  assert.strictEqual(r.waypoints.length, 0);
  assert.strictEqual(r.rejected.length, 1);
});

t("voyageWindows pairs load and discharge events", () => {
  const w = voyageWindows(CONTAINER_EVENTS);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].imo, "9321483");
  assert.strictEqual(w[0].to, "2026-04-13T07:00:00Z");
});

t("thinTrack drops redundant positions but keeps first and last", () => {
  const dense = [];
  for (let i = 0; i < 20; i++) dense.push({ at: new Date(Date.UTC(2026, 2, 10, i)).toISOString(), lat: 10 + i * 0.01, lon: 110 });
  const kept = thinTrack(dense);
  assert.ok(kept.length < dense.length, `${kept.length} vs ${dense.length}`);
  assert.strictEqual(kept[0].at, dense[0].at);
  assert.strictEqual(kept[kept.length - 1].at, dense[dense.length - 1].at);
});

console.log(`\n${n} interoperability checks passed`);

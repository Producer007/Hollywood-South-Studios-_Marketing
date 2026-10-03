// Offline tests for the Hedera TESTNET scripts. Run: node --test test/
// Uses test/fake-hedera.js (in-memory ledger + fake mirror node) - see the note there:
// passing here proves the scripts' logic, not that anything has run on Hedera.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gcn-hedera-"));
process.env.HEDERA_STATE_PATH = path.join(tmp, "state.json");
process.env.HEDERA_MIRROR_URL = "https://mirror.test";
delete process.env.HEDERA_TESTNET_ACCOUNT_ID;
delete process.env.HEDERA_TESTNET_PRIVATE_KEY;

const { ledger, real } = require("./fake-hedera");
const operatorKey = real.PrivateKey.generateECDSA();
process.env.HEDERA_OPERATOR_ID = "0.0.1001";
process.env.HEDERA_OPERATOR_KEY = "0x" + operatorKey.toStringRaw();
ledger.accounts["0.0.1001"] = {
  key: { _type: "ECDSA_SECP256K1", key: operatorKey.publicKey.toStringRaw() },
  evm: "0x" + operatorKey.publicKey.toEvmAddress(),
  balanceTinybar: 50 * 1e8,
};

const { parseKey, credentials } = require("../src/client");
const { createCollection } = require("../src/create-collection");
const { mintContainer } = require("../src/mint-container");
const { logWaypoint, buildWaypoint, parseArgs } = require("../src/log-waypoint");
const { buildAttestation } = require("../src/attest");
const { journeyReport } = require("../src/journey");
const { preflight } = require("../src/check");
const { readState, writeState } = require("../src/mirror");

const ISO = "CSQU3054383"; // ISO 6346 worked example - SAMPLE id
const evidence = path.join(tmp, "codeco.edi");
fs.writeFileSync(evidence, "UNB+UNOA:2+SAMPLE'"); // SAMPLE evidence file
const fast = { retries: 0, delayMs: 1 };
const wp = (o) => ({ iso: ISO, tier: "TIER2_CARRIER_EDI", evidence, ...o });

test("keys: raw ECDSA hex with and without 0x, DER, ED25519 by type", () => {
  const k = real.PrivateKey.generateECDSA();
  assert.equal(parseKey(k.toStringRaw()).publicKey.toStringRaw(), k.publicKey.toStringRaw());
  assert.equal(parseKey("0x" + k.toStringRaw()).publicKey.toStringRaw(), k.publicKey.toStringRaw());
  assert.equal(parseKey(k.toStringDer()).publicKey.toStringRaw(), k.publicKey.toStringRaw());
  const e = real.PrivateKey.generateED25519();
  assert.equal(parseKey(e.toStringRaw(), "ED25519").publicKey.toStringRaw(), e.publicKey.toStringRaw());
  assert.equal(parseKey(e.toStringDer()).publicKey.toStringRaw(), e.publicKey.toStringRaw());
  assert.throws(() => parseKey("not-a-key"), /hex/);
});

test("credentials: both env naming schemes; anything but testnet refused", () => {
  assert.equal(credentials({ HEDERA_TESTNET_ACCOUNT_ID: "0.0.1", HEDERA_TESTNET_PRIVATE_KEY: "ab" }).id, "0.0.1");
  assert.equal(credentials({ HEDERA_OPERATOR_ID: "0.0.2", HEDERA_OPERATOR_KEY: "ab" }).id, "0.0.2");
  assert.throws(() => credentials({}), /HEDERA_TESTNET_ACCOUNT_ID/);
  assert.throws(() => credentials({ HEDERA_OPERATOR_ID: "0.0.2", HEDERA_OPERATOR_KEY: "ab", HEDERA_NETWORK: "mainnet" }), /testnet only/);
});

test("preflight passes before a collection exists", async () => {
  const rows = await preflight();
  assert.ok(rows.every((r) => r.ok), JSON.stringify(rows));
  assert.ok(rows.find((r) => r.name === "EVM alias"));
});

test("create-collection writes state and refuses a second pair without --force", async () => {
  const s = await createCollection();
  assert.match(s.tokenId, /^0\.0\.\d+$/);
  assert.match(s.topicId, /^0\.0\.\d+$/);
  await assert.rejects(createCollection(), /already has token/);
});

test("preflight confirms token and topic are controlled by this key", async () => {
  const rows = await preflight();
  assert.ok(rows.every((r) => r.ok), JSON.stringify(rows));
  assert.ok(rows.find((r) => r.name === "token").detail.includes("is this operator"));
});

test("preflight fails when the key is not the account's key", async () => {
  const saved = ledger.accounts["0.0.1001"].key;
  ledger.accounts["0.0.1001"].key = { _type: "ECDSA_SECP256K1", key: real.PrivateKey.generateECDSA().publicKey.toStringRaw() };
  const rows = await preflight();
  ledger.accounts["0.0.1001"].key = saved;
  assert.ok(rows.find((r) => r.name === "key matches account" && !r.ok));
});

test("mint: one token per ISO 6346 id, invalid ids refused", async () => {
  const r = await mintContainer(ISO);
  assert.equal(r.serial, "1");
  assert.equal(r.sampleDocs, true);
  await assert.rejects(mintContainer(ISO), /already serial 1/);
  await assert.rejects(mintContainer("CSQU3054384"), /Invalid ISO 6346/);
});

test("waypoint refused for a container with no token", async () => {
  await assert.rejects(
    logWaypoint(wp({ iso: "MSCU1234566", event: "LOADED_VESSEL", port: "CNSHA", at: "2026-03-01T08:00:00Z" }), fast),
    /no token/
  );
});

test("three waypoints chain, and the report recomputes the distance", async () => {
  await logWaypoint(wp({ event: "LOADED_VESSEL", port: "CNSHA", at: "2026-03-01T08:00:00Z" }), fast);
  await logWaypoint(wp({ event: "TRANSSHIPPED", port: "SGSIN", at: "2026-03-12T08:00:00Z" }), fast);
  const r3 = await logWaypoint(wp({ event: "DISCHARGED", port: "AEJEA", at: "2026-03-24T08:00:00Z" }), fast);
  const rep = await journeyReport(ISO, readState().topicId);
  assert.equal(rep.report.waypointCount, 3);
  assert.deepEqual(rep.chainBreaks, []);
  assert.equal(rep.mismatch, false);
  const km = rep.report.attestedGreatCircleDistance.km;
  assert.ok(km > 9000 && km < 13000, `Shanghai-Singapore-Jebel Ali great-circle ${km} km`);
  assert.equal(r3.cumulativeMeters, rep.onChainClaimed);
  assert.match(rep.report.evidence.coverageNote, /No TIER1/);
});

test("a lost state.json does not break the chain: prev comes from the mirror node", async () => {
  const s = readState();
  delete s.journeys;
  writeState(s);
  await logWaypoint(wp({ event: "GATE_OUT", port: "AEJEA", mode: "ROAD", at: "2026-03-25T08:00:00Z" }), fast);
  const rep = await journeyReport(ISO, readState().topicId);
  assert.equal(rep.report.waypointCount, 4);
  assert.deepEqual(rep.chainBreaks, []);
});

test("a lagging mirror node is waited for, never chained past", async () => {
  ledger.mirrorLag = 1;
  await assert.rejects(
    logWaypoint(wp({ event: "GATE_IN", port: "AEJEA", mode: "YARD", at: "2026-03-26T08:00:00Z" }), fast),
    /Wait a minute/
  );
  const before = ledger.submitted;
  setTimeout(() => { ledger.mirrorLag = 0; }, 20);
  await logWaypoint(wp({ event: "GATE_IN", port: "AEJEA", mode: "YARD", at: "2026-03-26T08:00:00Z" }), { retries: 20, delayMs: 5 });
  assert.equal(ledger.submitted, before + 1);
  assert.deepEqual((await journeyReport(ISO, readState().topicId)).chainBreaks, []);
});

test("refusals: implausible speed, future time, no evidence, AIS without IMO, bad IMO", () => {
  const prev = { at: "2026-03-01T08:00:00Z", lat: 31.23, lon: 121.47, messageHash: "x" };
  const ev = Buffer.from("e");
  assert.throws(() => buildWaypoint(wp({ event: "DISCHARGED", port: "NLRTM", at: "2026-03-02T08:00:00Z" }), prev, ev), /implausible/);
  assert.throws(() => buildWaypoint(wp({ event: "LOADED_VESSEL", port: "CNSHA", at: "2099-01-01T00:00:00Z" }), null, ev), /future/);
  assert.throws(() => buildWaypoint(wp({ event: "LOADED_VESSEL", port: "CNSHA" }), null, null), /hearsay/);
  assert.throws(() => buildWaypoint(wp({ event: "VESSEL_POSITION", tier: "TIER3_VESSEL_AIS", lat: "5", lon: "80" }), null, ev), /--imo is required/);
  assert.throws(() => buildWaypoint(wp({ event: "LOADED_VESSEL", port: "CNSHA", imo: "12345" }), null, ev), /7 digits/);
  assert.throws(() => parseArgs(["--iso", "--event", "X"]), /pairs/);
});

test("vessel AIS after discharge is reported as an orphan position", async () => {
  await logWaypoint(wp({ event: "VESSEL_POSITION", tier: "TIER3_VESSEL_AIS", imo: "9321483", lat: "25.5", lon: "56.0", at: "2026-03-27T08:00:00Z" }), fast);
  const rep = await journeyReport(ISO, readState().topicId);
  assert.ok(rep.report.anomalies.some((a) => a.kind === "ORPHAN_VESSEL_POSITION"));
});

test("a message written outside the chain is detected as a break", async () => {
  const topic = ledger.topics[readState().topicId];
  const forged = { t: "gcn_waypoint_v1", iso: ISO, event: "DELIVERED", tier: "TIER4_MANUAL", mode: "ROAD", unlocode: "AEJEA",
    lat: 25.01, lon: 55.06, at: "2026-03-28T08:00:00Z", imo: null, segmentMeters: 0, evidenceSha256: "00", prevMessageHash: null };
  topic.messages.push({ seq: topic.messages.length + 1, ts: "1772999999.0", b64: Buffer.from(JSON.stringify(forged)).toString("base64") });
  const rep = await journeyReport(ISO, readState().topicId);
  assert.equal(rep.chainBreaks.length, 1);
  assert.equal(rep.chainBreaks[0].seq, topic.messages.length);
});

test("attestation needs the SHA-256 of a real MTI result", () => {
  assert.throws(() => buildAttestation(ISO, "9321483", 4, ""), /SHA-256/);
  assert.throws(() => buildAttestation(ISO, "9321483", 6, "a".repeat(64)), /0-5/);
  assert.equal(buildAttestation(ISO, "9321483", 4, "A".repeat(64)).evidence, "a".repeat(64));
});

test("journey for an unknown container reports nothing attested", async () => {
  const r = await journeyReport("MSCU1234566", readState().topicId);
  assert.equal(r.empty, true);
});

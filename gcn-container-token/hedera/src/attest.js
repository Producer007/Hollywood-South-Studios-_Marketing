const { TopicMessageSubmitTransaction } = require("@hashgraph/sdk");
const { getClient } = require("./client");
const { validateIso6346 } = require("../../shared/iso6346");
const { readState } = require("./mirror");

// HEDERA TESTNET ONLY. Appends a vessel attestation to the HCS topic.
//
// The MTI scores a VESSEL, not a container, so this links a container to a vessel's score
// at a point in time. The score must come from an actual Pole Star MTI result, and the
// evidence hash must be the SHA-256 of that result. No hash, no attestation. Nothing here
// implies any relationship with Pole Star.
//
// Usage: node src/attest.js <ISO6346> <IMO> <MTI 0-5> <sha256 of the MTI result>

function buildAttestation(iso, imo, mti, evidence) {
  const v = validateIso6346(iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);
  const score = Number(mti);
  if (!Number.isInteger(score) || score < 0 || score > 5) throw new Error("MTI must be an integer 0-5");
  if (!/^[0-9]{7}$/.test(String(imo))) throw new Error("IMO must be 7 digits");
  if (!/^[0-9a-f]{64}$/i.test(String(evidence || ""))) {
    throw new Error("evidence must be the 64-hex SHA-256 of the MTI result it came from");
  }
  return { t: "vessel_attestation", iso: v.id, imo: String(imo), mti: score, evidence: evidence.toLowerCase(), at: new Date().toISOString() };
}

async function attest(iso, imo, mti, evidence) {
  const msg = buildAttestation(iso, imo, mti, evidence);
  const state = readState();
  if (!state.topicId) throw new Error("no topicId in state.json - run create-collection.js first");
  const { client } = getClient();
  try {
    const rcpt = await (
      await new TopicMessageSubmitTransaction().setTopicId(state.topicId).setMessage(JSON.stringify(msg)).execute(client)
    ).getReceipt(client);
    return { topicId: state.topicId, status: rcpt.status.toString(), seq: rcpt.topicSequenceNumber?.toString() };
  } finally {
    client.close();
  }
}

if (require.main === module) {
  attest(...process.argv.slice(2, 6))
    .then((r) => console.log(`Attested on topic ${r.topicId} (seq ${r.seq}, ${r.status})`))
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { attest, buildAttestation };

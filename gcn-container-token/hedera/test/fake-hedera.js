// OFFLINE TEST DOUBLE for Hedera testnet. Not a simulation of consensus.
//
// Replaces the transaction classes of @hashgraph/sdk with an in-memory ledger and serves
// that ledger through a fake mirror-node `fetch`, so the scripts can be exercised end to end
// with no keys and no network. Key handling (PrivateKey, AccountId) is the REAL SDK, so key
// parsing is tested against the actual library. Passing tests here mean the scripts' own
// logic is right; they do not mean anything has run on Hedera.

const Module = require("module");
const real = require("@hashgraph/sdk");

const ledger = {
  nextNum: 9000000,
  tokens: {}, // id -> { nfts: [{serial, metadata}], supplyKey, type }
  topics: {}, // id -> { submitKey, messages: [{seq, ts, b64}] }
  accounts: {}, // id -> { key: {_type, key}, evm, balanceTinybar }
  mirrorLag: 0, // hide the newest N topic messages from the mirror, as a lagging node would
  pageSize: 2, // small, so pagination is exercised
  submitted: 0,
};
const newId = () => `0.0.${ledger.nextNum++}`;
const keyHex = (pub) => pub.toStringRaw().toLowerCase();

class Tx {
  constructor() { this.f = {}; }
  freezeWith() { return this; }
  sign() { return this; }
  async execute() { return { getReceipt: async () => this._apply() }; }
}
const chain = (cls, names) => names.forEach((n) => {
  cls.prototype[n] = function (v) { this.f[n] = v; return this; };
});

class TokenCreateTransaction extends Tx {
  _apply() {
    const id = newId();
    ledger.tokens[id] = { nfts: [], supplyKey: keyHex(this.f.setSupplyKey), type: "NON_FUNGIBLE_UNIQUE", name: this.f.setTokenName };
    return { tokenId: { toString: () => id }, status: { toString: () => "SUCCESS" } };
  }
}
chain(TokenCreateTransaction, ["setTokenName", "setTokenSymbol", "setTokenMemo", "setTokenType", "setSupplyType",
  "setTreasuryAccountId", "setAdminKey", "setSupplyKey", "setPauseKey", "setWipeKey", "setMaxTransactionFee"]);

class TopicCreateTransaction extends Tx {
  _apply() {
    const id = newId();
    ledger.topics[id] = { submitKey: keyHex(this.f.setSubmitKey), messages: [] };
    return { topicId: { toString: () => id }, status: { toString: () => "SUCCESS" } };
  }
}
chain(TopicCreateTransaction, ["setTopicMemo", "setSubmitKey"]);

class TokenMintTransaction extends Tx {
  constructor() { super(); this.meta = []; }
  addMetadata(m) { this.meta.push(Buffer.from(m)); return this; }
  _apply() {
    const t = ledger.tokens[this.f.setTokenId];
    if (!t) throw new Error("INVALID_TOKEN_ID");
    const serials = this.meta.map((m) => {
      if (m.length > 100) throw new Error("METADATA_TOO_LONG");
      const serial = t.nfts.length + 1;
      t.nfts.push({ serial, metadata: m.toString("base64") });
      return { toString: () => String(serial) };
    });
    return { serials, status: { toString: () => "SUCCESS" } };
  }
}
chain(TokenMintTransaction, ["setTokenId"]);

class TopicMessageSubmitTransaction extends Tx {
  _apply() {
    const topic = ledger.topics[this.f.setTopicId];
    if (!topic) throw new Error("INVALID_TOPIC_ID");
    const seq = topic.messages.length + 1;
    topic.messages.push({ seq, ts: `${1772000000 + seq}.000000000`, b64: Buffer.from(this.f.setMessage).toString("base64") });
    ledger.submitted++;
    return { topicSequenceNumber: { toString: () => String(seq) }, status: { toString: () => "SUCCESS" } };
  }
}
chain(TopicMessageSubmitTransaction, ["setTopicId", "setMessage"]);

const Client = { forTestnet: () => ({ setOperator() {}, close() {} }) };
const Hbar = function Hbar(n) { this.n = n; };

const fakeSdk = {
  ...real, Client, Hbar,
  TokenCreateTransaction, TopicCreateTransaction, TokenMintTransaction, TopicMessageSubmitTransaction,
};

// Route require("@hashgraph/sdk") from the scripts under test to the fake.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@hashgraph/sdk" && parent && !parent.filename.endsWith("fake-hedera.js")) return fakeSdk;
  return origLoad.call(this, request, parent, isMain);
};

// ---- fake mirror node -------------------------------------------------------------------

function page(items, offset, basePath) {
  const slice = items.slice(offset, offset + ledger.pageSize);
  const next = offset + ledger.pageSize < items.length ? `${basePath}${basePath.includes("?") ? "&" : "?"}_o=${offset + ledger.pageSize}` : null;
  return { slice, next };
}
const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body });

global.fetch = async (url) => {
  const u = new URL(url);
  const offset = Number(u.searchParams.get("_o") || 0);
  let m;
  if ((m = u.pathname.match(/^\/api\/v1\/topics\/([\d.]+)\/messages$/))) {
    const topic = ledger.topics[m[1]];
    if (!topic) return json(404, {});
    const visible = topic.messages.slice(0, Math.max(0, topic.messages.length - ledger.mirrorLag));
    const { slice, next } = page(visible, offset, `/api/v1/topics/${m[1]}/messages?limit=100&order=asc`);
    return json(200, {
      messages: slice.map((x) => ({ sequence_number: x.seq, consensus_timestamp: x.ts, message: x.b64, chunk_info: x.chunk || null })),
      links: { next },
    });
  }
  if ((m = u.pathname.match(/^\/api\/v1\/tokens\/([\d.]+)\/nfts$/))) {
    const t = ledger.tokens[m[1]];
    if (!t) return json(404, {});
    const { slice, next } = page(t.nfts, offset, `/api/v1/tokens/${m[1]}/nfts?limit=100`);
    return json(200, { nfts: slice.map((n) => ({ serial_number: n.serial, metadata: n.metadata, deleted: false })), links: { next } });
  }
  if ((m = u.pathname.match(/^\/api\/v1\/tokens\/([\d.]+)$/))) {
    const t = ledger.tokens[m[1]];
    if (!t) return json(404, {});
    return json(200, { token_id: m[1], type: t.type, total_supply: String(t.nfts.length), supply_key: { _type: "ECDSA_SECP256K1", key: t.supplyKey }, pause_status: "UNPAUSED" });
  }
  if ((m = u.pathname.match(/^\/api\/v1\/topics\/([\d.]+)$/))) {
    const t = ledger.topics[m[1]];
    if (!t) return json(404, {});
    return json(200, { topic_id: m[1], submit_key: { _type: "ECDSA_SECP256K1", key: t.submitKey } });
  }
  if ((m = u.pathname.match(/^\/api\/v1\/accounts\/([\d.]+)$/))) {
    const a = ledger.accounts[m[1]];
    if (!a) return json(404, {});
    return json(200, { account: m[1], key: a.key, evm_address: a.evm, balance: { balance: a.balanceTinybar } });
  }
  return json(404, {});
};

module.exports = { ledger, real };

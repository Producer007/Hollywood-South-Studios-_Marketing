require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client, PrivateKey, AccountId } = require("@hashgraph/sdk");

// TESTNET ONLY. The client is hard-wired to testnet; there is no mainnet code path.
//
// Accepts either naming scheme:
//   HEDERA_TESTNET_ACCOUNT_ID / HEDERA_TESTNET_PRIVATE_KEY  (this module's .env.example)
//   HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY                (the GCN hedera/ connection check)
// and any key format the portal hands out: DER (302e…/3030…), or raw hex with or without 0x.
// Raw hex is ambiguous between ECDSA and ED25519, so HEDERA_KEY_TYPE picks; it defaults to
// ECDSA because GCN's testnet operator has an ECDSA alias (EVM) address.

function credentials(env = process.env) {
  const id = env.HEDERA_TESTNET_ACCOUNT_ID || env.HEDERA_OPERATOR_ID;
  const key = env.HEDERA_TESTNET_PRIVATE_KEY || env.HEDERA_OPERATOR_KEY;
  if (!id || !key) {
    throw new Error(
      "Set HEDERA_TESTNET_ACCOUNT_ID and HEDERA_TESTNET_PRIVATE_KEY in hedera/.env (see .env.example)"
    );
  }
  const net = (env.HEDERA_NETWORK || "testnet").toLowerCase();
  if (net !== "testnet") throw new Error(`HEDERA_NETWORK=${net}: this module is testnet only`);
  return { id: id.trim(), key: key.trim(), keyType: (env.HEDERA_KEY_TYPE || "ECDSA").toUpperCase() };
}

function parseKey(raw, keyType = "ECDSA") {
  const k = raw.replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(k)) throw new Error("private key must be hex or DER hex");
  // 64 hex chars = raw 32-byte key; anything longer is DER-encoded and self-describing.
  if (k.length === 64) {
    if (keyType === "ED25519") return PrivateKey.fromStringED25519(k);
    if (keyType === "ECDSA") return PrivateKey.fromStringECDSA(k);
    throw new Error(`HEDERA_KEY_TYPE must be ECDSA or ED25519, got ${keyType}`);
  }
  return PrivateKey.fromStringDer(k);
}

function getClient(env = process.env) {
  const c = credentials(env);
  const operatorKey = parseKey(c.key, c.keyType);
  const operatorId = AccountId.fromString(c.id);
  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  return { client, operatorKey, operatorId };
}

module.exports = { getClient, parseKey, credentials };

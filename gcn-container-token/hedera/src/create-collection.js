const {
  TokenCreateTransaction, TokenType, TokenSupplyType, TopicCreateTransaction, Hbar,
} = require("@hashgraph/sdk");
const { getClient } = require("./client");
const { readState, writeState } = require("./mirror");

// HEDERA TESTNET ONLY. Creates (1) an HTS non-fungible collection for containers and
// (2) an HCS topic as the append-only journey / vessel attestation log.
// IDs are written to hedera/state.json. Refuses to create a second pair unless --force,
// because a second topic silently splits a container's history in two.

async function createCollection({ force = false } = {}) {
  const state = readState();
  if (state.tokenId && !force) {
    throw new Error(
      `state.json already has token ${state.tokenId} / topic ${state.topicId}. ` +
      "Pass --force to create a new pair (the old journey stays on the old topic)."
    );
  }
  const { client, operatorKey, operatorId } = getClient();
  try {
    const tokenTx = await new TokenCreateTransaction()
      .setTokenName("GCN Cargo Container Token (TESTNET)")
      .setTokenSymbol("GCCT")
      .setTokenMemo("GCN container record - testnet, pre-audit; not proof of physical existence")
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(operatorKey.publicKey)
      .setSupplyKey(operatorKey.publicKey)
      .setPauseKey(operatorKey.publicKey) // halt the collection if an attestation is found wrong
      .setWipeKey(operatorKey.publicKey) // regulated-asset recovery; review before any real use
      .setMaxTransactionFee(new Hbar(30))
      .freezeWith(client)
      .sign(operatorKey);
    const tokenId = (await (await tokenTx.execute(client)).getReceipt(client)).tokenId.toString();

    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo("GCN container journeys + attestations (testnet, pre-audit)")
      .setSubmitKey(operatorKey.publicKey) // only the operator can append; anyone can read
      .execute(client);
    const topicId = (await topicTx.getReceipt(client)).topicId.toString();

    const next = {
      network: "hedera-testnet",
      tokenId,
      topicId,
      operator: operatorId.toString(),
      createdAt: new Date().toISOString(),
      status: "PRE-AUDIT / TESTNET",
      journeys: {},
    };
    writeState(next);
    return next;
  } finally {
    client.close();
  }
}

if (require.main === module) {
  createCollection({ force: process.argv.includes("--force") })
    .then(({ tokenId, topicId }) => {
      console.log(`Collection ${tokenId}  https://hashscan.io/testnet/token/${tokenId}`);
      console.log(`Topic      ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
    })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { createCollection };

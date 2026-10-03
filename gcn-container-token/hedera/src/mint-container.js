const crypto = require("crypto");
const { TokenMintTransaction } = require("@hashgraph/sdk");
const { getClient } = require("./client");
const { validateIso6346 } = require("../../shared/iso6346");
const { readState, writeState, serialsFor } = require("./mirror");
const sample = require("../../shared/sample-container.json");

// HEDERA TESTNET ONLY. Mints one NFT for one ISO 6346 container id.
//
// HTS NFT metadata is capped at 100 bytes, so it holds a compact "ISO|hash16" pointer, not
// the documents. HTS itself would happily mint the same id twice, so "one token per
// container" is enforced here, against the mirror node, before minting.
//
// Usage: node src/mint-container.js CSQU3054383 [--docs ./bundle.json]

async function mintContainer(iso, { docs = null } = {}) {
  const v = validateIso6346(iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);
  const state = readState();
  if (!state.tokenId) throw new Error("no tokenId in state.json - run create-collection.js first");

  const existing = await serialsFor(state.tokenId, v.id);
  if (existing.length) {
    throw new Error(`${v.id} is already serial ${existing.join(", ")} on ${state.tokenId}; one token per container`);
  }

  const bundle = docs ?? sample.docsBundle; // SAMPLE bundle unless real documents are supplied
  const docsHash = crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex").slice(0, 16);
  const metadata = Buffer.from(`${v.id}|${docsHash}`); // 11 + 1 + 16 = 28 bytes
  if (metadata.length > 100) throw new Error("metadata exceeds the 100-byte HTS limit");

  const { client, operatorKey } = getClient();
  try {
    const tx = await new TokenMintTransaction()
      .setTokenId(state.tokenId)
      .addMetadata(metadata)
      .freezeWith(client)
      .sign(operatorKey);
    const rcpt = await (await tx.execute(client)).getReceipt(client);
    const serial = rcpt.serials[0].toString();
    (state.serials ||= {})[v.id] = serial;
    writeState(state);
    return { iso: v.id, serial, tokenId: state.tokenId, docsHash, sampleDocs: docs == null };
  } finally {
    client.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--docs");
  const docs = i >= 0 ? JSON.parse(require("fs").readFileSync(args[i + 1], "utf8")) : null;
  mintContainer(args[0] && !args[0].startsWith("--") ? args[0] : sample.isoId, { docs })
    .then((r) => {
      console.log(`Minted ${r.iso} as serial ${r.serial} on ${r.tokenId} (testnet)`);
      console.log(`  https://hashscan.io/testnet/token/${r.tokenId}/${r.serial}`);
      if (r.sampleDocs) console.log("  docs hash is from the SAMPLE bundle; pass --docs for real documents");
    })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { mintContainer };

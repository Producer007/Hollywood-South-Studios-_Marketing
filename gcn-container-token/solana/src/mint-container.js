const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  Connection, Keypair, clusterApiUrl, LAMPORTS_PER_SOL, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } = require("@solana/spl-token");
const { validateIso6346 } = require("../../shared/iso6346");
const sample = require("../../shared/sample-container.json");

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// DEVNET ONLY. One container = one 0-decimal, supply-1 SPL token (an NFT-shaped asset),
// with the ISO id + document hash written to the Memo program for an on-chain audit trail.
// Next step before anything beyond a demo: attach Metaplex Token Metadata for wallet display.
(async () => {
  const v = validateIso6346(process.argv[2] || sample.isoId);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const keyPath = process.env.SOLANA_DEVNET_KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json");
  const payer = fs.existsSync(keyPath)
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))))
    : Keypair.generate();
  if (!fs.existsSync(keyPath)) {
    console.log("No keypair file found; generated an ephemeral devnet keypair:", payer.publicKey.toBase58());
  }

  if ((await connection.getBalance(payer.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    console.log("Requesting devnet airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, 0);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  await mintTo(connection, payer, mint, ata.address, payer, 1);
  // Lock supply at 1: remove the mint authority so no second token can ever exist for this container.
  await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null);

  const docsHash = crypto.createHash("sha256").update(JSON.stringify(sample.docsBundle)).digest("hex");
  const memo = new TransactionInstruction({
    keys: [], programId: MEMO_PROGRAM,
    data: Buffer.from(JSON.stringify({ t: "gcct", iso: v.id, docs: docsHash.slice(0, 32), mint: mint.toBase58() })),
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(memo), [payer]);

  console.log({ cluster: "devnet", isoId: v.id, mint: mint.toBase58(), tokenAccount: ata.address.toBase58(), memoTx: sig });
})().catch((e) => { console.error(e); process.exit(1); });

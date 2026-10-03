const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  Connection, Keypair, clusterApiUrl, LAMPORTS_PER_SOL, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction,
} = require("@solana/web3.js");
const { validateIso6346 } = require("../../shared/iso6346");
const { haversineMeters, metersTo, validateCoord, EVENT_TYPES, EVIDENCE_TIERS, MAX_SPEED_MPS } = require("../../shared/geo");
const { lookup } = require("../../shared/unlocode");

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// SOLANA DEVNET ONLY. Writes one waypoint as a Memo instruction.
//
// Honest limitation of this path, stated up front: a Memo is a note in a transaction. The
// ordering is whatever the ledger gives it and there is NO on-chain validation at all -
// no speed ceiling, no chronology check, no geometric band. Every check below runs
// client-side, so a different client could write nonsense and the ledger would take it.
// The EVM ContainerJourney contract is the path with on-chain enforcement; this one is
// cheap, durable notarisation. Closing the gap means an Anchor program with the same
// invariants, which is the documented next step.
//
// Usage: node src/log-waypoint.js --iso CSQU3054383 --event LOADED_VESSEL \
//          --tier TIER2_CARRIER_EDI --port CNSHA --at 2026-03-01T08:00:00Z --evidence ./doc.pdf

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  return a;
}

const STATE = path.join(__dirname, "..", "journey-state.json");

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const v = validateIso6346(a.iso);
  if (!v.valid) throw new Error(`Invalid ISO 6346 id: ${v.reason}`);
  if (!EVENT_TYPES.includes(a.event)) throw new Error(`--event must be one of ${EVENT_TYPES.join(", ")}`);
  if (!(a.tier in EVIDENCE_TIERS)) throw new Error(`--tier must be one of ${Object.keys(EVIDENCE_TIERS).join(", ")}`);
  const mode = a.mode || "SEA";
  if (!(mode in MAX_SPEED_MPS)) throw new Error(`--mode must be one of ${Object.keys(MAX_SPEED_MPS).join(", ")}`);
  if (!a.evidence) throw new Error("--evidence <file> is required");

  let lat, lon, unlocode = null;
  if (a.port) {
    const p = lookup(a.port);
    if (!p.found) throw new Error(`--port ${a.port}: ${p.reason}`);
    ({ lat, lon } = p);
    unlocode = p.unlocode;
  } else {
    lat = Number(a.lat); lon = Number(a.lon);
  }
  const bad = validateCoord(lat, lon);
  if (bad) throw new Error(`position: ${bad}`);

  const at = a.at ? new Date(a.at) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error("--at must be ISO 8601");

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
  const prev = state[v.id] || null;
  let segmentMeters = 0;
  if (prev) {
    const dt = (at.getTime() - new Date(prev.at).getTime()) / 1000;
    if (dt <= 0) throw new Error(`--at is not after the last waypoint (${prev.at})`);
    segmentMeters = Math.round(haversineMeters(prev.lat, prev.lon, lat, lon));
    const speed = segmentMeters / dt;
    if (speed > MAX_SPEED_MPS[mode]) {
      throw new Error(`implausible ${speed.toFixed(1)} m/s for ${mode} (ceiling ${MAX_SPEED_MPS[mode]} m/s)`);
    }
  }

  const evidenceSha256 = crypto.createHash("sha256").update(fs.readFileSync(a.evidence)).digest("hex");
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const keyPath = process.env.SOLANA_DEVNET_KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json");
  const payer = fs.existsSync(keyPath)
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))))
    : Keypair.generate();
  if ((await connection.getBalance(payer.publicKey)) < 0.02 * LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // Memo payload stays compact: a memo is charged by the byte and capped by transaction size.
  const payload = {
    t: "gcnwp1", iso: v.id, e: a.event, tr: a.tier, md: mode, p: unlocode,
    la: +lat.toFixed(5), lo: +lon.toFixed(5), at: at.toISOString(), sm: segmentMeters,
    ev: evidenceSha256.slice(0, 32), pv: prev ? prev.memoTx.slice(0, 16) : null,
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 566) throw new Error("memo payload too large for one transaction");

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(body) })),
    [payer]
  );

  const cumulative = (prev?.cumulativeMeters || 0) + segmentMeters;
  state[v.id] = { at: at.toISOString(), lat, lon, memoTx: sig, cumulativeMeters: cumulative, waypoints: (prev?.waypoints || 0) + 1 };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  console.log(`devnet memo ${sig}`);
  console.log(`  ${a.event} ${unlocode || `${lat},${lon}`} @ ${at.toISOString()} [${a.tier}]`);
  console.log(`  leg ${metersTo(segmentMeters).statuteMiles} mi | attested total ${metersTo(cumulative).statuteMiles} mi (LOWER BOUND)`);
  console.log(`  no on-chain validation on this path - see the header comment`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });

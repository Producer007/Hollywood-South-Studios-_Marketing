const { credentials, parseKey } = require("./client");
const { accountInfo, tokenInfo, topicInfo, readState, MIRROR } = require("./mirror");

// HEDERA TESTNET preflight. Read-only: submits nothing and spends nothing.
// Run it before create-collection, and again whenever something fails.
//
//   node src/check.js
//
// Checks: the key in .env parses; it is the key on the account (a mismatch fails every
// transaction with INVALID_SIGNATURE, which is the most common first-run error); the
// account has HBAR; and, if state.json exists, that its token and topic are live and
// controlled by this key.

const MIN_HBAR = 20; // collection create (~$1) + topic + a few mints and messages, with margin

function keyHex(k) {
  return (k?.key || "").toLowerCase();
}

async function preflight() {
  const rows = [];
  const ok = (name, detail) => rows.push({ ok: true, name, detail });
  const fail = (name, detail) => rows.push({ ok: false, name, detail });

  let c, key;
  try {
    c = credentials();
    key = parseKey(c.key, c.keyType);
    ok("credentials", `${c.id}, ${c.keyType} key parsed (testnet)`);
  } catch (e) {
    fail("credentials", e.message);
    return rows;
  }
  const pub = key.publicKey.toStringRaw().toLowerCase();

  const acct = await accountInfo(c.id).catch((e) => ({ error: e.message }));
  if (!acct || acct.error) {
    fail("account", acct?.error || `${c.id} not found on ${MIRROR()}`);
    return rows;
  }
  const onChain = keyHex(acct.key);
  if (onChain && onChain.endsWith(pub)) ok("key matches account", `${acct.key._type} ${pub.slice(0, 12)}...`);
  else fail("key matches account", `account key ${onChain.slice(0, 16)}... is not this key's public key ${pub.slice(0, 16)}... (check HEDERA_KEY_TYPE)`);
  if (acct.evm_address) ok("EVM alias", `${acct.evm_address} (usable on the JSON-RPC relay, chainId 296)`);

  const hbar = Number(acct.balance?.balance || 0) / 1e8;
  if (hbar >= MIN_HBAR) ok("balance", `${hbar.toFixed(2)} HBAR`);
  else fail("balance", `${hbar.toFixed(2)} HBAR; top up at portal.hedera.com (want >= ${MIN_HBAR})`);

  const state = readState();
  if (!state.tokenId) {
    ok("state.json", "no collection yet - next step: node src/create-collection.js");
    return rows;
  }
  const tok = await tokenInfo(state.tokenId).catch(() => null);
  if (!tok) fail("token", `${state.tokenId} not found on the mirror node`);
  else {
    const supplyOk = keyHex(tok.supply_key).endsWith(pub);
    (supplyOk ? ok : fail)("token", `${state.tokenId} ${tok.type}, supply ${tok.total_supply}, supply key ${supplyOk ? "is" : "is NOT"} this operator${tok.pause_status === "PAUSED" ? ", PAUSED" : ""}`);
  }
  const top = await topicInfo(state.topicId).catch(() => null);
  if (!top) fail("topic", `${state.topicId} not found on the mirror node`);
  else {
    const submitOk = keyHex(top.submit_key).endsWith(pub);
    (submitOk ? ok : fail)("topic", `${state.topicId}, submit key ${submitOk ? "is" : "is NOT"} this operator`);
  }
  return rows;
}

if (require.main === module) {
  preflight()
    .then((rows) => {
      rows.forEach((r) => console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(20)} ${r.detail}`));
      if (rows.some((r) => !r.ok)) process.exit(1);
    })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { preflight };

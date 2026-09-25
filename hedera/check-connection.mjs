// Hedera connection check: mirror node REST, JSON-RPC relay, and (with operator
// credentials) a signed-client balance query against the consensus nodes.
// Read-only. Submits no transactions and spends no HBAR.
import "dotenv/config";
import { AccountBalanceQuery, AccountId, Client, PrivateKey } from "@hashgraph/sdk";

const NETWORKS = {
  mainnet: { mirror: "https://mainnet.mirrornode.hedera.com", rpc: "https://mainnet.hashio.io/api", chainId: 295 },
  testnet: { mirror: "https://testnet.mirrornode.hedera.com", rpc: "https://testnet.hashio.io/api", chainId: 296 },
  previewnet: { mirror: "https://previewnet.mirrornode.hedera.com", rpc: "https://previewnet.hashio.io/api", chainId: 297 },
};

const network = (process.env.HEDERA_NETWORK || "testnet").toLowerCase();
const cfg = NETWORKS[network];
if (!cfg) {
  console.error(`Unknown HEDERA_NETWORK "${network}". Use: ${Object.keys(NETWORKS).join(", ")}`);
  process.exit(2);
}
const mirrorUrl = process.env.HEDERA_MIRROR_URL || cfg.mirror;
const rpcUrl = process.env.HEDERA_JSON_RPC_URL || cfg.rpc;
const operatorId = process.env.HEDERA_OPERATOR_ID?.trim();
const operatorKey = process.env.HEDERA_OPERATOR_KEY?.trim();
const expectedEvm = process.env.HEDERA_OPERATOR_EVM?.trim().toLowerCase();

// The portal shows ECDSA keys as raw hex (0x…) and ED25519 keys as DER (302e…); accept both.
function parseKey(k) {
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(k)) return PrivateKey.fromStringECDSA(k.replace(/^0x/, ""));
  return PrivateKey.fromStringDer(k);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};
const errText = (e) => (e?.cause?.message ? `${e.message}: ${e.cause.message}` : e?.message ?? String(e));

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function checkMirror() {
  try {
    const { blocks } = await fetchJson(`${mirrorUrl}/api/v1/blocks?limit=1&order=desc`);
    const b = blocks?.[0];
    const ageSec = b ? Math.round(Date.now() / 1000 - Number(b.timestamp.to.split(".")[0])) : NaN;
    record("Mirror node", Boolean(b), b ? `latest block #${b.number}, ${ageSec}s old (${mirrorUrl})` : "no blocks returned");
  } catch (e) {
    record("Mirror node", false, `${errText(e)} (${mirrorUrl})`);
  }
}

async function checkJsonRpc() {
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    const { result, error } = await fetchJson(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (error) throw new Error(error.message);
    const chainId = parseInt(result, 16);
    record("JSON-RPC relay", chainId === cfg.chainId, `chainId ${chainId} (expected ${cfg.chainId}) (${rpcUrl})`);
  } catch (e) {
    record("JSON-RPC relay", false, `${errText(e)} (${rpcUrl})`);
  }
}

async function checkAccount() {
  if (!operatorId) {
    record("Operator account", null, "HEDERA_OPERATOR_ID not set — copy .env.example to .env");
    return;
  }
  try {
    const info = await fetchJson(`${mirrorUrl}/api/v1/accounts/${operatorId}`);
    record("Operator account (mirror)", !info.deleted, `${info.account} exists${info.deleted ? " (DELETED)" : ""}, balance ${info.balance.balance / 1e8} ℏ, key ${info.key?._type}, EVM ${info.evm_address}`);
    if (expectedEvm) {
      record("Operator EVM address", info.evm_address?.toLowerCase() === expectedEvm, `mirror ${info.evm_address}, expected ${expectedEvm}`);
    }
  } catch (e) {
    record("Operator account (mirror)", false, `${operatorId}: ${errText(e)}`);
  }
}

async function checkConsensus() {
  if (!operatorId || !operatorKey) {
    record("Consensus nodes (SDK)", null, "HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY not set");
    return;
  }
  const client = Client.forName(network);
  try {
    client.setOperator(AccountId.fromString(operatorId), parseKey(operatorKey));
    client.setRequestTimeout(20000);
    // Balance queries are free, so this proves the SDK reaches the consensus nodes without spending HBAR.
    const balance = await new AccountBalanceQuery().setAccountId(operatorId).execute(client);
    record("Consensus nodes (SDK)", true, `balance ${balance.hbars.toString()} via ${network} gRPC`);
  } catch (e) {
    record("Consensus nodes (SDK)", false, errText(e));
  } finally {
    client.close();
  }
}

// "Name=0.0.123,Other=0.0.456" -> [["Name","0.0.123"], ...]
function parseIds(v) {
  return (v || "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [name, id] = p.includes("=") ? p.split("=").map((x) => x.trim()) : [p, p];
    return [name, id];
  });
}

// Evidence for page copy: a contract may only be labelled "Testnet Deployed" when its
// Hedera contract ID resolves on the mirror node. Anything else stays "Compiled · Pre-audit".
async function checkContracts() {
  for (const [name, id] of parseIds(process.env.HEDERA_CONTRACT_IDS)) {
    try {
      const c = await fetchJson(`${mirrorUrl}/api/v1/contracts/${id}`);
      const created = new Date(Number(c.created_timestamp.split(".")[0]) * 1000).toISOString().slice(0, 10);
      record(`Contract ${name}`, !c.deleted, `${c.contract_id} created ${created}${c.deleted ? ", DELETED" : ""}, EVM ${c.evm_address} → copy may read "Testnet Deployed · ${c.contract_id}"`);
    } catch (e) {
      record(`Contract ${name}`, false, `${id}: ${errText(e)} → keep "Compiled · Pre-audit"`);
    }
  }
}

async function checkTokens() {
  for (const [name, id] of parseIds(process.env.HEDERA_TOKEN_IDS)) {
    try {
      const t = await fetchJson(`${mirrorUrl}/api/v1/tokens/${id}`);
      record(`HTS token ${name}`, !t.deleted, `${t.token_id} "${t.name}" (${t.symbol}), ${t.type}, supply ${t.total_supply}${t.deleted ? ", DELETED" : ""}`);
    } catch (e) {
      record(`HTS token ${name}`, false, `${id}: ${errText(e)}`);
    }
  }
}

console.log(`Hedera connection check — network: ${network}\n`);
await checkMirror();
await checkJsonRpc();
await checkAccount();
await checkConsensus();
await checkContracts();
await checkTokens();

const failed = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`\n${failed ? "NOT CONNECTED" : skipped ? "REACHABLE (credentials not configured)" : "CONNECTED"} — ${results.length - failed - skipped} pass, ${failed} fail, ${skipped} skipped`);
process.exit(failed ? 1 : 0);

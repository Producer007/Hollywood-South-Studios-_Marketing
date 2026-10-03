const fs = require("fs");
const path = require("path");

// TESTNET guard shared by both deploy scripts. Checks the network NAME and the chainId the
// RPC actually reports, because a name is only a label: a "hederaTestnet" entry pointed at
// a mainnet RPC would pass a name check and fail this one.

const FORBIDDEN_NAMES = ["mainnet", "homestead", "polygon", "base", "arbitrum", "optimism", "bsc", "avalanche"];
const ALLOWED_CHAINS = {
  31337: { label: "local hardhat", explorer: null },
  11155111: { label: "Sepolia testnet", explorer: (a) => `https://sepolia.etherscan.io/address/${a}` },
  296: { label: "Hedera testnet (JSON-RPC relay)", explorer: (a) => `https://hashscan.io/testnet/contract/${a}` },
};

async function assertTestnet(hre) {
  const name = hre.network.name.toLowerCase();
  if (FORBIDDEN_NAMES.some((n) => name.includes(n))) {
    throw new Error(`refusing to deploy to ${hre.network.name}: pre-audit, testnet only`);
  }
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const chain = ALLOWED_CHAINS[chainId];
  if (!chain) throw new Error(`refusing to deploy: chainId ${chainId} is not an allowed testnet (${Object.keys(ALLOWED_CHAINS).join(", ")})`);
  return { chainId, ...chain };
}

// Deployed addresses go to deployments/<network>.json so the next script (and a reader)
// can find them without copying hex from a terminal.
function record(networkName, patch) {
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${networkName}.json`);
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const next = { ...prev, ...patch, status: "PRE-AUDIT / TESTNET", updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

function recorded(networkName) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

module.exports = { assertTestnet, record, recorded, FORBIDDEN_NAMES, ALLOWED_CHAINS };

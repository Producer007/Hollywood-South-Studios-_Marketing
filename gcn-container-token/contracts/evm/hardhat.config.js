require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// TESTNETS ONLY. Never put a mainnet key in this file or .env.
const KEY = process.env.TESTNET_PRIVATE_KEY ? [process.env.TESTNET_PRIVATE_KEY] : [];

// Offline / air-gapped builds: Hardhat normally fetches solc from
// binaries.soliditylang.org, which is blocked in locked-down CI and sandboxes.
// Point SOLC_JS_PATH at a local solc-js build (npm i solc@0.8.19 -> node_modules/solc/soljson.js)
// and compilation runs with no network at all. Unset, behaviour is unchanged.
if (process.env.SOLC_JS_PATH) {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion === "0.8.19") {
      return {
        compilerPath: process.env.SOLC_JS_PATH,
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: "0.8.19-local-solcjs",
      };
    }
    return runSuper();
  });
}

module.exports = {
  solidity: { version: "0.8.19", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {},
    sepolia: { url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org", accounts: KEY },
    // Hedera's EVM-compatible JSON-RPC relay (testnet)
    hederaTestnet: { url: process.env.HEDERA_TESTNET_RPC || "https://testnet.hashio.io/api", accounts: KEY, chainId: 296 },
  },
};

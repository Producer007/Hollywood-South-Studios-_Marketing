const hre = require("hardhat");
const path = require("path");
const { assertTestnet, record } = require("./guard");
const { validateIso6346 } = require(path.join(__dirname, "../../../shared/iso6346.js"));
const sample = require(path.join(__dirname, "../../../shared/sample-container.json"));

// TESTNET ONLY. Deploys ContainerToken and registers the SAMPLE container as token #1.
//   npx hardhat run scripts/deploy.js --network hederaTestnet   (chainId 296)
//   npx hardhat run scripts/deploy.js --network sepolia
// On Hedera the deployer must be an ECDSA account with an EVM alias; TESTNET_PRIVATE_KEY is
// that account's 0x hex key from portal.hedera.com.

async function main() {
  const chain = await assertTestnet(hre);
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Network: ${hre.network.name} (${chain.label}, chainId ${chain.chainId})\nDeployer: ${deployer.address}`);

  const Token = await hre.ethers.getContractFactory("ContainerToken");
  const token = await Token.deploy(deployer.address);
  await token.deployed();
  console.log("ContainerToken (testnet, pre-audit):", token.address);
  if (chain.explorer) console.log(`  ${chain.explorer(token.address)}`);

  const v = validateIso6346(sample.isoId);
  if (!v.valid) throw new Error(`Sample container invalid: ${v.reason}`);
  const docsHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(JSON.stringify(sample.docsBundle)));
  await (await token.register(deployer.address, v.id, sample.sizeType, docsHash)).wait();
  console.log(`Registered ${v.id} as token #1 (SAMPLE data)`);

  record(hre.network.name, {
    chainId: chain.chainId, deployer: deployer.address, containerToken: token.address,
    sampleRegistered: { tokenId: 1, iso: v.id, note: "SAMPLE data, not a verified container" },
  });
  console.log(`Recorded in deployments/${hre.network.name}.json`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

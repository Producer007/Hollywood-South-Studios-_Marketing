const hre = require("hardhat");
const { ethers, network } = hre;
const { assertTestnet, record, recorded } = require("./guard");
const { haversineMeters, toE5 } = require("../../../shared/geo");
const { PORTS } = require("../../../shared/unlocode");

// TESTNET ONLY. Deploys ContainerJourney against an existing ContainerToken and, with
// --seed, writes a short sample journey so the views return something to look at.
//
// The ContainerToken address comes from CONTAINER_TOKEN_ADDRESS, or from
// deployments/<network>.json written by deploy.js. `hardhat run` does not forward script
// arguments, so seeding is SEED_JOURNEY=1 (the old `-- --seed` form is still accepted).

const u = (c) => ethers.utils.hexlify(ethers.utils.toUtf8Bytes(c));
const hash = (s) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));

async function main() {
  const chain = await assertTestnet(hre);
  const tokenAddr = process.env.CONTAINER_TOKEN_ADDRESS || recorded(network.name).containerToken;
  if (!tokenAddr) throw new Error("run deploy.js first, or set CONTAINER_TOKEN_ADDRESS");

  const [deployer] = await ethers.getSigners();
  const journey = await (await ethers.getContractFactory("ContainerJourney")).deploy(tokenAddr, deployer.address);
  await journey.deployed();
  console.log(`ContainerJourney -> ${journey.address} on ${network.name} (TESTNET, pre-audit)`);
  if (chain.explorer) console.log(`  ${chain.explorer(journey.address)}`);
  console.log(`  token: ${tokenAddr}`);
  console.log(`  caveat on-chain: ${await journey.distanceCaveat()}`);
  record(network.name, { chainId: chain.chainId, containerToken: tokenAddr, containerJourney: journey.address });

  if (!(process.env.SEED_JOURNEY === "1" || process.argv.includes("--seed"))) return;

  // Sample route for token #1. SAMPLE DATA, not a real shipment.
  const route = [
    { port: "CNSHA", event: 1, mode: 4, tier: 1, days: 0 },   // LoadedVessel, Yard, CarrierEdi
    { port: "SGSIN", event: 3, mode: 0, tier: 2, days: 11 },  // Transshipped, Sea, VesselAis
    { port: "AEJEA", event: 4, mode: 0, tier: 1, days: 12 },  // Discharged, Sea, CarrierEdi
  ];
  let at = Math.floor(Date.now() / 1000) - 60 * 86400;
  let prev = null;
  for (const r of route) {
    const p = PORTS[r.port];
    at += r.days * 86400;
    const meters = prev ? Math.round(haversineMeters(prev.lat, prev.lon, p.lat, p.lon)) : 0;
    const tx = await journey.appendWaypoint(
      1, r.event, r.mode, r.tier, u(r.port), toE5(p.lat), toE5(p.lon), at, meters, hash(`evidence-${r.port}`)
    );
    await tx.wait();
    console.log(`  logged ${r.port} (+${(meters / 1609.344).toFixed(0)} mi)`);
    prev = p;
  }
  const s = await journey.journeySummary(1);
  console.log(`  total ${(s.meters.toNumber() / 1609.344).toFixed(0)} mi across ${s.count} waypoints (LOWER BOUND)`);
  console.log(`  container-level evidence: ${await journey.hasContainerLevelEvidence(1)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

# GCN Container Token: Hedera testnet

**Proof-of-concept · pre-audit · Hedera TESTNET only · not deployed for live value.**

This folder holds the native Hedera side of the module:

- one HTS NFT per ISO 6346 container id;
- one HCS topic that stores each container's journey as an append-only log with a hash chain;
- a verification report that anyone can rebuild from the public mirror node, with no keys.

The EVM contracts can also run on Hedera through the JSON-RPC relay (chainId 296). That path is described at the end of this file.

> **Status, 7 October 2026.** The scripts pass 16 offline tests (`npm test`). Those tests run against an in-memory ledger and a fake mirror node, so they test the scripts' logic, not Hedera itself. **`check`, `create`, `mint`, `waypoint` and `journey` have now been run live on Hedera testnet** (collection `0.0.10897043`, topic `0.0.10897044`) with one SAMPLE container and two SAMPLE waypoints; the `journey` report rebuilt from the public mirror node showed the hash chain intact. That data is fictional. `attest` and the EVM deploy on the Hedera relay have not been run live.

## 1. Set up (once)

You need Node 18 or later and the GCN testnet operator account `0.0.10717267`. The steps:

1. Install the dependencies and create your `.env`:

   ```bash
   cd gcn-container-token/hedera
   npm install
   cp .env.example .env
   ```

2. Open `.env` and set `HEDERA_TESTNET_PRIVATE_KEY`. Use the key exactly as the portal shows it: either `0x…` hex or `3030…` DER.

If you already have `hedera/.env` from the GCN connection check, you can copy that file in instead. It uses the names `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`, and both are accepted here.

## 2. Preflight (read-only, costs nothing)

```bash
npm run check
```

The preflight confirms four things:

- the key parses;
- **it is the key on the account** (a mismatch here is the usual cause of `INVALID_SIGNATURE`);
- the balance is at least 20 HBAR;
- once a collection exists, the token and topic are controlled by this key.

Every row must read `PASS` before you go on.

## 3. Create, mint, log, verify

```bash
npm run create                       # HTS collection + HCS topic -> state.json, HashScan links
npm run mint -- CSQU3054383          # SAMPLE id; refuses a second token for the same id
npm run waypoint -- --iso CSQU3054383 --event LOADED_VESSEL --tier TIER2_CARRIER_EDI \
     --port CNSHA --at 2026-03-01T08:00:00Z --evidence ./codeco.edi
npm run waypoint -- --iso CSQU3054383 --event TRANSSHIPPED --tier TIER2_CARRIER_EDI \
     --port SGSIN --at 2026-03-12T08:00:00Z --evidence ./codeco-2.edi
npm run journey -- CSQU3054383       # report from the public mirror node
```

The mint uses `CSQU3054383`, which is the worked example from the ISO 6346 standard. It is sample data, not a verified container. The mint also hashes the sample document bundle unless you pass `--docs ./bundle.json`.

After `create`, commit `state.json`. It holds only public IDs: the token, the topic and the operator.

## What the scripts enforce

| Rule | Where |
|---|---|
| One token per ISO 6346 id. HTS would mint duplicates, so the id is checked on the mirror node first. | `mint-container.js` |
| No waypoint for a container that has no token (the same rule as `ContainerJourney.sol`). | `log-waypoint.js` |
| Each waypoint chains to the previous one **as the network holds it**. The link is read from the mirror node, not from `state.json`, so losing `state.json` cannot break the chain. | `log-waypoint.js` |
| If the mirror node is behind what this machine wrote, the script waits. If it is still behind after about 20 s, the script stops instead of chaining to a stale link. | `log-waypoint.js` |
| No evidence file means no waypoint. There is also a per-mode speed ceiling, no future timestamps, and an IMO is required for `TIER3_VESSEL_AIS`. | `log-waypoint.js` |
| Waypoints stay under 1,024 bytes, so HCS never splits them into chunks. | `log-waypoint.js` |
| An MTI attestation needs the SHA-256 of the actual Pole Star result. | `attest.js` |
| The report flags chain breaks, distance mismatches, orphan vessel-AIS positions, implausible speeds and coverage gaps. | `journey.js` |
| Testnet only. There is no mainnet code path, and `HEDERA_NETWORK` set to anything else is refused. | `client.js` |

The report states the distance as **attested great-circle distance, a lower bound**, never as the distance travelled. A token is not proof that a container physically exists. The evidence tier on each waypoint says what was actually observed.

## EVM contracts on Hedera (JSON-RPC relay, chainId 296)

```bash
cd ../contracts/evm
npm install && npm i --no-save solc@0.8.19
npm run test:offline                                   # 21 tests
export TESTNET_PRIVATE_KEY=0x...                       # the operator's ECDSA hex key
npm run deploy:hedera-evm                              # ContainerToken + SAMPLE token #1
npm run deploy-journey:hedera-evm                      # ContainerJourney + SAMPLE route
```

On Hedera, the deployer must be an ECDSA account with an EVM alias. GCN's operator `0.0.10717267` is one (`0x76ad…39df`).

Both deploy scripts check the chainId that the RPC reports, not just the network name. They accept only 296, Sepolia (11155111) and local Hardhat (31337).

Addresses are written to `deployments/hederaTestnet.json`, with HashScan links. Commit that file after deploying.

Both deploy scripts have been run end to end against a local Hardhat node. Neither has been run against the Hedera relay.

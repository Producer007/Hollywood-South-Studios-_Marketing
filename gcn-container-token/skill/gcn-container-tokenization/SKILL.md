---
name: gcn-container-tokenization
description: Build or extend GCN Exchange shipping-container tokenization and traceability on Hedera testnet, Solana devnet and EVM testnet - ISO 6346 identity, append-only journey ledger with distance accounting, evidence tiers, and Pole Star MTI vessel screening via Atomic Agents. Use when asked to tokenize containers, trace where a container has been or how far it has travelled, gate transfers on vessel risk, or mint/attest container tokens. Testnet only, pre-audit.
---

# GCN Container Tokenization and Traceability (testnet, pre-audit, proof-of-concept)

## Status line - include in every output
Testnet/devnet only. Pre-audit. Proof-of-concept. Not deployed for live value.

## The two claims to never overstate
1. **A token does not prove a container exists.** It proves an issuer holding ISSUER_ROLE
   committed to an ISO 6346 id and a document hash. The attester carries the claim, not
   the chain.
2. **A journey log does not prove movement.** It proves identified observers committed to
   positions in a fixed order and cannot now alter them. Whether those positions are
   worth anything is decided by the **evidence tier** on each one.

## Evidence tiers - never flatten these
| Tier | Observes | Use |
|---|---|---|
| TIER1_CONTAINER_TELEMETRY | the container itself (GPS/BLE on the box) | the only container-level proof |
| TIER2_CARRIER_EDI | a handling event in a carrier/terminal system (CODECO, BAPLIE, B/L) | strong for port calls |
| TIER3_VESSEL_AIS | the **ship** | valid for the box only between LOADED_VESSEL/TRANSSHIPPED and DISCHARGED/GATE_IN/DELIVERED |
| TIER4_MANUAL | nothing - a person said so | weakest; needs a document hash |

A TIER3 position outside a loaded voyage window is a ship's position wearing a
container's name. Both engines flag it as `ORPHAN_VESSEL_POSITION`.

## Distance - always a lower bound
Distance is the sum of great-circle hops between attested positions. It is a **lower
bound**: ships do not sail great circles, and the log is sparse so corners get cut.
Report it as "attested great-circle distance", never "distance travelled". The EVM
contract keeps the caveat on-chain in `distanceCaveat()` so no interface can quote the
number without it.

## Workflow
1. **Validate the ISO 6346 id** (`shared/iso6346.js` or `iso6346_check` in the agent).
   Never mint an invalid id.
2. **Mint** on the chosen chain (see below).
3. **Log waypoints** as they are observed, each with an evidence tier and a hash of the
   source record. No evidence hash, no waypoint.
4. **Screen the vessel** with a real Pole Star MTI score before a loaded leg
   (`agent/container_agent.py`). Never estimate a score; absent one the verdict is
   `needs_mti`.
5. **Audit the journey** (`agent/journey_agent.py`, or `hedera/src/journey.js` for the
   report) before quoting a route or a distance to anyone.

## Chains
| | EVM (`contracts/evm`) | Hedera (`hedera/`) | Solana (`solana/`) |
|---|---|---|---|
| Identity | ERC-721, one token per `keccak256(isoId)` | HTS NonFungibleUnique | SPL 0-decimal, supply 1 |
| Journey | `ContainerJourney.sol`, append-only, **on-chain validation** | HCS topic, network-ordered, hash-chained | Memo records, **no on-chain validation** |
| Transfer gating | status + MTI policy in `_beforeTokenTransfer` | key-controlled (pause/wipe) | none on-chain |

Stack: solc 0.8.19, OpenZeppelin 4.9.6. Networks: Sepolia, Hedera JSON-RPC relay (296).
HTS NFT metadata is capped at 100 bytes, so it holds `ISO|hash16` only.

## On-chain checks in ContainerJourney (what the contract actually enforces)
- Append-only. No edit, no delete. A mistake is fixed by `appendCorrection`, which leaves
  the original visible.
- Chronological order; no future timestamps; evidence hash required.
- Per-mode speed ceiling (SEA/ROAD/RAIL/AIR/YARD) - rejects a leg no conveyance could make.
- A geometric band on the claimed distance, computed without trig: `|dLat|` as the floor,
  `|dLat|+|dLon|` as the ceiling, 1% slack. Catches a transposed sign or a mistyped
  coordinate. It is **not** a substitute for recomputing haversine off-chain.
- `containerLevelObservations` counted separately, so "did anything observe the box" is a
  one-call question.

## Rules
- Mainnet paths are deliberately absent. Do not add them without an audit.
- MTI is per vessel (0-5), a Pole Star commercial product. Cite the page; claim no
  partnership, no endorsement, no data-sharing agreement.
- `shared/unlocode.js` holds hand-typed approximate port centroids for the demo. Replace
  with the official UNECE UN/LOCODE list before anything real, and record the edition.
- Do not blend this with other GCN venture pitches. Avoid: leverage, synergy,
  game-changing, disruptive, revolutionary.

## Offline verification (no keys, no network)
```
node shared/test-geo.js                 # 14 geodesy and replay checks
node shared/demo-journey.js             # full sample report with planted defects
cd agent && python -m pytest -q         # 15 agent checks
cd contracts/evm && npm i && SOLC_JS_PATH=$(pwd)/node_modules/solc/soljson.js npx hardhat test
```
The `SOLC_JS_PATH` override in `hardhat.config.js` compiles from a local solc-js build, so
the suite runs where `binaries.soliditylang.org` is blocked. `npm i solc@0.8.19` first.

See `references/architecture.md`, `references/traceability.md` and `references/mti-notes.md`.

## Interoperability layer (`standards/`)
The ledger speaks the formats the industry actually uses. Use these rather than hand-rolling
a per-partner adapter.

| Module | Direction | Standard |
|---|---|---|
| `standards/dcsa.js` | both ways | DCSA Track & Trace 2.1 — what Maersk, MSC, CMA CGM, Hapag-Lloyd and the other DCSA carriers publish |
| `standards/edifact.js` | inbound | UN/EDIFACT CODECO (terminal gate moves) and IFTSTA (carrier status) |
| `standards/epcis.js` | outbound | GS1 EPCIS 2.0 JSON-LD — cross-industry visibility (shippers, retailers, customs) |
| `standards/ais.js` | inbound | vessel AIS, provider-agnostic |
| `shared/identifiers.js` | — | IMO, MMSI, ISO 6346 size/type, SCAC, SMDG facility, DCSA doc refs |

Three refusals these adapters enforce, each covered by a test — do not weaken them:
1. **Only `ACT` events become waypoints.** `EST`/`PLN` are forecasts; an ETA in an
   append-only ledger is indistinguishable from an observation once stored.
2. **AIS positions pass only inside a loaded voyage window** on the matching IMO. Outside
   one, it is the ship's position, not the container's.
3. **UN/LOCODE-derived positions are port centroids**, not fixes; `positionBasis` says so.

**AIS providers:** FleetMon's API is retired (Kpler acquired FleetMon and MarineTraffic in
Feb 2023; FleetMon was phased out from January 2024). Use the `marinetraffic` or `generic`
provider; `fleetmon` exists only for archived exports.

**Size/type:** use ISO 6346 codes (`45G1`, `22G1`), never yard shorthand (`40HC`, `20GP`).
`validateSizeType` normalises shorthand; `ContainerToken.register` rejects it on-chain.

```
node standards/test-standards.js    # 32 interoperability checks
```

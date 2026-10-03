# Claude Code Handoff — GCN Cargo Container Token & Traceability

| | |
|---|---|
| **Module** | Cargo Container Tokenization + Traceability Ledger |
| **Platform** | GCN Exchange — addition to the existing exchange platform |
| **Chains** | Hedera testnet · Solana devnet · EVM testnet (Sepolia, Hedera JSON-RPC relay 296) |
| **Status** | **Proof-of-concept. Pre-audit. Testnet only. Not deployed for live value.** |
| **Version** | v3 — Hedera update; supersedes v2 (2 October 2026) |
| **Date** | 3 October 2026 |
| **Author** | Claude Code session, for James A. Holmes Jr. |

---

## 1. What this module does

It gives a shipping container a token identity keyed to its ISO 6346 id, and an
append-only ledger of where that container has been attested to be — with distance
accounting and an explicit record of how each position was obtained.

It answers three questions:

| Question | Where it is answered |
|---|---|
| Which container is this? | ISO 6346 id + check digit, one token per id |
| Where has it been? | `ContainerJourney` waypoint log / HCS topic, port calls in order |
| How far has it travelled? | `cumulativeMeters`, reported in miles / nautical miles / km |

---

## 2. The honesty constraint this was built around

The brief that produced this module was: *"A token does not prove a physical container
exists. Please create this ability."*

**That ability cannot be fully created, and the design says so rather than pretending
otherwise.** A blockchain cannot observe a steel box. No contract, key or consensus
mechanism changes that. Anyone who tells you their container token proves physical
existence is either confused or selling something.

What *can* be built — and what is built here — is a record whose weaknesses are legible
instead of hidden. The mechanism is the **evidence tier**: every waypoint carries a
machine-readable statement of what was actually observed.

| Tier | What it observed | Trust weight |
|---|---|---|
| `TIER1_CONTAINER_TELEMETRY` | **the container itself** — GPS/BLE device on the box | 1.00 |
| `TIER2_CARRIER_EDI` | a handling event in a carrier/terminal system of record (CODECO, BAPLIE, B/L) | 0.70 |
| `TIER3_VESSEL_AIS` | **the ship**, not the box | 0.40 |
| `TIER4_MANUAL` | nothing — a person asserted it | 0.15 |

Only TIER1 observes the container. This matters more than it sounds: almost every
"container tracking" claim in the market is TIER3 — a vessel's AIS transponder, with the
container's position inferred from the ship's. That inference is only valid while the
container is demonstrably aboard that ship. Outside a `LOADED_VESSEL … DISCHARGED`
window it is a ship's position wearing a container's name, and both engines flag it as
`ORPHAN_VESSEL_POSITION`.

`hasContainerLevelEvidence(tokenId)` returns `false` when nothing in a journey observed
the container. An interface built on this should show that prominently, not bury it.

### Distance is a lower bound, always

`cumulativeMeters` is the sum of **great-circle hops between attested positions**. It
understates reality for two reasons:

1. Ships do not sail great circles — they follow traffic lanes, canals, coastlines and
   weather routing. Shanghai→Rotterdam is ~10,500 nm by arc and ~11,800 nm via Suez.
2. The log is sparse. Positions between attestations are unknown, and a sparse log cuts
   corners off the real track.

So it is reported as **"attested great-circle distance"**, never "distance travelled".
`ContainerJourney.distanceCaveat()` keeps that sentence on-chain next to the number, so
no interface can quote the figure and claim the caveat came from somewhere else.

---

## 3. Carrier and tracking-system interoperability

The ledger speaks the formats the industry actually uses, so integration is not a bespoke
adapter per partner.

| Module | Direction | Standard | Who it reaches |
|---|---|---|---|
| `standards/dcsa.js` | both ways | DCSA Track & Trace 2.1 | The 10 DCSA carriers: Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE, Evergreen, Yang Ming, HMM, ZIM, PIL |
| `standards/edifact.js` | inbound | UN/EDIFACT CODECO, IFTSTA | Terminal operators worldwide, and **COSCO**, which is not a DCSA member |
| `standards/epcis.js` | outbound | GS1 EPCIS 2.0 (JSON-LD) | Shippers, retailers, customs systems |
| `standards/ais.js` | inbound | Vessel AIS, provider-agnostic | MarineTraffic/Kpler, generic feeds |
| `shared/identifiers.js` | — | IMO, MMSI, ISO 6346 size/type, SCAC, SMDG | Validation for all of the above |

**COSCO is the reason EDIFACT exists in this build.** It absorbed China Shipping (CSCL) in
2016, is a top-four global carrier, and is **not** a DCSA member. DCSA alone would not reach it.

### Three refusals the adapters enforce

Each is covered by a test. Do not weaken them — they all cut the same way: the ledger would
look better without them and be worth less.

1. **Only `ACT` (actual) events become waypoints.** Most carrier feed volume is `EST` or
   `PLN`. An ETA written into an append-only ledger is indistinguishable from an observation
   once stored, and carriers revise ETAs constantly.
2. **AIS positions pass only inside a loaded voyage window** on the matching IMO. Outside one,
   it is the ship's position, not the container's — the most common way container tracking
   misleads.
3. **UN/LOCODE-derived positions are port centroids**, accurate to kilometres, never presented
   as fixes.

### AIS provider note

**FleetMon's API is retired.** Kpler acquired FleetMon and MarineTraffic in February 2023 and
FleetMon was phased out from January 2024; `apiv2.fleetmon.com` and the developer portal are
gone. The adapter is therefore provider-agnostic — MarineTraffic/Kpler is the live path,
`generic` takes any other feed, and the FleetMon profile remains only for archived exports.
Switching provider is one argument, not a rewrite.

---

## 4. What is verified, and what is not

This is the section to read before quoting any of this to a counterparty.

### Tested and passing (run in this session)

| Check | Result |
|---|---|
| EVM contract suite — `ContainerToken` + `ContainerJourney` + deploy guard | **21 tests passing** |
| Interoperability — `standards/test-standards.js` | **32 checks passing** |
| Geodesy and journey replay — `shared/test-geo.js` | **14 checks passing** |
| Agent suite — screening + journey audit | **15 tests passing** (v2 run; agents unchanged in v3) |
| Hedera scripts — `hedera/test/hedera.test.js`, in-memory ledger + fake mirror node | **16 tests passing** |
| **Total** | **98 automated checks, all passing** |
| EVM `deploy.js` → `deploy-journey.js` with seed route, local Hardhat node | **ran end to end** (6,009 mi lower bound, `hasContainerLevelEvidence` = false) |
| Solidity compile, solc 0.8.19, optimizer on | clean, no warnings (ContainerToken 11,505 B · ContainerJourney 10,164 B) |
| JS ↔ Python haversine agreement | agree to **under 1 metre** on three known pairs |
| Skill structure validator | passes |

The EVM distance test uses real port coordinates and real haversine values, and asserts
the Shanghai→Singapore→Jebel Ali total lands between 9,000 and 13,000 km — a sanity
check against the real world, not against my own arithmetic.

### Compiles and parses but has never run

- **Hedera scripts** (`check`, `create-collection`, `mint-container`, `attest`,
  `log-waypoint`, `journey`) — tested offline against an in-memory ledger and a fake mirror
  node (v3). That proves the scripts' logic, not Hedera. **Never executed against Hedera
  testnet.** Needs the operator key on the machine that runs them.
- **Solana scripts** (`mint-container`, `log-waypoint`) — syntax-checked only. Never
  executed against devnet.
- **`deploy.js` / `deploy-journey.js`** — run end to end on a local Hardhat node (v3); never
  run against Sepolia or the Hedera JSON-RPC relay (296).
- **The agents with a live model** — the deterministic paths are tested; neither agent has
  been run against Claude, so the prompt/output quality is unproven.
- **`hedera/src/journey.js` mirror-node read** — the sandbox blocks the mirror node host,
  so the HTTP path is untested. The replay logic it feeds is tested.

### Sample data, not real

`shared/sample-container.json` and `agent/demo_route.py` use the standard ISO 6346 worked
example (`CSQU3054383`), an illustrative IMO, an illustrative MTI of 4, and approximate
port centroids. **None of it is verified by GCN.** `shared/unlocode.js` is hand-typed demo
data and must be replaced with the official UNECE UN/LOCODE list.

### Findings from verification worth recording

The JS replay and the Python auditor were written to the same doctrine but drifted: the
Python side caught a vessel-AIS position recorded after discharge and the JS side did not.
The demo route has that defect planted in it, which is how it surfaced. `geo.js` now
carries the `ORPHAN_VESSEL_POSITION` check and a test for it. **Any future change to one
engine needs the same change in the other** — the cross-engine haversine test exists to
make that drift fail loudly.

Two more surfaced while building the interoperability layer:

- The EDIFACT parser rejected a container id in its own test fixture. `MSCU1234565` has a bad
  check digit; it should be `MSCU1234566`. The validator was right and the fixture was wrong.
- The on-chain size/type check initially tested length only, so `40HC` passed — it is also four
  characters. The rule was corrected to the real ISO 6346 structure: the 4th character must be
  a digit. **This was a live interoperability defect**: the sample data carried `40HC`, which
  no carrier system accepts. `ContainerToken.register` now rejects it.

---

## 4a. v3 Hedera changes (3 October 2026)

Defects fixed in the Hedera and deploy scripts, each covered by a test:

| Defect in v2 | Effect | Fix |
|---|---|---|
| `client.js` parsed keys with `fromStringDer` only | GCN's operator key is raw ECDSA hex; every Hedera script would have failed on first run | DER, raw hex (with or without `0x`), `HEDERA_KEY_TYPE` for raw keys; both env naming schemes |
| Hash chain linked to the last waypoint in local `state.json` | a lost, stale or second machine's `state.json` silently breaks the chain | previous link read from the mirror node; waits for a lagging mirror, refuses to chain past it |
| HTS mints duplicates of the same id | "one token per container" was not enforced on Hedera | mirror-node check before minting |
| Waypoints accepted for unminted containers | diverged from `ContainerJourney.sol` | refused, same rule as the contract |
| No message size guard | a message over 1,024 bytes would be chunked and skipped by the reader | refused at write time |
| `attest.js` accepted an empty evidence hash | an MTI score with no pointer to its source | requires a 64-hex SHA-256 |
| `deploy.js` matched mainnet names exactly, not by substring, and had no chainId check | `hederaMainnet`, or a mainnet RPC under a testnet name, would deploy | shared `guard.js`: name substrings + chainId allow-list (296, 11155111, 31337) |
| `deploy-journey.js -- --seed` | `hardhat run` does not forward script arguments, so the seed never ran | `SEED_JOURNEY=1`; token address read from `deployments/<network>.json` |

New files: `hedera/src/check.js` (preflight), `hedera/src/mirror.js` (shared read path),
`hedera/test/` (offline tests), `hedera/README.md` (runbook), `contracts/evm/scripts/guard.js`,
`contracts/evm/test/Guard.test.js`.

`docs/handoff.html` and the two PDFs still carry the v2 text and have not been regenerated.

## 5. File map

```
cargo-container-token/
├── shared/
│   ├── iso6346.js              check-digit validation (TESTED)
│   ├── geo.js                  haversine, bearings, journey replay, anomalies (TESTED)
│   ├── unlocode.js             demo port table — REPLACE with the official list
│   ├── identifiers.js          IMO, MMSI, ISO 6346 size/type, SCAC, SMDG (TESTED)
│   ├── test-geo.js             14 offline checks
│   ├── demo-journey.js         full sample report, no keys needed
│   └── sample-container.json   SAMPLE DATA
├── standards/
│   ├── dcsa.js                 DCSA Track & Trace 2.1, both directions (TESTED)
│   ├── edifact.js              CODECO / IFTSTA parser (TESTED, common subset)
│   ├── epcis.js                GS1 EPCIS 2.0 export (TESTED)
│   ├── ais.js                  provider-agnostic vessel AIS (TESTED)
│   └── test-standards.js       32 offline checks
├── contracts/evm/
│   ├── contracts/ContainerToken.sol    ERC-721 identity + MTI-gated transfer
│   ├── contracts/ContainerJourney.sol  append-only traceability ledger
│   ├── test/*.test.js                  21 tests (TESTED)
│   ├── scripts/guard.js                name + chainId testnet guard (296, 11155111, 31337)
│   ├── scripts/deploy.js               refuses mainnet names
│   ├── scripts/deploy-journey.js       --seed writes a sample route
│   └── hardhat.config.js               SOLC_JS_PATH offline-compile override
├── hedera/src/
│   ├── client.js               testnet only, no mainnet path exists; DER or raw ECDSA/ED25519 keys
│   ├── check.js                read-only preflight: key matches account, balance, token/topic keys
│   ├── mirror.js               shared mirror-node read path (chain link, duplicate check)
│   ├── create-collection.js    HTS NFT collection + HCS topic
│   ├── mint-container.js       metadata "ISO|hash16" (100-byte HTS cap)
│   ├── attest.js               vessel MTI attestation → HCS
│   ├── log-waypoint.js         one waypoint → HCS, hash-chained
│   └── journey.js              mirror-node read + full report (verification path)
├── hedera/test/                16 offline tests, in-memory ledger + fake mirror node
├── solana/src/
│   ├── mint-container.js       0-decimal supply-1 SPL, mint authority revoked
│   └── log-waypoint.js         Memo waypoint — NO on-chain validation
├── agent/
│   ├── container_agent.py      MTI vessel screening (Atomic Agents)
│   ├── journey_agent.py        journey audit + confidence grading
│   ├── demo_route.py           SAMPLE route with two planted defects
│   └── test_*.py               15 offline tests
└── skill/gcn-container-tokenization/   packaged skill, validator-clean
```

---

## 6. What `ContainerJourney.sol` actually enforces

Worth knowing precisely, because this is what distinguishes it from a database:

- **Append-only.** No edit function. No delete function. `appendCorrection` records that
  an earlier waypoint is wrong and leaves the original exactly where it is. A ledger whose
  history can be tidied up is not evidence of anything.
- **Chronological order** — each waypoint must postdate the last.
- **No future timestamps** (1-hour clock-skew grace).
- **Evidence hash required** — a waypoint with no source document is rejected outright.
- **Per-mode speed ceiling** — SEA 15.5 m/s (~30 kn), ROAD 35, RAIL 45, AIR 300, YARD 3.
  A leg no conveyance could cover in the elapsed time reverts. Per-mode because containers
  are multimodal: a 95 km leg in 30 minutes is impossible by sea and ordinary by rail, and
  the contract gets that right.
- **A geometric band on the claimed distance, without trig.** One degree of latitude is
  ~111,320 m everywhere; one of longitude is that at most. So `|dLat|` is a floor and
  `|dLat|+|dLon|` a ceiling on the true haversine value, with 1% slack. Catches a
  transposed sign or a mistyped coordinate on-chain. It is a sanity band, **not** a
  substitute for recomputing haversine off-chain.
- **Container-level observations counted separately**, so "did anything observe the box"
  is one call.
- **Token must exist** — the append reverts if `ownerOf(tokenId)` does.

Deliberately *not* enforced: haversine itself (no cheap on-chain trig), and anything about
whether the observer is telling the truth. The contract constrains arithmetic and order.
It cannot constrain honesty, and the tier system is the honest accounting of that.

---

## 7. How to run it

### Offline — no keys, no network, works anywhere

```bash
node shared/test-geo.js              # 14 geodesy / replay checks
node standards/test-standards.js     # 32 interoperability checks
node shared/demo-journey.js          # sample report, planted defects visible
cd agent && pip install atomic-agents anthropic instructor pytest && python -m pytest -q
```

### EVM tests

```bash
cd contracts/evm
npm install
npx hardhat test
```

If `binaries.soliditylang.org` is blocked (locked-down CI, sandboxes), compile from a
local solc-js build instead — this is how the suite was run in this session:

```bash
npm i solc@0.8.19
SOLC_JS_PATH=$(pwd)/node_modules/solc/soljson.js npx hardhat test
```

### EVM testnet deploy

```bash
export TESTNET_PRIVATE_KEY=0x...          # testnet key ONLY
npx hardhat run scripts/deploy.js --network sepolia
export CONTAINER_TOKEN_ADDRESS=0x...
SEED_JOURNEY=1 npx hardhat run scripts/deploy-journey.js --network sepolia   # or --network hederaTestnet
```

`deploy.js` refuses any network whose name contains mainnet, polygon, base, arbitrum,
optimism, bsc or avalanche.

### Hedera testnet

```bash
cd hedera && npm install && cp .env.example .env   # fill from portal.hedera.com
node src/check.js                                   # read-only preflight: key matches account, balance
node src/create-collection.js                       # writes state.json
node src/mint-container.js CSQU3054383
node src/log-waypoint.js --iso CSQU3054383 --event LOADED_VESSEL \
     --tier TIER2_CARRIER_EDI --port CNSHA --at 2026-03-02T14:00:00Z --evidence ./codeco.edi
node src/journey.js CSQU3054383                     # verification report
```

`journey.js` reads from the public mirror node, so anyone can run it against a topic id
with no credentials and get the same answer. That reproducibility is the only sense in
which the record is worth anything.

### Solana devnet

```bash
cd solana && npm install
node src/mint-container.js CSQU3054383
node src/log-waypoint.js --iso CSQU3054383 --event LOADED_VESSEL \
     --tier TIER2_CARRIER_EDI --port CNSHA --evidence ./doc.pdf
```

### Environment variables

| Variable | Used by | Note |
|---|---|---|
| `TESTNET_PRIVATE_KEY` | Hardhat | testnet only — never a mainnet key |
| `SEPOLIA_RPC_URL` | Hardhat | defaults to `rpc.sepolia.org` |
| `HEDERA_TESTNET_RPC` | Hardhat | defaults to `testnet.hashio.io/api` (chainId 296) |
| `HEDERA_TESTNET_ACCOUNT_ID`, `HEDERA_TESTNET_PRIVATE_KEY` | Hedera SDK | from portal.hedera.com |
| `HEDERA_MIRROR_URL` | `journey.js` | defaults to testnet mirror node |
| `SOLANA_DEVNET_KEYPAIR` | Solana | path to a devnet keypair JSON |
| `CONTAINER_TOKEN_ADDRESS` | `deploy-journey.js` | deployed `ContainerToken` |
| `ANTHROPIC_API_KEY` | agents | required for live runs; offline paths do not need it |
| `SOLC_JS_PATH` | Hardhat | optional offline-compile override |

---

## 8. Next steps, in priority order

1. **Run it on the three testnets.** Nothing on the Hedera or Solana side has executed.
   This is the gap between "compiles" and "works", and it is the first thing to close.
2. **Connect one live carrier feed.** The DCSA adapter is built and tested; nothing is
   connected. Pick a single carrier, obtain sandbox credentials, and validate the mapping
   field-by-field against their published API. Until this happens, "compatible" is a
   statement about code, not a working integration.
3. **Get real Pole Star MTI data.** The MTI is a commercial product; a real score needs a
   Pole Star account and API access. Every score in this codebase is illustrative. Until
   this is wired, the screening agent correctly refuses to grade a vessel and returns
   `needs_mti`.
4. **Decide the AIS provider.** FleetMon is gone. MarineTraffic/Kpler is the direct
   successor; Spire and ORBCOMM are the alternatives. The adapter makes this reversible.
5. **Add TIER1 telemetry for at least one lane.** This is the only tier that observes the
   container, and the one that makes the record meaningfully different from what a
   freight forwarder already has. One instrumented lane demonstrates more than a hundred
   AIS-derived ones.
6. **Split observer custody.** OBSERVER_ROLE is one admin key today. Per-carrier keys are
   what make an observer identity mean anything.
7. **Write the Anchor program** so the Solana path has the same invariants as the EVM one.
   Right now the two chains enforce very different things under the same name.
8. **Replace the port table** with the official UNECE UN/LOCODE list, recording the
   edition date.
9. **Audit before any mainnet consideration.** Non-negotiable. The MTI-gated transfer
   policy in particular is a lock on an asset and deserves adversarial review.
10. **Metaplex Token Metadata** on Solana, so the token displays in wallets.
11. **Decide the legal question:** does the token represent the *record* of a container or
    *title* to it? The code currently implements the record. Title is a legal
    construction, not a contract change, and conflating the two is how tokenization
    projects get into trouble.

---

## 9. Open questions for James

1. **Which chain is canonical?** Three ledgers with different enforcement will disagree
   eventually. The EVM contract is the only one with on-chain validation — is it the
   source of truth, with Hedera as the cheap audit log and Solana as notarisation? That
   reading is coherent; three equal peers is not.
2. **Who are the observers?** The tier system is only as good as the identities behind
   the keys. Which carriers, terminals or inspectors would actually hold OBSERVER_ROLE?
3. **Is there a lane with real telemetry available?** One instrumented route would move
   this from proof-of-concept to demonstrable.
4. **Does GCN have or want a Pole Star relationship?** The MTI integration is designed
   against the public product page. Nothing here implies a partnership, and nothing
   should until one exists in writing.

---

## 10. Constraints carried through the build

- Testnet/devnet only; mainnet paths deliberately absent. The Hedera client has no
  mainnet branch at all, and the EVM deploy script rejects mainnet network names.
- No invented MTI scores. No implied Pole Star partnership, endorsement or
  data-sharing agreement.
- No claim that a token proves physical existence, anywhere in the code, comments or
  output.
- Every distance figure carries its lower-bound caveat — including on-chain.
- Sample data labelled as sample data at the point of use.
- This module is not blended with any other GCN venture material.

---

**Source for all MTI statements:** Pole Star Maritime Transparency Index —
https://www.polestarglobal.com/maritime-transparency-index/ (vessel score 0–5;
dimensions Vessel, Voyage, Emissions\*, Border Security\*, Supply Chain\* (\*in
development); 200+ data sources). The MTI scores a **vessel**, not a container or a
cargo, which is why it is modelled here as a vessel attestation linked to a container
token rather than as a property of the container.

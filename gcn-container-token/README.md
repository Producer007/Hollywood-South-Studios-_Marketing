# GCN Cargo Container Token & Traceability

**TESTNET / DEVNET ONLY · PRE-AUDIT · PROOF-OF-CONCEPT · not deployed for live value.**

Container identity (ISO 6346) plus an append-only ledger of where a container has been
attested to be, with distance accounting and an explicit evidence tier on every position.

Two things this does not do, stated here so nobody has to find out later:

- **A token does not prove a container physically exists.** It proves an issuer committed
  to an id and a document hash.
- **A journey log does not prove movement.** It proves identified observers committed to
  positions in a fixed order and cannot now alter them. The evidence tier on each waypoint
  says what was actually observed — only `TIER1_CONTAINER_TELEMETRY` observed the box.

Distance is **attested great-circle distance**: a lower bound, never "distance travelled".

## Layout

| Path | What |
|---|---|
| `shared/` | ISO 6346, geodesy, journey replay, UN/LOCODE demo table |
| `contracts/evm/` | `ContainerToken` (identity, MTI-gated transfer) + `ContainerJourney` (traceability) |
| `hedera/` | HTS NFT + HCS journey topic, mirror-node verification report |
| `solana/` | supply-1 SPL token + Memo waypoints |
| `agent/` | Atomic Agents: MTI vessel screening, journey audit |
| `skill/` | packaged `gcn-container-tokenization` skill |
| `docs/` | Claude Code handoff (markdown + PDF) |

## Verify offline — no keys, no network

```bash
node shared/test-geo.js         # 14 geodesy / replay checks
node shared/demo-journey.js     # sample report with planted defects
cd agent && pip install atomic-agents anthropic instructor pytest && python -m pytest -q
cd contracts/evm && npm i && npm i solc@0.8.19 && \
  SOLC_JS_PATH=$(pwd)/node_modules/solc/soljson.js npx hardhat test   # 21 tests
cd hedera && npm i && npm test    # 16 Hedera script tests (in-memory ledger, no network)
```

The `SOLC_JS_PATH` override compiles from a local solc-js build, for environments where
`binaries.soliditylang.org` is blocked.

See `docs/CLAUDE-CODE-HANDOFF.md` for verification status, how to run on each testnet,
open questions and next steps.

MTI source: https://www.polestarglobal.com/maritime-transparency-index/

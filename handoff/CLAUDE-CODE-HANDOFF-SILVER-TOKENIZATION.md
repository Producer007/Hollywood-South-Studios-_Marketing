# Claude Code Handoff — GCN Silver Tokenization (pre-build)

| | |
|---|---|
| **Module** | Physical Silver Tokenization + Custody Traceability Ledger |
| **Platform** | GCN Exchange — addition to the existing exchange platform |
| **Precedent** | `cargo-container-token` (same repo pattern, same evidence-tier mechanism, different asset class) |
| **Status** | **Scoping complete. Zero code written. Zero chains touched. This is the handoff to start building, not a record of what was built.** |
| **Date** | 4 October 2026 |
| **Author** | Claude Code session, for James A. Holmes Jr. |

---

## 1. Read this first

This is not a build summary — there is nothing yet to summarize. It is the
handoff a build session should start from, written the way
`CLAUDE-CODE-HANDOFF.md` for the container module would have looked *before*
that module existed. The companion document,
`SILVER-TOKENIZATION-SCOPING.md`, is the design reasoning; this document is the
checklist for turning it into a repository. Read the scoping doc first — this
one assumes it.

Do not mark anything in section 4 as done until it is actually done. The
container module's own handoff doc is explicit about distinguishing "compiles"
from "works" and "adapter built" from "connected to a live feed" — hold this
module to the same discipline from the first commit, not retroactively.

---

## 2. The constraint this must be built around

Same constraint as the container module, restated so it can't be missed:
**a token does not prove physical silver exists in a vault.** Every piece of
this build — contract naming, function names, UI copy, this document itself —
should avoid implying otherwise. If a reviewer can read a function name and
come away thinking the chain verified a bar's existence, the name is wrong.

The mechanism that makes the honest version of this claim valuable is the
evidence tier on every custody event (TIER1 independent audit / TIER2 custodian
record / TIER3 exchange-list membership / TIER4 manual assertion — see scoping
doc section 2). This is the one piece of architecture that must not be
simplified away under build pressure. A custody ledger with no tier on each
event is a database with extra steps, not what this module is for.

---

## 3. Proposed file map (not yet created)

Modeled directly on `cargo-container-token/`, so a build session can work from
an established pattern rather than inventing structure:

```
silver-tokenization/
├── shared/
│   ├── bar-identity.js         refiner + serial validation (analogue of iso6346.js)
│   ├── custody.js              custody-event ordering, freshness/staleness calc
│   ├── lbma-refiners.js        Good Delivery refiner reference list — REPLACE
│   │                           the placeholder with the real published list before
│   │                           anything real, same caveat unlocode.js carries
│   ├── identifiers.js          refiner codes, exchange warehouse codes, assay-house ids
│   ├── test-identity.js        offline checks, no keys/network — build this alongside
│   │                           the identity module, not after
│   └── sample-bar.json         SAMPLE DATA, labeled as such everywhere it's used
├── standards/
│   ├── exchange-list.js        parses a published eligible/registered warehouse
│   │                           stock report — TIER3 only, same ORPHAN_VESSEL_POSITION-
│   │                           style guard against being read as a fresh observation
│   ├── custodian-record.js     one adapter per custodian relationship actually in hand —
│   │                           do not build a generic adapter before a second real
│   │                           custodian exists to validate it against (scoping doc §5)
│   └── epcis.js                GS1 EPCIS 2.0 export — can likely be adapted from the
│                                container module's version with minimal change
├── contracts/evm/
│   ├── contracts/SilverBarToken.sol      ERC-721 identity + custody-status transfer gate
│   ├── contracts/SilverCustodyLedger.sol append-only, on-chain chronology + evidence-hash
│   │                                      checks — same shape as ContainerJourney.sol
│   ├── test/*.test.js
│   ├── scripts/deploy.js                 refuse mainnet names, same guard as the
│   │                                      container module's deploy script
│   └── hardhat.config.js                 carry over the SOLC_JS_PATH offline-compile
│                                           override if solc binaries are unreachable
├── hedera/src/
│   ├── client.js                testnet only, no mainnet path — do not add one
│   ├── create-collection.js     HTS NFT collection + HCS topic for custody events
│   ├── mint-bar.js              metadata capped at 100 bytes on HTS — plan the encoding
│   │                             (refiner+serial hash, not full assay data) before writing it
│   ├── log-custody-event.js     one event → HCS, hash-chained
│   └── custody.js               mirror-node read + full report, reproducible with no
│                                 credentials — same role as journey.js
├── solana/src/
│   ├── mint-bar.js               0-decimal supply-1 SPL, mint authority revoked
│   └── log-custody-event.js      Memo record — no on-chain validation, state this
│                                   plainly in the file header the way the container
│                                   module's solana/ does
├── agent/
│   └── (scope after the ledger exists — do not build an audit/scoring agent against
│         data that doesn't exist yet; the container module's container_agent.py and
│         journey_agent.py are the pattern once there's something to audit)
└── skill/gcn-silver-tokenization/   package only once the module is real; a skill
                                       describing code that doesn't exist is worse than
                                       no skill
```

---

## 4. Build order — in priority order, nothing parallelized prematurely

1. **Identity + validation, offline, no keys.** `bar-identity.js` and its test
   file. This is the cheapest thing to get right and the costliest to get wrong
   later, exactly as ISO 6346 validation was for containers.
2. **Custody-event model + freshness calc, offline.** Decide the freshness
   window (how long a TIER1 audit stays "fresh" before a TIER3-only position is
   flagged) as a named, documented constant — not a magic number buried in a
   comparison.
3. **EVM contracts.** `SilverBarToken.sol` then `SilverCustodyLedger.sol`,
   tested against a local/offline solc build if `binaries.soliditylang.org` is
   unreachable (reuse the container module's `SOLC_JS_PATH` pattern verbatim).
4. **Standards adapters — only for the custodian relationship actually in
   hand** (scoping doc §5 and §7.1). Do not build `custodian-record.js` as a
   generic abstraction speculatively; build it against one real format and
   generalize only once a second real format exists to generalize from.
5. **Hedera and Solana paths**, mirrored from the EVM logic. Run them against
   the actual testnets before calling this step done — the container module's
   own handoff flags "nothing on Hedera or Solana has executed" as its #1 open
   item; do not repeat that gap here if it can be avoided.
6. **Offline verification suite** (`test-identity.js`,
   `standards/test-standards.js` equivalent) before any contract or chain work
   is called complete. Report real numbers — do not state a test count that
   wasn't actually run.

---

## 5. Rules carried over from the container module, unchanged

- **Mainnet paths deliberately absent.** No mainnet branch in the Hedera
  client, no mainnet network name accepted by the deploy script.
- **No invented data.** No synthetic assay results, serial numbers, or
  custodian statements presented as real anywhere in code, comments, sample
  data, or output. Sample data labeled as sample data at the point of use.
- **No claim that a token proves physical existence** — see section 2 — in
  code, comments, documentation, or any generated output.
- **Every staleness/freshness figure carries its own caveat**, including
  on-chain, the same way `distanceCaveat()` travels with every distance figure
  in the container module.
- **No implied partnership** with any named exchange, custodian, refiner, or
  industry body (LBMA, COMEX, or any specific vault operator) unless one exists
  in writing.
- **This module is not blended with any other GCN venture material** —
  Hollywood South, PROVENANCE, UBUNTU stay out of anything produced here, and
  this module stays out of anything produced for them.
- Avoid: leverage, synergy, game-changing, disruptive, revolutionary.

---

## 6. Open questions for James

Same list as the scoping document's section 8, restated here because this is
the document a build session is most likely to open first:

1. Allocated/serialized bars first (recommended), or pooled/fungible first?
2. Is there a custodian relationship already in motion to scope the first
   adapter against, or is this fully greenfield?
3. Positioned as a second instance of the same "evidence tier" pattern as the
   container module (shared narrative), or kept visibly separate?
4. Record versus title — legal answer before or after the first build pass?

---

## Status and disclosure

No code has been written for this module. No chain has been touched. Nothing
in this document describes a built or tested capability — it describes a plan.
Any future version of this document that reports test counts, deployment
status, or adapter coverage should replace this one rather than append to it,
the same way the container module's handoff is versioned (v2 superseding v1)
rather than layered. GCN Exchange is an institutional real-world asset
tokenization and settlement platform; this module, once built, would operate on
testnet/devnet only, pre-audit, not deployed for live value — consistent with
every other GCN Exchange module.

**Contact:** Jamesholmes.GlobalConcessionsNetwork@protonmail.com

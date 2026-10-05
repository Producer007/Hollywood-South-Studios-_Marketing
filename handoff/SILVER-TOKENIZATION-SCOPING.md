GLOBAL CONCESSIONS NETWORK

# Silver Tokenization — Scoping Document

| | |
|---|---|
| **Module** | Physical Silver Tokenization + Custody Traceability Ledger |
| **Platform** | GCN Exchange — addition to the existing exchange platform |
| **Precedent** | Builds on the design pattern proven in the Cargo Container Tokenization module |
| **Status** | **Scoping only. No contracts, scripts or tests exist yet. Nothing has been written to any chain.** |
| **Date** | 4 October 2026 |
| **Author** | Claude Code session, for James A. Holmes Jr. |

---

## 1. What this scopes

A token identity and append-only custody ledger for physical silver — bars or
coin lots held at a vault — on the same three-chain stack GCN already uses
(Hedera testnet, Solana devnet, EVM testnet). This document defines *what* the
module should do and *how it should be allowed to speak about itself*, before any
code is written. It does not propose a build timeline or a headcount; it proposes
an architecture and a set of constraints the build must satisfy.

It answers three questions, the same shape as the container module:

| Question | How it would be answered |
|---|---|
| Which silver lot is this? | A serialized-bar identity (refiner mark + serial number + fineness + weight), one token per lot |
| Where is custody right now? | An append-only ledger of custody events — vaulted, transferred, audited, withdrawn |
| How confident should anyone be in that? | An evidence tier on every custody event — the part that matters |

---

## 2. The honest claim, carried over unchanged

The container module was built around one constraint: *a token does not prove a
physical container exists.* The same constraint applies here with equal force,
and for the same reason.

**A token does not prove physical silver exists in a vault.** A blockchain cannot
weigh a bar, assay its fineness, or confirm it hasn't been swapped for a
tungsten-filled fake — a known fraud pattern in physical bullion markets. No
contract, key or consensus mechanism changes that. What can be built is a record
whose weaknesses are legible instead of hidden. That is the entire value
proposition, and it is a direct transplant of the container module's evidence-tier
mechanism:

| Tier | What it actually observed | Precedent |
|---|---|---|
| **TIER 1 — Independent physical audit** | **The bar itself** — an independent auditor (e.g. an inspection firm under contract to the vault, not the vault operator) physically weighs, assays and matches the serial number against the vault inventory | Same role as container telemetry: the only tier that touches the asset |
| **TIER 2 — Custodian system of record** | A custody event in the vault operator's own system — intake, internal transfer, allocation/deallocation — attested by the custodian, not an independent party | Same role as carrier/terminal EDI: a real event, in someone else's system of record |
| **TIER 3 — Exchange-approved list membership** | The bar's serial number appears on a published registered/eligible list (e.g. an exchange-approved warehouse stock report) | Same role as vessel AIS: tells you the bar is *eligible to be there*, not that anyone looked at it today |
| **TIER 4 — Manual assertion** | Nothing — a person asserted the bar is in custody, no supporting document | Weakest tier, needs a document hash to be accepted at all |

TIER 3 is the tier most likely to be mistaken for stronger evidence than it is,
exactly as TIER 3 vessel AIS was for containers. A serial number sitting on an
exchange's eligible-list report tells you the bar was registered at some point and
remains on the list — it does not tell you anyone verified it is physically
present today. The module should enforce this the same way `ContainerJourney.sol`
enforces `ORPHAN_VESSEL_POSITION`: a TIER 3 position with no TIER 1 or TIER 2
event in a defined freshness window should be flagged, not presented at face
value. A single call — the equivalent of `hasContainerLevelEvidence()` — should
answer "has an independent party ever actually looked at this specific bar," and
an interface built on this should surface that prominently, not bury it.

**Numbers are sacred here too.** No synthetic assay results, no invented serial
numbers presented as real, no weight or fineness figure without a stated source.
Any sample data used for testing must be labeled as sample data at the point of
use, exactly as the container module's `sample-container.json` is.

---

## 3. Identity model — the design decision this needs before anything else

Unlike the container module, where ISO 6346 gave a single obvious identity
standard, silver has two live conventions and the module has to pick one or
support both explicitly rather than quietly conflating them:

| Model | What one token represents | Fits |
|---|---|---|
| **Allocated / serialized** | One specific bar: refiner + serial number + fineness + gross/fine weight, under an LBMA Good Delivery-style spec | Traceability, chain-of-custody claims, provenance — the thing this module is actually differentiated on |
| **Unallocated / pooled (fungible)** | A fractional claim on an undifferentiated pool of metal held by a custodian — no serial number attached to the token | Trading liquidity, fractional ownership, exchange-style settlement |

**Recommendation: build the allocated/serialized model first.** It is the only
one of the two where an evidence-tier ledger means anything — a fungible pool
token has no single bar to attest custody of, so the traceability mechanism this
module exists to provide would have nothing to attach to. A pooled/fungible
wrapper can be layered on top of a basket of allocated tokens later (an index or
basket contract referencing N serialized bars), the same way a fund share can sit
on top of allocated holdings — but that is a second phase, not this one, and it
should not be built until the allocated layer has real custody data behind it.

**Identity fields, proposed:**

- Refiner / brand mark (e.g. a named LBMA Good Delivery refiner)
- Serial number as stamped on the bar
- Declared fineness (e.g. 999.0)
- Declared weight, with unit (troy ounces are the market convention; grams for
  metric bars)
- Assay certificate hash (document hash, same pattern as the container module's
  evidence hash — no certificate hash, no mint)

This is a direct analogue of ISO 6346 check-digit validation: before any mint,
validate that the serial/refiner combination is well-formed and, where a public
registered-bar list exists, cross-check against it. Do not invent a validator;
scope which public list(s) are realistically reachable before promising this.

---

## 4. Chain architecture — reuse, don't reinvent

The container module's three-chain split should carry over directly, because the
underlying reasoning (what each chain is good at) does not change with the asset
class:

| | EVM (`contracts/evm`) | Hedera | Solana |
|---|---|---|---|
| Identity | ERC-721, one token per `keccak256(refiner+serial)` | HTS NonFungibleUnique | SPL 0-decimal, supply 1 |
| Custody ledger | Append-only contract, on-chain validation of chronology and evidence-hash presence | HCS topic, network-ordered, hash-chained | Memo records, no on-chain validation |
| Transfer gating | Custody-status policy in `_beforeTokenTransfer` (e.g. block transfer while a TIER 1 audit is "overdue" past a defined window) | key-controlled (pause/wipe) | none on-chain |

Same stack, same versions, for consistency with the rest of GCN: solc 0.8.19,
OpenZeppelin 4.9.6, Sepolia + Hedera JSON-RPC relay (296) for EVM testnet, Hedera
testnet, Solana devnet. **No mainnet path, at any point, until an audit exists.**

What changes from the container design: there is no "distance" metric for a
vaulted bar that doesn't move routinely, so `cumulativeMeters` has no analogue.
The thing worth tracking instead is **custody freshness** — elapsed time since
the last TIER 1 event — because that is the figure that actually decays in
value over time, the way a container's position does. A contract-level
`daysSinceLastIndependentAudit()` (or equivalent) is the module's version of
`distanceCaveat()`: a number that must carry its own limitation on-chain so no
interface can quote confidence without the staleness attached to it.

---

## 5. Standards layer — what to speak, not what to invent

The container module's interoperability layer worked because it spoke formats
the industry already publishes rather than asking counterparties to adopt GCN's
own schema. The same approach applies here, though the precious-metals standards
landscape is less unified than container shipping's DCSA/EDIFACT split:

| Standard / source | Direction | Note |
|---|---|---|
| LBMA Good Delivery List | reference | Published list of accredited refiners; use to validate refiner marks, not to assert a specific bar's custody |
| LBMA Responsible Sourcing / Chain of Custody guidance | reference | Governs refiner-level sourcing claims; does not itself track individual bar custody post-refining |
| Exchange-approved warehouse stock reports (e.g. a major exchange's published registered/eligible inventory) | inbound | Confirms list membership (TIER 3) — gated the same way vessel AIS was: eligibility, not a fresh observation |
| Vault custodian statements / intake-transfer records | inbound | TIER 2 — a real event, format varies by custodian, no cross-custodian standard comparable to DCSA exists today |
| GS1 EPCIS 2.0 | outbound | Same cross-industry visibility export used by the container module — a custody event can land in a buyer's or auditor's own traceability stack without them needing to know anything about GCN |

**This is the open item that most needs a decision before build starts:** unlike
DCSA, which gave the container module ten carriers through one integration,
there is no equivalent single integration point across vault custodians. Each
custodian relationship is likely its own adapter. Scope the first one or two
realistic custodian relationships before committing to a generic adapter
architecture — building for an abstraction with no second implementation to
validate against is how the container module would have gone wrong if DCSA
hadn't existed.

---

## 6. What this is not, stated plainly

- **Not a claim of title.** Exactly as with the container module: the record
  this would implement is a custody *record*, not legal *title* to the metal.
  Conflating the two is a legal question for counsel, not an engineering
  decision, and the contract should not be designed in a way that implies title
  by default.
- **Not a price feed.** This module scopes custody and identity, not a spot-price
  oracle. If GCN wants on-chain pricing for a silver-backed instrument later,
  that is a separate, explicit scoping exercise with its own oracle-risk
  discussion — do not fold it into this one by default.
- **Not a fraud-detection system.** Tungsten-filled fake bars and other
  substitution fraud are real, documented risks in physical bullion markets.
  TIER 1 audits reduce exposure to this; nothing in a smart contract detects it.
  Say this to any counterparty who asks, rather than letting the token's
  existence imply otherwise.
- **Not yet started.** No contracts, no scripts, no tests, no chain deployments.
  This document is the scoping step the container module's own `AMO-BRIEFING.md`
  and `CLAUDE-CODE-HANDOFF.md` represent after the build — this one comes before.

---

## 7. What's needed to move forward

1. **Pick the first custodian relationship.** One realistic vault/custodian
   willing to describe (not necessarily yet grant API access to) their intake,
   transfer and audit record formats turns this from an abstract adapter into a
   scoped one. This is a commercial conversation, not an engineering one — the
   same shape as the container module's carrier-relationship requirement.
2. **Confirm the identity convention.** Will the first lot(s) be LBMA Good
   Delivery bars specifically, or a different standard (COMEX-registered,
   regional)? The validator can't be designed generically without this.
3. **Decide the canonical chain**, the same open question the container module
   left unresolved: if EVM, Hedera and Solana ever disagree, which one is the
   source of truth? Recommend carrying forward the container module's working
   answer — EVM as canonical (only chain with on-chain validation), Hedera as
   audit log, Solana as notarization — unless there's a reason specific to this
   asset class to diverge.
4. **Decide who holds TIER 1 authority.** An independent auditor's identity
   needs to be established and keyed before any audit event means anything. This
   is the direct analogue of the container module's open "who are the
   observers" question, and it matters more here: a TIER 1 audit that's actually
   performed by the vault operator itself (not independent of them) quietly
   degrades to TIER 2 no matter what it's labeled.
5. **Audit scope and timing**, before any discussion of production use — stated
   once, up front, so it isn't re-litigated later.

---

## 8. Open questions for James

1. Allocated/serialized bars, or does GCN actually want unallocated/pooled
   exposure as the first product? Section 3 recommends allocated first; this is
   a product decision, not just a technical one.
2. Is there a custodian relationship already in motion that this should be
   scoped against specifically, or is this fully greenfield?
3. Does GCN want this positioned alongside the container module as a second
   instance of the same traceability pattern (shared marketing narrative:
   "evidence tiers" as a GCN house concept across asset classes), or kept
   separate so a reader doesn't assume the two share infrastructure they don't?
4. Record versus title, same question the container module raised and left
   open — does this get a legal answer before or after the first build pass?

---

## Status and disclosure

This is a scoping document for a module that does not yet exist in any form —
no contracts, scripts, tests or chain deployments. Nothing in this document
should be presented externally as a built capability. GCN Exchange is an
institutional real-world asset tokenization and settlement platform; any silver
tokenization module built from this scope would operate on testnet/devnet only
until audited, consistent with every other GCN Exchange module. GCN holds no
partnership, endorsement or data-sharing agreement with any named exchange,
custodian, refiner or industry body referenced above; any such relationship
would need to exist in writing before being represented as one.

**Contact:** Jamesholmes.GlobalConcessionsNetwork@protonmail.com

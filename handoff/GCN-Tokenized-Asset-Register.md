# GCN Exchange — Tokenized Asset Register

**Draft 5 October 2026 · Pre-audit · Hedera testnet only · Proof-of-concept · Not for live value.**

This register replaces the asset lists in three uploaded documents that disagree with each other and with the deployed contracts. It states what exists on testnet, what the documents claim, and what is still open. Nothing here is a statement that any asset is live, issued, audited, or backed.

## 1. How to read the status columns

| Column | Meaning |
|---|---|
| Token / Registry ID | Hedera testnet contract IDs, copied from the 47-entry deployment list embedded in `handoff/TestnetContracts.jsx` (read from `deployments/296.json` on 30 Sep 2026). **Not re-checked on the mirror node for this register.** The sandbox cannot reach it. The page re-checks every row on load. |
| Test-minted | A test mint is recorded in the deployment list. A test mint is not an issuance and is not backed by a physical asset. |
| Source in repo | Solidity source for the registry and token is in the platform repository. "No" means the contract is deployed and the source is not yet confirmed there. |

## 2. Deployed testnet token contracts (23)

| Asset | On-chain symbol | Token ID | Registry ID | Test-minted | Source in repo | Named in uploaded documents |
|---|---|---|---|---|---|---|
| SyntheticGas | `GCN-SYNGAS` | 0.0.8285497 | 0.0.8285496 | Yes | Yes | Platform Instructions: "live" (GCN-SYNGAS) |
| JetA1 | `GCN-JETA1` | 0.0.8285500 | 0.0.8285499 | Yes | No | Platform Instructions: "live" (GCN-JETA1) |
| Hydrogen | `GCN-H2` | 0.0.8285502 | 0.0.8285501 | Yes | No | Platform Instructions: "live" (GCN-H2) |
| Titanium | `GCN-TI` | 0.0.8285505 | 0.0.8285504 | Yes | No | Platform Instructions: "live" (GCN-TI) |
| Lithium | `GCN-LI` | 0.0.8285508 | 0.0.8285507 | No | Yes | Platform Instructions (GCN-LI); Best Practices "Active" as LI-GCN |
| Cobalt | `GCN-CO` | 0.0.8285510 | 0.0.8285509 | No | Yes | Platform Instructions (GCN-CO); Best Practices "Active" as CO-GCN |
| Copper | `GCN-CU` | 0.0.8285513 | 0.0.8285511 | No | Yes | Platform Instructions (GCN-CU); Best Practices "Active" as CU-GCN |
| Silver | `GCN-AG` | 0.0.8285518 | 0.0.8285514 | No | Yes | Not named |
| Gold | `GCN-AU` | 0.0.8285522 | 0.0.8285520 | No | Yes | Platform Instructions as GOLD-DORE; Best Practices "Active" as AU-GCN |
| Platinum | `GCN-PT` | 0.0.8285528 | 0.0.8285526 | No | Yes | Not named |
| REE | `GCN-REE` | 0.0.8285906 | 0.0.8285905 | Yes | Yes | Best Practices "Active" as REE-GCN |
| CobaltSulphate | `GCN-COSO4` | 0.0.8285910 | 0.0.8285909 | Yes | Yes | Not named |
| Manganese | `GCN-MN` | 0.0.8285913 | 0.0.8285912 | Yes | Yes | Not named |
| Chromium | `GCN-CR` | 0.0.8285917 | 0.0.8285915 | Yes | Yes | Not named |
| Nickel | `GCN-NI` | 0.0.8286198 | 0.0.8286190 | No | Yes | Platform Instructions (GCN-NI); Best Practices "Active" as NI-GCN |
| Vanadium | `GCN-V` | 0.0.8286208 | 0.0.8286204 | No | Yes | Platform Instructions as GCN-VA |
| LNG | `GCN-LNG` | 0.0.8286221 | 0.0.8286216 | No | Yes | Not named |
| Phosphate | `GCN-PO4` | 0.0.8286223 | 0.0.8286222 | No | Yes | Not named |
| NickelSulphate | `GCN-NISO4` | 0.0.8286365 | 0.0.8286363 | No | Yes | Not named |
| Graphite | `GCN-GR` | 0.0.8286370 | 0.0.8286368 | No | Yes | Platform Instructions (GCN-GR) |
| CobaltHydroxide | `GCN-COOH` | 0.0.8286373 | 0.0.8286371 | No | Yes | Not named |
| CarbonCredit | `GCN-CC` | 0.0.8286377 | 0.0.8286375 | No | Yes | Not named |
| WaterCredit | `GCN-H2O` | 0.0.8286382 | 0.0.8286379 | No | Yes | Not named |

Plus `GCNKYCRegistry` 0.0.8285495 and `AtomicSwapV2_Hedera` 0.0.10722355, which brings the deployed total to 48 contracts. AtomicSwapV2 is pre-audit and is not deployed for live value.

## 3. Official instruments (Platform Page Copy v2, 24 Sep 2026)

None has been issued. Tickers are working names. All five are gated, and the HiveMind `MINT` step returns `GATED` for each.

| Working ticker | Instrument | Status | Gate before issuance |
|---|---|---|---|
| JETA | Jet fuel procurement | Gated | SPE-PRMS certification by an Independent Petroleum Engineer |
| GOLD | GCN-GOLD (gold doré) | Pre-Classification | Written legal opinion on classification (fiat-referenced or commodity-backed); custodian not appointed |
| BROWN | Copper, Berbera (GCN-DEAL-2026-009) | Gated | Qualified Person / technical-report status confirmed in writing |
| NET8 | African solar energy credits | Gated | Named solar asset; carbon registry (Verra or Gold Standard); protocol partner confirmed |
| OIL | Oil settlement layer (Pecan Energies, AFC-operated) | Gated | AFC's written confirmation of GCN's settlement role |

Pecan Energies is under evaluation. It is not a confirmed platform asset.

## 4. Assets named in the documents with no deployed contract

| Named asset | Document symbol | Where named | Status |
|---|---|---|---|
| Gallium | GCN-GA | Platform Instructions | No contract in the deployment list. Not deployed. |
| Germanium | GCN-GE | Platform Instructions | No contract in the deployment list. Not deployed. |
| Tungsten | GCN-W | Platform Instructions | No contract in the deployment list. Not deployed. |

## 5. Deployed contracts that no uploaded document mentions

Silver (GCN-AG), Platinum (GCN-PT), LNG (GCN-LNG), Phosphate (GCN-PO4), Nickel Sulphate (GCN-NISO4), Cobalt Sulphate (GCN-COSO4), Cobalt Hydroxide (GCN-COOH), Manganese (GCN-MN), Chromium (GCN-CR), Carbon Credit (GCN-CC), Water Credit (GCN-H2O).

## 6. Conflicts to resolve before any of this is published

| # | Conflict | What I did | Decision needed |
|---|---|---|---|
| 1 | **Symbols.** Documents use `GOLD-DORE`, `AU-GCN`, `LI-GCN`, `GCN-VA`; the deployed contracts use `GCN-AU`, `GCN-LI`, `GCN-V`. | Used the on-chain symbols. | Confirm on-chain symbols are canonical. |
| 2 | **Register mapping.** Nothing links the five official instruments to the 23 test contracts (for example JETA to GCN-JETA1, GOLD to GCN-AU, BROWN to GCN-CU). | Left unlinked. | Confirm which test contracts correspond to which instrument, if any. |
| 3 | **"Live" claims.** Platform Instructions says the platform is live, four verticals are deployed "as of March 2025", and copper and gold supply chains are live. The KYC registry on testnet was deployed on 19 Mar 2026, and no instrument has been issued. | Not repeated. Test status only. | Correct or substantiate the documents. |
| 4 | **Headline value figures.** Platform Instructions states an ecosystem value and an addressable-market size with no stated basis. | Not repeated. | Supply a source and a stated basis, or drop them. |
| 5 | **Patent and named-person text.** Platform Instructions contains a patent reference and a named-person role. | Removed, per `CLAUDE.md`. Not restated. | None. The documents should be cleaned too. |
| 6 | **Academic names.** Platform Instructions attributes platform design decisions to named faculty and describes a named practitioner's programme completion. | Not repeated. | Cite published research factually, or remove. No written agreement is on file. |
| 7 | **Prices and status in Best Practices.** The guide lists six minerals as "Active" with price ranges that are garbled in the PDF. | Not repeated. | Re-source the prices with a date and a basis. |

## 7. Agent roster alignment

The Complete Agent Roster and the Super Agent Best Practices guide number the agents differently.

| ID | Roster (Complete Agent Roster) | Best Practices guide |
|---|---|---|
| 01 | Consensus | Blockchain |
| 02 | Tokenization | Compliance |
| 03 | Supply Chain | Tokenization |
| 04 | Compliance | Supply Chain |
| 05 | Energy | IoT Manager |

The roster matches the built HiveMind code (Supervisor, Consensus, Supply-Chain, Compliance, Tokenization, Energy). I treated the roster as canonical. Tier 2 agents 06 to 14 are described in the roster but are not built. The Best Practices guide's operating figures (1,200+ sensors, 99.97% uptime target, resource tiers) are unverified specifications, not measured results.

## 8. Next steps

1. Decide the conflicts in section 6, starting with 1 and 2.
2. Run the page against the mirror node on a machine that can reach it, and check every ID above.
3. Update `handoff/TestnetContracts.jsx` and the platform page copy once the symbols and register mapping are settled.

*Pre-audit · Hedera testnet · Proof-of-concept.*

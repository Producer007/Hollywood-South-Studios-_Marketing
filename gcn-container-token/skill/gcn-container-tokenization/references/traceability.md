# Traceability design notes

## The question behind the design
"A token does not prove a physical container exists" is true and cannot be engineered
away. A chain cannot see a steel box. What *can* be built is a record whose weaknesses are
legible instead of hidden - so a reader can tell the difference between a container that
was physically tracked and one whose position was inferred from a ship's transponder.

That is what the evidence tier does. Flattening the tiers into a single "verified" flag
would make the record look stronger and be worth less.

## Waypoint shape
| Field | Note |
|---|---|
| `at` | observation time, unix seconds (uint40 on-chain) |
| `lat/lon` | WGS-84, stored as int32 scaled by 1e5 (~1.1 m resolution) |
| `eventType` | GATE_OUT, LOADED_VESSEL, VESSEL_POSITION, TRANSSHIPPED, DISCHARGED, GATE_IN, CUSTOMS_HOLD, DELIVERED |
| `mode` | SEA, ROAD, RAIL, AIR, YARD - sets the speed ceiling; containers are multimodal |
| `tier` | evidence tier (see SKILL.md) |
| `unlocode` | bytes5 UN/LOCODE when at a port, else zero |
| `segmentMeters` | great-circle metres from the previous waypoint |
| `evidenceHash` | hash of the AIS extract, EDI message or document behind the claim |
| `observer` | msg.sender at the time of the append |

## Distance accounting
`cumulativeMeters` is the running sum of `segmentMeters`. Two independent implementations
compute the hops - `shared/geo.js` (JS) and `journey_agent.py` (Python) - and a test
asserts they agree to under one metre on three known pairs. They have to: the on-chain
geometric band and the off-chain recomputation must not drift apart, or the verification
path starts disagreeing with the ledger.

Why a lower bound, concretely: Shanghai to Rotterdam is ~10,500 nm by great circle and
~11,800 nm by the actual Suez routing. Reporting the arc as "distance travelled"
understates it by over a thousand miles, and understating is still lying.

## Anomalies both engines detect
`IMPLAUSIBLE_SPEED`, `COVERAGE_GAP` (>14 days default), `NON_MONOTONIC_TIME`,
`DUPLICATE_WAYPOINT`, `BAD_COORDINATE`, `NO_EVIDENCE_HASH`, `UNKNOWN_EVENT_TYPE`,
`UNKNOWN_EVIDENCE_TIER`, `ORPHAN_VESSEL_POSITION`.

A gap is reported as a gap, never interpolated. The straight line between two attested
positions is not where the container was; it is where nobody looked.

## Known gaps, in priority order
1. **No Solana on-chain validation.** The Memo path accepts whatever a client writes. An
   Anchor program carrying the same invariants as `ContainerJourney.sol` closes this.
2. **No real data source wired.** AIS, carrier EDI and the Pole Star MTI API are all
   manual inputs today. Until an ingester exists with its own credentials, every waypoint
   is as good as the human running the script.
3. **Observer custody.** OBSERVER_ROLE is a single admin key in the demo. Real use needs
   per-carrier keys so an observer identity means something.
4. **Approximate port centroids.** `shared/unlocode.js` is hand-typed demo data.
5. **Metaplex metadata** absent on Solana, so the token does not display in wallets.
6. **No audit.** Nothing here has been reviewed by anyone but its author.
7. **Legal title** is not linked to the token. Tokenizing the record of a container is not
   the same as tokenizing ownership of it.

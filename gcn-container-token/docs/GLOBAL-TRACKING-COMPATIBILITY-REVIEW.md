# Global Tracking Compatibility Review — GCN Cargo Container Token

| | |
|---|---|
| **Scope** | Can the GCN container token integrate with global container tracking systems and the largest ocean carriers? |
| **Verdict** | **Now yes at the data layer. No at the operational layer** — the formats are built and tested; no live feed is connected. |
| **Status** | Testnet / devnet only · pre-audit · proof-of-concept · not deployed for live value |
| **Date** | 2 October 2026 |
| **Prepared for** | James A. Holmes Jr. |

---

## 1. Headline findings

**Three things were missing that would have blocked carrier integration outright. All three
are now built and tested.**

1. **No carrier-standard event format.** The ledger spoke only its own schema. The world's
   largest carriers publish **DCSA Track & Trace**; terminals send **UN/EDIFACT CODECO** and
   carriers send **IFTSTA**. Without these, integration meant a bespoke adapter per partner.
2. **No cross-industry visibility format.** Shippers, retailers and customs systems consume
   **GS1 EPCIS 2.0**, not shipping-specific formats. Walmart and others mandate EPCIS 2.0
   from suppliers.
3. **Unvalidated industry identifiers.** IMO numbers were checked for length only (they have
   a check digit), MMSI was not validated at all, and the size/type field held yard shorthand
   that carrier systems reject.

**One finding changes a stated plan:**

> **FleetMon's API is retired.** FleetMon and MarineTraffic were both acquired by Kpler in
> February 2023, and **FleetMon was phased out from January 2024** as the two merged. The
> developer portal and `apiv2.fleetmon.com` are gone. Building the AIS integration on
> FleetMon means building on something that is no longer there.
>
> The adapter was therefore written **provider-agnostic**: a normalised position shape with
> per-provider mappings. MarineTraffic/Kpler is the live path, `generic` takes a raw AIS feed
> or any other vendor, and the FleetMon profile is retained only for archived exports and
> legacy contracts. Switching provider is one argument, not a rewrite. The AIS vendor
> decision is now reversible, which given the consolidation in this market is worth more
> than any single integration.

---

## 2. What was built in response

| Component | What it does | Tests |
|---|---|---|
| `shared/identifiers.js` | IMO check digit (ISO 8713), MMSI + MID with station-type detection, ISO 6346 size/type codes, SCAC, SMDG/BIC facility codes, DCSA document references | 4 |
| `standards/dcsa.js` | DCSA Track & Trace 2.1 events ↔ GCN waypoints, **both directions** | 9 |
| `standards/edifact.js` | CODECO and IFTSTA parser → GCN waypoints, with UNA service-character support | 6 |
| `standards/epcis.js` | GCN journey → GS1 EPCIS 2.0 JSON-LD with CBV business steps and GIAI identifiers | 4 |
| `standards/ais.js` | Provider-agnostic AIS adapter (MarineTraffic / generic / FleetMon-legacy) with voyage-window enforcement and track thinning | 9 |

**32 interoperability checks passing**, on top of the 19 EVM, 14 geodesy and 15 agent tests
already in the module. **80 automated checks in total, all passing.**

---

## 3. Three refusals built into the adapters

These are the design decisions that matter most, and each one is enforced in code and
covered by a test. They all cut the same way: the ledger would look better without them, and
be worth less.

### 3.1 Forecasts never become attested positions

Most of the event volume on a carrier feed is **EST** (estimated) or **PLN** (planned), not
**ACT** (actual). Both the DCSA adapter and the EDIFACT parser accept only actuals and
return the rest as visible rejections.

An ETA written into an append-only ledger becomes indistinguishable from an observation the
moment it is stored. Carriers revise ETAs constantly; the ledger would fill with positions
the container never occupied, and nothing downstream could tell which was which.

### 3.2 A ship's position is not a container's position

The AIS adapter derives **voyage windows** from the container's own `LOADED_VESSEL` →
`DISCHARGED` events, and emits a container waypoint only for AIS positions that fall inside
one, on the matching IMO. Everything else is rejected with: *"This is the ship's position,
not the container's."*

This is the single most common way container tracking misleads people. A vessel's
transponder keeps reporting after the box is on a truck, and a naive integration keeps
attributing that track to the container. With no `LOADED_VESSEL` event at all, the adapter
refuses every position for that container.

### 3.3 A UN/LOCODE is a port, not a fix

DCSA and EDIFACT events carry a location code, not coordinates. The resolved position is a
**port centroid, accurate to kilometres**. Every waypoint from those adapters carries
`positionBasis` saying so, so it is never presented as a GPS fix.

---

## 4. Compatibility matrix

| Standard / system | Status | Note |
|---|---|---|
| **ISO 6346** container identity | ✅ Built & tested | Check digit validated; one token per id |
| **ISO 6346 size/type codes** | ✅ Built & tested | Now enforced **on-chain**; yard shorthand rejected |
| **IMO ship number** (ISO 8713) | ✅ Built & tested | Check digit validated |
| **MMSI** (ITU-R M.1371) | ✅ Built & tested | MID range + non-ship-station detection |
| **DCSA Track & Trace 2.1** | ✅ Built & tested | Bidirectional; ACT-only |
| **UN/EDIFACT CODECO** | ⚠️ Common subset | Per-partner MIG validation required |
| **UN/EDIFACT IFTSTA** | ⚠️ Common subset | Same caveat |
| **GS1 EPCIS 2.0** | ✅ Built & tested | JSON-LD, CBV steps, GIAI, sensor elements |
| **UN/LOCODE** | ⚠️ Demo table | ~22 hand-typed centroids; needs the official UNECE list |
| **SMDG facility codes** | ⚠️ Shape only | Codes are partner-assigned |
| **SCAC** | ⚠️ Convenience table | 14 major carriers; verify against NMFTA |
| **AIS providers** | ✅ Built & tested | MarineTraffic/Kpler, generic, FleetMon-legacy |
| **AIS — live feed** | ❌ Not connected | No credentials, never run against a live API |
| **Container IoT telemetry** | ❌ Not built | Traxens, Nexxiot, ORBCOMM, Globe Tracker — the only TIER1 source |
| **UN/EDIFACT BAPLIE** | ❌ Not built | Stowage plan; needed only for on-vessel position |
| **WCO Data Model / customs** | ❌ Not built | Needed for customs filing, not for tracking |
| **ISO 18185 e-seals** | ❌ Not built | Seal numbers parsed from CODECO; no e-seal reader |

**Legend:** ✅ built and tested offline · ⚠️ built with a stated limitation · ❌ not built

---

## 5. What "compatible with the largest shippers" honestly means right now

The carriers behind DCSA — Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE, Evergreen, HMM, Yang
Ming, ZIM — publish Track & Trace APIs against the standard this module now reads and
writes. So:

**What is true:** the data formats are built, bidirectional, and tested against realistic
event payloads. A DCSA event from any of those carriers maps into the ledger, and a GCN
waypoint maps back out into a DCSA event their systems can consume.

**What is not yet true:** nothing is connected. No carrier API credential exists, no live
feed has been consumed, and each carrier extends and constrains DCSA in its own published
API. Integration is a per-carrier commercial and contractual exercise — an API agreement,
sandbox credentials, then field-by-field validation against *their* documentation. The code
is ready for that conversation; it has not had it.

The honest claim to make externally is: **"DCSA Track & Trace compatible, pending carrier
API agreement"** — not "integrated with major carriers."

---

## 6. Still missing, in priority order

1. **Container IoT telemetry (TIER1).** Still the biggest gap, and now the *only* remaining
   one that changes what the product fundamentally is. Everything built so far improves
   TIER2 and TIER3 — paperwork and ships. **Nothing in this module yet observes a container.**
   Traxens, Nexxiot, ORBCOMM and Globe Tracker are the vendors; one instrumented lane
   demonstrates more than a hundred AIS-derived ones.
2. **One live carrier feed.** Pick a single carrier, get sandbox credentials, validate the
   DCSA mapping field-by-field against their published API. Until this happens, "compatible"
   remains a statement about code, not about a working integration.
3. **An AIS provider decision.** FleetMon is gone. MarineTraffic/Kpler is the direct
   successor; Spire and ORBCOMM are the main alternatives. The adapter makes this reversible,
   but the commercial decision still has to be made.
4. **The official UN/LOCODE list.** ~22 hand-typed port centroids will not survive contact
   with a real route. Load the UNECE code list and record the edition.
5. **Per-partner EDIFACT profiles.** The parser handles the common subset. Each terminal's
   MIG differs; profiles should be configuration, not code changes.
6. **BAPLIE** if on-vessel stowage position is ever needed (bay/row/tier).
7. **Audit** before any mainnet consideration. Unchanged and non-negotiable.

---

## 7. Changes made to existing code

- **`ContainerToken.sol`** now rejects yard shorthand in the size/type field. ISO 6346
  requires the 4th character to be a digit (`45G1`); shorthand like `40HC` is also four
  characters but ends in a letter, so the digit check is what separates them. This was a
  live interoperability defect: the sample data carried `40HC`, which no carrier system
  accepts.
- **Sample data and all tests** updated from `40HC` to `45G1`.
- Contract recompiled, **19 EVM tests passing**.

---

## 8. Findings from verification worth recording

Two defects were caught by the tests themselves rather than by review:

- The EDIFACT parser rejected a container id in my own test fixture. `MSCU1234565` has a bad
  check digit — it should be `MSCU1234566`. The validator was right and the fixture was
  wrong, which is the correct direction for that disagreement.
- The on-chain size/type check initially tested length only. `40HC` is four characters, so
  it passed. The test failed, and the rule was corrected to the actual ISO 6346 structure.

---

**Sources**

- DCSA Interface Standard for Track and Trace 2.1 — https://dcsa.org
- DCSA event code reference — https://docs.vizionapi.com/docs/dcsa-event-code-types
- UN/EDIFACT CODECO D95B — https://www.stylusstudio.com/edifact/D95B/CODECO.htm
- GS1 EPCIS 2.0 — https://www.gs1.org/epcis
- FleetMon / MarineTraffic merge and phase-out — https://support.marinetraffic.com/en/articles/9552991-fleetmon-and-marinetraffic-merge-process-for-former-fleetmon-ais-partners-from-january-2024
- FleetMon API retirement and historical surface — https://github.com/api-evangelist/fleetmon
- Pole Star Maritime Transparency Index — https://www.polestarglobal.com/maritime-transparency-index/

# Architecture
| Layer | EVM | Hedera | Solana |
|---|---|---|---|
| Asset | ERC-721 per container (keccak256(isoId) uniqueness) | HTS NonFungibleUnique | SPL 0-decimal, supply 1 |
| Docs pointer | docsHash (bytes32) | 16-hex sha256 prefix in metadata | sha256 prefix in Memo |
| Attestation | attestVessel(imo, mti, evidence) | HCS message | (next step) Memo / Metaplex |
| Transfer gating | on-chain, status + MTI | key-controlled (pause/wipe) | none on-chain; off-chain policy |
| Supply lock | one token per id | admin/supply keys held by operator | mint authority revoked |
Known gaps: Metaplex metadata, Solana gating, key custody, audit, oracle for MTI, legal title linkage.
Verification so far: ISO validator tested; contract compiled with solcjs 0.8.19; Hardhat tests written but not executed (solc download blocked in sandbox); Hedera/Solana scripts syntax-checked only, never run against networks.

# Hedera Connection Check

Checks that a machine can reach Hedera and that your Hedera Portal account and key work. Read-only by default; `--signed` adds one 1-tinybar testnet transfer.

| Check | What it proves |
|---|---|
| Mirror node | REST access to `<network>.mirrornode.hedera.com` and fresh blocks |
| JSON-RPC relay | Hashio relay reachable and on the right chain ID (mainnet 295 · testnet 296 · previewnet 297) |
| Operator account (mirror) | Your portal account ID exists; shows balance and EVM address |
| Contracts (`HEDERA_CONTRACT_IDS`) | Each contract ID exists on the network and isn't deleted. This is the evidence needed before page copy says "Testnet Deployed" |
| HTS tokens (`HEDERA_TOKEN_IDS`) | Each test token exists; shows name, symbol, type and supply |
| Consensus nodes (signed tx, `--signed`) | Signs and submits a 1-tinybar transfer to the fee account `0.0.98` and waits for a `SUCCESS` receipt. Proves key, signing and consensus end to end. Testnet/previewnet only, refused on mainnet |

## Run

```bash
cd hedera
npm install
cp .env.example .env   # paste Account ID + DER private key from portal.hedera.com/dashboard
npm run check              # read-only
npm run check -- --signed  # + one 1-tinybar testnet transfer
```

`AccountBalanceQuery` is not used: Hedera throttles it on consensus nodes from release v0.74 and removes it in v0.77 (October 2026). Balances come from the mirror node.

Exit code `0` = CONNECTED, `1` = at least one check failed.

## GCN testnet account

| Field | Value |
|---|---|
| Account ID | `0.0.10717267` (active) |
| EVM address | `0x76adac5080337ac817801d5dc58839cb50c439df` (ECDSA key alias) |
| Key type | ECDSA secp256k1, for EVM tooling (Hardhat, Foundry, MetaMask) |
| Network | Testnet |

The check fails if the mirror node reports a different EVM address for this account, or if the `.env` key doesn't match it.

**Retired:** `0.0.10716121` (EVM `0xd1d8734c645392df255d98287c645592407a3e23`). Its private key was exposed on 2026-09-25, so don't use it for deployments, signing or any GCN material.

## Verified connection

**2026-09-26: CONNECTED (signed transaction confirmed), 7/7 checks passed**, run from the operator's machine on testnet.

| Check | Result |
|---|---|
| Mirror node | Live (block #40987331, 3s old) |
| JSON-RPC relay | chainId 296 (testnet) |
| Account `0.0.10717267` | Exists, 1000 ℏ, ECDSA_SECP256K1 |
| Key ↔ account | Match; EVM `0x76adac5080337ac817801d5dc58839cb50c439df` |
| gRPC ports | 28/28 consensus endpoints reachable |
| Signed transaction | `SUCCESS` via node 0.0.9, tx `0.0.10717267@1790381836.689166189` ([mirror record](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.10717267-1790381836-689166189)) |

This verifies testnet connectivity and signing only. No GCN contract or token is deployed by this check.

## Deployed contracts (testnet)

| Contract | Contract ID | EVM address | Status |
|---|---|---|---|
| AtomicSwapV2_Hedera | `0.0.10722355` | `0x969D5457DFfaD4Cdf240dd3a246e41dA0F156465` | **Testnet deployed 2026-09-26 · Pre-audit · Not for live value** |

- Deployed from `0.0.10717267`, deploy tx `0x7d6ce51ab52e30abf80a26db83c50142d963acd5d74f191ef076160353b2416a`. The contract ID was resolved from the mirror node by the deploy script.
- Source: `gcn-atomicswap-v2` with settlement fixes F1–F4 (17/17 tests passing on the operator's machine).
- Test swap (simulated, deployer on both sides): create `0xa9cf9b5d…cbe6`, fund `0xbc5f0a73…72e8`, withdraw `0x6809f65c…eae2`. Both legs settled and the contract balance stayed at 0.
- Carbon NFT is not configured (`address(0)`), so minting is disabled.
- On-chain Chainlink price validation is **not implemented** in this contract.

To re-verify: `HEDERA_CONTRACT_IDS=AtomicSwapV2_Hedera=0.0.10722355 npm run check`.

## Status

- **Network:** testnet by default. The portal issues testnet/previewnet accounts. Mainnet is not active for GCN and remains a future buildout item.
- **Contracts:** nothing is deployed by this tool. The GCN Atomic Swap V2 contract is **pre-audit and not deployed for live value**.
- The portal's Playground and Contract Builder are browser tools tied to your login. Use this script to confirm the same account from code.

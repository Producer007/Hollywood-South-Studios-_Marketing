# Hedera Connection Check

Read-only check that a machine can reach Hedera and that your Hedera Portal account works. Submits no transactions and spends no HBAR.

| Check | What it proves |
|---|---|
| Mirror node | REST access to `<network>.mirrornode.hedera.com` and fresh blocks |
| JSON-RPC relay | Hashio relay reachable and on the right chain ID (mainnet 295 · testnet 296 · previewnet 297) |
| Operator account (mirror) | Your portal account ID exists; shows balance and EVM address |
| Contracts (`HEDERA_CONTRACT_IDS`) | Each contract ID exists on the network and isn't deleted. This is the evidence needed before page copy says "Testnet Deployed" |
| HTS tokens (`HEDERA_TOKEN_IDS`) | Each test token exists; shows name, symbol, type and supply |
| Consensus nodes (SDK) | `@hashgraph/sdk` signs in as your operator and runs a free `AccountBalanceQuery` over gRPC |

## Run

```bash
cd hedera
npm install
cp .env.example .env   # paste Account ID + DER private key from portal.hedera.com/dashboard
npm run check
```

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

## Status

- **Network:** testnet by default. The portal issues testnet/previewnet accounts. Mainnet is not active for GCN and remains a future buildout item.
- **Contracts:** nothing is deployed by this tool. The GCN Atomic Swap V2 contract is **pre-audit and not deployed for live value**.
- The portal's Playground and Contract Builder are browser tools tied to your login. Use this script to confirm the same account from code.

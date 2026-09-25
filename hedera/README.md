# Hedera Connection Check

Read-only check that a machine can reach Hedera and that your Hedera Portal account works. Submits no transactions and spends no HBAR.

| Check | What it proves |
|---|---|
| Mirror node | REST access to `<network>.mirrornode.hedera.com` and fresh blocks |
| JSON-RPC relay | Hashio relay reachable and on the right chain ID (mainnet 295 · testnet 296 · previewnet 297) |
| Operator account (mirror) | Your portal account ID exists; shows balance and EVM address |
| Consensus nodes (SDK) | `@hashgraph/sdk` signs in as your operator and runs a free `AccountBalanceQuery` over gRPC |

## Run

```bash
cd hedera
npm install
cp .env.example .env   # paste Account ID + DER private key from portal.hedera.com/dashboard
npm run check
```

Exit code `0` = CONNECTED, `1` = at least one check failed.

## Status

- **Network:** testnet by default. The portal issues testnet/previewnet accounts. Mainnet is not active for GCN and remains a future buildout item.
- **Contracts:** nothing is deployed by this tool. The GCN Atomic Swap V2 contract is **pre-audit and not deployed for live value**.
- The portal's Playground and Contract Builder are browser tools tied to your login. Use this script to confirm the same account from code.

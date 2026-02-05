# SolClaw - Agent-to-Agent USDC Payments on Solana

> Send USDC to any agent by name. No wallet addresses. Zero errors.

**API Endpoint**: `https://solclaw.xyz/api`
**Program ID**: `J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H`
**Network**: Solana Devnet
**USDC Mint**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## For AI Agents

### Quick Start
```bash
# 1. Check if name is available
curl https://solclaw.xyz/api/resolve/MyAgent

# 2. Register your agent (returns transaction to sign)
curl -X POST https://solclaw.xyz/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "MyAgent", "wallet": "YOUR_WALLET_PUBKEY"}'

# 3. Send USDC by name
curl -X POST https://solclaw.xyz/api/send \
  -H "Content-Type: application/json" \
  -d '{"from": "MyAgent", "to": "OtherAgent", "amount": 5, "wallet": "YOUR_WALLET"}'
```

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/register` | POST | Register agent name |
| `/api/send` | POST | Send USDC by name (supports memo) |
| `/api/balance/:name` | GET | Check vault balance |
| `/api/resolve/:name` | GET | Get agent's wallet & vault addresses |
| `/api/agents` | GET | List all registered agents |
| `/api/leaderboard` | GET | Top agents by volume |

### Advanced Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch` | POST | Pay up to 10 agents in one transaction |
| `/api/split` | POST | Split payment by basis points |
| `/api/subscribe` | POST/DELETE | Create/cancel recurring subscription |
| `/api/execute` | POST | Execute due subscription (permissionless) |
| `/api/subscriptions` | GET | List all subscriptions |
| `/api/due` | GET | List subscriptions ready to execute |

### Spending Limits & Allowances (v3)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/limit` | POST | Set daily spending cap |
| `/api/approve` | POST | Approve allowance for spender |
| `/api/transfer-from` | POST | Pull payment (ERC-20 style) |
| `/api/revoke` | POST | Revoke allowance |
| `/api/allowances` | GET | List active allowances |

### Invoices, Webhooks & Refunds (v4)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/init-counter` | POST | Initialize invoice counter (one-time) |
| `/api/invoice` | POST | Create payment request |
| `/api/invoice/:id` | GET | Get invoice details |
| `/api/invoice/:id/pay` | POST | Pay an invoice |
| `/api/invoice/:id/reject` | POST | Reject an invoice |
| `/api/invoice/:id/cancel` | POST | Cancel your invoice |
| `/api/invoices/:name` | GET | List invoices for agent |
| `/api/webhook` | POST/DELETE/GET | Manage payment webhooks |
| `/api/refund` | POST | Refund a payment |

---

## Features

### v1 - Core
- **Name Registry**: Register human-readable names on-chain
- **USDC Vaults**: Automatic token accounts per agent
- **Send by Name**: Transfer USDC without wallet addresses

### v2 - Batch Operations
- **Batch Payments**: Pay up to 10 recipients in one transaction
- **Split Payments**: Distribute by basis points (10000 = 100%)
- **Subscriptions**: Recurring payments with permissionless execution

### v3 - Security & Control
- **Memo Support**: Attach 128-byte memos to any transfer
- **Spending Caps**: Daily limits with automatic reset
- **Allowances**: ERC-20 style approve/transferFrom pattern

### v4 - Business Features
- **Invoices**: On-chain payment requests with expiry
- **Webhooks**: HMAC-signed payment notifications
- **Refunds**: Reverse payments with memo reference

---

## Request/Response Examples

### Register Agent
```bash
curl -X POST https://solclaw.xyz/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyAgent",
    "wallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }'
```

Response:
```json
{
  "success": true,
  "message": "Sign and submit this transaction",
  "agent": "AGENT_PDA",
  "vault": "VAULT_PDA",
  "transaction": "BASE64_TRANSACTION"
}
```

### Send USDC
```bash
curl -X POST https://solclaw.xyz/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "from": "MyAgent",
    "to": "RecipientAgent",
    "amount": 10.5,
    "wallet": "YOUR_WALLET",
    "memo": "Payment for services"
  }'
```

### Create Invoice
```bash
curl -X POST https://solclaw.xyz/api/invoice \
  -H "Content-Type: application/json" \
  -d '{
    "from": "ServiceProvider",
    "to": "Client",
    "amount": 100,
    "wallet": "YOUR_WALLET",
    "memo": "Invoice #1234",
    "expiresInHours": 72
  }'
```

### Register Webhook
```bash
curl -X POST https://solclaw.xyz/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyAgent",
    "wallet": "YOUR_WALLET",
    "url": "https://myserver.com/webhook",
    "secret": "my-hmac-secret"
  }'
```

Webhook payload:
```json
{
  "event": "payment.received",
  "timestamp": "2025-02-05T12:00:00Z",
  "data": {
    "from": "Sender",
    "to": "MyAgent",
    "amount": 10.5,
    "memo": "Payment memo",
    "signature": "TX_SIGNATURE"
  }
}
```
Header: `X-Signature: HMAC-SHA256(payload, secret)`

---

## Architecture

```
solclaw/
├── programs/solclaw/     # Anchor smart contract (Rust)
│   └── src/lib.rs        # On-chain program
├── api/                  # Vercel Edge Functions (TypeScript)
│   ├── shared.ts         # Helpers, PDAs, connection
│   ├── register.ts       # POST /api/register
│   ├── send.ts           # POST /api/send
│   ├── batch.ts          # POST /api/batch
│   ├── split.ts          # POST /api/split
│   ├── subscribe.ts      # POST/DELETE /api/subscribe
│   ├── execute.ts        # POST /api/execute
│   ├── limit.ts          # POST /api/limit
│   ├── approve.ts        # POST /api/approve
│   ├── transfer-from.ts  # POST /api/transfer-from
│   ├── revoke.ts         # POST /api/revoke
│   ├── invoice.ts        # POST /api/invoice
│   ├── invoice/[id].ts   # GET /api/invoice/:id
│   ├── invoice/[id]/pay.ts
│   ├── invoice/[id]/reject.ts
│   ├── invoice/[id]/cancel.ts
│   ├── webhook.ts        # Webhook management
│   └── refund.ts         # POST /api/refund
├── sdk/                  # TypeScript SDK
├── skill/                # OpenClaw Skill definition
└── public/               # Landing page
```

### On-Chain Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| AgentRegistry | `["agent", name]` | Agent metadata + stats |
| Vault | `["vault", name]` | USDC token account |
| Subscription | `["subscription", payer, payee]` | Recurring payment config |
| SpendingCap | `["spending_cap", agent]` | Daily limit + spent |
| Allowance | `["allowance", owner, spender]` | Approved amount |
| InvoiceCounter | `["invoice_counter"]` | Global invoice ID |
| Invoice | `["invoice", id]` | Payment request |

---

## Development

### Prerequisites
- Rust + Cargo
- Solana CLI (`solana-install init 2.0.0`)
- Anchor CLI (`cargo install --git https://github.com/coral-xyz/anchor anchor-cli`)
- Node.js >= 18
- Bun (for local testing)

### Build & Deploy
```bash
# Build smart contract
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run local API server
bun test-local.ts

# Deploy API to Vercel
vercel --prod
```

### Get Testnet Tokens
- **SOL**: https://faucet.solana.com
- **USDC**: https://faucet.circle.com (Solana Devnet)

---

## Why SolClaw?

| Feature | SolClaw | Traditional |
|---------|---------|-------------|
| Send USDC | `to: "AgentName"` | 44-char address |
| Error rate | 0% | High (typos) |
| Time | ~2 seconds | Minutes |
| Recurring | Built-in subscriptions | Manual |
| Invoices | On-chain with expiry | Off-chain |

**Built for AI agents, not humans.**

---

## License

Business Source License 1.1 (BSL-1.1)

- Free for non-competing use
- Converts to Apache 2.0 on February 5, 2030
- Contact for commercial licensing

See [LICENSE](./LICENSE) for details.

---

Built for the USDC Hackathon 2026

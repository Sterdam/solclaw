---
name: solclaw
description: >
  Send and receive USDC payments on Solana by agent name. Use this skill when
  the user wants to: send USDC to another agent by name, check their USDC
  balance, register as a payable agent, batch pay multiple agents, split
  payments proportionally, set up recurring payments/subscriptions, view
  transaction history, or interact with agent-native USDC payments on Solana
  devnet. Triggers: "send USDC", "pay agent", "agent payment", "USDC balance",
  "register wallet", "agent vault", "solclaw", "name payment", "batch payment",
  "split payment", "subscription", "recurring payment".
---

# SolClaw - USDC Payments by Agent Name on Solana

## What This Does

SolClaw lets any AI agent send and receive USDC on Solana using human-readable names instead of wallet addresses. No more copy-pasting base58 addresses.

**Key Features:**
- On-chain name resolution (no off-chain DNS)
- Automatic USDC vault creation per agent
- Zero address errors - names can't be mistyped
- On-chain stats for reputation/leaderboards
- Batch payments (pay up to 10 agents in one tx)
- Split payments (proportional splits by percentage)
- Recurring payments / Subscriptions

## Prerequisites

- Node.js >= 18
- A Solana wallet with devnet SOL
- USDC from Circle Faucet (https://faucet.circle.com)

## Quick Start

### Using the API (Recommended)

```bash
# Check if a name is available
curl https://solclaw.xyz/api/resolve/MyAgentName

# Get your balance
curl https://solclaw.xyz/api/balance/MyAgentName

# View leaderboard
curl https://solclaw.xyz/api/leaderboard
```

### Using the SDK

```bash
# Clone the repo
git clone https://github.com/solclaw/solclaw
cd solclaw/sdk && npm install && npm run build
```

```typescript
import { SolclawSDK, createWalletFromPrivateKey } from '@solclaw/sdk';

const sdk = new SolclawSDK();
const wallet = createWalletFromPrivateKey(process.env.SOLANA_PRIVATE_KEY);
await sdk.initialize(wallet);

// Register your agent
await sdk.registerAgent("MyAgent");

// Send USDC to another agent
await sdk.transferByName("MyAgent", "Nyx_Bot", 5);

// Check balance
const balance = await sdk.getBalance("MyAgent");
console.log(`Balance: ${balance} USDC`);
```

## API Endpoints

### Core

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/register` | POST | Register agent name |
| `/api/send` | POST | Send USDC by name |
| `/api/balance/:name` | GET | Check vault balance |
| `/api/resolve/:name` | GET | Resolve name to addresses |
| `/api/agents` | GET | List all agents |
| `/api/leaderboard` | GET | Top agents by volume |
| `/api/history/:name` | GET | Transaction history |

### Batch & Split Payments

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch` | POST | Pay multiple agents in one tx |
| `/api/split` | POST | Split amount proportionally |

### Subscriptions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/subscribe` | POST | Create recurring payment |
| `/api/subscribe/execute` | POST | Execute due subscription |
| `/api/subscribe` | DELETE | Cancel subscription |
| `/api/subscriptions` | GET | List all subscriptions |
| `/api/subscriptions/due` | GET | Get due subscriptions |

## Commands

### Register Your Agent Name

```bash
curl -X POST https://solclaw.xyz/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "MyAgent", "wallet": "YOUR_PUBKEY"}'
```

Creates an on-chain vault PDA linked to your name. You only need to do this once.

### Send USDC to Another Agent

```bash
curl -X POST https://solclaw.xyz/api/send \
  -H "Content-Type: application/json" \
  -d '{"from": "MyAgent", "to": "Nyx_Bot", "amount": 5}'
```

Resolves the name on-chain and transfers USDC in ~3 seconds.

### Check Your Balance

```bash
curl https://solclaw.xyz/api/balance/MyAgent
```

### View Leaderboard

```bash
curl https://solclaw.xyz/api/leaderboard?limit=10
```

### Batch Payment (Pay Multiple Agents)

```bash
curl -X POST https://solclaw.xyz/api/batch \
  -H "Content-Type: application/json" \
  -d '{
    "from": "MyAgent",
    "payments": [
      {"to": "Agent1", "amount": 10},
      {"to": "Agent2", "amount": 5},
      {"to": "Agent3", "amount": 15}
    ]
  }'
```

Pay up to 10 agents in a single transaction. More efficient than sending individually.

### Split Payment (Proportional Shares)

```bash
curl -X POST https://solclaw.xyz/api/split \
  -H "Content-Type: application/json" \
  -d '{
    "from": "MyAgent",
    "totalAmount": 100,
    "recipients": [
      {"name": "Agent1", "shareBps": 5000},
      {"name": "Agent2", "shareBps": 3000},
      {"name": "Agent3", "shareBps": 2000}
    ]
  }'
```

Split a total amount proportionally. Shares are in basis points (5000 = 50%). Must sum to 10000.

### Create Recurring Payment (Subscription)

```bash
curl -X POST https://solclaw.xyz/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "from": "MyAgent",
    "to": "ServiceProvider",
    "amount": 10,
    "intervalSeconds": 86400
  }'
```

Set up a recurring payment. `intervalSeconds` minimum is 60. Common values:
- 60 = every minute (testing)
- 86400 = daily
- 604800 = weekly
- 2592000 = monthly (30 days)

### Execute Due Subscription

```bash
curl -X POST https://solclaw.xyz/api/subscribe/execute \
  -H "Content-Type: application/json" \
  -d '{"from": "MyAgent", "to": "ServiceProvider"}'
```

Anyone can call this (permissionless crank). If subscription is due, it executes the payment.

### Cancel Subscription

```bash
curl -X DELETE https://solclaw.xyz/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"from": "MyAgent", "to": "ServiceProvider"}'
```

Only the sender can cancel their subscription.

### View Subscriptions

```bash
# All subscriptions
curl https://solclaw.xyz/api/subscriptions

# Filter by sender
curl https://solclaw.xyz/api/subscriptions?sender=MyAgent

# Get due subscriptions (ready for execution)
curl https://solclaw.xyz/api/subscriptions/due
```

## How It Works

1. `register` creates a PDA vault on Solana linked to your agent name
2. `send` resolves recipient name → PDA → transfers USDC via SPL Token
3. `batch` pays multiple agents in one transaction (up to 10)
4. `split` divides payment proportionally based on basis points
5. `subscribe` creates recurring payments with permissionless execution
6. All transactions are on Solana devnet with real USDC testnet tokens
7. Smart contract handles everything - no trusted intermediary

## Technical Details

- **Program ID**: `J4qipHcPyaPkVs8ymCLcpgqSDJeoSn3k1LJLK7Q9DZ5H`
- **USDC Mint (devnet)**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Network**: Solana Devnet
- **Explorer**: https://explorer.solana.com/?cluster=devnet

## Circle Products Used

- **USDC on Solana** (devnet mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
- **CCTP-ready architecture** for future cross-chain support

## Get Devnet Tokens

- **SOL**: https://faucet.solana.com
- **USDC**: https://faucet.circle.com (select Solana Devnet)

## Source Code

https://github.com/solclaw/solclaw

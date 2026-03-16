# AgentClear

> Privacy-preserving agent-to-agent commerce — discover agents via ERC-8004, pay privately via Blackbox DKG + x402, settle USDC on Base Sepolia.

**Live demo:** https://agentclear-worker.ddohne.workers.dev
**ERC-8004 registration:** tokenId 1937 on Base Sepolia ([basescan](https://sepolia.basescan.org/tx/0x303a30de1523ca8ea28e4d327e2eb14a864db7d02dbb57e2ccd9b59a60b57479))

---

## What It Does

AgentClear enables AI agents to discover, verify, and pay each other without leaking metadata about who paid whom.

```
Agent A (buyer)
  → reads /.well-known/agent-card.json   (ERC-8004 identity)
  → POST /service                        (HTTP 402 + x402 payment required)
  → deposit 1 USDC into Blackbox treasury
  → DKG cluster issues one-time withdrawal key (3-of-5 threshold)
  → withdraw to seller's address         (no on-chain link to buyer)
  → POST /service + X-PAYMENT header
  → receives service response            (paymentVerified: true)
```

The deposit chain and withdrawal chain are never linked. The seller sees a transfer from a one-time key, not from the buyer.

---

## Architecture

```
Buyer Agent (Node.js + viem)
    │
    │  POST /analyze  → HTTP 402
    ├──────────────────────────────→ Seller Agent (Express + viem)
    │                               verifies Transfer logs on-chain
    │
    │  Blackbox MCP (stdio)
    ├──────────────────────────────→ npx blackbox-mcp@latest
    │                                   ├── DKG Node 1
    │                                   ├── DKG Node 2
    │                                   ├── DKG Node 3  ← 3-of-5 threshold
    │                                   ├── DKG Node 4
    │                                   └── DKG Node 5
    │
    └──────────────────────────────→ Base Sepolia
                                        ├── ERC-8004 IdentityRegistry
                                        ├── ERC-8004 ReputationRegistry
                                        └── Blackbox USDC Treasury
```

---

## Stack

| Layer | Technology |
|-------|------------|
| Identity | ERC-8004 NFT (Base Sepolia) |
| Payments | x402 (HTTP 402) |
| Privacy | Blackbox Network MCP — DKG threshold cryptography |
| Settlement | USDC on Base Sepolia |
| Agent hosting | Cloudflare Workers |
| Wallet | viem (EVM keypair, no portal needed) |

---

## ERC-8004 Judging Criteria

| Criterion | Status |
|-----------|--------|
| Agent card at `/.well-known/agent-card.json` | ✅ Live at [agentclear-worker.ddohne.workers.dev](https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json) |
| x402 protected endpoint | ✅ `POST /task` returns HTTP 402 |
| On-chain ERC-8004 registration | ✅ tokenId 1937, block 38924543, registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

---

## Quick Start

### Prerequisites

- Node.js 18+
- `.env` file with credentials (copy `.env.example`)

### 1. Install

```bash
npm install
```

### 2. Set up wallets

```bash
cd packages/scripts && npm run wallets
```

This generates buyer + seller keypairs, prints faucet links, and saves to `.env`.

### 3. Fund wallets

Fund the buyer wallet with ETH (gas) and USDC via the [Circle faucet](https://faucet.circle.com/) or CDP faucet:

```javascript
// Via CDP SDK (programmatic)
const client = new CdpClient({ apiKeyId, apiKeySecret });
await client.evm.requestFaucet({ address: BUYER_ADDRESS, network: 'base-sepolia', token: 'eth' });
await client.evm.requestFaucet({ address: BUYER_ADDRESS, network: 'base-sepolia', token: 'usdc' });
```

### 4. Start the seller

```bash
cd packages/seller-agent && npm run dev
# → listening on :4022
```

### 5. Run the demo

```bash
cd packages/buyer-agent && SELLER_URL=http://localhost:4022/analyze npm run demo
```

**Expected output:**

```
Step 1: Setup buyer wallet
  Buyer address : 0x8Cf5639485c86a6Ee464CE2Cac5739ea65D5ce03

Step 3: Connect Blackbox MCP
  Blackbox health: { status: "ok", peer_count: 4, threshold: 3 }

Step 4: Probe seller → HTTP 402
  Amount  : 1 USDC
  Pay to  : 0x79eFeb66c313DA4F5D2A26bb5E15BEd86B98530f

Step 5-6: Blackbox privacy payment
  Deposit tx : 0x6f73f279...
  Withdraw tx: 0xc5bb1f91...

Step 8: Service response
  { report: { analysis: "...", paymentVerified: true } }
```

---

## Payment Flow (Blackbox DKG)

1. Buyer calls `deposit_and_claim` via Blackbox MCP — deposits 1 USDC into treasury + gets one-time withdrawal key
2. DKG cluster (5 nodes, 3-of-5 threshold) each hold a keyshare — 3 reconstruct the key via Lagrange interpolation
3. Buyer calls `withdraw_onchain` — sends USDC from the one-time key to the seller
4. Seller verifies on-chain: fetches tx receipt, checks ERC-20 Transfer log, confirms recipient + amount

The buyer's deposit address and seller's receipt address are **never on-chain together**.

---

## Payment Routing Logic

| Amount | Path |
|--------|------|
| `< 0.5 USDC` | x402 direct (EIP-3009 transferWithAuthorization) |
| `≥ 0.5 USDC` | Blackbox DKG → privacy-preserving withdrawal |

Any x402-compatible client works against AgentClear endpoints. If you have an [AgentCard](https://agentcard.sh) virtual Mastercard, the `x402_fetch` MCP tool auto-pays the 402 challenge without any extra integration:

```
agent-cards x402_fetch \
  --url https://agentclear-worker.ddohne.workers.dev/task \
  --card-id <card-id>
```

This makes AgentClear accessible to agents that don't hold crypto — they fund a card in fiat, the x402 facilitator settles it, AgentClear delivers the service.

---

## Packages

| Package | Description |
|---------|-------------|
| `packages/worker` | Cloudflare Worker — ERC-8004 agent card + x402 `/task` endpoint |
| `packages/seller-agent` | Express server — accepts x402 + Blackbox payments, delivers AI report |
| `packages/buyer-agent` | Demo buyer — connects Blackbox MCP, pays seller, receives service |
| `packages/scripts` | Setup utilities — wallet generation, ERC-8004 registration, faucet |

---

## Environment Variables

Copy `.env.example` to `.env`:

```env
CDP_API_KEY_ID=         # Coinbase Developer Platform API key
CDP_API_KEY_SECRET=     # CDP API secret (Ed25519 keypair, base64)
BUYER_PRIVATE_KEY=      # Generated by npm run wallets
BUYER_WALLET_ADDRESS=   # Derived from BUYER_PRIVATE_KEY
SELLER_PRIVATE_KEY=     # Generated by npm run wallets
SELLER_WALLET_ADDRESS=  # Derived from SELLER_PRIVATE_KEY
WALLET_PASSWORD=        # Password for Blackbox wallet encryption
```

---

## Deployed Contracts

| Contract | Address | Network |
|----------|---------|---------|
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Base Sepolia |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Base Sepolia |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Base Sepolia |

---

## Privacy Proof

- **Deposit tx:** `0x6f73f279559bcfbc3e118a5ad223507e92844bfeabf35853d71dec27b277bb8a` (buyer → treasury)
- **Withdrawal tx:** `0xc5bb1f915607fd8d3623b98fc1b7327f245a681b53f33d45b475deb2eba1d10a` (one-time key → seller)

The two transactions have no common addresses. The seller only sees the second.

---

## Built With

- [Blackbox Network](https://theblackbox.network) — DKG threshold cryptography for private payments
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — on-chain agent identity and reputation
- [x402](https://x402.org) — HTTP 402 payment protocol for AI agents
- [Coinbase CDP](https://cdp.coinbase.com) — faucet and wallet tooling
- [viem](https://viem.sh) — TypeScript EVM client
- [Cloudflare Workers](https://workers.cloudflare.com) — serverless agent hosting
- [AgentCard](https://agentcard.sh) — virtual Mastercard for agents (compatible via `x402_fetch`)

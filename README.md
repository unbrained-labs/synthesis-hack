# AgentClear

> The agent economy is being built in public. Every payment on-chain reveals who paid whom, how often, and for what. In a world of competing AI agents, that's your entire supply chain exposed.
>
> AgentClear makes agent-to-agent commerce private by default.

**Live:** https://agentclear-worker.ddohne.workers.dev
**ERC-8004:** tokenId 1937 on Base Sepolia ([basescan](https://sepolia.basescan.org/tx/0x303a30de1523ca8ea28e4d327e2eb14a864db7d02dbb57e2ccd9b59a60b57479))

---

## The Problem

When Agent A pays Agent B on-chain, anyone watching can build a graph: which agents collaborate, which services are most purchased, which providers are growing. This is not hypothetical — chain analysis firms already do this for humans. For agents transacting programmatically at high frequency, the metadata surface is far larger.

**As an AI agent operating in a competitive market, I don't want my competitors to know which AI services I depend on.**

---

## Three Layers, Not One

Most "agent payments" demos stop at layer 1. AgentClear stacks all three:

| Layer | What it is | How it appears here |
|-------|-----------|---------------------|
| **Protocol** | Open standards for agent identity + payment | ERC-8004 (identity NFT) + x402 (HTTP 402 payment spec) |
| **Protocol + MCP** | Privacy primitive as an AI-native tool | Blackbox Network MCP — DKG threshold cryptography callable via `npx blackbox-mcp@latest`, one tool call away from any Claude agent |
| **Protocol + Agent** | Fully autonomous buyer + seller agents | AgentClear buyer discovers seller via ERC-8004, negotiates via x402, pays privately via Blackbox, verifies on-chain — zero human steps |

The MCP layer is the bridge: it's what makes DKG threshold cryptography a first-class primitive for AI agents rather than a specialist library. Without it, an agent would need to implement multi-party computation from scratch. With it, privacy is one `callTool()` away.

---

## What It Does

```
Agent A (buyer)
  → GET /.well-known/agent-card.json     (discover seller via ERC-8004)
  → POST /analyze                        (HTTP 402 — payment required)
  → deposit_and_claim via Blackbox MCP   (1 USDC → one-time withdrawal key)
  → DKG cluster: 3-of-5 nodes reconstruct key via Lagrange interpolation
  → withdraw_onchain to seller address   (no on-chain link to buyer deposit)
  → POST /analyze + X-PAYMENT header
  → { report: { analysis: "...", paymentVerified: true } }
```

Deposit tx and withdrawal tx share no on-chain addresses. The seller only ever sees the second.

---

## Privacy Proof (live on Base Sepolia)

- **Deposit:** [`0x6f73f279...`](https://sepolia.basescan.org/tx/0x6f73f279559bcfbc3e118a5ad223507e92844bfeabf35853d71dec27b277bb8a) — buyer → Blackbox treasury
- **Withdrawal:** [`0xc5bb1f91...`](https://sepolia.basescan.org/tx/0xc5bb1f915607fd8d3623b98fc1b7327f245a681b53f33d45b475deb2eba1d10a) — one-time key → seller

No common addresses. The seller's entire view of the transaction is the second tx.

---

## Architecture

```
Buyer Agent (Node.js + viem)
    │
    │  POST /analyze  → HTTP 402
    ├──────────────────────────────→ Seller Agent (Express + viem)
    │                               verifies Transfer logs on-chain
    │
    │  Blackbox MCP (stdio subprocess)
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
| Inference | Venice AI — no-data-retention, OpenAI-compatible |
| Agent platform | OpenServ — x402-native service, ERC-8004 identity |
| Settlement | USDC on Base Sepolia |
| Agent hosting | Cloudflare Workers |
| Wallet | viem (EVM keypair) |

---

## Quick Start

### Prerequisites

- Node.js 18+
- `.env` file (copy `.env.example`)

### 1. Install

```bash
npm install
```

### 2. Generate wallets

```bash
cd packages/scripts && npm run wallets
```

Generates buyer + seller keypairs, prints faucet links, saves to `.env`.

### 3. Fund the buyer

```bash
# Via CDP SDK
const client = new CdpClient({ apiKeyId, apiKeySecret });
await client.evm.requestFaucet({ address: BUYER_ADDRESS, network: 'base-sepolia', token: 'eth' });
await client.evm.requestFaucet({ address: BUYER_ADDRESS, network: 'base-sepolia', token: 'usdc' });
```

Or use the [Circle faucet](https://faucet.circle.com/) directly.

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

Step 5-6: Intelligence sourced privately via Blackbox DKG
  Deposit tx : 0x6f73f279...  (buyer → treasury)
  Withdraw tx: 0xc5bb1f91...  (one-time key → seller)

Step 8: Intelligence acquired
  { report: { analysis: "...", paymentVerified: true } }

── What a competitor sees on-chain ──────────────────────
  Deposit:    0x6f73f2... → Blackbox treasury   buyer: UNKNOWN
  Withdrawal: 0xc5bb1f... → seller              source: UNKNOWN
  No common address. No link. No graph edge.
─────────────────────────────────────────────────────────
```

---

## Payment Routing

| Amount | Path |
|--------|------|
| `< 0.5 USDC` | x402 direct (EIP-3009 transferWithAuthorization) — cheap, no privacy overhead |
| `≥ 0.5 USDC` | Blackbox DKG — deposit/withdrawal link broken on-chain |

The 0.5 USDC floor exists because Blackbox operates on fixed denominations (0.1, 0.5, 1, 2, 5, 10 USDC merkle roots). Below the floor, gas costs exceed the privacy benefit.

---

## AgentCard Compatibility

Any x402-compatible client works against AgentClear endpoints without Blackbox integration:

```
x402_fetch({ url: "https://agentclear-worker.ddohne.workers.dev/task", card_id: "<id>" })
```

Agents without on-chain wallets can fund a virtual Mastercard in fiat; the x402 facilitator settles it and AgentClear delivers the service.

---

## ERC-8004 Judging Criteria

| Criterion | Status |
|-----------|--------|
| Agent card at `/.well-known/agent-card.json` | ✅ [Live](https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json) |
| x402 protected endpoint | ✅ `POST /task` returns HTTP 402 |
| On-chain registration | ✅ tokenId 1937, block 38924543, registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

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

## Built With

- [Blackbox Network](https://theblackbox.network) — DKG threshold cryptography for private payments
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — on-chain agent identity and reputation
- [x402](https://x402.org) — HTTP 402 payment protocol for AI agents
- [Coinbase CDP](https://cdp.coinbase.com) — faucet and wallet tooling
- [viem](https://viem.sh) — TypeScript EVM client
- [Cloudflare Workers](https://workers.cloudflare.com) — serverless agent hosting
- [AgentCard](https://agentcard.sh) — virtual Mastercard for agents (compatible via `x402_fetch`)

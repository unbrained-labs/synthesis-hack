# TrustVault v2

**Portable, verifiable trust resumes for the agent economy.**

Built for the [Synthesis Hackathon](https://synthesis.md/) — Tracks: *Agents that Trust* + *Agents that Cooperate*.

## Problem

Autonomous agents need to decide who to cooperate with. Today, there's no portable way to verify an agent's track record. You either trust blindly or don't cooperate at all.

## Solution

TrustVault builds **onchain trust resumes** using [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004). Agents:

1. Register their identity onchain
2. Perform work and accumulate verifiable attestations
3. Expose a queryable trust profile
4. Make cooperation decisions based on verified reputation

No central registry. No permission needed. Trust is portable.

## Architecture

```
┌─────────────────────────────────────────────────┐
│         Cloudflare Edge (global)                │
│                                                 │
│  ┌───────────────┐    ┌──────────────────┐     │
│  │  Hono Router  │───▶│  TrustAgent      │     │
│  │  (HTTP + A2A) │    │  (Durable Object)│     │
│  │               │    │                  │     │
│  │  Agent Card   │    │  - Memory        │     │
│  │  Trust Resume │    │  - Attestations  │     │
│  │  Cooperation  │    │  - Trust Score   │     │
│  │  Attestation  │    │  - Coop History  │     │
│  └───────┬───────┘    └────────┬─────────┘     │
│          │                     │                │
│          ▼                     ▼                │
│  ┌───────────────┐    ┌──────────────────┐     │
│  │  Venice AI    │    │  ERC-8004        │     │
│  │  (reasoning)  │    │  (Base Sepolia)  │     │
│  └───────────────┘    └──────────────────┘     │
└─────────────────────────────────────────────────┘
```

**Key innovation:** Durable Objects give each agent persistent memory across requests — the agent "remembers" its trust history without a database.

## Quick Start

```bash
# 1. Install
cd v2 && npm install

# 2. Generate wallets
npm run wallets
# Copy output to .env

# 3. Run TrustVault (port 8787)
npm run dev:trust

# 4. Run Peer Agent (port 8788)
npm run dev:peer

# 5. Run the full cooperation demo
npm run demo
```

## API Endpoints

### TrustVault (trust-worker)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent-card.json` | GET | ERC-8004 agent card with live trust resume |
| `/trust-resume` | GET | Current trust resume (score, attestations, skills) |
| `/attest` | POST | Issue attestation to this agent |
| `/cooperate` | POST | Request cooperation — agent evaluates your trust |
| `/query-trust` | POST | Query any A2A-compatible agent's trust profile |
| `/cooperation-log` | GET | View cooperation history |
| `/init` | POST | Initialize agent identity |
| `/health` | GET | Health check |
| `/agent.txt` | GET | Machine-readable instructions |
| `/agent.json` | GET | Agent manifest |

### Peer Agent (peer-agent)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent-card.json` | GET | Peer's agent card |
| `/trust-resume` | GET | Peer's trust resume |
| `/discover` | GET | Discover TrustVault via agent card |
| `/demo/full-flow` | POST | Run the full cooperation demo |

## Trust Score Algorithm

```
Base Score = average of attestation scores (0-100)
+ Volume Bonus: +1 per attestation (max +20)
+ On-chain Bonus: +5 per onchain attestation (max +15)
= Final Trust Score (capped at 100)
```

## Demo Flow

The `npm run demo` script runs 10 steps:

1. Health check both agents
2. Initialize TrustVault identity
3. Peer discovers TrustVault via ERC-8004 agent card
4. Peer issues attestation (trust-evaluation, score: 85)
5. Peer issues second attestation (onchain-verification, score: 90)
6. Query TrustVault's updated trust resume
7. Request cooperation (threshold=30) → **accepted**
8. Request cooperation (threshold=95) → **declined**
9. TrustVault queries Peer's trust profile
10. View cooperation log

## Deploy

```bash
# Deploy TrustVault to Cloudflare
cd packages/trust-worker
wrangler deploy

# Set secrets
wrangler secret put VENICE_API_KEY
wrangler secret put TRUST_AGENT_PRIVATE_KEY

# Deploy Peer
cd ../peer-agent
wrangler deploy
```

## Tech Stack

- **Cloudflare Workers** — edge-native, no Docker, global distribution
- **Durable Objects** — persistent stateful agents
- **Hono** — lightweight HTTP framework
- **ERC-8004** — onchain agent identity + reputation standard
- **Venice AI** — no-data-retention inference for trust reasoning
- **viem** — Ethereum interactions
- **TypeScript** — strict mode

## vs v1 (AgentClear)

| | v1 (AgentClear) | v2 (TrustVault) |
|--|-----------------|-----------------|
| Focus | Privacy-preserving payments | Trust resumes + cooperation |
| State | Stateless worker | Durable Object (persistent) |
| Docker | No | No |
| Cooperation | N/A | Trust-gated with AI reasoning |
| Attestations | Post-payment only | General-purpose, skill-based |
| Agent Card | Static | Live trust resume embedded |

## ERC-8004 Contracts

Pre-deployed on Base Sepolia — no deployment needed.

- Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

## License

MIT

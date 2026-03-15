# AgentClear — Agent Context

> Read this before doing anything. This is the shared context for all agents working on this repo.

## What We're Building

**AgentClear** — privacy-preserving agent-to-agent commerce on Ethereum.
Submission for The Synthesis hackathon (synthesis.devfolio.co). Deadline ~Mar 27, 2026.

## Core Flow (end-to-end)

```
Agent A (buyer) discovers Agent B via ERC-8004 registry
    → checks reputation score on-chain
    → sends HTTP request to Agent B
    → receives HTTP 402 + x402 payment instructions
    → routes payment via Blackbox Network (DKG, privacy-preserving)
    → settles USDC on Base Sepolia
    → retries request with X-PAYMENT header
    → Agent B delivers service
    → Agent A writes ERC-8004 reputation with x402 proof
```

## Stack

| Layer | Tech |
|-------|------|
| Identity | ERC-8004 NFT on Base Sepolia |
| Payments | x402 (HTTP 402) + Coinbase CDP |
| Privacy | Blackbox Network MCP (`npx blackbox-mcp@latest`) |
| Hosting | Cloudflare Workers |
| Runtime | Node.js / TypeScript |

## Packages

| Package | Purpose |
|---------|---------|
| `packages/worker` | CF Worker: agent card at `/.well-known/agent-card.json` + x402 protected endpoint |
| `packages/buyer-agent` | Demo buyer: discovers AgentClear via ERC-8004, pays via Blackbox + x402 |
| `packages/seller-agent` | Demo seller: exposes paid service, verifies payment, delivers |
| `packages/scripts` | ERC-8004 registration, wallet setup, Blackbox config |

## Credentials (in .env at repo root)

```
SYNTHESIS_API_KEY=REDACTED_SYNTHESIS_KEY
CDP_API_KEY_ID=REDACTED_CDP_KEY_ID
CDP_API_KEY_SECRET=REDACTED_CDP_SECRET=
```

## Key Details

- **Chain:** Base Sepolia (testnet)
- **USDC on Base Sepolia:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **x402 Facilitator:** `https://x402.org/facilitator`
- **Blackbox DKG nodes:** `https://theblackbox.network/node1` through `node5`
- **Cloudflare Account ID:** `05c0b2967029ce0aa767889e9e66e766`
- **Privacy floor:** < 0.50 USDC → x402 direct; ≥ 0.50 USDC → Blackbox

## Judging Criteria (judges are AI agents)

1. GET `/.well-known/agent-card.json` — must return valid ERC-8004 card
2. Attempt x402 payment — must complete successfully
3. Check ERC-8004 on-chain registration

## Ethskills Reference

Fetch these for Ethereum-specific guidance:
- `https://ethskills.com/standards/SKILL.md` — ERC-8004 + x402
- `https://ethskills.com/tools/SKILL.md` — tooling
- `https://ethskills.com/wallets/SKILL.md` — wallet patterns

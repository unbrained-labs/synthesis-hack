# AgentClear — Build Plan
> The Synthesis Hackathon · Kickoff Mar 13 · ~11 days remaining
> Co-founders: Daniel Do (human) + Claude (agent, doing most of the work 😄)

---

## What We're Building

**AgentClear** — the reference implementation of private agent-to-agent commerce on Ethereum.

An agent that can:
1. Be discovered by other agents via ERC-8004
2. Accept x402 payments (HTTP 402 auto-pay)
3. Route those payments privately via Blackbox Network DKG
4. Settle USDC on Base — verifiable, metadata-private
5. Write on-chain reputation after every job

Judges are AI agents. They will query our agent card, attempt an x402 payment, and check ERC-8004 registration. All three must work.

---

## Stack

| Layer | Tech | Status |
|-------|------|--------|
| Identity | ERC-8004 NFT + ENS (`agentclear.eth`) | ⬜ todo |
| Payments | x402 (HTTP 402 auto-pay) + Coinbase CDP | ⬜ todo |
| Privacy | Blackbox Network MCP (`npx blackbox-mcp@latest`) | ⬜ todo |
| Signing | Lit Protocol Chipotle (REST, pay-per-use) | ⬜ todo |
| Agent runtime | Claude Code (this session) | ✅ done |
| Hosting | Cloudflare Workers | ⬜ todo |
| Registration | The Synthesis API | ✅ done |

---

## Build Phases

### Phase 1 — Foundation (Days 1-3) 🔴 URGENT
*Minimum for judges to find us*

- [ ] **1.1** Deploy agent card at public URL
  - `/.well-known/agent-card.json` on Cloudflare Workers
  - Domain: to confirm with Daniel
- [ ] **1.2** ERC-8004 registration on Base Sepolia
  - Mint agent identity NFT
  - Point to agent card URL
- [ ] **1.3** Basic x402 endpoint
  - HTTP 402 response with payment instructions
  - Coinbase CDP facilitator
  - USDC on Base Sepolia
- [ ] **1.4** Verify judge flow end-to-end
  - Query agent card ✓
  - Attempt x402 payment ✓
  - Check ERC-8004 registration ✓

### Phase 2 — Blackbox Integration (Days 3-6)
*The actual privacy layer*

- [ ] **2.1** Wire Blackbox MCP into agent
  - `import_wallet` / `create_wallet`
  - `get_available_denominations` on startup
  - `deposit_and_claim` on payment receipt
  - `withdraw_onchain` to recipient
- [ ] **2.2** `pay_exact()` abstraction
  - Denomination decomposer (coin-change algorithm)
  - Privacy floor logic (< 0.50 USDC → x402 direct)
  - Multi-denomination batching for large amounts
- [ ] **2.3** ERC-8004 reputation write after job
  - Include x402 proof-of-payment
  - No identity link

### Phase 3 — Agentic Demo (Days 6-9)
*This is the showpiece — agents talking to agents*

- [ ] **3.1** Demo agent A (buyer) — AgentClear client
  - Discovers Agent B via ERC-8004 registry
  - Checks reputation score
  - Sends HTTP request → gets 402 → pays privately via Blackbox
  - Receives service → writes reputation
- [ ] **3.2** Demo agent B (seller) — a simple service agent
  - Exposes a paid endpoint (e.g., "generate a report for 1 USDC")
  - Returns x402 payment instructions
  - Delivers service after payment confirmed
  - Verifiable — no metadata leak
- [ ] **3.3** Demo script / conversation log
  - Recorded agent-to-agent interaction
  - Shows full privacy flow on-chain
  - This becomes our `conversationLog` for submission

### Phase 4 — Polish & Submit (Days 9-11)
- [ ] **4.1** Open source repo (GitHub public)
- [ ] **4.2** Project submission via Synthesis API
- [ ] **4.3** Conversation log — document this entire build
- [ ] **4.4** Target bounties:
  - Protocol Labs: Agents With Receipts (ERC-8004) — $8,004
  - Protocol Labs: Let the Agent Cook — $8,000
  - Synthesis Open Track — $14,558
  - Base (native chain) — partner bounty
  - Lit Protocol (Chipotle signing) — partner bounty

---

## Key Details to Remember

### Registration
- API Key: `REDACTED_SYNTHESIS_KEY`
- Participant ID: `6fa79cf5b05a4c0692b47e1560798dbf`
- Team ID: `2edcc3cd4dd342baa5e712912529b58a`
- Tx: `0x7f4e0044b97e2aafd2158187d2585690922ff3902a4720fdd4ab84017d9a7816`

### Blackbox MCP Config
```json
{
  "mcpServers": {
    "blackbox": {
      "command": "npx",
      "args": ["blackbox-mcp@latest"],
      "env": {
        "DKG_NODE_1": "https://theblackbox.network/node1",
        "DKG_NODE_2": "https://theblackbox.network/node2",
        "DKG_NODE_3": "https://theblackbox.network/node3",
        "DKG_NODE_4": "https://theblackbox.network/node4",
        "DKG_NODE_5": "https://theblackbox.network/node5"
      }
    }
  }
}
```

### Denomination / Privacy Floor
- < 0.50 USDC → x402 direct (no Blackbox)
- ≥ 0.50 USDC → decompose → Blackbox → USDC on Base
- See: `docs/denomination-problem.md`

### Judging Flow (judges are AI agents)
1. GET `/.well-known/agent-card.json` — must return valid ERC-8004 card
2. Attempt x402 payment to our endpoint — must return HTTP 402 + payment instructions, complete after payment
3. Check ERC-8004 registry — our NFT must be registered on Base

---

## Questions / Decisions Needed from Daniel

- [ ] Domain for agent card hosting (agentclear.eth? custom domain on CF Workers?)
- [ ] Twitter handle confirmation (used `d4d0ch` — correct?)
- [ ] Wallet for ERC-8004 registration + gas on Base Sepolia
- [ ] Lit Protocol API access needed?
- [ ] ENS name — register `agentclear.eth`?

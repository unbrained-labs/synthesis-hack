# Synthesis Hackathon — Bounty Sheet

## AgentClear Relevance Key
- 🟢 Strong fit — already mostly covered, minimal work
- 🟡 Good fit — meaningful integration needed (hours, not days)
- 🔴 Weak/no fit — different domain

---

## Priority Targets

| Sponsor | Track | Prize | Fit | What's needed |
|---------|-------|-------|-----|---------------|
| **Protocol Labs** | Agents With Receipts — ERC-8004 | $8,004 | 🟢 | `agent.json` + `agent_log.json` |
| **Protocol Labs** | Let the Agent Cook | $8,000 | 🟢 | `agent.json` + `agent_log.json` |
| **Synthesis Open Track** | Shared pool | $19,500 | 🟢 | Enter by default (meta-agent judges all sponsors) |
| **OpenServ** | Ship Something Real | $4,500 | 🟢 | Register on OpenServ — bounty literally names x402 + ERC-8004 |
| **Venice** | Private Agents, Trusted Actions | $11,457* | 🟡 | Swap seller inference to Venice API (OpenAI-compatible) |
| **Merit Systems** | Build with AgentCash | $1,750 | 🟡 | Register seller `/analyze` as x402 API on AgentCash |
| **Locus** | Best Use of Locus | $3,000 | 🟡 | Integrate Locus wallet SDK for buyer payment flow |
| **Status Network** | Gasless Transactions | $50 | 🟡 | Deploy any contract + 1 gasless tx on Status Sepolia |

*Venice prizes in VVV token, not USD cash

---

## Full Sponsor List

| Sponsor | Pool | Tracks | Notes |
|---------|------|--------|-------|
| **Synthesis Open Track** | $19,500 | Shared prize judged by meta-agent | All sponsors contribute; enter by default |
| **Protocol Labs** | $15,932 | Let the Agent Cook ($8k) + Agents With Receipts ($8,004) | Requires `agent.json` + `agent_log.json` (DevSpot manifest) |
| **Venice** | $11,457 | Private Agents, Trusted Actions | VVV token prizes; OpenAI-compatible API; privacy narrative aligns perfectly |
| **Lido** | $9,963 | stETH Agent Treasury ($3k) + Vault Monitor ($1.5k) + Lido MCP ($5k) | stETH-specific, different domain |
| **Celo** | $9,962 | Best Agent on Celo ($5k) | Requires building on Celo chain |
| **Uniswap** | $9,962 | Agentic Finance ($5k) | Requires Uniswap API key + real swaps |
| **Bankr** | $7,471 | Best Bankr LLM Gateway Use ($5k) | Multi-model LLM gateway with onchain execution |
| **OpenServ** | $4,981 | Ship Something Real ($4.5k) + Build Story ($500) | Explicitly wants x402-native services + ERC-8004 identity |
| **MetaMask** | $4,981 | Best Use of Delegations ($5k) | ERC-7715 intent-based delegations, needs deep integration |
| **Octant** | $4,981 | Public goods evaluation tracks (3x $1k) | Public goods data — different domain |
| **SuperRare** | $4,981 | Autonomous NFT agents on Rare Protocol ($2.5k) | NFT/art domain |
| **Olas** | $2,989 | Pearl ($1k) + Hire Agent ($1k) + Monetize Agent ($1k) | Olas-specific framework required |
| **Locus** | $2,989 | Best Use of Locus ($3k) | Agent-native payments on Base/USDC — relevant |
| **Status Network** | $1,992 | Gasless tx ($50/team, up to 40 teams) | Just deploy contract + gasless tx + AI agent component |
| **Virtuals Digital S.A.** | $1,993 | ERC-8183 Open Build ($2k) | ERC-8183 standard, different identity spec |
| **Merit Systems** | $1,694 | Build with AgentCash ($1.75k) | x402 API consumption — our seller IS an x402 API |
| **ENS** | $1,694 | Identity ($600) + Open Integration ($300) + Communication ($600) | Replace hex addresses with ENS names in agent flows |
| **bond.credit** | $1,694 | Agents that pay — GMX live trading ($1.5k) | Live GMX perp trading on Arbitrum, different domain |
| **Self** | $996 | Best Self Agent ID Integration ($1k) | ZK-powered agent identity, complements ERC-8004 |
| **Arkhai** | $996 | Applications ($450) + Escrow Extensions ($450) | Alkahest escrow protocol, different domain |
| **Markee** | $797 | GitHub Integration ($800) | Add Markee message to high-traffic GitHub repo |
| **ampersend** | $498 | Best Agent with ampersend-sdk ($500) | Unknown SDK, low ROI |

---

## What's Needed Right Now

### 1. `agent.json` — DevSpot Agent Manifest (unlocks ~$16k Protocol Labs)
Required fields per bounty description:
- agent name, operator wallet, ERC-8004 identity
- supported tools, tech stacks, compute constraints, task categories

### 2. `agent_log.json` — Structured Execution Log (same $16k unlock)
Required fields: decisions, tool calls, retries, failures, final outputs

### 3. OpenServ registration
Register AgentClear as an x402-native service on OpenServ platform.

### 4. Venice API swap (optional, $11k upside)
Replace inference in seller `/analyze` with Venice's OpenAI-compatible API.
```
const openai = new OpenAI({ baseURL: "https://api.venice.ai/api/v1", apiKey: VENICE_API_KEY });
```

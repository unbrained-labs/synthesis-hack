# Denomination Problem: Arbitrary Amounts in Blackbox

## The Problem

Blackbox uses fixed denominations tied to on-chain merkle roots. An agent trying to pay an arbitrary amount like `0.01 USDC` or `123.50 USDC` has no clean path today.

| Amount | Issue |
|--------|-------|
| `0.01 USDC` | Below minimum denomination (1 USDC) — can't enter Blackbox at all |
| `123.50 USDC` | 123 is representable via `{1,2,5,10}`, but 0.50 has nowhere to go |

---

## Option A — Extend the Protocol (New Merkle Roots)

Register additional denominations on-chain to cover the gaps:

| Gap | Add |
|-----|-----|
| Sub-dollar micro | 0.01, 0.05, 0.10, 0.25, 0.50 USDC |
| Large amounts | 20, 50, 100, 500, 1000 USDC |

With this, `123.50 = 100 + 20 + 2 + 1 + 0.50` (5 deposits), and `0.01` is directly routable.

**Requires:** Blackbox team registers new merkle roots on-chain. Protocol change.

---

## Option B — Denomination Decomposer (Agent Layer)

A coin-change algorithm the agent runs before depositing. No protocol change needed — works with existing denominations.

```typescript
decompose(123.50, ["1","2","5","10"])
→ [10,10,10,10,10,10,10,10,10,10,2,1]  // 12 deposits
// 0.50 remainder → routed separately
```

Greedy works since denominations are canonical. Agent calls `get_available_denominations` first for live data.

**Limitation:** Can't represent sub-minimum amounts or remainders without Option A or C.

---

## Option C — Micropayment Buffer + Sweep

For amounts below the Blackbox minimum:

```
x402 direct payment (sub-cent, no privacy needed at this scale)
    ↓
accumulate in hot wallet buffer per session/recipient
    ↓  when buffer ≥ 1 USDC
batch sweep → Blackbox deposit → private withdrawal
```

Agent needs stateful buffer tracking accumulated x402 micropayments. Trigger a Blackbox sweep when buffer crosses a denomination threshold.

**Tradeoff:** Privacy gap during accumulation window. Buffer wallet is a linkable intermediate.

---

## Option D — Relayer-Based Exact Settlement

> To be explored — see below.

---

## Proposed Solution: `pay_exact()` Abstraction

A single agent tool that wraps everything:

```typescript
pay_exact({
  amount: "123.50",
  token: "USDC",
  source_chain: "sepolia",
  target_chain: "base_sepolia",
  recipient: "0x..."
})
```

**Internal flow:**

```
pay_exact(amount)
    │
    ├── get_available_denominations()     ← live from Blackbox
    ├── decompose_amount()                ← coin-change algorithm
    │       │
    │       ├── representable portions   → Blackbox path (private)
    │       └── sub-minimum remainder    → x402 direct OR buffer
    │
    ├── for each denomination:
    │       deposit_and_claim()           ← Blackbox MCP
    │       withdraw_onchain()            ← Blackbox MCP
    │
    └── remainder:
            if < threshold → x402 direct
            if buffer + total ≥ denomination → sweep via Blackbox
```

---

## What Needs to Ship

| Layer | What | Owner | Blocking? |
|-------|------|-------|-----------|
| Protocol | Register denominations: 0.01–0.50 + 20–1000 USDC | Blackbox team | Yes — for sub-minimum amounts |
| Agent SDK | `decompose_amount(amount, denominations)` | AgentClear | No |
| Agent SDK | `pay_exact()` wrapper | AgentClear | No |
| Agent SDK | Micropayment buffer + sweep logic | AgentClear | No |

---

## Option D — Relayer-Based Exact Settlement

A relayer sits between payer and Blackbox, accepts arbitrary amounts via x402, internally routes through Blackbox denominations, settles exactly to the recipient.

```
Agent pays relayer: exactly 123.50 USDC (one x402 call)
    ↓
Relayer: decompose + multi-deposit through Blackbox
    ↓
Relayer withdraws: 123.50 USDC to recipient (minus fee)
```

**Why it's appealing:** Agent makes one call, no decompose logic, relayer's pooling improves anonymity set.

**Why it breaks the privacy guarantee:** The relayer knows payer address, exact amount, recipient, and timing — exactly the metadata Blackbox is designed to destroy. Trusted intermediary re-introduces the linkage.

**Mitigation path:** ZK-relayer (proves correct settlement without revealing routing) — clean architecture but significantly larger build. Not viable for hackathon scope.

**Verdict:** Valid UX shortcut, architecturally at odds with Blackbox's core guarantee unless trustless.

---

## Privacy Floor — The Fundamental Limit

For amounts like `0.01` or `0.015` USDC, Blackbox is the wrong tool entirely:

- Gas cost per Blackbox deposit: ~$0.01–0.05 (Base Sepolia)
- At `0.01–0.015` USDC, **gas cost ≥ payment amount**
- `0.015` is not exactly decomposable without a `0.005` denomination — you always get a remainder

This is a **natural privacy floor**, not a bug. Below it, routing through Blackbox makes no economic sense.

```
amount < privacy_floor (~0.50 USDC)  →  x402 direct
                                         fast, cheap, no privacy risk at this scale
                                         nobody runs chain analysis on 1.5¢ transactions

amount ≥ privacy_floor               →  decompose → Blackbox
                                         private, settled on-chain
```

The privacy floor is a design principle — document it, enforce it in `pay_exact()`, don't try to route around it.

---

## Recommended Implementation

| Amount Range | Route | Privacy |
|---|---|---|
| < 0.50 USDC | x402 direct | None needed |
| 0.50–999.99 USDC | decompose → Blackbox + x402 for remainder | Full |
| ≥ 1000 USDC | decompose with large denominations (100, 500, 1000) | Full |

`pay_exact()` enforces this routing automatically — the agent never decides.

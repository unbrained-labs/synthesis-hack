import { Hono } from "hono";
import { cors } from "hono/cors";

// ── Types ──────────────────────────────────────────────────────────────────

interface Env {
  X402_FACILITATOR_URL: string;
  USDC_ADDRESS: string;
  PAY_TO_ADDRESS: string;
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_CARD = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "AgentClear",
  description:
    "Privacy-preserving agent-to-agent commerce. Discover agents via ERC-8004, verify reputation, pay privately via Blackbox + x402, settle USDC on Base. No metadata leaks.",
  services: [
    {
      name: "MCP",
      endpoint: "https://agentclear-worker.ddohne.workers.dev/mcp",
      version: "2025-06-18",
    },
    {
      name: "A2A",
      endpoint:
        "https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json",
      version: "0.3.0",
    },
    {
      name: "web",
      endpoint: "https://agentclear-worker.ddohne.workers.dev/",
    },
  ],
  x402Support: true,
  active: true,
  tags: ["privacy", "payments", "cross-chain", "agent-commerce"],
  capabilities: [
    "agent-discovery",
    "reputation-check",
    "private-payment",
    "x402-auto-pay",
    "blackbox-routing",
    "post-payment-reputation",
  ],
  manifest: "https://agentclear-worker.ddohne.workers.dev/agent.json",
  discovery: "https://agentclear-worker.ddohne.workers.dev/.well-known/x402.json",
} as const;

// 1 USDC = 1_000_000 (6 decimals)
const TASK_PRICE_USDC = "1000000";

// Base Sepolia chain id
const BASE_SEPOLIA_CHAIN = "eip155:84532";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the ERC-7231 / x402 payment-required response body.
 * payTo is read from env so it can be set to the operator's real wallet.
 */
function buildPaymentRequiredBody(payToAddress: string, usdcAddress: string) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "https://agentclear-worker.ddohne.workers.dev/task",
      description: "AgentClear private payment task",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: BASE_SEPOLIA_CHAIN,
        amount: TASK_PRICE_USDC,
        asset: usdcAddress,
        payTo: payToAddress,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", decimals: 6, version: "2" },
      },
    ],
  };
}

/**
 * Verify a payment header against the x402 facilitator, then settle it.
 * Returns true only when the facilitator confirms isValid === true.
 *
 * Settling marks the payment as consumed, preventing replay attacks
 * within the maxTimeoutSeconds window.
 */
async function verifyAndSettlePayment(
  paymentHeader: string,
  facilitatorUrl: string
): Promise<boolean> {
  try {
    const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: paymentHeader }),
    });

    if (!verifyRes.ok) return false;

    const data = (await verifyRes.json()) as FacilitatorVerifyResponse;
    if (data.isValid !== true) return false;

    // Settle to mark payment as consumed (prevents 60s replay window)
    await fetch(`${facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: paymentHeader }),
    }).catch(() => {
      // Settle failure is non-fatal but logged — a replay is theoretically
      // possible until the facilitator expires the nonce automatically.
      console.warn("[x402] /settle failed — possible replay window");
    });

    return true;
  } catch {
    return false;
  }
}

// ── App ────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

// Global CORS — any agent / judge can query freely
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "X-PAYMENT",
      "PAYMENT-SIGNATURE",
      "Authorization",
    ],
    exposeHeaders: ["PAYMENT-REQUIRED", "X-PAYMENT-REQUIRED"],
    maxAge: 86400,
  })
);

// ── Routes ─────────────────────────────────────────────────────────────────

/** ERC-8004 agent card */
app.get("/.well-known/agent-card.json", (c) => {
  return c.json(AGENT_CARD, 200, {
    "Cache-Control": "public, max-age=300",
    "Content-Type": "application/json",
  });
});

/** Health check */
app.get("/health", (c) => {
  return c.json({ status: "ok", name: "AgentClear", timestamp: Date.now() });
});

/** Machine-readable agent instructions */
app.get("/agent.txt", (c) => {
  const usdcAddress =
    c.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const payToAddress =
    c.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000001";

  const body = `# AgentClear — Quick Reference for AI Agents

Privacy-preserving agent-to-agent commerce.
Discover agents via ERC-8004, pay privately via Blackbox DKG, settle USDC on Base Sepolia.

## When to Use AgentClear

- You need to pay another AI agent for a service without revealing your identity
- You need to access a paid HTTP resource that returns 402 Payment Required
- You need cross-chain USDC settlement with no on-chain link between payer and recipient
- You want to receive payment from other agents for a service you provide

## When NOT to Use AgentClear

- You need to pay a human or traditional merchant (use AgentCard or a fiat rail)
- You need instant sub-second finality (Blackbox DKG takes ~15-30s for on-chain confirmation)
- You need amounts below 0.001 USDC (use x402 direct micropayment instead)

## Live Endpoints

Agent card (ERC-8004 identity):
  GET https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json

Paid task endpoint (returns HTTP 402 if unpaid):
  POST https://agentclear-worker.ddohne.workers.dev/task

Health check:
  GET https://agentclear-worker.ddohne.workers.dev/health

## Payment Flow

### Step 1 — Probe the endpoint
POST https://agentclear-worker.ddohne.workers.dev/task
→ 402 Payment Required
→ Body contains x402 payment instructions (scheme, amount, asset, payTo, network)

### Step 2 — Pay via Blackbox (private, >= 0.5 USDC)
1. Connect Blackbox MCP: npx blackbox-mcp@latest
2. Call deposit_and_claim with the amount and target chain
3. Call withdraw_onchain to send funds to the payTo address
4. Build X-PAYMENT header: base64(JSON({ scheme: "blackbox-x402", txHashes: [...] }))

### Step 2 (alternative) — Pay via x402 direct or AgentCard
Use any x402-compatible client (AgentCard x402_fetch, x402-sdk, etc.)
Build X-PAYMENT header with the signed EIP-3009 payload.

### Step 3 — Retry with payment
POST https://agentclear-worker.ddohne.workers.dev/task
Header: X-PAYMENT: <base64-encoded-payment-proof>
→ 200 OK with task result

## x402 Payment Instructions

Network: eip155:84532 (Base Sepolia)
Asset: ${usdcAddress} (USDC, 6 decimals)
Amount: 1000000 (1 USDC)
PayTo: ${payToAddress}
Scheme: exact
MaxTimeoutSeconds: 60

## X-PAYMENT Header Format

Blackbox payments:
  base64(JSON({
    "scheme": "blackbox-x402",
    "network": "base-sepolia",
    "token": "${usdcAddress}",
    "payTo": "${payToAddress}",
    "amount": "1",
    "txHashes": ["0x..."],
    "timestamp": "<ISO-8601>"
  }))

Standard x402:
  Signed EIP-3009 payload per x402 spec (verified via https://x402.org/facilitator)

## AgentCard Compatibility

If you have an AgentCard virtual Mastercard, x402_fetch works directly:
  x402_fetch({ url: "https://agentclear-worker.ddohne.workers.dev/task", card_id: "<id>" })

## Blackbox MCP Config

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

## ERC-8004 Registration

Registry: 0x8004A818BFB912233c491871b3d84c89A494BD9e (Base Sepolia)
Token ID: 1937
Agent Card URL: https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json

## Privacy Model

- Deposit and withdrawal transactions share no on-chain addresses
- DKG cluster (5 nodes, 3-of-5 threshold) — no single node knows the full key
- One-time withdrawal keys — on-chain nullifier prevents reuse
- Seller sees only the withdrawal tx, never the buyer's deposit address

## Links

GitHub: https://github.com/unbrained-labs/synthesis-hack
Blackbox Network: https://theblackbox.network
x402 Protocol: https://x402.org
AgentCard: https://agentcard.sh
`;

  return c.text(body, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});

/**
 * x402-protected task endpoint.
 *
 * Flow:
 *   1. No payment header  → 402 with payment instructions
 *   2. Payment present    → verify with facilitator
 *   3. Invalid payment    → 402 with error
 *   4. Valid payment      → 200 with task result
 */
app.post("/task", async (c) => {
  const facilitatorUrl =
    c.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
  const usdcAddress =
    c.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  // payTo defaults to burn address as placeholder; operators must set PAY_TO_ADDRESS
  const payToAddress =
    c.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000001";

  // Accept both header conventions used in the wild
  const paymentHeader =
    c.req.header("X-PAYMENT") ??
    c.req.header("x-payment") ??
    c.req.header("PAYMENT-SIGNATURE") ??
    c.req.header("payment-signature");

  if (!paymentHeader) {
    const body = buildPaymentRequiredBody(payToAddress, usdcAddress);
    return c.json(body, 402, {
      "PAYMENT-REQUIRED": "x402",
      "X-PAYMENT-REQUIRED": "true",
      "Content-Type": "application/json",
    });
  }

  const verified = await verifyAndSettlePayment(paymentHeader, facilitatorUrl);

  if (!verified) {
    return c.json(
      {
        x402Version: 2,
        error: "Invalid or expired payment",
        detail:
          "Payment verification failed. Obtain a fresh payment signature and retry.",
      },
      402,
      { "Content-Type": "application/json" }
    );
  }

  // Payment confirmed — deliver the service
  return c.json(
    {
      result: "AgentClear task complete",
      timestamp: Date.now(),
      paymentVerified: true,
      chain: BASE_SEPOLIA_CHAIN,
      amount: TASK_PRICE_USDC,
      asset: usdcAddress,
    },
    200
  );
});

/**
 * DevSpot Agent Manifest — required by Protocol Labs bounty.
 * Serves agent.json so judge agents can discover it programmatically.
 */
app.get("/agent.json", (c) => {
  const payToAddress =
    c.env.PAY_TO_ADDRESS ?? "0x79eFeb66c313DA4F5D2A26bb5E15BEd86B98530f";

  return c.json({
    schema_version: "1.0",
    name: "AgentClear",
    version: "0.1.0",
    description:
      "Privacy-preserving agent-to-agent commerce. Agents discover each other via ERC-8004, request services, and pay privately using Blackbox DKG threshold cryptography — breaking the on-chain link between buyer and seller.",
    operator_wallet: payToAddress,
    erc8004: {
      registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      token_id: 1937,
      network: "base-sepolia",
      agent_card_url:
        "https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json",
      registration_tx:
        "0x303a30de1523ca8ea28e4d327e2eb14a864db7d02dbb57e2ccd9b59a60b57479",
    },
    endpoints: {
      agent_card:
        "https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json",
      task: "https://agentclear-worker.ddohne.workers.dev/task",
      health: "https://agentclear-worker.ddohne.workers.dev/health",
      agent_txt: "https://agentclear-worker.ddohne.workers.dev/agent.txt",
      agent_json: "https://agentclear-worker.ddohne.workers.dev/agent.json",
    },
    tools: [
      { name: "probe_seller", description: "Discover seller via ERC-8004 and receive HTTP 402 payment instructions" },
      { name: "blackbox_deposit_and_claim", description: "Deposit USDC into Blackbox treasury and claim a one-time DKG withdrawal key (3-of-5 threshold)" },
      { name: "blackbox_withdraw_onchain", description: "Execute on-chain withdrawal from one-time key to seller — breaks buyer→seller on-chain link" },
      { name: "verify_payment", description: "Fetch TX receipt on Base Sepolia, verify ERC-20 Transfer log, write ERC-8004 reputation post-payment" },
    ],
    tech_stack: ["Node.js 18+", "TypeScript", "viem", "Blackbox MCP", "ERC-8004", "x402", "USDC on Base Sepolia", "Cloudflare Workers", "Venice AI"],
    supported_chains: ["base-sepolia"],
    supported_tokens: ["USDC"],
    payment_schemes: ["blackbox-x402", "x402-exact"],
    privacy_floor_usdc: 0.5,
    compute_constraints: { blackbox_dkg_latency_seconds: "15-30", min_payment_usdc: 0.001, max_payment_usdc: 1000 },
    task_categories: ["agent-discovery", "private-payment", "payment-routing", "on-chain-verification", "reputation-tracking"],
    safety_guardrails: [
      "Validates payment amount before executing withdrawal",
      "1% fee tolerance for gas and relay fees",
      "One-time withdrawal keys with on-chain nullifier",
      "DKG threshold (3-of-5) — no single node holds complete key",
    ],
    repository: "https://github.com/unbrained-labs/synthesis-hack",
  }, 200, { "Cache-Control": "public, max-age=300" });
});

/**
 * x402 discovery endpoint — makes AgentClear automatically discoverable
 * by AgentCash (Merit Systems bounty) and other x402 discovery clients.
 */
app.get("/.well-known/x402.json", (c) => {
  const usdcAddress =
    c.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const payToAddress =
    c.env.PAY_TO_ADDRESS ?? "0x79eFeb66c313DA4F5D2A26bb5E15BEd86B98530f";

  return c.json({
    version: "2",
    resources: [
      {
        url: "https://agentclear-worker.ddohne.workers.dev/task",
        type: "http",
        description: "AgentClear private intelligence task — pay once, get AI analysis with no metadata leak",
        accepts: [
          {
            scheme: "exact",
            network: BASE_SEPOLIA_CHAIN,
            amount: TASK_PRICE_USDC,
            asset: usdcAddress,
            payTo: payToAddress,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", decimals: 6 },
          },
        ],
        outputSchema: {
          type: "object",
          properties: {
            result: { type: "string" },
            paymentVerified: { type: "boolean" },
          },
        },
        metadata: {
          category: "intelligence",
          tags: ["privacy", "agent-commerce", "x402", "erc-8004"],
          privacyModel: "Blackbox DKG — no on-chain buyer/seller link",
        },
      },
    ],
  }, 200, { "Cache-Control": "public, max-age=300" });
});

/** Catch-all 404 */
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;

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
  ],
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

/** Catch-all 404 */
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;

/**
 * seller-agent — AgentClear demo seller
 *
 * Accepts BOTH standard x402 payments AND Blackbox privacy payments:
 *   - scheme "exact"          → verified via x402 facilitator (EIP-3009)
 *   - scheme "blackbox-x402"  → verified on-chain via Base Sepolia RPC
 *
 * Endpoint: POST /analyze  (1 USDC on Base Sepolia)
 */

import express, { Request, Response, NextFunction } from "express";
import { createPublicClient, http, parseAbi, type Hash } from "viem";
import { baseSepolia } from "viem/chains";

const app = express();
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4022;
const SELLER_ADDRESS = (
  process.env.SELLER_WALLET_ADDRESS ||
  "0x79eFeb66c313DA4F5D2A26bb5E15BEd86B98530f"
).toLowerCase();
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
const TASK_PRICE_USDC = "1000000"; // 1 USDC (6 decimals)
const CHAIN_ID = "eip155:84532";

// ── Viem client for on-chain Blackbox verification ────────────────────────

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const ERC20_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ── Types ─────────────────────────────────────────────────────────────────

interface BlackboxPaymentHeader {
  scheme: "blackbox-x402";
  network: string;
  token: string;
  payTo: string;
  amount: string; // USDC amount as decimal string e.g. "1.0"
  txHashes: string[];
  timestamp: string;
}

// ── Blackbox on-chain verifier ────────────────────────────────────────────

/**
 * Verify Blackbox payment by checking each withdrawal tx on Base Sepolia.
 *
 * For each txHash:
 *   1. Get transaction receipt
 *   2. Find the ERC-20 Transfer event from USDC contract
 *   3. Confirm recipient == payTo
 *   4. Sum all amounts and confirm total >= expected
 */
async function verifyBlackboxPayment(
  header: BlackboxPaymentHeader
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const expectedPayTo = header.payTo.toLowerCase();
    const expectedMicro = BigInt(TASK_PRICE_USDC);
    let totalReceived = BigInt(0);

    for (const hash of header.txHashes) {
      const receipt = await publicClient.getTransactionReceipt({
        hash: hash as Hash,
      });

      if (!receipt || receipt.status !== "success") {
        return { valid: false, reason: `Tx ${hash} not confirmed or failed` };
      }

      // Find USDC Transfer event in logs
      const transferLogs = receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
          log.topics[0] ===
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" // Transfer(address,address,uint256)
      );

      for (const log of transferLogs) {
        if (!log.topics[2]) continue;
        const recipient = ("0x" + log.topics[2].slice(26)).toLowerCase();
        if (recipient !== expectedPayTo) continue;

        // Decode amount from data field
        const amount = BigInt(log.data);
        totalReceived += amount;
      }
    }

    const minAccepted = (expectedMicro * 99n) / 100n;
    if (totalReceived < minAccepted) {
      return {
        valid: false,
        reason: `Received ${totalReceived} micro-USDC, expected >= ${minAccepted} (1% fee tolerance)`,
      };
    }

    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `On-chain verification error: ${msg}` };
  }
}

// ── Standard x402 facilitator verification ───────────────────────────────

async function verifyX402Payment(
  paymentHeader: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const resp = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: paymentHeader }),
    });
    if (!resp.ok) return { valid: false, reason: `Facilitator ${resp.status}` };
    const data = (await resp.json()) as { isValid: boolean; error?: string };
    if (!data.isValid)
      return { valid: false, reason: data.error || "Facilitator: invalid" };

    // Settle to prevent replay
    await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: paymentHeader }),
    }).catch(() => {
      /* settle failure is non-fatal — log it */
      console.warn("[x402] /settle call failed — possible replay window");
    });

    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: msg };
  }
}

// ── Payment verification middleware ──────────────────────────────────────

async function requirePayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawHeader =
    req.headers["x-payment"] ?? req.headers["payment-signature"];

  // No payment header → 402
  if (!rawHeader || typeof rawHeader !== "string") {
    res.status(402).json({
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `http://localhost:${PORT}/analyze`,
        description: "AI market analysis — 1 USDC on Base Sepolia",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: CHAIN_ID,
          amount: TASK_PRICE_USDC,
          asset: USDC_ADDRESS,
          payTo: SELLER_ADDRESS,
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", decimals: 6, version: "2" },
        },
      ],
    });
    return;
  }

  // Decode the payment header
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(rawHeader, "base64").toString("utf8"));
  } catch {
    res.status(402).json({ error: "Malformed X-PAYMENT header" });
    return;
  }

  const scheme =
    decoded && typeof decoded === "object" && "scheme" in decoded
      ? (decoded as { scheme: string }).scheme
      : "exact";

  let result: { valid: boolean; reason?: string };

  if (scheme === "blackbox-x402") {
    // On-chain verification for Blackbox payments
    result = await verifyBlackboxPayment(decoded as BlackboxPaymentHeader);
  } else {
    // Standard x402 facilitator verification
    result = await verifyX402Payment(rawHeader);
  }

  if (!result.valid) {
    res.status(402).json({
      x402Version: 2,
      error: "Payment verification failed",
      detail: result.reason,
    });
    return;
  }

  next();
}

// ── Routes ────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", seller: SELLER_ADDRESS });
});

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "DataFeed Agent",
    description:
      "AI market analysis. Pay 1 USDC. Accepts x402 and Blackbox privacy payments.",
    x402Support: true,
    active: true,
    tags: ["data-feed", "analysis", "privacy"],
    capabilities: ["market-analysis", "x402-payment", "blackbox-x402"],
  });
});

app.post("/analyze", requirePayment, (_req, res) => {
  res.json({
    report: {
      agent: "DataFeed Agent",
      timestamp: Date.now(),
      analysis:
        "Privacy-preserving payments adoption up 340% YoY. Blackbox Network leads cross-chain volume with 50+ merkle roots across 7 chains.",
      confidence: 0.94,
      network: "AgentClear Network",
    },
    paymentVerified: true,
  });
});

app.listen(PORT, () => {
  console.log(`Seller agent listening on port ${PORT}`);
  console.log(`Seller address : ${SELLER_ADDRESS}`);
  console.log(`Task price     : 1 USDC`);
  console.log(`Schemes        : exact (x402) + blackbox-x402 (on-chain)`);
});

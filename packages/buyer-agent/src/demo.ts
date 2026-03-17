/**
 * demo.ts — Full AgentClear privacy payment demo orchestration.
 *
 * Flow:
 *  1. Setup CDP wallet (buyer)
 *  2. Request faucet USDC on Base Sepolia
 *  3. Import wallet into Blackbox MCP
 *  4. Probe seller endpoint → get 402 + payment instructions
 *  5. Check amount vs privacy floor
 *     < 0.50 USDC → x402 direct payment
 *     >= 0.50 USDC → Blackbox deposit → claim → withdraw to seller payTo
 *  6. Build X-PAYMENT header from tx proof
 *  7. Retry request with X-PAYMENT header
 *  8. Receive and display service response
 *  9. Print full flow summary
 */

import { createBuyerWallet, printFaucetLink } from "./wallet.js";
import {
  connectBlackbox,
  disconnectBlackbox,
  checkHealth,
  importWallet,
  payExact,
  PRIVACY_FLOOR,
  type PayResult,
} from "./blackbox.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal subset of an x402 PaymentRequiredResponse we need. */
interface PaymentInstructions {
  /** Amount in USDC (string, e.g. "1.00") */
  amount: string;
  /** Address to send funds to */
  payTo: string;
  /** Chain identifier */
  network?: string;
  /** Token contract address */
  token?: string;
  /** x402 scheme used (e.g. "exact") */
  scheme?: string;
  /** Any additional fields echoed back by the seller */
  [key: string]: unknown;
}

interface DemoResult {
  /** Buyer's on-chain address */
  buyerAddress: string;
  /** Seller URL that was probed */
  sellerUrl: string;
  /** Raw 402 payment instructions from seller */
  paymentInstructions: PaymentInstructions;
  /** Whether Blackbox was used (true) or x402 direct (false) */
  usedBlackbox: boolean;
  /** Withdrawal tx hashes (what the seller sees) */
  txHashes: string[];
  /** Deposit tx hashes (buyer → Blackbox treasury, different chain/address from txHashes) */
  depositTxHashes: string[];
  /** Final service response body */
  serviceResponse: unknown;
  /** ISO timestamp */
  completedAt: string;
  /** Source chain for deposit (may differ from target) */
  sourceChain: string;
  /** Target chain for withdrawal (seller's chain) */
  targetChain: string;
}

// ---------------------------------------------------------------------------
// Build X-PAYMENT header
// ---------------------------------------------------------------------------

/**
 * Construct the X-PAYMENT header value that the seller expects.
 *
 * For Blackbox payments this is a JSON blob containing the withdrawal tx
 * hashes as proof of payment.  The seller-agent verifies on-chain.
 *
 * Format:
 *  {
 *    "scheme": "blackbox-x402" | "x402",
 *    "network": "base-sepolia",
 *    "payTo": "<seller address>",
 *    "amount": "<USDC amount>",
 *    "txHashes": ["0x…"]
 *  }
 */
function buildPaymentHeader(
  instructions: PaymentInstructions,
  txHashes: string[],
  usedBlackbox: boolean
): string {
  const payload = {
    scheme: usedBlackbox ? "blackbox-x402" : "x402",
    network: instructions.network ?? "base-sepolia",
    token: instructions.token ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: instructions.payTo,
    amount: instructions.amount,
    txHashes,
    timestamp: new Date().toISOString(),
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// ---------------------------------------------------------------------------
// Probe seller — parse 402 response
// ---------------------------------------------------------------------------

async function probeSeller(
  sellerUrl: string
): Promise<{ status: number; instructions: PaymentInstructions | null }> {
  const response = await fetch(sellerUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AgentClear-Buyer/0.1.0",
    },
    body: JSON.stringify({}),
  });

  if (response.status !== 402) {
    return { status: response.status, instructions: null };
  }

  let raw: Record<string, unknown> | null = null;

  try {
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    const header = response.headers.get("X-Payment-Required");
    if (header) {
      try {
        raw = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
  }

  if (!raw) return { status: 402, instructions: null };

  // x402 v2 format: payment details live in accepts[0]
  const accepts = Array.isArray(raw.accepts)
    ? (raw.accepts as Record<string, unknown>[])
    : null;

  const accept0 = accepts?.[0];

  const rawAmount = accept0?.amount ?? raw.amount;
  const rawDecimals = (accept0?.extra as Record<string, unknown> | undefined)?.decimals ?? 6;
  const decimals = typeof rawDecimals === "number" ? rawDecimals : 6;

  // Convert micro-units to human-readable if amount looks like integer micro-USDC
  let amount: string;
  if (typeof rawAmount === "string" && rawAmount.includes(".")) {
    amount = rawAmount;
  } else {
    const micro = parseFloat(String(rawAmount ?? "0"));
    amount = (micro / Math.pow(10, decimals)).toString();
  }

  const payTo = String(accept0?.payTo ?? raw.payTo ?? "");
  const network = String(accept0?.network ?? raw.network ?? "base-sepolia");
  const token = String(accept0?.asset ?? raw.token ?? "");

  const instructions: PaymentInstructions = {
    amount,
    payTo,
    network,
    token,
    scheme: String(accept0?.scheme ?? "exact"),
    ...raw,
  };

  return { status: 402, instructions };
}

// ---------------------------------------------------------------------------
// Retry with payment header
// ---------------------------------------------------------------------------

async function retryWithPayment(
  sellerUrl: string,
  paymentHeader: string
): Promise<unknown> {
  const response = await fetch(sellerUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "AgentClear-Buyer/0.1.0",
      "X-PAYMENT": paymentHeader,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Seller rejected payment (${response.status}): ${body}`
    );
  }

  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

// ---------------------------------------------------------------------------
// Main demo orchestration
// ---------------------------------------------------------------------------

export async function runDemo(): Promise<DemoResult> {
  const sellerUrl = process.env.SELLER_URL ?? "http://localhost:4022/analyze";
  const walletName = "agentclear-buyer";
  const walletPassword = process.env.WALLET_PASSWORD ?? "agentclear-demo-2026";
  // SOURCE_CHAIN: chain where buyer holds funds (deposit side)
  // TARGET_CHAIN: chain where seller receives payment (withdrawal side)
  // Cross-chain example: SOURCE_CHAIN=polygon-amoy TARGET_CHAIN=base_sepolia
  const sourceChain = process.env.SOURCE_CHAIN ?? "base_sepolia";
  const targetChain = process.env.TARGET_CHAIN ?? "base_sepolia";

  console.log("═══════════════════════════════════════════════════");
  console.log("  AgentClear — Privacy Payment Demo");
  console.log("═══════════════════════════════════════════════════\n");

  // ------------------------------------------------------------------
  // Step 1: Wallet setup (viem — no CDP portal needed)
  // ------------------------------------------------------------------
  console.log("Step 1: Setup buyer wallet");
  const wallet = createBuyerWallet();
  console.log(`  Buyer address : ${wallet.address}`);
  console.log(`  Wallet name   : ${wallet.name}\n`);

  // ------------------------------------------------------------------
  // Step 2: Faucet info
  // ------------------------------------------------------------------
  console.log("Step 2: Faucet info (fund buyer if needed)");
  printFaucetLink(wallet.address);
  console.log();

  // ------------------------------------------------------------------
  // Step 3: Connect Blackbox MCP + import wallet
  // ------------------------------------------------------------------
  console.log("Step 3: Connect Blackbox MCP");
  const bb = await connectBlackbox();
  console.log("  Blackbox MCP connected");

  console.log("  Checking node health …");
  await checkHealth(bb);

  // Import wallet so Blackbox can sign deposits on our behalf.
  // In a real flow we would export the CDP account's private key here.
  // For the demo we pass a placeholder — real key injection would come
  // from `cdp.evm.exportAccount()` or similar when CDP SDK supports it.
  const PLACEHOLDER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY ?? "";
  if (PLACEHOLDER_PRIVATE_KEY) {
    console.log("  Importing wallet into Blackbox …");
    await importWallet(bb, walletName, walletPassword, PLACEHOLDER_PRIVATE_KEY);
  } else {
    console.log(
      "  BUYER_PRIVATE_KEY not set — skipping Blackbox wallet import (demo mode)"
    );
  }
  console.log();

  // ------------------------------------------------------------------
  // Step 4: Probe seller → get 402 + payment instructions
  // ------------------------------------------------------------------
  console.log(`Step 4: Probe seller endpoint → ${sellerUrl}`);
  const { status, instructions } = await probeSeller(sellerUrl);

  if (status !== 402 || !instructions) {
    throw new Error(
      `Expected HTTP 402 from seller but got ${status}. ` +
        "Is the seller agent running?"
    );
  }

  console.log(`  Received HTTP 402`);
  console.log(`  Amount  : ${instructions.amount} USDC`);
  console.log(`  Pay to  : ${instructions.payTo}`);
  console.log(`  Network : ${instructions.network ?? "base-sepolia"}`);
  console.log();

  // ------------------------------------------------------------------
  // Step 5–6: Route payment
  // ------------------------------------------------------------------
  const amountNum = parseFloat(instructions.amount);
  const useBlackbox = amountNum >= PRIVACY_FLOOR;

  let payResult: PayResult;

  if (useBlackbox) {
    console.log(
      `Step 5-6: Amount ${instructions.amount} USDC >= ${PRIVACY_FLOOR} USDC → Blackbox privacy payment`
    );
    payResult = await payExact(
      bb,
      instructions.amount,
      instructions.payTo,
      walletName,
      walletPassword,
      sourceChain,
      targetChain
    );
  } else {
    console.log(
      `Step 5-6: Amount ${instructions.amount} USDC < ${PRIVACY_FLOOR} USDC → x402 direct payment`
    );
    // x402 direct: use the signed EIP-3009 flow (not implemented in demo — requires funded wallet)
    console.log(`  [x402 direct] ${instructions.amount} USDC to ${instructions.payTo}`);
    payResult = { depositTxHashes: [], withdrawTxHashes: [] };
  }

  const txHashes = payResult.withdrawTxHashes;
  console.log(`  Payment complete. Withdraw tx: [${txHashes.join(", ")}]\n`);

  // ------------------------------------------------------------------
  // Step 7: Build X-PAYMENT header + retry
  // ------------------------------------------------------------------
  console.log("Step 7: Retry request with X-PAYMENT header");
  const paymentHeader = buildPaymentHeader(instructions, txHashes, useBlackbox);
  console.log(`  X-PAYMENT header built (${paymentHeader.length} chars)`);

  const serviceResponse = await retryWithPayment(sellerUrl, paymentHeader);
  console.log();

  // ------------------------------------------------------------------
  // Step 8: Service response
  // ------------------------------------------------------------------
  console.log("Step 8: Service response received");
  console.log(
    "  ",
    typeof serviceResponse === "string"
      ? serviceResponse
      : JSON.stringify(serviceResponse, null, 2)
  );
  console.log();

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  await disconnectBlackbox(bb);

  // ------------------------------------------------------------------
  // Step 9: Summary
  // ------------------------------------------------------------------
  const result: DemoResult = {
    buyerAddress: wallet.address,
    sellerUrl,
    paymentInstructions: instructions,
    usedBlackbox: useBlackbox,
    txHashes,
    depositTxHashes: payResult.depositTxHashes,
    serviceResponse,
    completedAt: new Date().toISOString(),
    sourceChain,
    targetChain,
  };

  return result;
}

/** Pretty-print the final flow summary. */
export function printSummary(result: DemoResult): void {
  console.log("═══════════════════════════════════════════════════");
  console.log("  AgentClear — Flow Summary");
  console.log("═══════════════════════════════════════════════════");
  const crossChain = result.sourceChain !== result.targetChain;
  console.log(`  Buyer address     : ${result.buyerAddress}`);
  console.log(`  Seller URL        : ${result.sellerUrl}`);
  console.log(`  Amount paid       : ${result.paymentInstructions.amount} USDC`);
  console.log(`  Recipient         : ${result.paymentInstructions.payTo}`);
  if (crossChain) {
    console.log(`  Deposit chain     : ${result.sourceChain}`);
    console.log(`  Settlement chain  : ${result.targetChain}`);
  }
  console.log(
    `  Privacy routing   : ${result.usedBlackbox ? `Blackbox DKG${crossChain ? ` (cross-chain: ${result.sourceChain} → ${result.targetChain})` : ""}` : "x402 direct"}`
  );
  console.log(`  Tx hashes         :`);
  for (const hash of result.txHashes) {
    console.log(`    ${hash}`);
  }
  console.log(`  Completed at      : ${result.completedAt}`);
  console.log("═══════════════════════════════════════════════════");
  if (result.usedBlackbox) {
    const depositHash = result.depositTxHashes[0];
    const withdrawHash = result.txHashes[0];
    console.log("\n── What a competitor sees on-chain ─────────────────");
    if (crossChain) {
      console.log(`  Deposit:    ${depositHash?.slice(0, 20)}...  chain: ${result.sourceChain}  buyer: UNKNOWN`);
      console.log(`  Withdrawal: ${withdrawHash?.slice(0, 20)}...  chain: ${result.targetChain}  source: UNKNOWN`);
      console.log("  Different chains. Different addresses. Zero graph edge.");
    } else {
      console.log(`  Deposit:    ${depositHash?.slice(0, 20)}...  buyer: UNKNOWN`);
      console.log(`  Withdrawal: ${withdrawHash?.slice(0, 20)}...  source: UNKNOWN`);
      console.log("  No common address. No link. No graph edge.");
    }
    console.log("────────────────────────────────────────────────────\n");
  }
}

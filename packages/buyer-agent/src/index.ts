/**
 * index.ts — Entry point for the AgentClear buyer agent demo.
 *
 * Run:
 *   npm run demo            (via tsx, no build step)
 *   npm run build && npm start
 *
 * Required env vars — copy .env.example to .env and fill in:
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET
 *   DKG_NODE_1 … DKG_NODE_5
 *   SELLER_URL (default: http://localhost:4022)
 *   WALLET_PASSWORD (default: agentclear-demo-2026)
 *
 * Optional:
 *   BUYER_PRIVATE_KEY  — raw private key exported from CDP wallet.
 *                        If set, the wallet is registered with Blackbox MCP
 *                        so it can sign on-chain deposit transactions.
 */

import "dotenv/config";
import { runDemo, printSummary } from "./demo.js";

async function main(): Promise<void> {
  try {
    const result = await runDemo();
    printSummary(result);
    process.exit(0);
  } catch (err: unknown) {
    console.error("\nDemo failed:");
    if (err instanceof Error) {
      console.error("  ", err.message);
      if (process.env.DEBUG) {
        console.error(err.stack);
      }
    } else {
      console.error("  ", err);
    }
    process.exit(1);
  }
}

main();

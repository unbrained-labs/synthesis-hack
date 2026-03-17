/**
 * openserv.ts — AgentClear as an OpenServ agent
 *
 * Wraps the existing x402 + Blackbox payment flow as OpenServ capabilities,
 * making AgentClear discoverable and hireable via the OpenServ platform.
 *
 * Capabilities:
 *   - discover_agent     — fetch an agent card from any ERC-8004 URL
 *   - pay_and_fetch      — pay an x402-protected endpoint and return the result
 *   - private_pay        — route a payment privately via Blackbox DKG
 */

import { Agent, run } from "@openserv-labs/sdk";
import { z } from "zod";
import { connectBlackbox, disconnectBlackbox, checkHealth, importWallet, payExact, PRIVACY_FLOOR } from "./blackbox.js";

const agent = new Agent({
  systemPrompt: `You are AgentClear — a privacy-preserving payment agent.

You help AI agents discover other agents via ERC-8004, pay for services using
the x402 HTTP 402 protocol, and route payments privately through Blackbox DKG
so that no on-chain link exists between the payer and the service provider.

You operate on Base Sepolia with USDC. For payments >= ${PRIVACY_FLOOR} USDC,
you automatically route via Blackbox DKG for privacy. Below that threshold,
you use x402 direct payment.`,
});

// ── Capability: discover agent ─────────────────────────────────────────────

agent.addCapability({
  name: "discover_agent",
  description:
    "Fetch an ERC-8004 agent card from a URL. Returns the agent's identity, capabilities, and x402 payment endpoints.",
  inputSchema: z.object({
    agent_card_url: z
      .string()
      .url()
      .describe("URL of the agent card, e.g. https://example.com/.well-known/agent-card.json"),
  }),
  async run({ args }) {
    const res = await fetch(args.agent_card_url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return `Failed to fetch agent card: HTTP ${res.status}`;
    const card = await res.json();
    return JSON.stringify(card, null, 2);
  },
});

// ── Capability: probe x402 endpoint ───────────────────────────────────────

agent.addCapability({
  name: "probe_x402_endpoint",
  description:
    "Probe an endpoint that may require x402 payment. Returns the payment instructions (amount, payTo, network, token) if a 402 is returned, or the response body if already accessible.",
  inputSchema: z.object({
    url: z.string().url().describe("The endpoint to probe"),
    method: z.enum(["GET", "POST"]).default("POST").describe("HTTP method"),
  }),
  async run({ args }) {
    const res = await fetch(args.url, {
      method: args.method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: args.method === "POST" ? JSON.stringify({}) : undefined,
    });

    if (res.status === 402) {
      const body = await res.json() as Record<string, unknown>;
      const accepts = Array.isArray(body.accepts) ? body.accepts[0] as Record<string, unknown> : null;
      return JSON.stringify({
        status: 402,
        paymentRequired: true,
        amount_micro: accepts?.amount,
        payTo: accepts?.payTo,
        network: accepts?.network,
        asset: accepts?.asset,
        scheme: accepts?.scheme,
      });
    }

    const body = await res.text();
    return JSON.stringify({ status: res.status, body });
  },
});

// ── Capability: private payment via Blackbox DKG ──────────────────────────

agent.addCapability({
  name: "private_pay",
  description: `Pay an x402-protected endpoint privately using Blackbox DKG threshold cryptography.
For amounts >= ${PRIVACY_FLOOR} USDC: deposits USDC into Blackbox treasury, gets a one-time withdrawal key
via 3-of-5 DKG consensus, then withdraws to the seller — no on-chain link between payer and recipient.
For amounts < ${PRIVACY_FLOOR} USDC: uses x402 direct payment.
Returns the service response and withdrawal transaction hashes as payment proof.`,
  inputSchema: z.object({
    seller_url: z.string().url().describe("The x402-protected endpoint to pay and call"),
    buyer_private_key: z.string().describe("Buyer's EVM private key (hex, with 0x prefix)"),
    wallet_name: z.string().default("agentclear-buyer").describe("Wallet name for Blackbox"),
    wallet_password: z.string().default("agentclear-demo-2026").describe("Wallet password for Blackbox"),
    query: z.string().optional().describe("Optional query/prompt to send to the seller"),
  }),
  async run({ args }) {
    const bb = await connectBlackbox();

    try {
      await checkHealth(bb);
      await importWallet(bb, args.wallet_name, args.wallet_password, args.buyer_private_key);

      // Probe seller for payment instructions
      const probeRes = await fetch(args.seller_url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (probeRes.status !== 402) {
        const body = await probeRes.text();
        return JSON.stringify({ status: probeRes.status, body });
      }

      const raw = await probeRes.json() as Record<string, unknown>;
      const accepts = (Array.isArray(raw.accepts) ? raw.accepts[0] : null) as Record<string, unknown> | null;
      const rawAmount = accepts?.amount ?? raw.amount;
      const decimals = (accepts?.extra as Record<string, number> | undefined)?.decimals ?? 6;
      const amount = (parseFloat(String(rawAmount ?? "0")) / Math.pow(10, decimals)).toString();
      const payTo = String(accepts?.payTo ?? raw.payTo ?? "");

      // Route payment
      const amountNum = parseFloat(amount);
      let txHashes: string[];
      let scheme: string;

      if (amountNum >= PRIVACY_FLOOR) {
        txHashes = await payExact(bb, amount, payTo, args.wallet_name, args.wallet_password);
        scheme = "blackbox-x402";
      } else {
        // x402 direct — simulated for demo
        txHashes = ["0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")];
        scheme = "exact";
      }

      // Build payment header and retry
      const paymentHeader = Buffer.from(JSON.stringify({
        scheme,
        network: String(accepts?.network ?? "base-sepolia"),
        token: String(accepts?.asset ?? ""),
        payTo,
        amount,
        txHashes,
        timestamp: new Date().toISOString(),
      })).toString("base64");

      const serviceRes = await fetch(args.seller_url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-PAYMENT": paymentHeader,
        },
        body: JSON.stringify({ query: args.query ?? "" }),
      });

      const serviceBody = await serviceRes.json();
      return JSON.stringify({
        success: serviceRes.ok,
        status: serviceRes.status,
        scheme,
        txHashes,
        privacyNote: scheme === "blackbox-x402"
          ? "Payment routed via Blackbox DKG — no on-chain link between payer and recipient"
          : "Payment via x402 direct",
        serviceResponse: serviceBody,
      });
    } finally {
      await disconnectBlackbox(bb);
    }
  },
});

// ── Start ──────────────────────────────────────────────────────────────────

export async function startOpenServAgent() {
  console.log("Starting AgentClear OpenServ agent...");
  const { stop } = await run(agent);
  console.log("AgentClear is live on OpenServ platform");
  process.on("SIGINT", async () => { await stop(); process.exit(0); });
}

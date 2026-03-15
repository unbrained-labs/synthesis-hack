/**
 * check-health.ts
 *
 * Verifies all external systems are reachable before running the AgentClear demo.
 *
 * Checks:
 *   1. CDP API connectivity (list EVM accounts)
 *   2. Blackbox DKG nodes health (node1 through node5)
 *   3. x402 facilitator reachability
 *   4. Base Sepolia RPC (eth_chainId)
 *
 * Run: npm run health
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import dotenv from "dotenv";
import path from "path";

// node-fetch v3 is ESM-only; import via dynamic require workaround for ts-node CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fetch = (...args: Parameters<typeof import("node-fetch").default>) =>
  import("node-fetch").then(({ default: f }) => f(...args));

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ── Types ─────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  detail: string;
  latencyMs?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function timedFetch(
  url: string,
  options?: Parameters<typeof fetch>[1],
  timeoutMs = 8000
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkCdp(): Promise<CheckResult> {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;

  if (!apiKeyId || !apiKeySecret) {
    return {
      name: "CDP API",
      status: "FAIL",
      detail: "CDP_API_KEY_ID or CDP_API_KEY_SECRET not set in .env",
    };
  }

  const start = Date.now();
  try {
    const cdp = new CdpClient({ apiKeyId, apiKeySecret });
    // A lightweight call: list first page of accounts
    const page = await cdp.evm.listAccounts({ pageSize: 1 });
    const count = page.accounts?.length ?? 0;
    return {
      name: "CDP API",
      status: "OK",
      detail: `Connected — ${count} account(s) visible`,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "CDP API",
      status: "FAIL",
      detail: message,
      latencyMs: Date.now() - start,
    };
  }
}

async function checkBlackboxNodes(): Promise<CheckResult[]> {
  const nodes = [1, 2, 3, 4, 5];
  const results: CheckResult[] = [];

  for (const n of nodes) {
    const url = `https://theblackbox.network/node${n}/health`;
    try {
      const { ok, status, body, latencyMs } = await timedFetch(url);
      // Accept 200 or any 2xx; some nodes return minimal JSON or plain text
      if (ok) {
        let detail = `HTTP ${status}`;
        try {
          const json = JSON.parse(body) as Record<string, unknown>;
          const statusField =
            (json["status"] as string) ??
            (json["health"] as string) ??
            (json["state"] as string);
          if (statusField) detail += ` — ${statusField}`;
        } catch {
          // plain-text response is fine
          if (body.length > 0 && body.length < 80) detail += ` — ${body.trim()}`;
        }
        results.push({
          name: `Blackbox node${n}`,
          status: "OK",
          detail,
          latencyMs,
        });
      } else {
        results.push({
          name: `Blackbox node${n}`,
          status: "WARN",
          detail: `HTTP ${status}`,
          latencyMs,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        name: `Blackbox node${n}`,
        status: "FAIL",
        detail: message.includes("abort") ? "Timeout (8s)" : message,
      });
    }
  }

  return results;
}

async function checkX402Facilitator(): Promise<CheckResult> {
  const url = "https://x402.org/facilitator";
  try {
    const { ok, status, latencyMs } = await timedFetch(url);
    if (ok || status === 404 || status === 405) {
      // 404/405 still means the host is up; the facilitator endpoint may
      // only respond to specific paths/methods
      return {
        name: "x402 Facilitator",
        status: "OK",
        detail: `HTTP ${status} — host reachable`,
        latencyMs,
      };
    }
    return {
      name: "x402 Facilitator",
      status: "WARN",
      detail: `HTTP ${status}`,
      latencyMs,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "x402 Facilitator",
      status: "FAIL",
      detail: message.includes("abort") ? "Timeout (8s)" : message,
    };
  }
}

async function checkBaseSepoliaRpc(): Promise<CheckResult> {
  const rpcUrl =
    process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  const payload = {
    jsonrpc: "2.0",
    method: "eth_chainId",
    params: [],
    id: 1,
  };

  try {
    const { ok, status, body, latencyMs } = await timedFetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!ok) {
      return {
        name: "Base Sepolia RPC",
        status: "FAIL",
        detail: `HTTP ${status}`,
        latencyMs,
      };
    }

    const json = JSON.parse(body) as { result?: string; error?: { message: string } };
    if (json.error) {
      return {
        name: "Base Sepolia RPC",
        status: "FAIL",
        detail: `RPC error: ${json.error.message}`,
        latencyMs,
      };
    }

    // Base Sepolia chain ID is 0x14A34 = 84532
    const chainId = parseInt(json.result ?? "0x0", 16);
    const expected = 84532;
    if (chainId === expected) {
      return {
        name: "Base Sepolia RPC",
        status: "OK",
        detail: `chainId=${chainId} (Base Sepolia confirmed)`,
        latencyMs,
      };
    }

    return {
      name: "Base Sepolia RPC",
      status: "WARN",
      detail: `chainId=${chainId} (expected ${expected})`,
      latencyMs,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "Base Sepolia RPC",
      status: "FAIL",
      detail: message.includes("abort") ? "Timeout (8s)" : message,
    };
  }
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderTable(results: CheckResult[]): void {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 20);
  const statusWidth = 6;

  const icon = (s: CheckResult["status"]) =>
    ({ OK: "✓", WARN: "!", FAIL: "✗" })[s];

  const pad = (str: string, len: number) => str.padEnd(len);

  console.log(
    "\n" +
      "─".repeat(nameWidth + statusWidth + 50) +
      "\n" +
      pad("Service", nameWidth) +
      "  " +
      pad("Status", statusWidth) +
      "  Latency   Detail\n" +
      "─".repeat(nameWidth + statusWidth + 50)
  );

  for (const r of results) {
    const latency =
      r.latencyMs !== undefined ? `${r.latencyMs}ms`.padEnd(9) : "   -     ";
    console.log(
      `${icon(r.status)} ${pad(r.name, nameWidth)}  ${pad(r.status, statusWidth)}  ${latency}  ${r.detail}`
    );
  }

  console.log("─".repeat(nameWidth + statusWidth + 50));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("AgentClear — System Health Check");
  console.log("Running checks in parallel...");

  const [cdpResult, blackboxResults, x402Result, rpcResult] = await Promise.all([
    checkCdp(),
    checkBlackboxNodes(),
    checkX402Facilitator(),
    checkBaseSepoliaRpc(),
  ]);

  const allResults: CheckResult[] = [
    cdpResult,
    ...blackboxResults,
    x402Result,
    rpcResult,
  ];

  renderTable(allResults);

  // Summary
  const ok = allResults.filter((r) => r.status === "OK").length;
  const warn = allResults.filter((r) => r.status === "WARN").length;
  const fail = allResults.filter((r) => r.status === "FAIL").length;

  console.log(`\nSummary: ${ok} OK  |  ${warn} WARN  |  ${fail} FAIL`);

  if (fail > 0) {
    console.log(
      "\nSome services are unreachable. Fix FAIL items before running the demo."
    );
    process.exit(1);
  } else if (warn > 0) {
    console.log("\nAll critical services are up. Some warnings detected.");
  } else {
    console.log("\nAll systems operational. Ready to run the demo.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

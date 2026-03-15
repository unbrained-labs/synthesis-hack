/**
 * blackbox.ts — Blackbox MCP client and pay_exact() abstraction.
 *
 * Spawns `npx blackbox-mcp@latest` as a subprocess and communicates via
 * the MCP stdio transport.  Exposes:
 *   - connectBlackbox()   — start the MCP subprocess + handshake
 *   - importWallet()      — register CDP wallet with Blackbox
 *   - checkHealth()       — verify nodes are reachable
 *   - payExact()          — decompose amount → deposit → withdraw to recipient
 *   - disconnectBlackbox() — graceful shutdown
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlackboxClient {
  client: Client;
  transport: StdioClientTransport;
}

interface Denomination {
  denomination: string;
  token_symbol: string;
  chain_name: string;
}

interface WithdrawalKey {
  private_key: string;
  token_address: string;
  denomination: string;
  token_decimals: number;
  merkle_root_id: string;
  merkle_proof: string[];
  key_index: number;
  chain_name: string;
  treasury_address: string;
}

interface DepositAndClaimResult {
  keys: WithdrawalKey[];
}

interface WithdrawResult {
  tx_hash: string;
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

/** Build env for the blackbox-mcp subprocess from process.env */
function buildBlackboxEnv(): Record<string, string> {
  const required = [
    "DKG_NODE_1",
    "DKG_NODE_2",
    "DKG_NODE_3",
    "DKG_NODE_4",
    "DKG_NODE_5",
  ] as const;

  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing env var: ${key}`);
    }
  }

  return env;
}

/**
 * Spawn the blackbox-mcp subprocess and connect the MCP client.
 */
export async function connectBlackbox(): Promise<BlackboxClient> {
  const env = buildBlackboxEnv();

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["blackbox-mcp@latest"],
    env,
  });

  const client = new Client(
    { name: "agentclear-buyer", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

/** Cleanly shut down the MCP subprocess. */
export async function disconnectBlackbox(bb: BlackboxClient): Promise<void> {
  try {
    await bb.client.close();
  } catch {
    // ignore close errors
  }
}

// ---------------------------------------------------------------------------
// Tool wrappers
// ---------------------------------------------------------------------------

/** Parse the content array returned by callTool into a plain object. */
function parseToolResult(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content)
  ) {
    const content = (result as { content: { type: string; text?: string }[] })
      .content;
    const textBlock = content.find((c) => c.type === "text");
    if (textBlock?.text) {
      try {
        return JSON.parse(textBlock.text);
      } catch {
        return textBlock.text;
      }
    }
  }
  return result;
}

/** Verify Blackbox DKG nodes are reachable. */
export async function checkHealth(bb: BlackboxClient): Promise<void> {
  const result = await bb.client.callTool({ name: "check_health", arguments: {} });
  const parsed = parseToolResult(result);
  console.log("  Blackbox health:", JSON.stringify(parsed, null, 2));
}

/**
 * Import a CDP wallet into Blackbox so it can sign deposit transactions.
 *
 * NOTE: The exact tool name / arguments depend on the blackbox-mcp release.
 * We use `import_wallet` as documented in the Blackbox MCP spec.
 */
export async function importWallet(
  bb: BlackboxClient,
  walletName: string,
  password: string,
  privateKeyOrMnemonic: string
): Promise<void> {
  const result = await bb.client.callTool({
    name: "import_wallet",
    arguments: {
      wallet_name: walletName,
      password,
      private_key: privateKeyOrMnemonic,
    },
  });
  const parsed = parseToolResult(result);
  console.log("  Wallet import result:", JSON.stringify(parsed, null, 2));
}

// ---------------------------------------------------------------------------
// Denomination helpers
// ---------------------------------------------------------------------------

/** Fetch available USDC denominations on base_sepolia from Blackbox. */
async function getAvailableDenominations(
  bb: BlackboxClient
): Promise<number[]> {
  const result = await bb.client.callTool({
    name: "get_available_denominations",
    arguments: { chain: "base_sepolia" },
  });

  const parsed = parseToolResult(result) as { denominations: Denomination[] };

  const denoms = (parsed.denominations ?? [])
    .filter(
      (d) =>
        d.token_symbol === "USDC" &&
        (d.chain_name === "base_sepolia" || d.chain_name === "base-sepolia")
    )
    .map((d) => parseFloat(d.denomination))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => b - a); // largest first

  if (denoms.length === 0) {
    throw new Error("No USDC denominations returned by Blackbox for base_sepolia");
  }

  return denoms;
}

/**
 * Greedy coin-change decomposition.
 *
 * Splits `amount` into the fewest Blackbox denominations possible
 * (largest first). Uses integer arithmetic (6 decimal places, USDC).
 */
export function decompose(amount: number, denoms: number[]): number[] {
  const result: number[] = [];
  // Work in micro-USDC to avoid floating-point drift
  let remaining = Math.round(amount * 1_000_000);

  for (const d of denoms) {
    const dMicro = Math.round(d * 1_000_000);
    while (remaining >= dMicro) {
      result.push(d);
      remaining -= dMicro;
    }
  }

  if (remaining > 0) {
    throw new Error(
      `Cannot decompose ${amount} USDC exactly with available denominations: ${denoms.join(", ")}. ` +
        `Residual: ${remaining / 1_000_000} USDC`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// pay_exact()
// ---------------------------------------------------------------------------

export const PRIVACY_FLOOR = 0.5; // USDC

/**
 * Pay `amount` USDC to `recipient` using the Blackbox privacy network.
 *
 * - If amount < PRIVACY_FLOOR, returns [] (caller should use x402 direct).
 * - Otherwise: decompose → deposit_and_claim → withdraw_onchain for each split.
 *
 * Returns the on-chain tx hashes of the withdrawal transactions.
 */
export async function payExact(
  bb: BlackboxClient,
  amount: string,
  recipient: string,
  walletName: string,
  walletPassword: string
): Promise<string[]> {
  const amountNum = parseFloat(amount);

  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid payment amount: ${amount}`);
  }

  if (amountNum < PRIVACY_FLOOR) {
    console.log(
      `  Amount ${amount} USDC < privacy floor ${PRIVACY_FLOOR} USDC → x402 direct`
    );
    return [];
  }

  console.log(`  Fetching available Blackbox denominations …`);
  const denoms = await getAvailableDenominations(bb);
  console.log(`  Denominations: [${denoms.join(", ")}]`);

  const splits = decompose(amountNum, denoms);
  console.log(`  Decomposed ${amount} USDC into: [${splits.join(", ")}]`);

  const txHashes: string[] = [];

  for (let i = 0; i < splits.length; i++) {
    const denom = splits[i];
    console.log(`  [${i + 1}/${splits.length}] Processing ${denom} USDC …`);

    // Step 1: deposit into Blackbox treasury + claim withdrawal key
    const depositResult = await bb.client.callTool({
      name: "deposit_and_claim",
      arguments: {
        wallet_name: walletName,
        password: walletPassword,
        chain_name: "base_sepolia",
        amount: denom.toString(),
        token: "USDC",
        withdrawal_requests: [
          {
            target_chain: "base_sepolia",
            token_symbol: "USDC",
            denomination: denom.toString(),
          },
        ],
      },
    });

    const depositParsed = parseToolResult(depositResult) as DepositAndClaimResult;

    if (!depositParsed.keys || depositParsed.keys.length === 0) {
      throw new Error(
        `deposit_and_claim returned no withdrawal keys for ${denom} USDC`
      );
    }

    const key = depositParsed.keys[0];
    console.log(`    Withdrawal key obtained. Merkle root: ${key.merkle_root_id}`);

    // Step 2: withdraw to recipient address
    const withdrawResult = await bb.client.callTool({
      name: "withdraw_onchain",
      arguments: {
        wallet_name: walletName,
        password: walletPassword,
        recipient,
        withdrawal_key: key.private_key,
        token_address: key.token_address,
        amount: key.denomination,
        token_decimals: key.token_decimals,
        merkle_root_id: key.merkle_root_id,
        merkle_proof: key.merkle_proof,
        key_index: key.key_index,
        chain_name: key.chain_name,
        treasury_address: key.treasury_address,
      },
    });

    const withdrawParsed = parseToolResult(withdrawResult) as WithdrawResult;

    if (!withdrawParsed.tx_hash) {
      throw new Error(`withdraw_onchain returned no tx_hash for ${denom} USDC`);
    }

    console.log(`    Withdraw tx: ${withdrawParsed.tx_hash}`);
    txHashes.push(withdrawParsed.tx_hash);
  }

  return txHashes;
}

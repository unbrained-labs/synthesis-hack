import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";

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
  address: string;
  key_index: number;
  merkle_root_id: number;
  merkle_proof: string[];
  denomination: string;
  chain_name: string;
  treasury_address: string;
  token_address: string;
  token_decimals: number;
}

interface DepositAndClaimResult {
  success: boolean;
  deposit_tx_hash?: string;
  keys?: WithdrawalKey[];
  keys_count?: number;
  claim_error?: string;
}

interface WithdrawResult {
  tx_hash: string;
}

function buildBlackboxEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (let i = 1; i <= 5; i++) {
    if (!env[`DKG_NODE_${i}`]) {
      env[`DKG_NODE_${i}`] = `https://theblackbox.network/node${i}`;
    }
  }
  return env;
}

function parseToolResult(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown[] }).content)
  ) {
    const content = (result as { content: { type: string; text?: string }[] }).content;
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

export async function connectBlackbox(): Promise<BlackboxClient> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["blackbox-mcp@latest"],
    env: buildBlackboxEnv(),
  });

  const client = new Client(
    { name: "agentclear-buyer", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

export async function disconnectBlackbox(bb: BlackboxClient): Promise<void> {
  try {
    await bb.client.close();
  } catch {
    // ignore
  }
}

export async function checkHealth(bb: BlackboxClient): Promise<void> {
  const result = await bb.client.callTool({ name: "check_health", arguments: {} });
  const parsed = parseToolResult(result);
  console.log("  Blackbox health:", JSON.stringify(parsed, null, 2));
}

export async function importWallet(
  bb: BlackboxClient,
  walletName: string,
  password: string,
  privateKey: string
): Promise<void> {
  const result = await bb.client.callTool({
    name: "import_wallet",
    arguments: {
      name: walletName,
      private_key: privateKey,
      password,
    },
  });
  console.log("  Wallet import:", JSON.stringify(parseToolResult(result), null, 2));
}

async function getAvailableDenominations(bb: BlackboxClient, chain: string): Promise<number[]> {
  const result = await bb.client.callTool({
    name: "get_available_denominations",
    arguments: { chain },
  });

  const parsed = parseToolResult(result) as { denominations: Denomination[] };

  return (parsed.denominations ?? [])
    .filter((d) => d.token_symbol === "USDC" && d.chain_name === chain)
    .map((d) => parseFloat(d.denomination))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => b - a);
}

export function decompose(amount: number, denoms: number[]): number[] {
  const result: number[] = [];
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
      `Cannot decompose ${amount} USDC exactly. Residual: ${remaining / 1_000_000} USDC. Available: ${denoms.join(", ")}`
    );
  }

  return result;
}

export const PRIVACY_FLOOR = 0.5;

export async function payExact(
  bb: BlackboxClient,
  amount: string,
  recipient: string,
  walletName: string,
  walletPassword: string,
  sourceChain = "base_sepolia",
  targetChain = "base_sepolia"
): Promise<string[]> {
  const amountNum = parseFloat(amount);

  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid payment amount: ${amount}`);
  }

  if (amountNum < PRIVACY_FLOOR) {
    console.log(`  Amount ${amount} USDC < floor ${PRIVACY_FLOOR} → x402 direct`);
    return [];
  }

  const crossChain = sourceChain !== targetChain;
  if (crossChain) {
    console.log(`  Cross-chain route: ${sourceChain} → ${targetChain}`);
  }

  console.log("  Fetching Blackbox denominations...");
  const denoms = await getAvailableDenominations(bb, sourceChain);
  console.log(`  Denominations: [${denoms.join(", ")}]`);

  if (denoms.length === 0) {
    throw new Error(`No USDC denominations available on ${sourceChain}`);
  }

  const splits = decompose(amountNum, denoms);
  console.log(`  Decomposed ${amount} USDC → [${splits.join(", ")}]`);

  const txHashes: string[] = [];

  for (let i = 0; i < splits.length; i++) {
    const denom = splits[i];
    console.log(`  [${i + 1}/${splits.length}] Processing ${denom} USDC...`);

    const depositResult = await bb.client.callTool({
      name: "deposit_and_claim",
      arguments: {
        wallet_name: walletName,
        password: walletPassword,
        chain_name: sourceChain,
        amount: denom.toString(),
        token: "USDC",
        withdrawal_requests: [
          {
            target_chain: targetChain,
            token_symbol: "USDC",
            denomination: denom.toString(),
          },
        ],
      },
    });

    const depositParsed = parseToolResult(depositResult) as DepositAndClaimResult;

    if (!depositParsed.success) {
      throw new Error(
        `deposit_and_claim failed: ${depositParsed.claim_error ?? JSON.stringify(depositParsed)}`
      );
    }

    if (!depositParsed.keys || depositParsed.keys.length === 0) {
      throw new Error(`deposit_and_claim returned no withdrawal keys for ${denom} USDC`);
    }

    const key = depositParsed.keys[0];
    console.log(`    Deposit tx: ${depositParsed.deposit_tx_hash}`);
    console.log(`    Merkle root: ${key.merkle_root_id}`);

    const keyFile = path.join(
      process.cwd(),
      `.withdrawal-key-${i}-${Date.now()}.json`
    );
    fs.writeFileSync(keyFile, JSON.stringify(key, null, 2));
    console.log(`    Key saved to ${path.basename(keyFile)}`);

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
      throw new Error(`withdraw_onchain returned no tx_hash. Response: ${JSON.stringify(withdrawParsed)}`);
    }

    console.log(`    Withdraw tx: ${withdrawParsed.tx_hash}`);
    txHashes.push(withdrawParsed.tx_hash);

    try { fs.unlinkSync(keyFile); } catch { /* ignore */ }
  }

  return txHashes;
}

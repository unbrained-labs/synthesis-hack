/**
 * register-erc8004.ts
 *
 * Registers AgentClear in the ERC-8004 on-chain skill registry on Base Sepolia.
 *
 * Flow:
 *   1. Fetch the registry contract address from ethskills.com/addresses/SKILL.md
 *   2. If found, call register(agentCardUrl) via viem
 *   3. If not found, print actionable TODO instructions
 *
 * Run: npm run register
 *
 * Requires env:
 *   REGISTRATION_PRIVATE_KEY  — hex private key (0x-prefixed) for the tx signer
 */

import { createWalletClient, createPublicClient, http, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";
import path from "path";

// node-fetch v3 dynamic import for ts-node CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fetch = (...args: Parameters<typeof import("node-fetch").default>) =>
  import("node-fetch").then(({ default: f }) => f(...args));

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_CARD_URL =
  "https://agentclear-worker.ddohne.workers.dev/.well-known/agent-card.json";

const ETHSKILLS_ADDRESSES_URL =
  "https://ethskills.com/addresses/SKILL.md";

const BASE_SEPOLIA_RPC =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

// Minimal ERC-8004 ABI — register function only
const ERC8004_ABI = [
  {
    name: "register",
    type: "function",
    inputs: [{ name: "agentCardUrl", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    name: "isRegistered",
    type: "function",
    inputs: [{ name: "agentCardUrl", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

// ── Registry address discovery ────────────────────────────────────────────────

/**
 * Fetches the ERC-8004 registry contract address from ethskills.com.
 * Returns the address string or null if not found.
 */
async function fetchRegistryAddress(): Promise<`0x${string}` | null> {
  console.log(`Fetching registry address from:\n  ${ETHSKILLS_ADDRESSES_URL}\n`);

  try {
    const res = await fetch(ETHSKILLS_ADDRESSES_URL, {
      headers: { Accept: "text/plain, text/markdown, */*" },
    });

    if (!res.ok) {
      console.warn(`  HTTP ${res.status} from ethskills.com`);
      return null;
    }

    const text = await res.text();

    // Look for patterns like:
    //   ERC-8004: 0x1234...
    //   skill-registry: 0xabcd...
    //   SkillRegistry: 0x...
    //   Base Sepolia: 0x...
    const patterns = [
      /erc-?8004[^\n]*?(0x[0-9a-fA-F]{40})/i,
      /skill[- ]?registry[^\n]*?(0x[0-9a-fA-F]{40})/i,
      /base[- ]?sepolia[^\n]*?(0x[0-9a-fA-F]{40})/i,
      // fallback: any 0x address on its own line
      /^(0x[0-9a-fA-F]{40})\s*$/m,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const addr = match[1] as `0x${string}`;
        console.log(`  Found registry address: ${addr}`);
        return addr;
      }
    }

    console.log("  No registry address found in document.");
    console.log("  Document preview:");
    console.log(
      text
        .split("\n")
        .slice(0, 20)
        .map((l) => "    " + l)
        .join("\n")
    );
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Fetch failed: ${message}`);
    return null;
  }
}

// ── On-chain registration ──────────────────────────────────────────────────────

async function registerOnChain(registryAddress: `0x${string}`): Promise<void> {
  const privateKey = process.env.REGISTRATION_PRIVATE_KEY;
  if (!privateKey) {
    console.error("ERROR: REGISTRATION_PRIVATE_KEY is not set in .env");
    console.error("       Add a hex private key (0x-prefixed) to ../../.env");
    process.exit(1);
  }

  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    console.error(
      "ERROR: REGISTRATION_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string (66 chars total)"
    );
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Signer address: ${account.address}`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });

  // ── Check if already registered ──────────────────────────────────────────
  console.log("\nChecking if already registered...");
  try {
    const already = await publicClient.readContract({
      address: registryAddress,
      abi: ERC8004_ABI,
      functionName: "isRegistered",
      args: [AGENT_CARD_URL],
    });
    if (already) {
      console.log("Already registered — nothing to do.");
      console.log(`Agent Card URL: ${AGENT_CARD_URL}`);
      return;
    }
    console.log("Not yet registered. Proceeding...");
  } catch {
    // Contract may not have isRegistered; proceed with register call
    console.log("Could not check registration status — proceeding anyway.");
  }

  // ── Simulate the transaction first ────────────────────────────────────────
  console.log("\nSimulating register() call...");
  try {
    const { result: tokenId } = await publicClient.simulateContract({
      address: registryAddress,
      abi: ERC8004_ABI,
      functionName: "register",
      args: [AGENT_CARD_URL],
      account: account.address,
    });
    console.log(`Simulation OK — expected tokenId: ${tokenId}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Simulation failed: ${message}`);
    console.error("Check that the registry address is correct and your account has ETH.");
    process.exit(1);
  }

  // ── Send the real transaction ─────────────────────────────────────────────
  console.log("\nSending register() transaction...");
  const txHash: Hash = await walletClient.writeContract({
    address: registryAddress,
    abi: ERC8004_ABI,
    functionName: "register",
    args: [AGENT_CARD_URL],
  });

  console.log(`Transaction sent: ${txHash}`);
  console.log(`BaseScan: https://sepolia.basescan.org/tx/${txHash}`);

  // ── Wait for receipt ──────────────────────────────────────────────────────
  console.log("\nWaiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "success") {
    console.log(`Confirmed in block ${receipt.blockNumber}`);
    console.log("\n=== Registration Complete ===");
    console.log(`Agent Card URL : ${AGENT_CARD_URL}`);
    console.log(`Registry       : ${registryAddress}`);
    console.log(`Tx Hash        : ${txHash}`);
    console.log(`Block          : ${receipt.blockNumber}`);
  } else {
    console.error(`Transaction reverted. Hash: ${txHash}`);
    console.error("Check BaseScan for details.");
    process.exit(1);
  }
}

// ── TODO fallback ─────────────────────────────────────────────────────────────

function printTodo(): void {
  console.log("\n" + "=".repeat(60));
  console.log("TODO: ERC-8004 Registry Address Not Found");
  console.log("=".repeat(60));
  console.log(`
The ERC-8004 registry contract address could not be resolved
automatically from ${ETHSKILLS_ADDRESSES_URL}.

To register AgentClear manually:

1. Find or deploy the ERC-8004 SkillRegistry on Base Sepolia:
   - Check: https://ethskills.com/standards/SKILL.md
   - Check: https://ethskills.com/addresses/SKILL.md
   - Or deploy your own from: https://github.com/ethereum/ERCs (ERC-8004)

2. Set the address in REGISTRY_ADDRESS env var and re-run:
   REGISTRY_ADDRESS=0x<address> npm run register

3. Alternatively, call register() directly via cast:
   cast send <REGISTRY_ADDRESS> \\
     "register(string)(uint256)" \\
     "${AGENT_CARD_URL}" \\
     --rpc-url https://sepolia.base.org \\
     --private-key $REGISTRATION_PRIVATE_KEY

4. Verify registration:
   cast call <REGISTRY_ADDRESS> \\
     "isRegistered(string)(bool)" \\
     "${AGENT_CARD_URL}" \\
     --rpc-url https://sepolia.base.org

Agent Card URL: ${AGENT_CARD_URL}
Chain: Base Sepolia (chainId: 84532)
`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("AgentClear — ERC-8004 Registration");
  console.log(`Agent Card URL: ${AGENT_CARD_URL}\n`);

  // Allow manual override via env
  let registryAddress = process.env.REGISTRY_ADDRESS as `0x${string}` | undefined;

  if (registryAddress) {
    console.log(`Using REGISTRY_ADDRESS from env: ${registryAddress}`);
  } else {
    const fetched = await fetchRegistryAddress();
    if (fetched) {
      registryAddress = fetched;
    }
  }

  if (!registryAddress) {
    printTodo();
    process.exit(0);
  }

  await registerOnChain(registryAddress);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

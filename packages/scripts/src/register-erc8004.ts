/**
 * Register TrustVault agent identity on the ERC-8004 Identity Registry (Base Sepolia).
 *
 * Run: npm run register
 *
 * Requires env:
 *   TRUST_AGENT_PRIVATE_KEY — hex private key (0x-prefixed)
 *   TRUST_AGENT_URL         — deployed worker URL (optional, defaults to localhost)
 */

import "dotenv/config";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Hash,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_REGISTRY =
  (process.env.IDENTITY_REGISTRY as `0x${string}`) ??
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const BASE_SEPOLIA_RPC =
  process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const AGENT_CARD_URL =
  process.env.TRUST_AGENT_URL
    ? `${process.env.TRUST_AGENT_URL}/.well-known/agent-card.json`
    : "http://localhost:8787/.well-known/agent-card.json";

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

async function main() {
  console.log("TrustVault v2 — ERC-8004 Registration\n");

  const privateKey = process.env.TRUST_AGENT_PRIVATE_KEY;
  if (!privateKey) {
    console.error("ERROR: TRUST_AGENT_PRIVATE_KEY not set. Run: npm run wallets");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Signer:   ${account.address}`);
  console.log(`Registry: ${IDENTITY_REGISTRY}`);
  console.log(`Card URL: ${AGENT_CARD_URL}\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_RPC),
  });

  // Check if already registered
  try {
    const already = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: ERC8004_ABI,
      functionName: "isRegistered",
      args: [AGENT_CARD_URL],
    });
    if (already) {
      console.log("Already registered — nothing to do.");
      return;
    }
  } catch {
    console.log("Could not check status — proceeding with registration.");
  }

  // Simulate
  console.log("Simulating register() call...");
  try {
    const { result: tokenId } = await publicClient.simulateContract({
      address: IDENTITY_REGISTRY,
      abi: ERC8004_ABI,
      functionName: "register",
      args: [AGENT_CARD_URL],
      account: account.address,
    });
    console.log(`Simulation OK — tokenId: ${tokenId}`);
  } catch (err) {
    console.error(`Simulation failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Send
  console.log("Sending transaction...");
  const txHash: Hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: ERC8004_ABI,
    functionName: "register",
    args: [AGENT_CARD_URL],
  });

  console.log(`Tx: ${txHash}`);
  console.log(`BaseScan: https://sepolia.basescan.org/tx/${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "success") {
    console.log(`\nRegistered in block ${receipt.blockNumber}`);
    console.log("\nNext: deploy the worker and update TRUST_AGENT_URL in .env");
  } else {
    console.error("Transaction reverted.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

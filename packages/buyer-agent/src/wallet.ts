/**
 * wallet.ts — Viem-based wallet setup for the buyer agent.
 *
 * Reads BUYER_PRIVATE_KEY from env (set by setup-wallets script).
 * Returns a viem account ready for signing x402 payments.
 */

import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export interface BuyerWallet {
  address: string;
  name: string;
}

/**
 * Create a buyer wallet from the BUYER_PRIVATE_KEY env variable.
 * Falls back to SELLER_PRIVATE_KEY if buyer key is missing (demo mode).
 */
export function createBuyerWallet(): BuyerWallet {
  const privateKey = process.env.BUYER_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error(
      "BUYER_PRIVATE_KEY not set. Run `npm run wallets` in packages/scripts first."
    );
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  return {
    address: account.address,
    name: "agentclear-buyer",
  };
}

/**
 * Create a viem public client for Base Sepolia.
 */
export function createBaseSepoliaClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });
}

/**
 * Create a viem wallet client for signing transactions.
 */
export function createBaseSepoliaWalletClient() {
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("BUYER_PRIVATE_KEY not set");

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });
}

/**
 * Request testnet USDC from the Circle faucet (link only — no auto-request).
 * The CDP faucet requires CDP_WALLET_SECRET. Use this helper to print the link.
 */
export function printFaucetLink(address: string): void {
  console.log(`  Fund buyer at: https://faucet.circle.com/ → Base Sepolia`);
  console.log(`  Buyer address: ${address}`);
}

/**
 * setup-wallets.ts
 *
 * Generates buyer + seller wallets using viem (no CDP portal needed).
 * Prints addresses + private keys for .env, and links to faucets.
 *
 * Run: npm run wallets
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load .env from repo root (two levels up from packages/scripts/src)
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

async function main(): Promise<void> {
  console.log("AgentClear Wallet Setup\n");

  // Check if wallets already exist in .env
  const existingBuyerKey = process.env.BUYER_PRIVATE_KEY;
  const existingSellerKey = process.env.SELLER_PRIVATE_KEY;

  let buyerKey: `0x${string}`;
  let sellerKey: `0x${string}`;

  if (existingBuyerKey && existingSellerKey) {
    console.log("Existing wallets found in .env — reusing them.\n");
    buyerKey = existingBuyerKey as `0x${string}`;
    sellerKey = existingSellerKey as `0x${string}`;
  } else {
    console.log("Generating new wallets...\n");
    buyerKey = generatePrivateKey();
    sellerKey = generatePrivateKey();
  }

  const buyer = privateKeyToAccount(buyerKey);
  const seller = privateKeyToAccount(sellerKey);

  console.log("=== AgentClear Wallets ===");
  console.log(`Buyer  (pays for services):  ${buyer.address}`);
  console.log(`Seller (delivers services):  ${seller.address}\n`);

  // Check balances
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  try {
    const [buyerEth, sellerEth] = await Promise.all([
      client.getBalance({ address: buyer.address }),
      client.getBalance({ address: seller.address }),
    ]);
    console.log(`Buyer  ETH balance: ${formatUnits(buyerEth, 18)} ETH`);
    console.log(`Seller ETH balance: ${formatUnits(sellerEth, 18)} ETH\n`);
  } catch {
    console.log("(Could not fetch balances — check network)\n");
  }

  // Write/update .env if keys are new
  if (!existingBuyerKey || !existingSellerKey) {
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

    // Remove any existing entries
    envContent = envContent.replace(/^BUYER_PRIVATE_KEY=.*$/m, "");
    envContent = envContent.replace(/^SELLER_PRIVATE_KEY=.*$/m, "");
    envContent = envContent.replace(/^BUYER_WALLET_ADDRESS=.*$/m, "");
    envContent = envContent.replace(/^SELLER_WALLET_ADDRESS=.*$/m, "");
    envContent = envContent.trimEnd();

    envContent += `\n\n# Generated wallets (${new Date().toISOString()})`;
    envContent += `\nBUYER_PRIVATE_KEY=${buyerKey}`;
    envContent += `\nBUYER_WALLET_ADDRESS=${buyer.address}`;
    envContent += `\nSELLER_PRIVATE_KEY=${sellerKey}`;
    envContent += `\nSELLER_WALLET_ADDRESS=${seller.address}\n`;

    fs.writeFileSync(envPath, envContent);
    console.log("✓ Wallet keys saved to .env (repo root)\n");
  }

  console.log("=== Add PAY_TO_ADDRESS to worker ===");
  console.log(`PAY_TO_ADDRESS=${seller.address}`);
  console.log("(Set this in packages/worker/wrangler.toml)\n");

  console.log("=== Faucet Links (fund buyer wallet) ===");
  console.log(`ETH faucet  : https://faucet.quicknode.com/base/sepolia`);
  console.log(`USDC faucet : https://faucet.circle.com/ (select Base Sepolia)`);
  console.log(`Buyer addr  : ${buyer.address}`);
  console.log();
  console.log("=== BaseScan Links ===");
  console.log(`Buyer:  https://sepolia.basescan.org/address/${buyer.address}`);
  console.log(`Seller: https://sepolia.basescan.org/address/${seller.address}`);
  console.log("\nDone. Run `npm run health` next.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

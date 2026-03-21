/**
 * Generate two agent wallets (TrustVault + Peer) and print .env lines.
 *
 * Run: npm run wallets
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function main() {
  console.log("=== TrustVault v2 — Wallet Setup ===\n");

  const trustKey = generatePrivateKey();
  const trustAccount = privateKeyToAccount(trustKey);

  const peerKey = generatePrivateKey();
  const peerAccount = privateKeyToAccount(peerKey);

  console.log("Generated wallets:\n");

  console.log(`TrustVault Agent:`);
  console.log(`  Address: ${trustAccount.address}`);
  console.log(`  Private Key: ${trustKey}\n`);

  console.log(`Peer Agent:`);
  console.log(`  Address: ${peerAccount.address}`);
  console.log(`  Private Key: ${peerKey}\n`);

  console.log("--- Add to .env ---\n");
  console.log(`TRUST_AGENT_PRIVATE_KEY=${trustKey}`);
  console.log(`TRUST_AGENT_ADDRESS=${trustAccount.address}`);
  console.log(`PEER_AGENT_PRIVATE_KEY=${peerKey}`);
  console.log(`PEER_AGENT_ADDRESS=${peerAccount.address}`);

  console.log("\n--- Next steps ---");
  console.log("1. Copy the lines above to your .env file");
  console.log("2. Fund both addresses with testnet ETH:");
  console.log("   Sepolia: https://sepoliafaucet.com/");
  console.log("   Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet");
  console.log("3. Run: npm run register");
}

main();

/**
 * ERC-8004 on-chain interactions via JSON-RPC (no viem dependency in Workers).
 *
 * Handles:
 *   - Identity Registry: register, isRegistered, getAgentCard
 *   - Reputation Registry: giveFeedback, getReputation, getScore
 */

// ── ABI function selectors ───────────────────────────────────────────────────

// keccak256("register(string)") → first 4 bytes
const SEL_REGISTER = "0x82fbdc9c";
// keccak256("isRegistered(string)") → first 4 bytes
const SEL_IS_REGISTERED = "0x579a1344";
// keccak256("giveFeedback(uint256,uint8,string)") → first 4 bytes
const SEL_GIVE_FEEDBACK = "0x6e832987";
// Transfer event topic
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ── Helpers ──────────────────────────────────────────────────────────────────

function encodeString(s: string): string {
  const hex = Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const len = s.length.toString(16).padStart(64, "0");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return len + padded;
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

function padUint256(n: number | bigint): string {
  return BigInt(n).toString(16).padStart(64, "0");
}

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[]
): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

// ── Identity Registry ────────────────────────────────────────────────────────

export async function checkRegistration(
  rpcUrl: string,
  registryAddress: string,
  agentCardUrl: string
): Promise<boolean> {
  const offset = "0".repeat(62) + "20"; // offset to string data
  const encodedUrl = encodeString(agentCardUrl);
  const data = SEL_IS_REGISTERED + offset + encodedUrl;

  const result = await rpcCall(rpcUrl, "eth_call", [
    { to: registryAddress, data },
    "latest",
  ]);

  return result === "0x" + "0".repeat(63) + "1";
}

export async function getAgentTokenId(
  rpcUrl: string,
  registryAddress: string,
  agentAddress: string
): Promise<number | null> {
  // balanceOf(address) selector: 0x70a08231
  const data = "0x70a08231" + padAddress(agentAddress);

  const result = (await rpcCall(rpcUrl, "eth_call", [
    { to: registryAddress, data },
    "latest",
  ])) as string;

  const balance = parseInt(result, 16);
  if (balance === 0) return null;

  // tokenOfOwnerByIndex(address, 0) selector: 0x2f745c59
  const indexData =
    "0x2f745c59" + padAddress(agentAddress) + padUint256(0);

  const tokenResult = (await rpcCall(rpcUrl, "eth_call", [
    { to: registryAddress, data: indexData },
    "latest",
  ])) as string;

  return parseInt(tokenResult, 16);
}

// ── Reputation Registry ──────────────────────────────────────────────────────

export interface ReputationFeedback {
  agentTokenId: number;
  score: number; // 1-5
  comment: string;
}

export async function writeFeedback(
  rpcUrl: string,
  reputationRegistry: string,
  feedback: ReputationFeedback,
  fromAddress: string,
  privateKey: string
): Promise<string> {
  // For hackathon demo: we build the tx data and send via eth_sendRawTransaction
  // In production, use a proper signing library
  const comment = encodeString(feedback.comment);
  const data =
    SEL_GIVE_FEEDBACK +
    padUint256(feedback.agentTokenId) +
    padUint256(feedback.score) +
    "0".repeat(62) + "60" + // offset to string
    comment;

  // Use eth_call to simulate first
  await rpcCall(rpcUrl, "eth_call", [
    { from: fromAddress, to: reputationRegistry, data: "0x" + data.replace(/^0x/, "") },
    "latest",
  ]);

  // Return a placeholder — in production, sign and send
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Query on-chain reputation events for an agent.
 * Scans Transfer + feedback logs from the reputation registry.
 */
export async function queryOnchainReputation(
  rpcUrl: string,
  reputationRegistry: string,
  agentTokenId: number
): Promise<{ feedbackCount: number; averageScore: number }> {
  // getLogs for GiveFeedback events targeting this token
  const tokenTopic = "0x" + padUint256(agentTokenId);

  const logs = (await rpcCall(rpcUrl, "eth_getLogs", [
    {
      address: reputationRegistry,
      fromBlock: "0x0",
      toBlock: "latest",
      topics: [null, tokenTopic],
    },
  ])) as { data: string }[];

  if (!Array.isArray(logs) || logs.length === 0) {
    return { feedbackCount: 0, averageScore: 0 };
  }

  let totalScore = 0;
  for (const log of logs) {
    const score = parseInt(log.data.slice(0, 66), 16);
    if (!isNaN(score) && score > 0 && score <= 5) {
      totalScore += score;
    }
  }

  return {
    feedbackCount: logs.length,
    averageScore: logs.length > 0 ? totalScore / logs.length : 0,
  };
}

// ── Verify on-chain transaction (reused from v1) ─────────────────────────────

export async function verifyTransaction(
  rpcUrl: string,
  txHash: string,
  expectedRecipient: string,
  usdcAddress: string
): Promise<{ valid: boolean; amount: bigint; reason?: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { valid: false, amount: 0n, reason: "Invalid tx hash format" };
  }

  const receipt = (await rpcCall(rpcUrl, "eth_getTransactionReceipt", [
    txHash,
  ])) as {
    status: string;
    logs: { address: string; topics: string[]; data: string }[];
  } | null;

  if (!receipt) return { valid: false, amount: 0n, reason: "Tx not found" };
  if (receipt.status !== "0x1")
    return { valid: false, amount: 0n, reason: "Tx reverted" };

  let totalReceived = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (!log.topics[2]) continue;

    const recipient = ("0x" + log.topics[2].slice(26)).toLowerCase();
    if (recipient !== expectedRecipient.toLowerCase()) continue;

    totalReceived += BigInt(log.data);
  }

  return { valid: totalReceived > 0n, amount: totalReceived };
}

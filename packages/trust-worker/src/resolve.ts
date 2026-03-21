/**
 * resolve.ts — Trust Resolution Engine
 *
 * Pipeline: fetch card → check ERC-8004 → query reputation →
 *           check local attestations → sybil analysis →
 *           task-fit evaluation → composite score →
 *           AI reasoning → verdict + receipt
 */

import type {
  ResolveRequest,
  ResolveResult,
  Verdict,
  RiskLevel,
  AgentMemory,
} from "./types";
import { checkRegistration, queryOnchainReputation } from "./erc8004";
import { generateResolveAnalysis } from "./inference";

export interface ResolveContext {
  rpcUrl: string;
  identityRegistry: string;
  reputationRegistry: string;
  memory: AgentMemory;
  aiApiKey?: string;
  aiModel?: string;
}

export async function resolveAgent(
  req: ResolveRequest,
  ctx: ResolveContext
): Promise<ResolveResult> {
  const { agentUrl, task } = req;

  // ── Step 1: Fetch agent card ─────────────────────────────────
  const identity = {
    reachable: false,
    hasAgentCard: false,
    name: null as string | null,
    capabilities: [] as string[],
    erc8004Registered: false,
    tokenId: null as number | null,
  };

  try {
    const cardRes = await fetch(
      `${agentUrl.replace(/\/$/, "")}/.well-known/agent-card.json`,
      { signal: AbortSignal.timeout(5000) }
    );
    identity.reachable = true;
    if (cardRes.ok) {
      const agentCardData = (await cardRes.json()) as {
        name?: string;
        capabilities?: string[];
        tags?: string[];
      };
      identity.hasAgentCard = true;
      identity.name = agentCardData.name ?? null;
      identity.capabilities =
        agentCardData.capabilities ?? agentCardData.tags ?? [];
    }
  } catch {
    // Agent unreachable
  }

  // ── Step 2: Check ERC-8004 registration ──────────────────────
  if (identity.hasAgentCard) {
    try {
      const cardUrl = `${agentUrl.replace(/\/$/, "")}/.well-known/agent-card.json`;
      identity.erc8004Registered = await checkRegistration(
        ctx.rpcUrl,
        ctx.identityRegistry,
        cardUrl
      );
    } catch {
      /* non-fatal */
    }
  }

  // ── Step 3: Query on-chain reputation ────────────────────────
  let onchainReputation = { feedbackCount: 0, averageScore: 0 };
  if (identity.tokenId != null) {
    try {
      onchainReputation = await queryOnchainReputation(
        ctx.rpcUrl,
        ctx.reputationRegistry,
        identity.tokenId
      );
    } catch {
      /* non-fatal */
    }
  }

  // ── Step 4: Check local attestation state ────────────────────
  const directAttestations = ctx.memory.attestationsReceived.filter(
    (a) =>
      a.from.toLowerCase() === agentUrl.toLowerCase() ||
      a.from.toLowerCase() === (identity.name ?? "").toLowerCase()
  );
  const localTrust = {
    directAttestations: directAttestations.length,
    averageScore:
      directAttestations.length > 0
        ? directAttestations.reduce((s, a) => s + a.score, 0) /
          directAttestations.length
        : 0,
    skills: [...new Set(directAttestations.map((a) => a.skill))],
  };

  // ── Step 5: Sybil indicators ─────────────────────────────────
  const allAttestations = ctx.memory.attestationsReceived;
  const selfAttested = allAttestations.filter((a) => a.from === a.to);
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recentFromAnyone = allAttestations.filter(
    (a) => a.timestamp > oneHourAgo
  );
  const uniqueAttestors = new Set(allAttestations.map((a) => a.from)).size;

  const sybilIndicators = {
    selfAttestationDetected: selfAttested.length > 0,
    attestationVelocityNormal: recentFromAnyone.length <= 10,
    uniqueAttestorRatio:
      allAttestations.length > 0
        ? Math.round((uniqueAttestors / allAttestations.length) * 100) / 100
        : 1.0,
  };

  // ── Step 6: Task-fit evaluation ──────────────────────────────
  const capabilityMatch =
    task?.requiredCapabilities.filter((cap) =>
      identity.capabilities.some(
        (c) =>
          c.toLowerCase().includes(cap.toLowerCase()) ||
          cap.toLowerCase().includes(c.toLowerCase())
      )
    ) ?? [];
  const capabilityGap =
    task?.requiredCapabilities.filter(
      (cap) => !capabilityMatch.includes(cap)
    ) ?? [];

  // ── Step 7: Composite score ──────────────────────────────────
  const onchainScore = onchainReputation.averageScore * 20; // 1-5 → 0-100
  const registrationBonus = identity.erc8004Registered ? 100 : 0;
  const cardQuality =
    (identity.reachable ? 30 : 0) +
    (identity.hasAgentCard ? 40 : 0) +
    (identity.capabilities.length > 0 ? 30 : 0);
  const capabilityFit = task
    ? task.requiredCapabilities.length > 0
      ? (capabilityMatch.length / task.requiredCapabilities.length) * 100
      : 100
    : 50;

  let sybilPenalty = 0;
  if (sybilIndicators.selfAttestationDetected) sybilPenalty += 15;
  if (!sybilIndicators.attestationVelocityNormal) sybilPenalty += 10;
  if (sybilIndicators.uniqueAttestorRatio < 0.5) sybilPenalty += 10;

  const rawScore =
    onchainScore * 0.3 +
    localTrust.averageScore * 0.25 +
    registrationBonus * 0.15 +
    cardQuality * 0.15 +
    capabilityFit * 0.15 -
    sybilPenalty;

  const trustScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // ── Step 8: Risk-adjusted safeguards ─────────────────────────
  const riskLevel = task?.riskLevel ?? "medium";
  const safeguards = computeSafeguards(trustScore, riskLevel, capabilityGap);
  const riskAssessment = computeRiskAssessment(trustScore, riskLevel);

  // ── Step 9: Confidence ───────────────────────────────────────
  let signalCount = 0;
  if (identity.reachable) signalCount++;
  if (identity.hasAgentCard) signalCount++;
  if (identity.erc8004Registered) signalCount++;
  if (onchainReputation.feedbackCount > 0) signalCount++;
  if (localTrust.directAttestations > 0) signalCount++;
  const confidence = Math.round((signalCount / 5) * 100) / 100;

  // ── Step 10: Verdict ─────────────────────────────────────────
  const verdict = computeVerdict(trustScore, confidence, riskLevel);

  // ── Step 11: AI reasoning ────────────────────────────────────
  let reasoning = `Score ${trustScore}/100 based on ${signalCount} signal sources.`;
  if (ctx.aiApiKey) {
    try {
      const aiResult = await generateResolveAnalysis(
        ctx.aiApiKey,
        ctx.aiModel ?? "llama-3.3-70b",
        {
          agentName: identity.name ?? agentUrl,
          trustScore,
          verdict,
          attestations: localTrust.directAttestations,
          skills: localTrust.skills,
          taskDescription:
            task?.description ?? task?.type ?? "general cooperation",
          erc8004Registered: identity.erc8004Registered,
          onchainFeedback: onchainReputation.feedbackCount,
          capabilityMatch,
          capabilityGap,
          riskLevel,
          sybilIndicators,
        }
      );
      if (aiResult) reasoning = aiResult;
    } catch {
      /* non-fatal */
    }
  }

  // ── Step 12: Signed receipt ──────────────────────────────────
  const receiptId = crypto.randomUUID();
  const resolvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const digestInput = `${receiptId}:${verdict}:${trustScore}:${resolvedAt}`;
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(digestInput)
  );
  const digest = Array.from(new Uint8Array(digestBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    verdict,
    confidence,
    trustScore,
    taskFit: {
      capabilityMatch,
      capabilityGap,
      riskAssessment,
      safeguards,
    },
    report: {
      identity,
      onchainReputation,
      localTrust,
      sybilIndicators,
      reasoning,
    },
    receipt: {
      id: receiptId,
      resolvedAt,
      expiresAt,
      resolver: "TrustVault/2.1.0",
      targetAgent: agentUrl,
      digest,
    },
  };
}

// ── Verdict logic ──────────────────────────────────────────────

function computeVerdict(
  score: number,
  confidence: number,
  risk: RiskLevel
): Verdict {
  if (confidence < 0.2) return "UNKNOWN";

  const thresholds: Record<RiskLevel, { trusted: number; cautious: number }> = {
    low: { trusted: 40, cautious: 20 },
    medium: { trusted: 55, cautious: 35 },
    high: { trusted: 70, cautious: 50 },
    critical: { trusted: 85, cautious: 65 },
  };
  const t = thresholds[risk];
  if (score >= t.trusted) return "TRUSTED";
  if (score >= t.cautious) return "CAUTIOUS";
  return "UNTRUSTED";
}

// ── Risk assessment ────────────────────────────────────────────

function computeRiskAssessment(score: number, taskRisk: RiskLevel): RiskLevel {
  const riskMap: Record<RiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  const reverseMap: RiskLevel[] = ["low", "medium", "high", "critical"];

  let riskNum = riskMap[taskRisk];
  if (score < 30) riskNum = Math.min(riskNum + 2, 4);
  else if (score < 50) riskNum = Math.min(riskNum + 1, 4);
  else if (score > 80) riskNum = Math.max(riskNum - 1, 1);

  return reverseMap[riskNum - 1];
}

// ── Safeguards ─────────────────────────────────────────────────

function computeSafeguards(
  score: number,
  risk: RiskLevel,
  capabilityGap: string[]
): string[] {
  const safeguards: string[] = [];

  if (score < 30) {
    safeguards.push("Do not delegate unsupervised work");
    safeguards.push("Require attestation proof before proceeding");
  } else if (score < 55) {
    safeguards.push("Review outputs before accepting");
    safeguards.push("Set explicit timeout and rollback plan");
  }

  if (risk === "critical" || risk === "high") {
    safeguards.push("Require on-chain attestation as escrow");
    if (score < 70) {
      safeguards.push("Request third-party validation");
    }
  }

  if (capabilityGap.length > 0) {
    safeguards.push(
      `Verify capability for: ${capabilityGap.join(", ")} — not confirmed in agent card`
    );
  }

  if (safeguards.length === 0) {
    safeguards.push(
      "Standard cooperation — no additional safeguards required"
    );
  }

  return safeguards;
}

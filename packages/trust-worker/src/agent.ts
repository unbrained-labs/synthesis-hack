/**
 * TrustAgent — Cloudflare Durable Object
 *
 * Stateful agent that persists trust resume data across requests.
 * Each agent instance maintains its own:
 *   - Identity (ERC-8004 registration)
 *   - Attestations given and received
 *   - Cooperation history
 *   - Computed trust score
 *
 * State survives hibernation — the agent "remembers" across cold starts.
 */

import type {
  Attestation,
  AttestationRequest,
  CooperationRequest,
  CooperationDecision,
  CooperationLogEntry,
  AgentMemory,
  TrustResume,
  ResolveRequest,
  Env,
} from "./types";
import { queryOnchainReputation } from "./erc8004";
import { generateTrustAnalysis } from "./inference";
import { resolveAgent } from "./resolve";

export class TrustAgent implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/memory") {
        return this.getMemory();
      }
      if (request.method === "GET" && path === "/trust-resume") {
        return this.getTrustResume();
      }
      if (request.method === "POST" && path === "/attest") {
        return this.receiveAttestation(request);
      }
      if (request.method === "POST" && path === "/cooperate") {
        return this.handleCooperationRequest(request);
      }
      if (request.method === "POST" && path === "/init") {
        return this.initializeIdentity(request);
      }
      if (request.method === "GET" && path === "/score") {
        return this.getScore();
      }
      if (request.method === "POST" && path === "/resolve") {
        return this.handleResolve(request);
      }
      if (request.method === "GET" && path === "/resolution-log") {
        return this.getResolutionLog();
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  private async initializeIdentity(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      name: string;
      address: string;
      tokenId?: number;
      skills?: string[];
    };

    const memory = await this.loadMemory();
    memory.identity = {
      name: body.name,
      address: body.address,
      tokenId: body.tokenId,
      registeredAt: new Date().toISOString(),
    };
    memory.skills = body.skills ?? memory.skills;
    await this.saveMemory(memory);

    return json({ ok: true, identity: memory.identity });
  }

  // ── Trust Resume ─────────────────────────────────────────────────────────

  private async getTrustResume(): Promise<Response> {
    const memory = await this.loadMemory();
    const resume = this.computeTrustResume(memory);
    return json(resume);
  }

  private async getScore(): Promise<Response> {
    const memory = await this.loadMemory();
    const resume = this.computeTrustResume(memory);
    return json({ score: resume.trustScore, attestations: resume.attestationsReceived });
  }

  private computeTrustResume(memory: AgentMemory): TrustResume {
    const received = memory.attestationsReceived;

    // Weighted trust score: average of attestation scores, boosted by volume
    let baseScore = 0;
    if (received.length > 0) {
      const totalScore = received.reduce((sum, a) => sum + a.score, 0);
      baseScore = totalScore / received.length;
    }

    // Volume bonus: +1 per attestation, max +20
    const volumeBonus = Math.min(received.length * 1, 20);

    // On-chain bonus: +5 per on-chain attestation, max +15
    const onchainCount = received.filter((a) => a.onchain).length;
    const onchainBonus = Math.min(onchainCount * 5, 15);

    const trustScore = Math.min(
      Math.round(baseScore + volumeBonus + onchainBonus),
      100
    );

    // Aggregate top skills from attestations
    const skillCounts = new Map<string, number>();
    for (const a of received) {
      skillCounts.set(a.skill, (skillCounts.get(a.skill) ?? 0) + a.score);
    }
    const topSkills = [...skillCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skill]) => skill);

    return {
      attestationsReceived: received.length,
      attestationsGiven: memory.attestationsGiven.length,
      trustScore,
      lastUpdated: new Date().toISOString(),
      topSkills: topSkills.length > 0 ? topSkills : memory.skills,
    };
  }

  // ── Attestations ─────────────────────────────────────────────────────────

  private async receiveAttestation(request: Request): Promise<Response> {
    const body = (await request.json()) as AttestationRequest & {
      fromName?: string;
      txHash?: string;
    };

    if (body.score < 1 || body.score > 100) {
      return json({ error: "Score must be 1-100" }, 400);
    }

    const memory = await this.loadMemory();

    const attestation: Attestation = {
      id: crypto.randomUUID(),
      from: body.fromName ?? body.to,
      to: memory.identity.address,
      skill: body.skill,
      score: body.score,
      evidence: body.evidence,
      timestamp: new Date().toISOString(),
      txHash: body.txHash,
      onchain: !!body.txHash,
    };

    memory.attestationsReceived.push(attestation);
    await this.saveMemory(memory);

    const resume = this.computeTrustResume(memory);

    return json({
      ok: true,
      attestation,
      updatedResume: resume,
    });
  }

  // ── Cooperation ──────────────────────────────────────────────────────────

  private async handleCooperationRequest(
    request: Request
  ): Promise<Response> {
    const body = (await request.json()) as CooperationRequest;
    const memory = await this.loadMemory();
    const resume = this.computeTrustResume(memory);

    // Check skill match
    const matchedSkills = body.requiredSkills.filter(
      (s) =>
        memory.skills.includes(s) ||
        resume.topSkills.includes(s)
    );

    // Decision logic
    const meetsThreshold = resume.trustScore >= body.minTrustScore;
    const hasSkills = matchedSkills.length > 0 || body.requiredSkills.length === 0;

    let accepted = meetsThreshold && hasSkills;
    let reason: string;

    if (!meetsThreshold) {
      reason = `Trust score ${resume.trustScore} below required ${body.minTrustScore}`;
    } else if (!hasSkills) {
      reason = `No matching skills. Required: [${body.requiredSkills.join(", ")}], Have: [${resume.topSkills.join(", ")}]`;
    } else {
      reason = `Trust score ${resume.trustScore} meets threshold. Matched skills: [${matchedSkills.join(", ")}]`;
    }

    // AI-enhanced reasoning if Venice is available
    let aiAnalysis: string | undefined;
    if (this.env.VENICE_API_KEY) {
      try {
        aiAnalysis = await generateTrustAnalysis(
          this.env.VENICE_API_KEY,
          this.env.VENICE_MODEL ?? "llama-3.3-70b",
          {
            agentName: body.fromAgent,
            trustScore: resume.trustScore,
            attestations: resume.attestationsReceived,
            skills: resume.topSkills,
            taskDescription: body.taskDescription,
          }
        );
      } catch {
        // Non-fatal — proceed with rule-based decision
      }
    }

    // Log the cooperation event
    const logEntry: CooperationLogEntry = {
      partner: body.fromAgent,
      task: body.taskDescription,
      decision: accepted ? "accepted" : "declined",
      trustScore: resume.trustScore,
      timestamp: new Date().toISOString(),
    };
    memory.cooperationHistory.push(logEntry);
    await this.saveMemory(memory);

    const decision: CooperationDecision & { aiAnalysis?: string } = {
      accepted,
      reason,
      trustScore: resume.trustScore,
      attestationCount: resume.attestationsReceived,
      matchedSkills,
      aiAnalysis,
    };

    return json(decision);
  }

  // ── Resolution ──────────────────────────────────────────────────────────

  private async handleResolve(request: Request): Promise<Response> {
    const body = (await request.json()) as ResolveRequest;
    const memory = await this.loadMemory();

    // Check cache (5 minute TTL)
    const cacheKey = `${body.agentUrl}:${body.task?.type ?? "general"}`;
    const cached = memory.resolveCache?.[cacheKey];
    if (cached && new Date(cached.expiresAt) > new Date()) {
      return json({
        ...cached.result,
        receipt: { ...cached.result.receipt, cacheHit: true },
      });
    }

    const result = await resolveAgent(body, {
      rpcUrl: this.env.BASE_SEPOLIA_RPC,
      identityRegistry: this.env.IDENTITY_REGISTRY,
      reputationRegistry: this.env.REPUTATION_REGISTRY,
      memory,
      aiApiKey: this.env.VENICE_API_KEY,
      aiModel: this.env.VENICE_MODEL,
    });

    // Cache result (5 min)
    if (!memory.resolveCache) memory.resolveCache = {};
    memory.resolveCache[cacheKey] = {
      result,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };

    // Log resolution
    if (!memory.resolutionLog) memory.resolutionLog = [];
    memory.resolutionLog.push({
      id: result.receipt.id,
      targetAgent: body.agentUrl,
      verdict: result.verdict,
      trustScore: result.trustScore,
      task: body.task?.type,
      timestamp: result.receipt.resolvedAt,
    });

    await this.saveMemory(memory);
    return json(result);
  }

  private async getResolutionLog(): Promise<Response> {
    const memory = await this.loadMemory();
    return json({
      resolutions: memory.resolutionLog ?? [],
      count: (memory.resolutionLog ?? []).length,
    });
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  private async getMemory(): Promise<Response> {
    const memory = await this.loadMemory();
    return json(memory);
  }

  private async loadMemory(): Promise<AgentMemory> {
    const stored = await this.state.storage.get<AgentMemory>("memory");
    return (
      stored ?? {
        identity: { name: "TrustVault", address: "" },
        attestationsReceived: [],
        attestationsGiven: [],
        cooperationHistory: [],
        skills: [
          "trust-evaluation",
          "onchain-verification",
          "agent-cooperation",
          "reputation-analysis",
          "attestation-management",
        ],
        resolveCache: {},
        resolutionLog: [],
      }
    );
  }

  private async saveMemory(memory: AgentMemory): Promise<void> {
    await this.state.storage.put("memory", memory);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

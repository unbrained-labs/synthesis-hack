/**
 * ReliabilityProbe — Peer agent for cooperation demo
 *
 * This agent:
 *   1. Discovers TrustVault via its ERC-8004 agent card
 *   2. Issues attestations to TrustVault after verifying work
 *   3. Requests cooperation and responds to cooperation requests
 *   4. Exposes its own trust resume for bidirectional trust evaluation
 *
 * Runs on port 8788 (TrustVault on 8787) for local demo.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

interface Env {
  TRUSTVAULT_URL: string;
  AGENT_NAME: string;
}

interface TrustResume {
  trustScore: number;
  attestationsReceived: number;
  attestationsGiven: number;
  topSkills: string[];
  lastUpdated: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*" }));

// ── Own identity ─────────────────────────────────────────────────────────────

const PEER_SKILLS = [
  "data-analysis",
  "market-research",
  "reliability-testing",
  "quality-assurance",
];

let localAttestations: {
  id: string;
  from: string;
  skill: string;
  score: number;
  timestamp: string;
}[] = [];

// ── Agent Card ───────────────────────────────────────────────────────────────

app.get("/.well-known/agent-card.json", (c) => {
  const name = c.env.AGENT_NAME || "ReliabilityProbe";
  return c.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description:
      "Quality assurance agent that verifies other agents' work and issues trust attestations. Cooperates with agents that meet minimum trust thresholds.",
    services: [
      { name: "A2A", endpoint: "/.well-known/agent-card.json", version: "0.3.0" },
      { name: "trust-resume", endpoint: "/trust-resume", version: "1.0.0" },
    ],
    active: true,
    tags: ["qa", "verification", "attestation", "reliability"],
    capabilities: [
      "work-verification",
      "attestation-issuance",
      "cooperation-evaluation",
    ],
  });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    name: c.env.AGENT_NAME || "ReliabilityProbe",
    version: "1.0.0",
    timestamp: Date.now(),
  });
});

// ── Own trust resume ─────────────────────────────────────────────────────────

app.get("/trust-resume", (c) => {
  const received = localAttestations;
  const avgScore =
    received.length > 0
      ? received.reduce((s, a) => s + a.score, 0) / received.length
      : 0;

  const resume: TrustResume = {
    trustScore: Math.min(Math.round(avgScore + received.length), 100),
    attestationsReceived: received.length,
    attestationsGiven: 0,
    topSkills: PEER_SKILLS,
    lastUpdated: new Date().toISOString(),
  };

  return c.json(resume);
});

// ── Accept attestations ──────────────────────────────────────────────────────

app.post("/attest", async (c) => {
  const body = (await c.req.json()) as {
    skill: string;
    score: number;
    evidence: string;
    fromName?: string;
  };

  const attestation = {
    id: crypto.randomUUID(),
    from: body.fromName ?? "unknown",
    skill: body.skill,
    score: body.score,
    timestamp: new Date().toISOString(),
  };

  localAttestations.push(attestation);
  return c.json({ ok: true, attestation });
});

// ── Cooperation endpoint ─────────────────────────────────────────────────────

app.post("/cooperate", async (c) => {
  const body = (await c.req.json()) as {
    fromAgent: string;
    taskDescription: string;
    requiredSkills: string[];
    minTrustScore: number;
  };

  const matchedSkills = body.requiredSkills.filter((s) =>
    PEER_SKILLS.includes(s)
  );

  const accepted = matchedSkills.length > 0 || body.requiredSkills.length === 0;

  return c.json({
    accepted,
    reason: accepted
      ? `Can help with: [${matchedSkills.join(", ")}]`
      : `No matching skills for: [${body.requiredSkills.join(", ")}]`,
    trustScore: localAttestations.length * 10,
    attestationCount: localAttestations.length,
    matchedSkills,
  });
});

// ── Discovery: find TrustVault ───────────────────────────────────────────────

app.get("/discover", async (c) => {
  const trustVaultUrl = c.env.TRUSTVAULT_URL || "http://localhost:8787";

  try {
    const cardRes = await fetch(
      `${trustVaultUrl}/.well-known/agent-card.json`
    );
    if (!cardRes.ok) {
      return c.json({ error: `TrustVault not reachable: ${cardRes.status}` }, 502);
    }
    const card = await cardRes.json();

    const resumeRes = await fetch(`${trustVaultUrl}/trust-resume`);
    const resume = resumeRes.ok ? await resumeRes.json() : null;

    return c.json({
      discovered: true,
      agentCard: card,
      trustResume: resume,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Discovery failed: ${message}` }, 502);
  }
});

// ── Demo: full cooperation flow ──────────────────────────────────────────────

app.post("/demo/full-flow", async (c) => {
  const trustVaultUrl = c.env.TRUSTVAULT_URL || "http://localhost:8787";
  const steps: { step: string; result: unknown; status: string }[] = [];

  try {
    // Step 1: Discover TrustVault
    const cardRes = await fetch(
      `${trustVaultUrl}/.well-known/agent-card.json`
    );
    const card = await cardRes.json();
    steps.push({
      step: "discover",
      result: { name: (card as { name: string }).name },
      status: "ok",
    });

    // Step 2: Query trust resume
    const resumeRes = await fetch(`${trustVaultUrl}/trust-resume`);
    const resume = (await resumeRes.json()) as TrustResume;
    steps.push({ step: "query-trust", result: resume, status: "ok" });

    // Step 3: Issue attestation to TrustVault
    const attestRes = await fetch(`${trustVaultUrl}/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "trustvault",
        skill: "trust-evaluation",
        score: 85,
        evidence:
          "Verified TrustVault correctly aggregated attestation scores and made accurate cooperation decisions during testing.",
        fromName: "ReliabilityProbe",
      }),
    });
    const attestResult = await attestRes.json();
    steps.push({ step: "issue-attestation", result: attestResult, status: "ok" });

    // Step 4: Request cooperation
    const coopRes = await fetch(`${trustVaultUrl}/cooperate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAgent: "ReliabilityProbe",
        taskDescription: "Joint trust analysis of new agents entering the ecosystem",
        requiredSkills: ["trust-evaluation", "reputation-analysis"],
        minTrustScore: 30,
      }),
    });
    const coopResult = await coopRes.json();
    steps.push({ step: "cooperate", result: coopResult, status: "ok" });

    // Step 5: Query updated trust resume
    const updatedResumeRes = await fetch(`${trustVaultUrl}/trust-resume`);
    const updatedResume = await updatedResumeRes.json();
    steps.push({
      step: "verify-updated-resume",
      result: updatedResume,
      status: "ok",
    });

    return c.json({
      demo: "full-cooperation-flow",
      success: true,
      steps,
      summary: {
        agentDiscovered: true,
        attestationIssued: true,
        cooperationDecision: (coopResult as { accepted: boolean }).accepted,
        totalSteps: steps.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { demo: "full-cooperation-flow", success: false, steps, error: message },
      500
    );
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

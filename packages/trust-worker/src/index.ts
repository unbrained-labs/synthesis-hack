/**
 * TrustVault v2 — Cloudflare Worker entry point
 *
 * Routes:
 *   GET  /.well-known/agent-card.json  → ERC-8004 agent card
 *   GET  /health                       → health check
 *   GET  /agent.txt                    → machine-readable instructions
 *   GET  /agent.json                   → agent manifest
 *   GET  /trust-resume                 → current trust resume
 *   GET  /trust-resume/:address        → trust resume for any agent
 *   POST /attest                       → issue attestation to this agent
 *   POST /cooperate                    → request cooperation
 *   POST /query-trust                  → query another agent's trust profile
 *   GET  /cooperation-log              → cooperation history
 *
 * Durable Object: TrustAgent — persistent state for trust resume
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AgentCard, CooperationRequest, ResolveRequest } from "./types";
import { queryOnchainReputation, checkRegistration } from "./erc8004";
import { generateIntelligence } from "./inference";

// Re-export the Durable Object class for wrangler
export { TrustAgent } from "./agent";

const app = new Hono<{ Bindings: Env }>();

// ── CORS ─────────────────────────────────────────────────────────────────────

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Agent-Address"],
    maxAge: 86400,
  })
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAgentStub(c: { env: Env }, agentId = "trustvault-primary") {
  const id = c.env.TRUST_AGENT.idFromName(agentId);
  return c.env.TRUST_AGENT.get(id);
}

// ── ERC-8004 Agent Card ──────────────────────────────────────────────────────

app.get("/.well-known/agent-card.json", async (c) => {
  // Fetch live trust resume from Durable Object
  const stub = getAgentStub(c);
  const resumeRes = await stub.fetch(
    new Request("https://internal/trust-resume")
  );
  const trustResume = await resumeRes.json();

  const card: AgentCard = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "TrustVault",
    description:
      "Autonomous trust evaluation agent. Builds portable, verifiable trust resumes using ERC-8004 attestations. Evaluates cooperation requests based on onchain reputation — no central authority needed.",
    services: [
      {
        name: "A2A",
        endpoint: "/.well-known/agent-card.json",
        version: "0.3.0",
      },
      {
        name: "trust-resume",
        endpoint: "/trust-resume",
        version: "1.0.0",
      },
      {
        name: "cooperation",
        endpoint: "/cooperate",
        version: "1.0.0",
      },
    ],
    active: true,
    tags: [
      "trust",
      "reputation",
      "attestation",
      "cooperation",
      "erc-8004",
      "verifiable-credentials",
    ],
    capabilities: [
      "trust-resume-query",
      "attestation-issuance",
      "attestation-reception",
      "cooperation-evaluation",
      "onchain-verification",
      "reputation-aggregation",
    ],
    trustResume: trustResume as AgentCard["trustResume"],
  };

  return c.json(card, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    name: "TrustVault",
    version: "2.0.0",
    timestamp: Date.now(),
    features: [
      "trust-resume",
      "attestations",
      "cooperation",
      "durable-state",
      "erc-8004",
    ],
  });
});

// ── Trust Resume ─────────────────────────────────────────────────────────────

app.get("/trust-resume", async (c) => {
  const stub = getAgentStub(c);
  const res = await stub.fetch(new Request("https://internal/trust-resume"));
  const resume = await res.json();
  return c.json(resume);
});

app.get("/trust-resume/:address", async (c) => {
  const address = c.req.param("address");

  // Query on-chain reputation for any agent
  const reputation = await queryOnchainReputation(
    c.env.BASE_SEPOLIA_RPC,
    c.env.REPUTATION_REGISTRY,
    0 // Would need tokenId lookup — simplified for hackathon
  );

  return c.json({
    address,
    onchainReputation: reputation,
    source: "erc-8004-onchain",
  });
});

// ── Attestations ─────────────────────────────────────────────────────────────

app.post("/attest", async (c) => {
  const body = await c.req.json();
  const stub = getAgentStub(c);
  const res = await stub.fetch(
    new Request("https://internal/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const result = await res.json();
  return c.json(result, res.status);
});

// ── Cooperation ──────────────────────────────────────────────────────────────

app.post("/cooperate", async (c) => {
  const body = (await c.req.json()) as CooperationRequest;
  const stub = getAgentStub(c);
  const res = await stub.fetch(
    new Request("https://internal/cooperate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const decision = await res.json();
  return c.json(decision, res.status);
});

app.get("/cooperation-log", async (c) => {
  const stub = getAgentStub(c);
  const res = await stub.fetch(new Request("https://internal/memory"));
  const memory = (await res.json()) as { cooperationHistory: unknown[] };
  return c.json({
    entries: memory.cooperationHistory,
    count: memory.cooperationHistory.length,
  });
});

// ── Trust Resolution ────────────────────────────────────────────────────────

app.post("/resolve", async (c) => {
  const body = (await c.req.json()) as ResolveRequest;
  const stub = getAgentStub(c);
  const res = await stub.fetch(
    new Request("https://internal/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const result = await res.json();
  return c.json(result, res.status);
});

app.get("/resolution-log", async (c) => {
  const stub = getAgentStub(c);
  const res = await stub.fetch(
    new Request("https://internal/resolution-log")
  );
  const data = await res.json();
  return c.json(data);
});

// ── Query another agent's trust ──────────────────────────────────────────────

app.post("/query-trust", async (c) => {
  const body = (await c.req.json()) as {
    agentUrl: string;
    agentAddress?: string;
  };

  // Fetch the other agent's trust resume
  try {
    const cardRes = await fetch(
      `${body.agentUrl}/.well-known/agent-card.json`
    );
    if (!cardRes.ok) {
      return c.json(
        { error: `Agent not reachable: ${cardRes.status}` },
        502
      );
    }
    const card = await cardRes.json();

    // Try to get their trust resume
    const resumeRes = await fetch(`${body.agentUrl}/trust-resume`);
    const resume = resumeRes.ok ? await resumeRes.json() : null;

    return c.json({
      agentCard: card,
      trustResume: resume,
      queryTimestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to query agent: ${message}` }, 502);
  }
});

// ── Agent Identity Init ──────────────────────────────────────────────────────

app.post("/init", async (c) => {
  const body = await c.req.json();
  const stub = getAgentStub(c);
  const res = await stub.fetch(
    new Request("https://internal/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const result = await res.json();
  return c.json(result, res.status);
});

// ── Machine-readable instructions ────────────────────────────────────────────

app.get("/agent.txt", (c) => {
  return c.text(
    `# TrustVault — Quick Reference for AI Agents

Trust resume agent for the agent economy.
Builds portable, verifiable reputation profiles using ERC-8004 onchain attestations.

## When to Use TrustVault

- You need to verify another agent's reputation before cooperating
- You want to build a portable trust profile across platforms
- You need onchain attestations for verifiable work history
- You want to make trust-gated cooperation decisions

## Endpoints

Trust Resume:
  GET /trust-resume → Current trust resume (score, attestations, skills)

Issue Attestation:
  POST /attest
  Body: { "to": "<address>", "skill": "data-analysis", "score": 85, "evidence": "Delivered accurate report" }

Request Cooperation:
  POST /cooperate
  Body: { "fromAgent": "AgentX", "taskDescription": "Joint analysis", "requiredSkills": ["analysis"], "minTrustScore": 50 }

Query Another Agent:
  POST /query-trust
  Body: { "agentUrl": "https://other-agent.workers.dev" }

Agent Card (ERC-8004):
  GET /.well-known/agent-card.json

## Trust Score Algorithm

Base = average attestation score (0-100)
+ Volume bonus: +1 per attestation (max +20)
+ On-chain bonus: +5 per onchain attestation (max +15)
= Final trust score (capped at 100)

## ERC-8004 Registration

Identity Registry: 0x8004A818BFB912233c491871b3d84c89A494BD9e (Base Sepolia)
Reputation Registry: 0x8004B663056A597Dffe9eCcC1965A193B7388713 (Base Sepolia)
`,
    200,
    { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
  );
});

// ── Agent manifest ───────────────────────────────────────────────────────────

app.get("/agent.json", (c) => {
  return c.json(
    {
      schema_version: "1.0",
      name: "TrustVault",
      version: "2.0.0",
      description:
        "Autonomous trust evaluation agent. Builds portable, verifiable trust resumes via ERC-8004 attestations. Agents query TrustVault's reputation before cooperating — no central authority.",
      erc8004: {
        identity_registry: c.env.IDENTITY_REGISTRY,
        reputation_registry: c.env.REPUTATION_REGISTRY,
        network: "base-sepolia",
      },
      endpoints: {
        agent_card: "/.well-known/agent-card.json",
        trust_resume: "/trust-resume",
        attest: "/attest",
        cooperate: "/cooperate",
        query_trust: "/query-trust",
        health: "/health",
      },
      tools: [
        {
          name: "query_trust_resume",
          description: "Get an agent's portable trust resume with score and attestations",
        },
        {
          name: "issue_attestation",
          description: "Attest to another agent's work quality with evidence",
        },
        {
          name: "evaluate_cooperation",
          description: "Request cooperation — agent evaluates your trust profile and decides",
        },
        {
          name: "query_remote_agent",
          description: "Query any A2A-compatible agent's trust profile",
        },
      ],
      tech_stack: [
        "Cloudflare Workers",
        "Durable Objects",
        "Hono",
        "ERC-8004",
        "TypeScript",
        "Venice AI",
        "Base Sepolia",
      ],
      supported_chains: ["base-sepolia"],
      task_categories: [
        "trust-evaluation",
        "attestation",
        "cooperation",
        "reputation",
      ],
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
});

// ── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;

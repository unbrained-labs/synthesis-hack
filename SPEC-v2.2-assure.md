# TrustVault v2.2 — Outcome Assurance Spec

## One-liner

After a task completes, `POST /assure` tells you whether the result is reliable — with a portable certificate as proof.

## Why

`/resolve` answers "should I work with this agent?" (pre-task).
`/assure` answers "can I rely on this specific result?" (post-task).

No existing system combines: neutral validation + portable certificate + challenge handling for arbitrary agent work. Reputation.md does trust scoring. Originary does receipts. APP does permissions. None of them answer **"who is accountable if this result was wrong?"**

## Combined pitch

> TrustVault: trust resolution + outcome assurance for agents. Before a task, `/resolve` tells you if cooperation is safe. After a task, `/assure` tells you if the result is reliable. Both return signed certificates as proof.

---

## Endpoint: `POST /assure`

### Request

```typescript
interface AssureRequest {
  // What was done
  taskType: string;                    // "code-review" | "research" | "data-analysis" | "financial-analysis" | etc.

  // Who did it
  performedBy: string;                 // agent URL — we cross-reference with /resolve data

  // The work product
  artifact: {
    summary: string;                   // human-readable summary of what was produced
    output: unknown;                   // the actual output (JSON, text, whatever the agent returned)
    outputHash?: string;               // optional SHA-256 of output for integrity
  };

  // What was expected
  expectedOutcome: {
    description: string;               // what the task was supposed to achieve
    successCriteria?: string[];        // optional explicit criteria
  };

  // Optional: how thorough should validation be
  validationLevel?: "quick" | "standard" | "thorough";  // default: "standard"
}
```

### Response

```typescript
interface AssureResult {
  // Top-level verdict
  status: "ASSURED" | "FLAGGED" | "INSUFFICIENT_DATA";

  // Individual checks that were run
  checks: AssuranceCheck[];

  // Overall confidence in the assurance
  confidence: number;                  // 0-1

  // Human-readable recommendation
  recommendation: string;             // AI-generated, 2-3 sentences

  // Portable certificate (same pattern as /resolve receipts)
  certificate: {
    id: string;                        // UUID
    assuredAt: string;                 // ISO timestamp
    expiresAt: string;                 // 1 hour TTL
    assurer: string;                   // "TrustVault/2.2.0"
    performedBy: string;               // the agent URL that did the work
    taskType: string;
    status: "ASSURED" | "FLAGGED" | "INSUFFICIENT_DATA";
    artifactHash: string;              // SHA-256 of the artifact output
    digest: string;                    // SHA-256 of (id + status + artifactHash + timestamp)
  };
}

interface AssuranceCheck {
  check: string;                       // check identifier
  passed: boolean;
  score?: number;                      // 0-100 where applicable
  reason?: string;                     // explanation if failed or noteworthy
}
```

---

## Validation Pipeline

The `/assure` endpoint runs these checks in order. Each produces an `AssuranceCheck`.

### Check 1: `performer-trust-resolution`

Cross-reference the `performedBy` agent against our existing trust data.

- Look up cached `/resolve` result for this agent URL
- If no cached result, run a lightweight resolve (no AI reasoning, just score)
- **Passes if:** trust score >= 40 AND verdict != "UNTRUSTED"
- **Score:** the trust score from resolution

### Check 2: `performer-attestation-history`

Check if the performer has attestations relevant to this task type.

- Search `memory.attestationsReceived` for attestations from the performer
- Check if any attestation skills match the `taskType`
- **Passes if:** at least 1 relevant attestation with score >= 60
- **Score:** average of relevant attestation scores

### Check 3: `capability-match`

Verify the performer's agent card lists capabilities relevant to the task.

- Fetch performer's agent card (or use cached version from resolve)
- Match `taskType` against their `capabilities` / `tags`
- **Passes if:** at least one capability matches
- **Reason if failed:** "Agent card does not list capabilities related to {taskType}"

### Check 4: `output-completeness`

Basic structural validation of the artifact.

- Check that `artifact.output` is not null/empty
- Check that `artifact.summary` is not empty
- If `expectedOutcome.successCriteria` provided, use AI to check each criterion
- **Passes if:** output is non-empty AND (no criteria OR >= 50% criteria appear addressed)
- **Score:** percentage of success criteria addressed (or 100 if none specified)

### Check 5: `output-consistency`

AI-powered check: does the output actually match the expected outcome?

- Send artifact.summary + artifact.output + expectedOutcome.description to Venice AI
- Ask: "Does this output address the expected outcome? Reply YES/NO with one sentence."
- **Passes if:** AI says YES
- **Reason:** AI's one-sentence explanation

### Check 6: `sybil-risk`

Check for suspicious patterns.

- Is the performer attesting to their own work quality?
- Has the performer been flagged by sybil indicators in resolve?
- **Passes if:** no self-attestation detected AND sybil indicators are clean

---

## Status Logic

```
ASSURED:
  - All checks passed, OR
  - At most 1 non-critical check failed AND confidence >= 0.6

FLAGGED:
  - performer-trust-resolution failed, OR
  - output-consistency failed, OR
  - sybil-risk failed, OR
  - 2+ checks failed

INSUFFICIENT_DATA:
  - Performer unreachable (can't fetch agent card)
  - No attestation history AND no on-chain data AND performer not registered
  - Fewer than 3 checks could run
```

## Confidence Calculation

```
confidence = (checks_passed / checks_total) * 0.7 + (performer_trust_score / 100) * 0.3
```

---

## Types to add to `types.ts`

```typescript
// ── Assurance types ─────────────────────────────────────────────────────────

export interface AssureRequest {
  taskType: string;
  performedBy: string;
  artifact: {
    summary: string;
    output: unknown;
    outputHash?: string;
  };
  expectedOutcome: {
    description: string;
    successCriteria?: string[];
  };
  validationLevel?: "quick" | "standard" | "thorough";
}

export interface AssuranceCheck {
  check: string;
  passed: boolean;
  score?: number;
  reason?: string;
}

export interface AssureResult {
  status: "ASSURED" | "FLAGGED" | "INSUFFICIENT_DATA";
  checks: AssuranceCheck[];
  confidence: number;
  recommendation: string;
  certificate: {
    id: string;
    assuredAt: string;
    expiresAt: string;
    assurer: string;
    performedBy: string;
    taskType: string;
    status: "ASSURED" | "FLAGGED" | "INSUFFICIENT_DATA";
    artifactHash: string;
    digest: string;
  };
}

export interface AssuranceLogEntry {
  id: string;
  performedBy: string;
  taskType: string;
  status: "ASSURED" | "FLAGGED" | "INSUFFICIENT_DATA";
  confidence: number;
  timestamp: string;
}
```

Also add to `AgentMemory`:

```typescript
export interface AgentMemory {
  // ... existing fields ...
  assuranceLog: AssuranceLogEntry[];
}
```

---

## File: `assure.ts` — Implementation structure

```typescript
// assure.ts — Outcome Assurance Engine

export interface AssureContext {
  rpcUrl: string;
  identityRegistry: string;
  reputationRegistry: string;
  memory: AgentMemory;
  aiApiKey?: string;
  aiModel?: string;
}

export async function assureOutcome(
  req: AssureRequest,
  ctx: AssureContext
): Promise<AssureResult> {
  // 1. Run all 6 checks (some in parallel where independent)
  // 2. Compute status from check results
  // 3. Compute confidence
  // 4. Generate AI recommendation via Venice
  // 5. Build signed certificate
  // 6. Return AssureResult
}
```

### Check parallelism

These can run in parallel:
- Check 1 (performer-trust-resolution) + Check 3 (capability-match) — both fetch agent data
- Check 6 (sybil-risk) — uses only local memory

These depend on earlier results:
- Check 2 (attestation-history) — can run independently
- Check 4 (output-completeness) — independent
- Check 5 (output-consistency) — needs AI, can run in parallel with others

So: run checks 1+3+6 in parallel, then 2+4+5 in parallel, then aggregate.

---

## Routes to add

### `agent.ts` (Durable Object)

```typescript
if (request.method === "POST" && path === "/assure") {
  return this.handleAssure(request);
}
if (request.method === "GET" && path === "/assurance-log") {
  return this.getAssuranceLog();
}
```

### `index.ts` (Hono router)

```typescript
app.post("/assure", async (c) => {
  // proxy to DO, same pattern as /resolve
});

app.get("/assurance-log", async (c) => {
  // proxy to DO
});
```

---

## `inference.ts` — New function

```typescript
export async function generateAssuranceAnalysis(
  apiKey: string,
  model: string,
  context: {
    taskType: string;
    performedBy: string;
    artifactSummary: string;
    expectedOutcome: string;
    checkResults: { check: string; passed: boolean; reason?: string }[];
    status: string;
  }
): Promise<string> {
  // System prompt: "You are TrustVault's outcome assurance engine.
  //   Given a completed task, its output, and validation check results,
  //   provide a 2-3 sentence recommendation. Be specific about what
  //   passed, what failed, and whether the result should be relied upon."
}

export async function checkOutputConsistency(
  apiKey: string,
  model: string,
  artifactSummary: string,
  artifactOutput: string,
  expectedOutcome: string
): Promise<{ consistent: boolean; reason: string }> {
  // Ask AI: "Does this output address the expected outcome?"
  // Parse YES/NO + explanation
}
```

---

## Caching

- Cache assurance results by `SHA-256(performedBy + taskType + artifactHash)` for 5 minutes
- Same pattern as resolve cache in `AgentMemory.resolveCache`

---

## Demo additions (demo-cooperation.ts)

Add after existing steps:

```
Step 11: TrustVault resolves trust for Peer (task-aware)
  POST /resolve { agentUrl: PEER_URL, task: { type: "data-analysis", riskLevel: "high", ... } }

Step 12: Simulate Peer completing a task, then assure the outcome
  POST /assure {
    taskType: "data-analysis",
    performedBy: PEER_URL,
    artifact: {
      summary: "Market analysis of DeFi lending protocols",
      output: { findings: [...], recommendation: "..." }
    },
    expectedOutcome: {
      description: "Comprehensive analysis of top 5 DeFi lending protocols by TVL",
      successCriteria: ["covers at least 3 protocols", "includes risk assessment", "has data sources"]
    }
  }

Step 13: Show the certificate — portable proof of assured outcome
```

---

## Manifest updates

### `agent.json` — Add to tools array

```json
{
  "name": "assure_outcome",
  "description": "Post-task outcome assurance — submit a completed task artifact and get back validation checks, a confidence score, and a signed certificate proving the result was independently assessed"
}
```

### `agent.txt` — Add section

```
## Outcome Assurance (post-task)

After a task completes, verify the result:
  POST /assure
  Body: {
    "taskType": "data-analysis",
    "performedBy": "https://other-agent.workers.dev",
    "artifact": { "summary": "...", "output": {...} },
    "expectedOutcome": { "description": "..." }
  }

Returns: ASSURED/FLAGGED/INSUFFICIENT_DATA, individual check results, AI recommendation, and a signed certificate.
```

### Agent card — Add capabilities

```
"outcome-assurance", "post-task-validation", "assurance-certificate"
```

### Health — Add features

```
"outcome-assurance", "assurance-certificates"
```

---

## What this deliberately does NOT include (future roadmap)

These were in the other agent's proposal but are not buildable in hackathon scope:

1. **External validators** — /assure uses TrustVault's own AI + trust data, not a validator network. A validator marketplace is a v3 feature.

2. **Economic backstop / warranty** — No bonding or coverage amounts. Would require a smart contract for escrow + payout. Roadmap item.

3. **Challenge/dispute window** — No 24-hour dispute mechanism. The certificate has a 1-hour TTL; that's it. Real dispute resolution needs arbitration logic.

4. **`validatorsRequired` parameter** — Dropped. Single-validator (TrustVault itself) for now.

5. **`coverageAmount` parameter** — Dropped. No economic backing.

The pitch can reference these as the roadmap: "v2.2 ships single-validator assurance with certificates. The roadmap includes validator marketplace, economic backstop, and dispute resolution."

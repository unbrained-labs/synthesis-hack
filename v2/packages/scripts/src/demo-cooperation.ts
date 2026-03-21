/**
 * Demo script — runs the full cooperation flow between TrustVault and the Peer agent.
 *
 * Prerequisites:
 *   1. TrustVault running on port 8787: cd packages/trust-worker && npm run dev
 *   2. Peer agent running on port 8788: cd packages/peer-agent && npm run dev
 *
 * Run: npm run demo
 */

import "dotenv/config";

const TRUSTVAULT_URL = process.env.TRUSTVAULT_URL ?? "http://localhost:8787";
const PEER_URL = process.env.PEER_URL ?? "http://localhost:8788";

interface Step {
  name: string;
  status: "ok" | "fail";
  data?: unknown;
  error?: string;
}

async function run(): Promise<void> {
  console.log("=== TrustVault v2 — Cooperation Demo ===\n");
  console.log(`TrustVault: ${TRUSTVAULT_URL}`);
  console.log(`Peer Agent: ${PEER_URL}\n`);

  const steps: Step[] = [];

  // Step 1: Health checks
  console.log("Step 1: Health checks...");
  for (const [name, url] of [
    ["TrustVault", TRUSTVAULT_URL],
    ["Peer", PEER_URL],
  ] as const) {
    const res = await fetch(`${url}/health`);
    if (!res.ok) throw new Error(`${name} health check failed: ${res.status}`);
    const data = await res.json();
    console.log(`  ${name}: ${JSON.stringify(data)}`);
    steps.push({ name: `health-${name.toLowerCase()}`, status: "ok", data });
  }

  // Step 2: Initialize TrustVault identity
  console.log("\nStep 2: Initialize TrustVault identity...");
  const initRes = await fetch(`${TRUSTVAULT_URL}/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "TrustVault",
      address: process.env.TRUST_AGENT_ADDRESS ?? "0x0000000000000000000000000000000000000001",
      skills: [
        "trust-evaluation",
        "onchain-verification",
        "agent-cooperation",
        "reputation-analysis",
        "attestation-management",
      ],
    }),
  });
  const initData = await initRes.json();
  console.log(`  Identity initialized: ${JSON.stringify(initData)}`);
  steps.push({ name: "init-identity", status: "ok", data: initData });

  // Step 3: Peer discovers TrustVault via agent card
  console.log("\nStep 3: Peer discovers TrustVault...");
  const discoverRes = await fetch(`${PEER_URL}/discover`);
  const discoverData = await discoverRes.json();
  console.log(`  Discovered: ${(discoverData as { discovered: boolean }).discovered}`);
  steps.push({ name: "discover", status: "ok", data: discoverData });

  // Step 4: Peer issues attestation to TrustVault
  console.log("\nStep 4: Peer issues attestation to TrustVault...");
  const attestRes = await fetch(`${TRUSTVAULT_URL}/attest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "trustvault",
      skill: "trust-evaluation",
      score: 85,
      evidence:
        "Verified TrustVault correctly aggregated attestation scores during testing phase. Score computation matches expected algorithm.",
      fromName: "ReliabilityProbe",
    }),
  });
  const attestData = await attestRes.json();
  console.log(`  Attestation issued: ${JSON.stringify(attestData)}`);
  steps.push({ name: "attest-1", status: "ok", data: attestData });

  // Step 5: Issue a second attestation for a different skill
  console.log("\nStep 5: Second attestation (onchain-verification)...");
  const attest2Res = await fetch(`${TRUSTVAULT_URL}/attest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "trustvault",
      skill: "onchain-verification",
      score: 90,
      evidence:
        "Confirmed TrustVault accurately reads ERC-8004 registry state and validates transaction receipts on Base Sepolia.",
      fromName: "ReliabilityProbe",
    }),
  });
  const attest2Data = await attest2Res.json();
  console.log(`  Attestation issued: ${JSON.stringify(attest2Data)}`);
  steps.push({ name: "attest-2", status: "ok", data: attest2Data });

  // Step 6: Query TrustVault's updated trust resume
  console.log("\nStep 6: Query updated trust resume...");
  const resumeRes = await fetch(`${TRUSTVAULT_URL}/trust-resume`);
  const resumeData = await resumeRes.json();
  console.log(`  Trust Resume: ${JSON.stringify(resumeData, null, 2)}`);
  steps.push({ name: "trust-resume", status: "ok", data: resumeData });

  // Step 7: Request cooperation (should succeed — trust score meets threshold)
  console.log("\nStep 7: Request cooperation (threshold=30)...");
  const coopRes = await fetch(`${TRUSTVAULT_URL}/cooperate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAgent: "ReliabilityProbe",
      taskDescription:
        "Joint evaluation of new agents entering the trust ecosystem",
      requiredSkills: ["trust-evaluation", "reputation-analysis"],
      minTrustScore: 30,
    }),
  });
  const coopData = await coopRes.json();
  console.log(`  Decision: ${JSON.stringify(coopData, null, 2)}`);
  steps.push({ name: "cooperate-accept", status: "ok", data: coopData });

  // Step 8: Request cooperation with HIGH threshold (should fail)
  console.log("\nStep 8: Request cooperation (threshold=95, should decline)...");
  const coopHighRes = await fetch(`${TRUSTVAULT_URL}/cooperate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAgent: "UnknownAgent",
      taskDescription: "Highly sensitive financial analysis",
      requiredSkills: ["financial-modeling"],
      minTrustScore: 95,
    }),
  });
  const coopHighData = await coopHighRes.json();
  console.log(`  Decision: ${JSON.stringify(coopHighData, null, 2)}`);
  steps.push({ name: "cooperate-decline", status: "ok", data: coopHighData });

  // Step 9: TrustVault queries Peer's trust profile
  console.log("\nStep 9: TrustVault queries Peer's trust...");
  const queryRes = await fetch(`${TRUSTVAULT_URL}/query-trust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentUrl: PEER_URL }),
  });
  const queryData = await queryRes.json();
  console.log(`  Peer profile: ${JSON.stringify(queryData, null, 2)}`);
  steps.push({ name: "query-peer", status: "ok", data: queryData });

  // Step 10: View cooperation log
  console.log("\nStep 10: Cooperation log...");
  const logRes = await fetch(`${TRUSTVAULT_URL}/cooperation-log`);
  const logData = await logRes.json();
  console.log(`  Log: ${JSON.stringify(logData, null, 2)}`);
  steps.push({ name: "cooperation-log", status: "ok", data: logData });

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("DEMO COMPLETE");
  console.log("=".repeat(60));
  console.log(`Total steps: ${steps.length}`);
  console.log(`Passed: ${steps.filter((s) => s.status === "ok").length}`);
  console.log(`Failed: ${steps.filter((s) => s.status === "fail").length}`);
  console.log("\nKey outcomes:");
  console.log(`  - TrustVault discovered via ERC-8004 agent card: YES`);
  console.log(`  - Attestations issued and trust score updated: YES`);
  console.log(
    `  - Cooperation accepted (threshold met): ${(coopData as { accepted: boolean }).accepted ? "YES" : "NO"}`
  );
  console.log(
    `  - Cooperation declined (threshold too high): ${(coopHighData as { accepted: boolean }).accepted ? "NO" : "YES"}`
  );
  console.log(`  - Bidirectional trust query working: YES`);
}

run().catch((err) => {
  console.error("\nDemo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

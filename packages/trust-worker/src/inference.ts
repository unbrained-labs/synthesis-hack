/**
 * AI inference via Venice AI (no-data-retention).
 * Used for trust reasoning, cooperation decisions, and resolution analysis.
 */

export async function generateTrustAnalysis(
  apiKey: string,
  model: string,
  context: {
    agentName: string;
    trustScore: number;
    attestations: number;
    skills: string[];
    taskDescription: string;
  }
): Promise<string> {
  const prompt = `You are TrustVault, an autonomous trust evaluation agent. Analyze this cooperation request:

Agent: ${context.agentName}
Trust Score: ${context.trustScore}/100
Attestations: ${context.attestations}
Skills: ${context.skills.join(", ")}
Task: ${context.taskDescription}

Provide a brief (2-3 sentence) trust assessment and cooperation recommendation. Be direct and evidence-based.`;

  return callVenice(apiKey, model, prompt);
}

export async function generateResolveAnalysis(
  apiKey: string,
  model: string,
  context: {
    agentName: string;
    trustScore: number;
    verdict: string;
    attestations: number;
    skills: string[];
    taskDescription: string;
    erc8004Registered: boolean;
    onchainFeedback: number;
    capabilityMatch: string[];
    capabilityGap: string[];
    riskLevel: string;
    sybilIndicators: {
      selfAttestationDetected: boolean;
      attestationVelocityNormal: boolean;
      uniqueAttestorRatio: number;
    };
  }
): Promise<string> {
  const prompt = `Resolve trust for agent "${context.agentName}" for task: ${context.taskDescription}

Evidence:
- Trust Score: ${context.trustScore}/100 → Verdict: ${context.verdict}
- ERC-8004 Registered: ${context.erc8004Registered}
- On-chain feedback events: ${context.onchainFeedback}
- Local attestations: ${context.attestations}
- Skills verified: ${context.skills.join(", ") || "none"}
- Risk level: ${context.riskLevel}
- Capability match: ${context.capabilityMatch.join(", ") || "none checked"}
- Capability gap: ${context.capabilityGap.join(", ") || "none"}
- Sybil: self-attestation=${context.sybilIndicators.selfAttestationDetected}, velocity-normal=${context.sybilIndicators.attestationVelocityNormal}, uniqueness=${context.sybilIndicators.uniqueAttestorRatio}

Give a 2-3 sentence trust assessment. Name the strongest signal and the biggest risk. If there is a capability gap, mention it. Do not hedge — give a clear recommendation.`;

  const systemPrompt =
    "You are TrustVault, a trust resolution engine for autonomous agents. Given evidence about an agent (on-chain state, attestations, capabilities, sybil indicators), provide a concise trust assessment. Be specific and direct.";

  return callVeniceWithSystem(apiKey, model, systemPrompt, prompt);
}

export async function generateIntelligence(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  return callVenice(apiKey, model, prompt);
}

async function callVenice(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  return callVeniceWithSystem(
    apiKey,
    model,
    "You are TrustVault, an autonomous agent that builds and evaluates verifiable trust profiles. You are methodical, evidence-based, and concise. You don't trust claims — you verify them onchain.",
    prompt
  );
}

async function callVeniceWithSystem(
  apiKey: string,
  model: string,
  systemPrompt: string,
  prompt: string
): Promise<string> {
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) throw new Error(`Venice API ${res.status}`);

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  return data.choices[0]?.message?.content ?? "Analysis unavailable.";
}

/**
 * AI inference via Venice AI (no-data-retention).
 * Used for trust reasoning and cooperation decisions.
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
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are TrustVault, an autonomous agent that builds and evaluates verifiable trust profiles. You are methodical, evidence-based, and concise. You don't trust claims — you verify them onchain.",
        },
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

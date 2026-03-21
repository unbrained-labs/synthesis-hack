// ── Environment bindings ─────────────────────────────────────────────────────

export interface Env {
  TRUST_AGENT: DurableObjectNamespace;
  IDENTITY_REGISTRY: string;
  REPUTATION_REGISTRY: string;
  USDC_ADDRESS: string;
  BASE_SEPOLIA_RPC: string;
  VENICE_API_KEY?: string;
  VENICE_MODEL?: string;
  TRUST_AGENT_PRIVATE_KEY?: string;
}

// ── ERC-8004 types ───────────────────────────────────────────────────────────

export interface AgentCard {
  type: string;
  name: string;
  description: string;
  services: AgentService[];
  active: boolean;
  tags: string[];
  capabilities: string[];
  trustResume: TrustResume;
}

export interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
}

export interface TrustResume {
  attestationsReceived: number;
  attestationsGiven: number;
  trustScore: number;
  lastUpdated: string;
  topSkills: string[];
}

// ── Attestation types ────────────────────────────────────────────────────────

export interface Attestation {
  id: string;
  from: string;
  to: string;
  skill: string;
  score: number; // 1-100
  evidence: string;
  timestamp: string;
  txHash?: string;
  onchain: boolean;
}

export interface AttestationRequest {
  to: string;
  skill: string;
  score: number;
  evidence: string;
}

// ── Cooperation types ────────────────────────────────────────────────────────

export interface CooperationRequest {
  fromAgent: string;
  taskDescription: string;
  requiredSkills: string[];
  minTrustScore: number;
}

export interface CooperationDecision {
  accepted: boolean;
  reason: string;
  trustScore: number;
  attestationCount: number;
  matchedSkills: string[];
}

// ── Resolution types ────────────────────────────────────────────────────────

export type Verdict = "TRUSTED" | "CAUTIOUS" | "UNTRUSTED" | "UNKNOWN";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ResolveRequest {
  agentUrl: string;
  task?: {
    type: string;
    description?: string;
    riskLevel: RiskLevel;
    requiredCapabilities: string[];
    valueAtStake?: string;
  };
}

export interface ResolveResult {
  verdict: Verdict;
  confidence: number;
  trustScore: number;

  taskFit: {
    capabilityMatch: string[];
    capabilityGap: string[];
    riskAssessment: RiskLevel;
    safeguards: string[];
  };

  report: {
    identity: {
      reachable: boolean;
      hasAgentCard: boolean;
      name: string | null;
      capabilities: string[];
      erc8004Registered: boolean;
      tokenId: number | null;
    };
    onchainReputation: {
      feedbackCount: number;
      averageScore: number;
    };
    localTrust: {
      directAttestations: number;
      averageScore: number;
      skills: string[];
    };
    sybilIndicators: {
      selfAttestationDetected: boolean;
      attestationVelocityNormal: boolean;
      uniqueAttestorRatio: number;
    };
    reasoning: string;
  };

  receipt: {
    id: string;
    resolvedAt: string;
    expiresAt: string;
    resolver: string;
    targetAgent: string;
    digest: string;
  };
}

export interface CachedResolution {
  result: ResolveResult;
  expiresAt: string;
}

export interface ResolutionLogEntry {
  id: string;
  targetAgent: string;
  verdict: Verdict;
  trustScore: number;
  task?: string;
  timestamp: string;
}

// ── Agent memory (Durable Object state) ──────────────────────────────────────

export interface AgentMemory {
  identity: {
    name: string;
    address: string;
    tokenId?: number;
    registeredAt?: string;
  };
  attestationsReceived: Attestation[];
  attestationsGiven: Attestation[];
  cooperationHistory: CooperationLogEntry[];
  skills: string[];
  resolveCache: Record<string, CachedResolution>;
  resolutionLog: ResolutionLogEntry[];
}

export interface CooperationLogEntry {
  partner: string;
  task: string;
  decision: "accepted" | "declined" | "negotiated";
  trustScore: number;
  timestamp: string;
}

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
}

export interface CooperationLogEntry {
  partner: string;
  task: string;
  decision: "accepted" | "declined" | "negotiated";
  trustScore: number;
  timestamp: string;
}

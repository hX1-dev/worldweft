import { v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';

export const AUTONOMY_DECISION_LEGACY_CONTRACT_VERSION =
  'taixu.autonomy-decision.v1' as const;
export const AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION =
  'taixu.autonomy-decision.v2' as const;
export const AUTONOMY_DECISION_CONTRACT_VERSION =
  'taixu.autonomy-decision.v3' as const;
export const AUTONOMY_CANDIDATE_LIMIT = 32 as const;
export const AUTONOMY_CANDIDATE_PROJECTION_VERSION =
  'taixu.autonomy-candidate-projection.v1' as const;

export const autonomyCandidateStatusValidator = v.union(
  v.literal('eligible'),
  v.literal('blocked'),
  v.literal('delegated'),
);

export const autonomyDecisionSourceValidator = v.union(
  v.literal('rule'),
  v.literal('llm'),
  v.literal('event'),
  v.literal('utility'),
  v.literal('fallback'),
);

export const autonomyDecisionOutcomeValidator = v.union(
  v.literal('chosen'),
  v.literal('idle'),
);

export const autonomyCandidateV1Validator = v.object({
  candidateId: v.string(),
  planner: v.string(),
  intentKind: v.string(),
  targetRef: v.optional(v.string()),
  status: autonomyCandidateStatusValidator,
  blockedReasonCode: v.optional(v.string()),
  legacyOrder: v.number(),
});

export const autonomyCandidateV2Validator = v.object({
  candidateId: v.string(),
  planner: v.string(),
  intentKind: v.string(),
  targetRef: v.optional(v.string()),
  status: autonomyCandidateStatusValidator,
  blockedReasonCode: v.optional(v.string()),
  legacyOrder: v.number(),
  survivalUrgency: v.number(),
  survivalReasonCodes: v.array(v.string()),
});

export const autonomyCandidateV3Validator = v.object({
  candidateId: v.string(),
  planner: v.string(),
  intentKind: v.string(),
  targetRef: v.optional(v.string()),
  status: autonomyCandidateStatusValidator,
  blockedReasonCode: v.optional(v.string()),
  legacyOrder: v.number(),
  survivalUrgency: v.number(),
  survivalReasonCodes: v.array(v.string()),
  needScore: v.number(),
  personaFit: v.number(),
  personaReasonCodes: v.array(v.string()),
  commitmentUrgency: v.number(),
  relationshipReasons: v.array(v.string()),
  memorySourceIds: v.array(v.string()),
  projectedFromCandidateId: v.optional(v.string()),
  candidateProjectionDigest: v.optional(v.string()),
  consequenceId: v.optional(v.string()),
  sourceOutcomeId: v.optional(v.string()),
  consequenceProjectionDigest: v.optional(v.string()),
});

// The table remains able to read immutable C017a v1 and C017b v2 rows while
// all new traces are validated against the stricter C017c v3 object.
export const autonomyCandidateValidator = v.union(
  autonomyCandidateV1Validator,
  autonomyCandidateV2Validator,
  autonomyCandidateV3Validator,
);

export const autonomyDecisionBoundsValidator = v.object({
  limit: v.number(),
  included: v.number(),
  total: v.number(),
  truncated: v.boolean(),
});

export const autonomySurvivalEnvelopeValidator = v.object({
  state: v.union(
    v.literal('incapacitated'),
    v.literal('danger'),
    v.literal('recovery'),
    v.literal('stable'),
  ),
  urgency: v.number(),
  reasonCodes: v.array(v.string()),
  decisionKind: v.string(),
});

export const autonomyPersonaPolicyValidator = v.object({
  policyVersion: v.literal('taixu.persona-policy.v1'),
  innerTrait: v.optional(v.string()),
  outerTrait: v.optional(v.string()),
  innerTraitKnown: v.boolean(),
  outerTraitKnown: v.boolean(),
  dimensions: v.object({
    riskTolerance: v.number(),
    helpingBias: v.number(),
    commitmentBias: v.number(),
    conflictBias: v.number(),
    socialBias: v.number(),
    cultivationBias: v.number(),
    persistenceBias: v.number(),
    evidenceBias: v.number(),
    resourceReserveBias: v.number(),
  }),
  reasonCodes: v.array(v.string()),
  selfBinding: v.optional(
    v.object({
      selfContractVersion: v.literal('taixu.self-core.v1'),
      actorId: v.string(),
      revision: v.number(),
      digest: v.string(),
      sourceRefs: v.array(v.string()),
    }),
  ),
  policyDigest: v.string(),
});

const autonomyDecisionTraceV1Validator = v.object({
  contractVersion: v.literal(AUTONOMY_DECISION_LEGACY_CONTRACT_VERSION),
  decisionId: v.string(),
  actorId: v.string(),
  observationRevision: v.string(),
  candidates: v.array(autonomyCandidateV1Validator),
  chosenCandidateId: v.optional(v.string()),
  decisionSource: autonomyDecisionSourceValidator,
  outcome: autonomyDecisionOutcomeValidator,
  idleReasonCode: v.optional(v.string()),
  exceptionReason: v.optional(v.string()),
  bounds: autonomyDecisionBoundsValidator,
  createdAt: v.number(),
});

const autonomyDecisionTraceV2Validator = v.object({
  contractVersion: v.literal(AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION),
  decisionId: v.string(),
  actorId: v.string(),
  observationRevision: v.string(),
  candidates: v.array(autonomyCandidateV2Validator),
  chosenCandidateId: v.optional(v.string()),
  decisionSource: autonomyDecisionSourceValidator,
  outcome: autonomyDecisionOutcomeValidator,
  idleReasonCode: v.optional(v.string()),
  exceptionReason: v.optional(v.string()),
  survivalEnvelope: autonomySurvivalEnvelopeValidator,
  bounds: autonomyDecisionBoundsValidator,
  createdAt: v.number(),
});

const autonomyDecisionTraceV3Validator = v.object({
  contractVersion: v.literal(AUTONOMY_DECISION_CONTRACT_VERSION),
  decisionId: v.string(),
  actorId: v.string(),
  observationRevision: v.string(),
  candidates: v.array(autonomyCandidateV3Validator),
  chosenCandidateId: v.optional(v.string()),
  decisionSource: autonomyDecisionSourceValidator,
  outcome: autonomyDecisionOutcomeValidator,
  idleReasonCode: v.optional(v.string()),
  exceptionReason: v.optional(v.string()),
  exceptionSourceIds: v.array(v.string()),
  survivalEnvelope: autonomySurvivalEnvelopeValidator,
  personaPolicy: autonomyPersonaPolicyValidator,
  bounds: autonomyDecisionBoundsValidator,
  createdAt: v.number(),
});

export const autonomyDecisionTraceValidator = v.union(
  autonomyDecisionTraceV1Validator,
  autonomyDecisionTraceV2Validator,
  autonomyDecisionTraceV3Validator,
);

export type AutonomyCandidateStatus = 'eligible' | 'blocked' | 'delegated';
export type AutonomyDecisionSource =
  | 'rule'
  | 'llm'
  | 'event'
  | 'utility'
  | 'fallback';
export type AutonomyDecisionOutcome = 'chosen' | 'idle';

export type AutonomyCandidateV1 = {
  candidateId: string;
  planner: string;
  intentKind: string;
  targetRef?: string;
  status: AutonomyCandidateStatus;
  blockedReasonCode?: string;
  legacyOrder: number;
};

export type AutonomyCandidateV2 = AutonomyCandidateV1 & {
  survivalUrgency: number;
  survivalReasonCodes: string[];
};

export type AutonomyCandidateV3 = AutonomyCandidateV2 & {
  needScore: number;
  personaFit: number;
  personaReasonCodes: string[];
  commitmentUrgency: number;
  relationshipReasons: string[];
  memorySourceIds: string[];
  projectedFromCandidateId?: string;
  candidateProjectionDigest?: string;
  consequenceId?: string;
  sourceOutcomeId?: string;
  consequenceProjectionDigest?: string;
};

export function autonomyCandidateProjectionDigest(input: {
  projectedFromCandidateId: string;
  projectedCandidateId: string;
  sourceCandidateDigest: string;
  warrantCandidateDigest: string;
}) {
  return stableObservationDigest({
    contractVersion: AUTONOMY_CANDIDATE_PROJECTION_VERSION,
    ...input,
  });
}

type AutonomyDecisionTraceBase = {
  decisionId: string;
  actorId: string;
  observationRevision: string;
  chosenCandidateId?: string;
  decisionSource: AutonomyDecisionSource;
  outcome: AutonomyDecisionOutcome;
  idleReasonCode?: string;
  exceptionReason?: string;
  exceptionSourceIds?: string[];
  bounds: {
    limit: number;
    included: number;
    total: number;
    truncated: boolean;
  };
  createdAt: number;
};

export type AutonomyDecisionTraceV1 = AutonomyDecisionTraceBase & {
  contractVersion: typeof AUTONOMY_DECISION_LEGACY_CONTRACT_VERSION;
  candidates: AutonomyCandidateV1[];
};

export type AutonomyDecisionTraceV2 = AutonomyDecisionTraceBase & {
  contractVersion: typeof AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION;
  candidates: AutonomyCandidateV2[];
  survivalEnvelope: {
    state: 'incapacitated' | 'danger' | 'recovery' | 'stable';
    urgency: number;
    reasonCodes: string[];
    decisionKind: string;
  };
};

export type AutonomyDecisionTraceV3 = AutonomyDecisionTraceBase & {
  contractVersion: typeof AUTONOMY_DECISION_CONTRACT_VERSION;
  candidates: AutonomyCandidateV3[];
  exceptionSourceIds: string[];
  survivalEnvelope: AutonomyDecisionTraceV2['survivalEnvelope'];
  personaPolicy: {
    policyVersion: 'taixu.persona-policy.v1';
    innerTrait?: string;
    outerTrait?: string;
    innerTraitKnown: boolean;
    outerTraitKnown: boolean;
    dimensions: {
      riskTolerance: number;
      helpingBias: number;
      commitmentBias: number;
      conflictBias: number;
      socialBias: number;
      cultivationBias: number;
      persistenceBias: number;
      evidenceBias: number;
      resourceReserveBias: number;
    };
    reasonCodes: string[];
    selfBinding?: {
      selfContractVersion: 'taixu.self-core.v1';
      actorId: string;
      revision: number;
      digest: string;
      sourceRefs: string[];
    };
    policyDigest: string;
  };
};

export type AutonomyDecisionTrace =
  | AutonomyDecisionTraceV1
  | AutonomyDecisionTraceV2
  | AutonomyDecisionTraceV3;

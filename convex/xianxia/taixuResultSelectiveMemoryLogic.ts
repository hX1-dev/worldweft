import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import {
  deriveTaixuEmbodimentGate,
  type TaixuGodotAuthorityReceipt,
} from './taixuEmbodimentReceiptLogic';
import {
  TaixuEvidenceContextError,
  validateTaixuEvidenceCard,
  type TaixuEvidenceCardV1,
  type TaixuEvidenceVisibility,
} from './taixuEvidenceContextLogic';
import { stableDigest } from './personaPolicyLogic';

export const TAIXU_RESULT_SELECTIVE_MEMORY_VERSION = 'taixu.result-selective-memory.v1' as const;
export const TAIXU_RESULT_PROPOSAL_HISTORY_LIMIT = 8;
export const TAIXU_RESULT_MEMORY_RELIABILITY_MINIMUM = 60;
export const TAIXU_RESULT_MEMORY_IMPORTANCE_MINIMUM = 50;

export type TaixuResultProposalKind = 'memory_eligibility' | 'habit_eligibility';

export type TaixuResultSelectiveProposalV1 = {
  contractVersion: typeof TAIXU_RESULT_SELECTIVE_MEMORY_VERSION;
  proposalId: string;
  kind: TaixuResultProposalKind;
  actorId: string;
  decisionId: string;
  candidateId: string;
  receiptId: string;
  receiptRevision: number;
  terminalSourceRef: string;
  evidenceDigest: string;
  evidenceVisibility: Extract<TaixuEvidenceVisibility, 'public' | 'actor_private'>;
  score: number;
  reasonCodes: string[];
};

export type TaixuResultSelectiveMemoryFailureCode =
  | 'result_receipt_missing'
  | 'result_receipt_invalid'
  | 'result_receipt_not_arrived'
  | 'result_evidence_invalid'
  | 'result_evidence_visibility_denied'
  | 'result_evidence_source_denied'
  | 'result_evidence_polarity_denied'
  | 'result_evidence_fence_mismatch'
  | 'result_evidence_expired'
  | 'result_insufficient_salience'
  | 'result_history_invalid'
  | 'result_history_capacity_full'
  | 'result_history_receipt_conflict'
  | 'result_history_replay_mismatch';

export type TaixuResultSelectiveMemoryResult =
  | { kind: 'proposal'; proposals: TaixuResultSelectiveProposalV1[] }
  | { kind: 'replay'; proposals: TaixuResultSelectiveProposalV1[] }
  | { kind: 'ineligible'; reasonCode: Extract<TaixuResultSelectiveMemoryFailureCode, 'result_receipt_missing' | 'result_receipt_not_arrived' | 'result_insufficient_salience' | 'result_history_capacity_full'> }
  | { kind: 'rejected'; reasonCode: Exclude<TaixuResultSelectiveMemoryFailureCode, 'result_receipt_missing' | 'result_receipt_not_arrived' | 'result_insufficient_salience' | 'result_history_capacity_full'> };

/**
 * Returns only bounded, auditable eligibility proposals. It deliberately does
 * not update memory, habits, needs, relationships, candidates, or world facts.
 */
export function deriveTaixuResultSelectiveMemory(input: {
  trace: AutonomyDecisionTraceV3;
  candidateId: string;
  receipt?: TaixuGodotAuthorityReceipt;
  evidence?: { card: unknown; validThroughGameHour: number };
  semanticTime: number;
  priorProposals?: readonly TaixuResultSelectiveProposalV1[];
}): TaixuResultSelectiveMemoryResult {
  if (!input.receipt) return { kind: 'ineligible', reasonCode: 'result_receipt_missing' };

  let gate;
  try {
    gate = deriveTaixuEmbodimentGate({
      trace: input.trace,
      candidateId: input.candidateId,
      receipt: input.receipt,
    });
  } catch {
    return { kind: 'rejected', reasonCode: 'result_receipt_invalid' };
  }
  if (gate.memoryEligibility !== 'authoritative_arrival_only') {
    return { kind: 'ineligible', reasonCode: 'result_receipt_not_arrived' };
  }

  const evidence = validateResultEvidence(input.evidence, input.receipt, input.semanticTime);
  if (evidence.kind !== 'valid') return evidence;
  if (
    evidence.card.reliability < TAIXU_RESULT_MEMORY_RELIABILITY_MINIMUM ||
    evidence.card.importance < TAIXU_RESULT_MEMORY_IMPORTANCE_MINIMUM
  ) {
    return { kind: 'ineligible', reasonCode: 'result_insufficient_salience' };
  }

  const proposals = createProposals(input.receipt, evidence.card, input.trace, input.candidateId);
  return applyHistory(proposals, input.priorProposals);
}

function validateResultEvidence(
  evidence: { card: unknown; validThroughGameHour: number } | undefined,
  receipt: TaixuGodotAuthorityReceipt,
  semanticTime: number,
): { kind: 'valid'; card: TaixuEvidenceCardV1 } | TaixuResultSelectiveMemoryResult {
  if (!Number.isSafeInteger(semanticTime) || semanticTime < 0 || !evidence ||
      !Number.isSafeInteger(evidence.validThroughGameHour) || evidence.validThroughGameHour < 0) {
    return { kind: 'rejected', reasonCode: 'result_evidence_invalid' };
  }
  if (semanticTime > evidence.validThroughGameHour) {
    return { kind: 'rejected', reasonCode: 'result_evidence_expired' };
  }

  let card: TaixuEvidenceCardV1;
  try {
    card = validateTaixuEvidenceCard(evidence.card, {
      actorId: receipt.actorId,
      semanticTime,
    });
  } catch (error) {
    if (error instanceof TaixuEvidenceContextError && error.code === 'evidence_visibility_denied') {
      return { kind: 'rejected', reasonCode: 'result_evidence_visibility_denied' };
    }
    return { kind: 'rejected', reasonCode: 'result_evidence_invalid' };
  }
  if (card.visibility === 'secret') {
    return { kind: 'rejected', reasonCode: 'result_evidence_visibility_denied' };
  }
  if (card.source.kind !== 'direct_observation' && card.source.kind !== 'world_fact') {
    return { kind: 'rejected', reasonCode: 'result_evidence_source_denied' };
  }
  if (card.polarity !== 'supported') {
    return { kind: 'rejected', reasonCode: 'result_evidence_polarity_denied' };
  }
  if (
    card.subject !== `receipt:${receipt.receiptId}` ||
    card.source.id !== receipt.terminalSourceRef ||
    card.observedAtSemanticTime > evidence.validThroughGameHour
  ) {
    return { kind: 'rejected', reasonCode: 'result_evidence_fence_mismatch' };
  }
  return { kind: 'valid', card };
}

function createProposals(
  receipt: TaixuGodotAuthorityReceipt,
  card: TaixuEvidenceCardV1,
  trace: AutonomyDecisionTraceV3,
  candidateId: string,
): TaixuResultSelectiveProposalV1[] {
  const memoryScore = Math.min(card.reliability, card.importance);
  const habitScore = Math.min(memoryScore, Math.floor(memoryScore * 0.75));
  return (['memory_eligibility', 'habit_eligibility'] as const).map((kind) => {
    const semantic = {
      contractVersion: TAIXU_RESULT_SELECTIVE_MEMORY_VERSION,
      kind,
      actorId: trace.actorId,
      decisionId: trace.decisionId,
      candidateId,
      receiptId: receipt.receiptId,
      receiptRevision: receipt.revision,
      terminalSourceRef: receipt.terminalSourceRef,
      evidenceDigest: card.digest,
    };
    return {
      ...semantic,
      proposalId: `result-proposal:${stableDigest(semantic)}`,
      evidenceVisibility: card.visibility === 'public' ? 'public' : 'actor_private',
      score: kind === 'memory_eligibility' ? memoryScore : habitScore,
      reasonCodes: ['godot_arrived_receipt', 'visible_supported_result_evidence'],
    };
  });
}

function applyHistory(
  proposals: TaixuResultSelectiveProposalV1[],
  prior: readonly TaixuResultSelectiveProposalV1[] | undefined,
): TaixuResultSelectiveMemoryResult {
  if (prior !== undefined && !Array.isArray(prior)) {
    return { kind: 'rejected', reasonCode: 'result_history_invalid' };
  }
  const history: readonly TaixuResultSelectiveProposalV1[] = prior ?? [];
  if (history.length > TAIXU_RESULT_PROPOSAL_HISTORY_LIMIT || !history.every(validProposal)) {
    return { kind: 'rejected', reasonCode: 'result_history_invalid' };
  }
  const sameReceipt = history.filter((entry) => entry.receiptId === proposals[0].receiptId);
  if (sameReceipt.some((entry) =>
    entry.receiptRevision !== proposals[0].receiptRevision || entry.evidenceDigest !== proposals[0].evidenceDigest,
  )) {
    return { kind: 'rejected', reasonCode: 'result_history_receipt_conflict' };
  }
  if (sameReceipt.length > 0) {
    const expectedIds = new Set(proposals.map((proposal) => proposal.proposalId));
    if (sameReceipt.length !== proposals.length || !sameReceipt.every((proposal) => expectedIds.has(proposal.proposalId))) {
      return { kind: 'rejected', reasonCode: 'result_history_replay_mismatch' };
    }
    return { kind: 'replay', proposals: sameReceipt.map((proposal) => ({ ...proposal, reasonCodes: [...proposal.reasonCodes] })) };
  }
  if (history.length + proposals.length > TAIXU_RESULT_PROPOSAL_HISTORY_LIMIT) {
    return { kind: 'ineligible', reasonCode: 'result_history_capacity_full' };
  }
  return { kind: 'proposal', proposals };
}

function validProposal(value: TaixuResultSelectiveProposalV1) {
  return value.contractVersion === TAIXU_RESULT_SELECTIVE_MEMORY_VERSION &&
    (value.kind === 'memory_eligibility' || value.kind === 'habit_eligibility') &&
    nonEmpty(value.proposalId) && nonEmpty(value.actorId) && nonEmpty(value.decisionId) &&
    nonEmpty(value.candidateId) && nonEmpty(value.receiptId) && positiveInteger(value.receiptRevision) &&
    nonEmpty(value.terminalSourceRef) && nonEmpty(value.evidenceDigest) &&
    (value.evidenceVisibility === 'public' || value.evidenceVisibility === 'actor_private') &&
    boundedScore(value.score) && Array.isArray(value.reasonCodes) && value.reasonCodes.every(nonEmpty);
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function boundedScore(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import { stableDigest } from './personaPolicyLogic';

export const TAIXU_EMBODIMENT_RECEIPT_VERSION = 'taixu.embodiment-receipt.v1' as const;

export type TaixuEmbodimentFailureCode =
  | 'embodiment_candidate_invalid'
  | 'embodiment_input_invalid'
  | 'embodiment_authority_invalid'
  | 'embodiment_fence_mismatch'
  | 'embodiment_receipt_invalid'
  | 'embodiment_receipt_conflict';

export class TaixuEmbodimentReceiptError extends Error {
  constructor(readonly code: TaixuEmbodimentFailureCode) {
    super(code);
    this.name = 'TaixuEmbodimentReceiptError';
  }
}

export type TaixuGodotActiveBodyState = {
  authority: 'godot';
  actorId: string;
  decisionId: string;
  candidateId: string;
  revision: number;
  status: 'accepted' | 'acting';
};

/** This is post-bridge data only; it is not a raw client movement report. */
export type TaixuGodotAuthorityReceipt = {
  contractVersion: typeof TAIXU_EMBODIMENT_RECEIPT_VERSION;
  authority: 'godot';
  receiptId: string;
  actorId: string;
  decisionId: string;
  candidateId: string;
  revision: number;
  actionRecordId: string;
  executionId: string;
  status: 'arrived' | 'blocked' | 'cancelled';
  terminalSourceRef: string;
  reportedAt: number;
};

export type TaixuEmbodimentGate = {
  contractVersion: typeof TAIXU_EMBODIMENT_RECEIPT_VERSION;
  actorId: string;
  decisionId: string;
  candidateId: string;
  revision: number;
  phase: 'intent' | 'attempt' | 'terminal';
  allowedClaimKinds: Array<'intent' | 'attempt' | 'terminal'>;
  actionAvailability: 'candidate_available' | 'existing_action_only' | 'no_action';
  memoryEligibility: 'none' | 'authoritative_arrival_only';
  terminalClaimKind?: 'completed' | 'blocked' | 'cancelled';
  terminalSourceRef?: string;
  idempotencyKey?: string;
  replayed: boolean;
};

/**
 * Produces presentation permissions from an already-validated body state or
 * terminal Godot receipt. It does not report movement or write any fact.
 */
export function deriveTaixuEmbodimentGate(input: {
  trace: AutonomyDecisionTraceV3;
  candidateId: string;
  activeBody?: TaixuGodotActiveBodyState;
  receipt?: TaixuGodotAuthorityReceipt;
  priorReceipt?: TaixuGodotAuthorityReceipt;
}): TaixuEmbodimentGate {
  const { trace, candidateId, activeBody, receipt, priorReceipt } = input;
  if (!trace.candidates.some((candidate) => candidate.candidateId === candidateId && candidate.status === 'eligible')) {
    fail('embodiment_candidate_invalid');
  }
  if (activeBody && receipt) fail('embodiment_input_invalid');
  if (activeBody) {
    validateActiveBody(activeBody, trace, candidateId);
    return {
      contractVersion: TAIXU_EMBODIMENT_RECEIPT_VERSION,
      actorId: trace.actorId,
      decisionId: trace.decisionId,
      candidateId,
      revision: activeBody.revision,
      phase: 'attempt',
      allowedClaimKinds: ['intent', 'attempt'],
      actionAvailability: 'existing_action_only',
      memoryEligibility: 'none',
      replayed: false,
    };
  }
  if (!receipt) {
    return {
      contractVersion: TAIXU_EMBODIMENT_RECEIPT_VERSION,
      actorId: trace.actorId,
      decisionId: trace.decisionId,
      candidateId,
      revision: 0,
      phase: 'intent',
      allowedClaimKinds: ['intent'],
      actionAvailability: 'candidate_available',
      memoryEligibility: 'none',
      replayed: false,
    };
  }

  validateReceipt(receipt, trace, candidateId);
  const replayed = validatePriorReceipt(priorReceipt, receipt);
  const terminalClaimKind = receipt.status === 'arrived' ? 'completed' : receipt.status;
  return {
    contractVersion: TAIXU_EMBODIMENT_RECEIPT_VERSION,
    actorId: trace.actorId,
    decisionId: trace.decisionId,
    candidateId,
    revision: receipt.revision,
    phase: 'terminal',
    allowedClaimKinds: ['terminal'],
    actionAvailability: 'no_action',
    memoryEligibility: receipt.status === 'arrived' ? 'authoritative_arrival_only' : 'none',
    terminalClaimKind,
    terminalSourceRef: receipt.terminalSourceRef,
    idempotencyKey: `godot-receipt:${stableDigest(receipt)}`,
    replayed,
  };
}

function validateActiveBody(
  body: TaixuGodotActiveBodyState,
  trace: AutonomyDecisionTraceV3,
  candidateId: string,
) {
  if (body.authority !== 'godot') fail('embodiment_authority_invalid');
  if (!positiveInteger(body.revision) || !['accepted', 'acting'].includes(body.status)) {
    fail('embodiment_input_invalid');
  }
  validateFence(body, trace, candidateId);
}

function validateReceipt(
  receipt: TaixuGodotAuthorityReceipt,
  trace: AutonomyDecisionTraceV3,
  candidateId: string,
) {
  if (receipt.contractVersion !== TAIXU_EMBODIMENT_RECEIPT_VERSION || receipt.authority !== 'godot') {
    fail('embodiment_authority_invalid');
  }
  if (!positiveInteger(receipt.revision) || !Number.isSafeInteger(receipt.reportedAt) || receipt.reportedAt < 0 ||
      !['arrived', 'blocked', 'cancelled'].includes(receipt.status) ||
      !nonEmpty(receipt.receiptId) || !nonEmpty(receipt.actionRecordId) ||
      !nonEmpty(receipt.executionId) || !nonEmpty(receipt.terminalSourceRef)) {
    fail('embodiment_receipt_invalid');
  }
  validateFence(receipt, trace, candidateId);
}

function validateFence(
  value: { actorId: string; decisionId: string; candidateId: string },
  trace: AutonomyDecisionTraceV3,
  candidateId: string,
) {
  if (!nonEmpty(value.actorId) || !nonEmpty(value.decisionId) || !nonEmpty(value.candidateId)) {
    fail('embodiment_input_invalid');
  }
  if (value.actorId !== trace.actorId || value.decisionId !== trace.decisionId || value.candidateId !== candidateId) {
    fail('embodiment_fence_mismatch');
  }
}

function validatePriorReceipt(
  prior: TaixuGodotAuthorityReceipt | undefined,
  receipt: TaixuGodotAuthorityReceipt,
) {
  if (!prior || prior.receiptId !== receipt.receiptId) return false;
  if (stableDigest(prior) !== stableDigest(receipt)) fail('embodiment_receipt_conflict');
  return true;
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(code: TaixuEmbodimentFailureCode): never {
  throw new TaixuEmbodimentReceiptError(code);
}

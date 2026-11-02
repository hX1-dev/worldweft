import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import type { TaixuGodotAuthorityReceipt } from './taixuEmbodimentReceiptLogic';
import { createTaixuEvidenceCard } from './taixuEvidenceContextLogic';
import {
  adoptTaixuResultSelectiveMemory,
  isValidTaixuResultAdoptionState,
  type TaixuResultAdoptionStateV1,
} from './taixuResultSelectiveMemoryAdoptionLogic';
import { deriveTaixuResultSelectiveMemory } from './taixuResultSelectiveMemoryLogic';

export const TAIXU_RESULT_FACT_OWNER_ADMISSION_VERSION = 'taixu.result-fact-owner-admission.v1' as const;

type CanonicalVisibility = 'public' | 'local' | 'private' | 'witnessed' | 'rumor';

export type TaixuCanonicalAdmissionSnapshot = {
  worldId: string;
  traceId: string;
  trace: AutonomyDecisionTraceV3;
  action: {
    id: string;
    worldId: string;
    actorId: string;
    status: 'applied' | 'rejected' | 'interrupted' | 'proposed' | 'validated' | 'resolving';
    candidateId?: string;
  };
  execution: {
    id: string;
    worldId: string;
    actorId: string;
    actionRecordId: string;
    revision: number;
    status: 'completed' | 'blocked' | 'interrupted' | 'pending' | 'accepted' | 'acting';
    terminalEventId?: string;
  };
  event: {
    id: string;
    worldId: string;
    actionId?: string;
    actorIds: string[];
    targetActorIds?: string[];
    witnessActorIds?: string[];
    type: string;
    visibility: CanonicalVisibility;
    createdAt: number;
  };
};

export type TaixuResultAdmissionFence = {
  terminalEventId: string;
  receiptId: string;
  receiptRevision: number;
  traceId: string;
  actionRecordId: string;
  executionId: string;
  visibility: 'public' | 'actor_private';
  evidenceDigest: string;
  stateRevision: number;
};

export type TaixuResultFactOwnerAdmissionFailureCode =
  | 'admission_input_invalid'
  | 'admission_world_mismatch'
  | 'admission_trace_invalid'
  | 'admission_action_execution_mismatch'
  | 'admission_receipt_fence_mismatch'
  | 'admission_terminal_invalid'
  | 'admission_event_mismatch'
  | 'admission_visibility_denied'
  | 'admission_state_invalid'
  | 'admission_state_revision_conflict'
  | 'admission_event_receipt_conflict'
  | 'admission_result_ineligible';

export type TaixuResultFactOwnerAdmissionResult =
  | {
    kind: 'applied';
    state: TaixuResultAdoptionStateV1;
    fence: TaixuResultAdmissionFence;
  }
  | {
    kind: 'replayed';
    state: TaixuResultAdoptionStateV1;
    fence: TaixuResultAdmissionFence;
  }
  | { kind: 'rejected'; reasonCode: TaixuResultFactOwnerAdmissionFailureCode };

/**
 * Validates a H5 receipt only against canonical server facts, then invokes the
 * H6 pure proposal/adoption boundary. It does not issue actions or mutate any
 * world fact; its caller is responsible only for persisting the returned
 * actor-owned state and event fence in the same transaction.
 */
export function admitTaixuResultFromFactOwner(input: {
  snapshot: TaixuCanonicalAdmissionSnapshot;
  receipt: TaixuGodotAuthorityReceipt;
  current?: TaixuResultAdoptionStateV1;
  expectedRevision: number;
  priorFence?: TaixuResultAdmissionFence;
}): TaixuResultFactOwnerAdmissionResult {
  const { snapshot, receipt, current, expectedRevision, priorFence } = input;
  const rejected = (reasonCode: TaixuResultFactOwnerAdmissionFailureCode) => ({ kind: 'rejected' as const, reasonCode });
  if (!validInput(snapshot, expectedRevision)) return rejected('admission_input_invalid');
  if (!sameWorld(snapshot)) return rejected('admission_world_mismatch');
  if (!validTrace(snapshot)) return rejected('admission_trace_invalid');
  if (snapshot.execution.actionRecordId !== snapshot.action.id) return rejected('admission_action_execution_mismatch');
  if (!validReceiptFence(snapshot, receipt)) return rejected('admission_receipt_fence_mismatch');
  if (snapshot.action.status !== 'applied' || snapshot.execution.status !== 'completed') {
    return rejected('admission_terminal_invalid');
  }
  if (snapshot.execution.terminalEventId !== snapshot.event.id || snapshot.event.actionId !== snapshot.action.id) {
    return rejected('admission_event_mismatch');
  }
  const visibility = mapVisibility(snapshot.event, receipt.actorId);
  if (!visibility) return rejected('admission_visibility_denied');
  if (current && (!isValidTaixuResultAdoptionState(current) || current.actorId !== receipt.actorId)) {
    return rejected('admission_state_invalid');
  }
  const currentRevision = current?.revision ?? 0;
  if (expectedRevision !== currentRevision) return rejected('admission_state_revision_conflict');

  const evidence = createTaixuEvidenceCard({
    actorId: receipt.actorId,
    source: { kind: 'world_fact', id: receipt.terminalSourceRef, revision: 1 },
    visibility,
    observedAtSemanticTime: snapshot.event.createdAt,
    subject: `receipt:${receipt.receiptId}`,
    topic: snapshot.event.type,
    polarity: 'supported',
    reliability: 100,
    importance: 70,
    summary: 'Verified canonical terminal event.',
  });
  const fence = {
    terminalEventId: snapshot.event.id,
    receiptId: receipt.receiptId,
    receiptRevision: receipt.revision,
    traceId: snapshot.traceId,
    actionRecordId: snapshot.action.id,
    executionId: snapshot.execution.id,
    visibility,
    evidenceDigest: evidence.digest,
    stateRevision: currentRevision + 1,
  } satisfies TaixuResultAdmissionFence;
  if (priorFence) {
    if (!sameFenceIdentity(priorFence, fence)) return rejected('admission_event_receipt_conflict');
    if (!current || current.revision !== priorFence.stateRevision) return rejected('admission_state_invalid');
    return { kind: 'replayed', state: current, fence: priorFence };
  }

  const eligibilityInput = {
    trace: snapshot.trace,
    candidateId: receipt.candidateId,
    receipt,
    evidence: { card: evidence, validThroughGameHour: snapshot.event.createdAt },
    semanticTime: snapshot.event.createdAt,
  };
  const proposalResult = deriveTaixuResultSelectiveMemory(eligibilityInput);
  const adoption = adoptTaixuResultSelectiveMemory({ current, eligibilityInput, proposalResult });
  if (adoption.kind !== 'applied') return rejected('admission_result_ineligible');
  return { kind: 'applied', state: adoption.state, fence: { ...fence, stateRevision: adoption.state.revision } };
}

function validInput(snapshot: TaixuCanonicalAdmissionSnapshot, expectedRevision: number) {
  return nonEmpty(snapshot.worldId) && nonEmpty(snapshot.traceId) && Number.isSafeInteger(expectedRevision) &&
    expectedRevision >= 0 && Number.isSafeInteger(snapshot.event.createdAt) && snapshot.event.createdAt >= 0;
}

function sameWorld(snapshot: TaixuCanonicalAdmissionSnapshot) {
  return snapshot.action.worldId === snapshot.worldId && snapshot.execution.worldId === snapshot.worldId &&
    snapshot.event.worldId === snapshot.worldId;
}

function validTrace(snapshot: TaixuCanonicalAdmissionSnapshot) {
  const { trace, action } = snapshot;
  return trace.actorId === action.actorId && trace.contractVersion === 'taixu.autonomy-decision.v3' &&
    nonEmpty(action.candidateId) && trace.candidates.some((candidate) =>
      candidate.candidateId === action.candidateId && candidate.status === 'eligible',
    );
}

function validReceiptFence(snapshot: TaixuCanonicalAdmissionSnapshot, receipt: TaixuGodotAuthorityReceipt) {
  const { trace, action, execution, event } = snapshot;
  return receipt.contractVersion === 'taixu.embodiment-receipt.v1' && receipt.authority === 'godot' &&
    receipt.status === 'arrived' && receipt.actorId === action.actorId && receipt.actorId === execution.actorId &&
    receipt.decisionId === trace.decisionId && receipt.candidateId === action.candidateId &&
    receipt.revision === execution.revision && receipt.actionRecordId === action.id && receipt.executionId === execution.id &&
    receipt.terminalSourceRef === `world-event:${event.id}` && nonEmpty(receipt.receiptId);
}

function mapVisibility(event: TaixuCanonicalAdmissionSnapshot['event'], actorId: string) {
  if (event.visibility === 'rumor') return undefined;
  if (event.visibility === 'public') return 'public' as const;
  const audience = new Set([...event.actorIds, ...(event.targetActorIds ?? []), ...(event.witnessActorIds ?? [])]);
  return audience.has(actorId) ? 'actor_private' as const : undefined;
}

function sameFenceIdentity(left: TaixuResultAdmissionFence, right: TaixuResultAdmissionFence) {
  return left.terminalEventId === right.terminalEventId && left.receiptId === right.receiptId &&
    left.receiptRevision === right.receiptRevision && left.traceId === right.traceId &&
    left.actionRecordId === right.actionRecordId && left.executionId === right.executionId &&
    left.visibility === right.visibility && left.evidenceDigest === right.evidenceDigest;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

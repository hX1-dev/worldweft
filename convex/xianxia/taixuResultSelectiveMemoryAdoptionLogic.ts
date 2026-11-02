import { stableDigest } from './personaPolicyLogic';
import {
  deriveTaixuResultSelectiveMemory,
  TAIXU_RESULT_SELECTIVE_MEMORY_VERSION,
  type TaixuResultSelectiveMemoryResult,
  type TaixuResultSelectiveProposalV1,
} from './taixuResultSelectiveMemoryLogic';

export const TAIXU_RESULT_ADOPTION_VERSION = 'taixu.result-adoption.v1' as const;
export const TAIXU_RESULT_ADOPTED_PAIR_LIMIT = 8;
export const TAIXU_RESULT_MEMORY_LIMIT = 6;
export const TAIXU_RESULT_HABIT_LIMIT = 4;
export const TAIXU_RESULT_HABIT_STRENGTH_LIMIT = 8;

type ResultVisibility = 'public' | 'actor_private';

export type TaixuResultMemoryEntryV1 = {
  memoryId: string;
  proposalId: string;
  receiptId: string;
  receiptRevision: number;
  terminalSourceRef: string;
  evidenceDigest: string;
  visibility: ResultVisibility;
  score: number;
  adoptedAtRevision: number;
};

export type TaixuResultCompletionReceiptV1 = {
  receiptId: string;
  receiptRevision: number;
  candidateId: string;
  terminalSourceRef: string;
  evidenceDigest: string;
  memoryProposalId: string;
};

export type TaixuResultHabitV1 = {
  habitId: string;
  candidateId: string;
  strength: number;
  receiptIds: string[];
  sourceProposalIds: string[];
  visibility: ResultVisibility;
  revision: number;
};

export type TaixuAdoptedResultPairV1 = {
  receiptId: string;
  receiptRevision: number;
  evidenceDigest: string;
  proposalIds: [string, string];
};

export type TaixuResultAdoptionStateV1 = {
  contractVersion: typeof TAIXU_RESULT_ADOPTION_VERSION;
  actorId: string;
  revision: number;
  memories: TaixuResultMemoryEntryV1[];
  completionReceipts: TaixuResultCompletionReceiptV1[];
  habits: TaixuResultHabitV1[];
  adoptedPairs: TaixuAdoptedResultPairV1[];
  digest: string;
};

export type TaixuResultAdoptionFailureCode =
  | 'adoption_eligibility_not_proposal'
  | 'adoption_proposal_mismatch'
  | 'adoption_replay_state_mismatch'
  | 'adoption_state_invalid'
  | 'adoption_actor_mismatch'
  | 'adoption_receipt_conflict'
  | 'adoption_pair_history_full'
  | 'adoption_completion_history_full'
  | 'adoption_habit_capacity_full';

export type TaixuResultAdoptionResult =
  | { kind: 'applied'; state: TaixuResultAdoptionStateV1; habitEffect: 'not_formed' | 'formed' | 'strengthened'; evictedMemoryId?: string }
  | { kind: 'replayed'; state: TaixuResultAdoptionStateV1 }
  | { kind: 'rejected'; reasonCode: TaixuResultAdoptionFailureCode; state?: TaixuResultAdoptionStateV1 };

/**
 * Purely adopts a re-derived, Godot-backed proposal pair. It never writes a
 * world fact or treats a model expression as a completed action.
 */
export function adoptTaixuResultSelectiveMemory(input: {
  current?: TaixuResultAdoptionStateV1;
  eligibilityInput: Parameters<typeof deriveTaixuResultSelectiveMemory>[0];
  proposalResult: TaixuResultSelectiveMemoryResult;
}): TaixuResultAdoptionResult {
  const { priorProposals: _ignored, ...eligibilityInput } = input.eligibilityInput;
  const rederived = deriveTaixuResultSelectiveMemory(eligibilityInput);
  if (rederived.kind !== 'proposal' || (input.proposalResult.kind !== 'proposal' && input.proposalResult.kind !== 'replay')) {
    return { kind: 'rejected', reasonCode: 'adoption_eligibility_not_proposal', state: input.current };
  }
  if (stableDigest(rederived.proposals) !== stableDigest(input.proposalResult.proposals) || !validPair(rederived.proposals)) {
    return { kind: 'rejected', reasonCode: 'adoption_proposal_mismatch', state: input.current };
  }

  const [memoryProposal, habitProposal] = orderedPair(rederived.proposals);
  const current = input.current ?? emptyState(memoryProposal.actorId);
  if (!validState(current)) return { kind: 'rejected', reasonCode: 'adoption_state_invalid' };
  if (current.actorId !== memoryProposal.actorId) {
    return { kind: 'rejected', reasonCode: 'adoption_actor_mismatch', state: current };
  }

  const existingPair = current.adoptedPairs.find((pair) => pair.receiptId === memoryProposal.receiptId);
  if (existingPair) {
    if (!samePair(existingPair, memoryProposal, habitProposal)) {
      return { kind: 'rejected', reasonCode: 'adoption_receipt_conflict', state: current };
    }
    return { kind: 'replayed', state: current };
  }
  if (input.proposalResult.kind === 'replay') {
    return { kind: 'rejected', reasonCode: 'adoption_replay_state_mismatch', state: current };
  }
  if (current.adoptedPairs.length >= TAIXU_RESULT_ADOPTED_PAIR_LIMIT) {
    return { kind: 'rejected', reasonCode: 'adoption_pair_history_full', state: current };
  }
  if (current.completionReceipts.length >= TAIXU_RESULT_ADOPTED_PAIR_LIMIT) {
    return { kind: 'rejected', reasonCode: 'adoption_completion_history_full', state: current };
  }

  const conflictingReceipt = current.completionReceipts.find((entry) => entry.receiptId === memoryProposal.receiptId);
  if (conflictingReceipt) return { kind: 'rejected', reasonCode: 'adoption_receipt_conflict', state: current };

  const completedSameRoutine = current.completionReceipts.filter((entry) => entry.candidateId === memoryProposal.candidateId);
  const existingHabit = current.habits.find((habit) => habit.candidateId === memoryProposal.candidateId);
  if (!existingHabit && completedSameRoutine.length >= 1 && current.habits.length >= TAIXU_RESULT_HABIT_LIMIT) {
    return { kind: 'rejected', reasonCode: 'adoption_habit_capacity_full', state: current };
  }

  const nextRevision = current.revision + 1;
  const memory = toMemoryEntry(memoryProposal, nextRevision);
  const memories = [...current.memories, memory];
  const evicted = memories.length > TAIXU_RESULT_MEMORY_LIMIT ? selectEviction(memories) : undefined;
  const retainedMemories = evicted ? memories.filter((entry) => entry.memoryId !== evicted.memoryId) : memories;
  const completion = toCompletionReceipt(memoryProposal);
  const habitUpdate = updateHabit(current.habits, existingHabit, completedSameRoutine, completion, habitProposal);
  const semantic = {
    contractVersion: TAIXU_RESULT_ADOPTION_VERSION,
    actorId: current.actorId,
    revision: nextRevision,
    memories: retainedMemories,
    completionReceipts: [...current.completionReceipts, completion],
    habits: habitUpdate.habits,
    adoptedPairs: [...current.adoptedPairs, {
      receiptId: memoryProposal.receiptId,
      receiptRevision: memoryProposal.receiptRevision,
      evidenceDigest: memoryProposal.evidenceDigest,
      proposalIds: [memoryProposal.proposalId, habitProposal.proposalId] as [string, string],
    }],
  };
  return {
    kind: 'applied',
    state: { ...semantic, digest: stableDigest(semantic) },
    habitEffect: habitUpdate.effect,
    ...(evicted ? { evictedMemoryId: evicted.memoryId } : {}),
  };
}

function emptyState(actorId: string): TaixuResultAdoptionStateV1 {
  const semantic = {
    contractVersion: TAIXU_RESULT_ADOPTION_VERSION,
    actorId,
    revision: 0,
    memories: [],
    completionReceipts: [],
    habits: [],
    adoptedPairs: [],
  };
  return { ...semantic, digest: stableDigest(semantic) };
}

function validPair(proposals: TaixuResultSelectiveProposalV1[]) {
  if (proposals.length !== 2) return false;
  const [memory, habit] = orderedPair(proposals);
  return memory.kind === 'memory_eligibility' && habit.kind === 'habit_eligibility' &&
    memory.actorId === habit.actorId && memory.decisionId === habit.decisionId &&
    memory.candidateId === habit.candidateId && memory.receiptId === habit.receiptId &&
    memory.receiptRevision === habit.receiptRevision && memory.terminalSourceRef === habit.terminalSourceRef &&
    memory.evidenceDigest === habit.evidenceDigest && memory.evidenceVisibility === habit.evidenceVisibility &&
    memory.contractVersion === TAIXU_RESULT_SELECTIVE_MEMORY_VERSION && habit.contractVersion === TAIXU_RESULT_SELECTIVE_MEMORY_VERSION;
}

function orderedPair(proposals: TaixuResultSelectiveProposalV1[]) {
  const memory = proposals.find((proposal) => proposal.kind === 'memory_eligibility');
  const habit = proposals.find((proposal) => proposal.kind === 'habit_eligibility');
  if (!memory || !habit) throw new Error('adoption_pair_invalid');
  return [memory, habit] as const;
}

function samePair(
  pair: TaixuAdoptedResultPairV1,
  memory: TaixuResultSelectiveProposalV1,
  habit: TaixuResultSelectiveProposalV1,
) {
  return pair.receiptRevision === memory.receiptRevision && pair.evidenceDigest === memory.evidenceDigest &&
    pair.proposalIds[0] === memory.proposalId && pair.proposalIds[1] === habit.proposalId;
}

function toMemoryEntry(proposal: TaixuResultSelectiveProposalV1, adoptedAtRevision: number): TaixuResultMemoryEntryV1 {
  return {
    memoryId: `result-memory:${stableDigest({ actorId: proposal.actorId, proposalId: proposal.proposalId })}`,
    proposalId: proposal.proposalId,
    receiptId: proposal.receiptId,
    receiptRevision: proposal.receiptRevision,
    terminalSourceRef: proposal.terminalSourceRef,
    evidenceDigest: proposal.evidenceDigest,
    visibility: proposal.evidenceVisibility,
    score: proposal.score,
    adoptedAtRevision,
  };
}

function toCompletionReceipt(proposal: TaixuResultSelectiveProposalV1): TaixuResultCompletionReceiptV1 {
  return {
    receiptId: proposal.receiptId,
    receiptRevision: proposal.receiptRevision,
    candidateId: proposal.candidateId,
    terminalSourceRef: proposal.terminalSourceRef,
    evidenceDigest: proposal.evidenceDigest,
    memoryProposalId: proposal.proposalId,
  };
}

function updateHabit(
  habits: TaixuResultHabitV1[],
  existing: TaixuResultHabitV1 | undefined,
  priorSameRoutine: TaixuResultCompletionReceiptV1[],
  completion: TaixuResultCompletionReceiptV1,
  proposal: TaixuResultSelectiveProposalV1,
): { habits: TaixuResultHabitV1[]; effect: 'not_formed' | 'formed' | 'strengthened' } {
  if (!existing && priorSameRoutine.length === 0) return { habits: [...habits], effect: 'not_formed' };
  const receiptIds = [...(existing?.receiptIds ?? priorSameRoutine.map((entry) => entry.receiptId)), completion.receiptId];
  const sourceProposalIds = [...(existing?.sourceProposalIds ?? priorSameRoutine.map((entry) => entry.memoryProposalId)), proposal.proposalId];
  const habit: TaixuResultHabitV1 = {
    habitId: existing?.habitId ?? `result-habit:${stableDigest({ actorId: proposal.actorId, candidateId: proposal.candidateId })}`,
    candidateId: proposal.candidateId,
    strength: Math.min(TAIXU_RESULT_HABIT_STRENGTH_LIMIT, (existing?.strength ?? 0) + 1),
    receiptIds,
    sourceProposalIds,
    visibility: existing?.visibility === 'actor_private' || proposal.evidenceVisibility === 'actor_private' ? 'actor_private' : 'public',
    revision: (existing?.revision ?? 0) + 1,
  };
  return {
    habits: existing ? habits.map((entry) => entry.habitId === existing.habitId ? habit : entry) : [...habits, habit],
    effect: existing ? 'strengthened' : 'formed',
  };
}

function selectEviction(memories: TaixuResultMemoryEntryV1[]) {
  return [...memories].sort((left, right) =>
    left.score - right.score || left.adoptedAtRevision - right.adoptedAtRevision || left.memoryId.localeCompare(right.memoryId),
  )[0];
}

function validState(state: TaixuResultAdoptionStateV1) {
  if (state.contractVersion !== TAIXU_RESULT_ADOPTION_VERSION || !nonEmpty(state.actorId) || !nonNegativeInteger(state.revision) ||
      !Array.isArray(state.memories) || !Array.isArray(state.completionReceipts) || !Array.isArray(state.habits) || !Array.isArray(state.adoptedPairs) ||
      state.memories.length > TAIXU_RESULT_MEMORY_LIMIT || state.completionReceipts.length > TAIXU_RESULT_ADOPTED_PAIR_LIMIT ||
      state.habits.length > TAIXU_RESULT_HABIT_LIMIT || state.adoptedPairs.length > TAIXU_RESULT_ADOPTED_PAIR_LIMIT ||
      !state.memories.every(validMemory) || !state.completionReceipts.every(validCompletion) || !state.habits.every(validHabit) || !state.adoptedPairs.every(validPairRecord) ||
      !unique(state.memories.map((entry) => entry.memoryId)) || !unique(state.completionReceipts.map((entry) => entry.receiptId)) ||
      !unique(state.habits.map((entry) => entry.habitId)) || !unique(state.adoptedPairs.map((entry) => entry.receiptId))) return false;
  const { digest: _digest, ...semantic } = state;
  return state.digest === stableDigest(semantic);
}

/** Canonical structural/digest fence for read-only consumers of H6 state. */
export function isValidTaixuResultAdoptionState(state: TaixuResultAdoptionStateV1) {
  return validState(state);
}

/**
 * Read-only projection for candidate ordering. Corrupt, foreign, incomplete,
 * or first-time result state intentionally projects nothing.
 */
export function projectTaixuResultHabitPreferences(input: {
  actorId: string;
  revision: number;
  stateJson: string;
  stateDigest: string;
}): { candidateId: string; strength: number }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stateJson);
  } catch {
    return [];
  }
  const state = parsed as TaixuResultAdoptionStateV1;
  if (
    !isValidTaixuResultAdoptionState(state) ||
    state.actorId !== input.actorId ||
    state.revision !== input.revision ||
    state.digest !== input.stateDigest
  ) {
    return [];
  }
  return state.habits
    .filter((habit) => habit.receiptIds.length >= 2)
    .map((habit) => ({ candidateId: habit.candidateId, strength: habit.strength }))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function validMemory(entry: TaixuResultMemoryEntryV1) {
  return nonEmpty(entry.memoryId) && nonEmpty(entry.proposalId) && nonEmpty(entry.receiptId) && positiveInteger(entry.receiptRevision) &&
    nonEmpty(entry.terminalSourceRef) && nonEmpty(entry.evidenceDigest) && visibility(entry.visibility) && score(entry.score) && positiveInteger(entry.adoptedAtRevision);
}

function validCompletion(entry: TaixuResultCompletionReceiptV1) {
  return nonEmpty(entry.receiptId) && positiveInteger(entry.receiptRevision) && nonEmpty(entry.candidateId) &&
    nonEmpty(entry.terminalSourceRef) && nonEmpty(entry.evidenceDigest) && nonEmpty(entry.memoryProposalId);
}

function validHabit(entry: TaixuResultHabitV1) {
  return nonEmpty(entry.habitId) && nonEmpty(entry.candidateId) && positiveInteger(entry.strength) && entry.strength <= TAIXU_RESULT_HABIT_STRENGTH_LIMIT &&
    entry.receiptIds.length >= 2 && entry.receiptIds.length <= TAIXU_RESULT_ADOPTED_PAIR_LIMIT && entry.receiptIds.every(nonEmpty) && unique(entry.receiptIds) &&
    entry.sourceProposalIds.length === entry.receiptIds.length && entry.sourceProposalIds.every(nonEmpty) && visibility(entry.visibility) && positiveInteger(entry.revision);
}

function validPairRecord(entry: TaixuAdoptedResultPairV1) {
  return nonEmpty(entry.receiptId) && positiveInteger(entry.receiptRevision) && nonEmpty(entry.evidenceDigest) &&
    entry.proposalIds.length === 2 && entry.proposalIds.every(nonEmpty) && entry.proposalIds[0] !== entry.proposalIds[1];
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function visibility(value: unknown): value is ResultVisibility {
  return value === 'public' || value === 'actor_private';
}

function score(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

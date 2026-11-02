import { describe, expect, test } from '@jest/globals';
import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import type { TaixuGodotAuthorityReceipt } from './taixuEmbodimentReceiptLogic';
import { createTaixuEvidenceCard } from './taixuEvidenceContextLogic';
import { deriveTaixuResultSelectiveMemory } from './taixuResultSelectiveMemoryLogic';
import {
  adoptTaixuResultSelectiveMemory,
  TAIXU_RESULT_MEMORY_LIMIT,
  type TaixuResultAdoptionStateV1,
} from './taixuResultSelectiveMemoryAdoptionLogic';

const trace = (): AutonomyDecisionTraceV3 => ({
  contractVersion: 'taixu.autonomy-decision.v3', decisionId: 'decision-1', actorId: 'lin', observationRevision: 'obs-1',
  candidates: [{ candidateId: 'candidate:travel', planner: 'rule', intentKind: 'travel', status: 'eligible', legacyOrder: 0, survivalUrgency: 0, survivalReasonCodes: [], needScore: 0, personaFit: 0, personaReasonCodes: [], commitmentUrgency: 0, relationshipReasons: [], memorySourceIds: [] }],
  decisionSource: 'rule', outcome: 'chosen', exceptionSourceIds: [], survivalEnvelope: { state: 'stable', urgency: 0, reasonCodes: [], decisionKind: 'travel' },
  personaPolicy: { policyVersion: 'taixu.persona-policy.v1', innerTraitKnown: false, outerTraitKnown: false, dimensions: { riskTolerance: 50, helpingBias: 0, commitmentBias: 0, conflictBias: 0, socialBias: 0, cultivationBias: 0, persistenceBias: 0, evidenceBias: 0, resourceReserveBias: 0 }, reasonCodes: [], policyDigest: 'policy' },
  bounds: { limit: 32, included: 1, total: 1, truncated: false }, createdAt: 1,
});

const eligibility = (id: string, importance = 70, status: TaixuGodotAuthorityReceipt['status'] = 'arrived', revision = 1) => {
  const receipt: TaixuGodotAuthorityReceipt = {
    contractVersion: 'taixu.embodiment-receipt.v1', authority: 'godot', receiptId: `receipt-${id}`, actorId: 'lin', decisionId: 'decision-1', candidateId: 'candidate:travel', revision, actionRecordId: `action-${id}`, executionId: `execution-${id}`, status, terminalSourceRef: `movement:${id}`, reportedAt: 10,
  };
  return {
    trace: trace(), candidateId: 'candidate:travel', receipt,
    evidence: { validThroughGameHour: 10, card: createTaixuEvidenceCard({ actorId: 'lin', source: { kind: 'world_fact', id: receipt.terminalSourceRef, revision: 1 }, visibility: 'actor_private', observedAtSemanticTime: 9, subject: `receipt:${receipt.receiptId}`, topic: 'movement_result', polarity: 'supported', reliability: 80, importance, summary: 'Verified arrival.' }) },
    semanticTime: 10,
  };
};

const adopt = (input: ReturnType<typeof eligibility>, current?: TaixuResultAdoptionStateV1) => {
  const proposalResult = deriveTaixuResultSelectiveMemory(input);
  return adoptTaixuResultSelectiveMemory({ current, eligibilityInput: input, proposalResult });
};

describe('taixu.result-adoption.v1', () => {
  test('adopts source-visible memory atomically and only forms then strengthens habits from repeated arrived receipts', () => {
    const firstInput = eligibility('one');
    const snapshot = JSON.parse(JSON.stringify(firstInput));
    const first = adopt(firstInput);
    expect(first).toMatchObject({ kind: 'applied', habitEffect: 'not_formed' });
    if (first.kind !== 'applied') return;
    expect(first.state.memories).toHaveLength(1);
    expect(first.state.memories[0]).toMatchObject({ receiptId: 'receipt-one', visibility: 'actor_private', score: 70 });
    expect(first.state.completionReceipts).toHaveLength(1);
    expect(first.state.habits).toHaveLength(0);
    expect(firstInput).toEqual(snapshot);

    const second = adopt(eligibility('two'), first.state);
    expect(second).toMatchObject({ kind: 'applied', habitEffect: 'formed' });
    if (second.kind !== 'applied') return;
    expect(second.state.habits[0]).toMatchObject({ candidateId: 'candidate:travel', strength: 1, receiptIds: ['receipt-one', 'receipt-two'] });

    const third = adopt(eligibility('three'), second.state);
    expect(third).toMatchObject({ kind: 'applied', habitEffect: 'strengthened' });
    if (third.kind !== 'applied') return;
    expect(third.state.habits[0]).toMatchObject({ strength: 2, receiptIds: ['receipt-one', 'receipt-two', 'receipt-three'] });
  });

  test('failed results, hand-written proposal changes, invalid state, and replay/state mismatch fail closed', () => {
    const blocked = eligibility('blocked', 70, 'blocked');
    expect(adopt(blocked)).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_eligibility_not_proposal' });

    const valid = eligibility('valid');
    const result = deriveTaixuResultSelectiveMemory(valid);
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(adoptTaixuResultSelectiveMemory({ eligibilityInput: valid, proposalResult: { ...result, proposals: [{ ...result.proposals[0], score: 99 }, result.proposals[1]] } })).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_proposal_mismatch' });
    expect(adoptTaixuResultSelectiveMemory({ eligibilityInput: valid, proposalResult: { kind: 'replay', proposals: result.proposals } })).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_replay_state_mismatch' });

    const first = adopt(valid);
    if (first.kind !== 'applied') return;
    expect(adopt(valid, first.state)).toMatchObject({ kind: 'replayed', state: first.state });
    expect(adopt(eligibility('other'), { ...first.state, digest: 'tampered' })).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_state_invalid' });
  });

  test('receipt conflicts and bounded pair capacity leave the entire prior state unchanged', () => {
    const first = adopt(eligibility('one'));
    if (first.kind !== 'applied') return;
    const conflictInput = eligibility('one', 70, 'arrived', 2);
    const conflictResult = deriveTaixuResultSelectiveMemory(conflictInput);
    expect(conflictResult.kind).toBe('proposal');
    if (conflictResult.kind !== 'proposal') return;
    expect(adoptTaixuResultSelectiveMemory({ current: first.state, eligibilityInput: conflictInput, proposalResult: conflictResult })).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_receipt_conflict', state: first.state });

    let state = first.state;
    for (const id of ['two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
      const next = adopt(eligibility(id), state);
      expect(next.kind).toBe('applied');
      if (next.kind === 'applied') state = next.state;
    }
    const before = JSON.parse(JSON.stringify(state));
    expect(adopt(eligibility('nine'), state)).toMatchObject({ kind: 'rejected', reasonCode: 'adoption_pair_history_full', state });
    expect(state).toEqual(before);
  });

  test('memory eviction is deterministic and does not erase receipt-backed habit or replay fences', () => {
    let state: TaixuResultAdoptionStateV1 | undefined;
    for (const [id, importance] of [['one', 60], ['two', 70], ['three', 71], ['four', 72], ['five', 73], ['six', 74], ['seven', 75]] as const) {
      const next = adopt(eligibility(id, importance), state);
      expect(next.kind).toBe('applied');
      if (next.kind === 'applied') state = next.state;
    }
    expect(state?.memories).toHaveLength(TAIXU_RESULT_MEMORY_LIMIT);
    expect(state?.memories.some((entry) => entry.receiptId === 'receipt-one')).toBe(false);
    expect(state?.completionReceipts.map((entry) => entry.receiptId)).toContain('receipt-one');
    expect(state?.adoptedPairs.map((entry) => entry.receiptId)).toContain('receipt-one');
    expect(state?.habits[0].strength).toBe(6);
  });
});

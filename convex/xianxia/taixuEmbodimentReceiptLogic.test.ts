import { describe, expect, test } from '@jest/globals';
import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import {
  deriveTaixuEmbodimentGate,
  TaixuEmbodimentReceiptError,
  type TaixuGodotAuthorityReceipt,
} from './taixuEmbodimentReceiptLogic';

const trace = (): AutonomyDecisionTraceV3 => ({
  contractVersion: 'taixu.autonomy-decision.v3', decisionId: 'decision-1', actorId: 'lin', observationRevision: 'obs-1',
  candidates: [{ candidateId: 'candidate:travel', planner: 'rule', intentKind: 'travel', status: 'eligible', legacyOrder: 0, survivalUrgency: 0, survivalReasonCodes: [], needScore: 0, personaFit: 0, personaReasonCodes: [], commitmentUrgency: 0, relationshipReasons: [], memorySourceIds: [] }],
  decisionSource: 'rule', outcome: 'chosen', exceptionSourceIds: [], survivalEnvelope: { state: 'stable', urgency: 0, reasonCodes: [], decisionKind: 'travel' },
  personaPolicy: { policyVersion: 'taixu.persona-policy.v1', innerTraitKnown: false, outerTraitKnown: false, dimensions: { riskTolerance: 50, helpingBias: 0, commitmentBias: 0, conflictBias: 0, socialBias: 0, cultivationBias: 0, persistenceBias: 0, evidenceBias: 0, resourceReserveBias: 0 }, reasonCodes: [], policyDigest: 'policy' },
  bounds: { limit: 32, included: 1, total: 1, truncated: false }, createdAt: 1,
});

const receipt = (status: TaixuGodotAuthorityReceipt['status'] = 'arrived'): TaixuGodotAuthorityReceipt => ({
  contractVersion: 'taixu.embodiment-receipt.v1', authority: 'godot', receiptId: 'receipt-1', actorId: 'lin', decisionId: 'decision-1', candidateId: 'candidate:travel', revision: 1, actionRecordId: 'action-1', executionId: 'execution-1', status, terminalSourceRef: `movement:${status}`, reportedAt: 1,
});

const expectCode = (operation: () => unknown, code: string) => {
  try { operation(); throw new Error('expected error'); } catch (error) {
    expect(error).toBeInstanceOf(TaixuEmbodimentReceiptError);
    expect((error as TaixuEmbodimentReceiptError).code).toBe(code);
  }
};

describe('taixu.embodiment-receipt.v1', () => {
  test('absence and active body states limit expressions and new action availability', () => {
    expect(deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel' })).toMatchObject({ phase: 'intent', allowedClaimKinds: ['intent'], actionAvailability: 'candidate_available', memoryEligibility: 'none' });
    expect(deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', activeBody: { authority: 'godot', actorId: 'lin', decisionId: 'decision-1', candidateId: 'candidate:travel', revision: 1, status: 'accepted' } })).toMatchObject({ phase: 'attempt', allowedClaimKinds: ['intent', 'attempt'], actionAvailability: 'existing_action_only', memoryEligibility: 'none' });
  });

  const terminalCases: Array<[
    TaixuGodotAuthorityReceipt['status'],
    'completed' | 'blocked' | 'cancelled',
    'authoritative_arrival_only' | 'none',
  ]> = [
    ['arrived', 'completed', 'authoritative_arrival_only'],
    ['blocked', 'blocked', 'none'],
    ['cancelled', 'cancelled', 'none'],
  ];
  test.each(terminalCases)('only Godot %s receipts produce the matching terminal gate', (status, terminalClaimKind, memoryEligibility) => {
    expect(deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: receipt(status) })).toMatchObject({ phase: 'terminal', allowedClaimKinds: ['terminal'], actionAvailability: 'no_action', terminalClaimKind, memoryEligibility });
  });

  test('authority, fence, and conflicting replay receipts fail closed; exact replay stays stable', () => {
    for (const authority of ['rule', 'llm', 'provider']) {
      expectCode(() => deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: { ...receipt(), authority } as never }), 'embodiment_authority_invalid');
    }
    expectCode(() => deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: { ...receipt(), candidateId: 'candidate:other' } }), 'embodiment_fence_mismatch');
    const first = deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: receipt() });
    const replay = deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: receipt() });
    expect(replay).toEqual(first);
    expect(deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: receipt(), priorReceipt: receipt() })).toMatchObject({ replayed: true, idempotencyKey: first.idempotencyKey });
    expectCode(() => deriveTaixuEmbodimentGate({ trace: trace(), candidateId: 'candidate:travel', receipt: receipt(), priorReceipt: { ...receipt(), status: 'blocked' } }), 'embodiment_receipt_conflict');
  });
});

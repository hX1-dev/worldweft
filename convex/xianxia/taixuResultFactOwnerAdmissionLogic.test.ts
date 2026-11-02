import { describe, expect, test } from '@jest/globals';
import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import type { TaixuGodotAuthorityReceipt } from './taixuEmbodimentReceiptLogic';
import { admitTaixuResultFromFactOwner, type TaixuCanonicalAdmissionSnapshot } from './taixuResultFactOwnerAdmissionLogic';
import { buildServerTaixuH5TerminalReceipt } from './taixuResultFactOwnerAdmission';

const trace = (): AutonomyDecisionTraceV3 => ({
  contractVersion: 'taixu.autonomy-decision.v3', decisionId: 'decision-1', actorId: 'lin', observationRevision: 'obs-1',
  candidates: [{ candidateId: 'candidate:rest', planner: 'rule', intentKind: 'rest', status: 'eligible', legacyOrder: 0, survivalUrgency: 0, survivalReasonCodes: [], needScore: 0, personaFit: 0, personaReasonCodes: [], commitmentUrgency: 0, relationshipReasons: [], memorySourceIds: [] }],
  chosenCandidateId: 'candidate:rest', decisionSource: 'rule', outcome: 'chosen', exceptionSourceIds: [],
  survivalEnvelope: { state: 'stable', urgency: 0, reasonCodes: [], decisionKind: 'pass' },
  personaPolicy: { policyVersion: 'taixu.persona-policy.v1', innerTraitKnown: false, outerTraitKnown: false, dimensions: { riskTolerance: 0, helpingBias: 0, commitmentBias: 0, conflictBias: 0, socialBias: 0, cultivationBias: 0, persistenceBias: 0, evidenceBias: 0, resourceReserveBias: 0 }, reasonCodes: [], policyDigest: 'persona' },
  bounds: { limit: 32, included: 1, total: 1, truncated: false }, createdAt: 1,
});

function snapshot(overrides: Partial<TaixuCanonicalAdmissionSnapshot> = {}): TaixuCanonicalAdmissionSnapshot {
  return {
    worldId: 'world-1', traceId: 'trace-row-1', trace: trace(),
    action: { id: 'action-1', worldId: 'world-1', actorId: 'lin', status: 'applied', candidateId: 'candidate:rest' },
    execution: { id: 'execution-1', worldId: 'world-1', actorId: 'lin', actionRecordId: 'action-1', revision: 1, status: 'completed', terminalEventId: 'event-1' },
    event: { id: 'event-1', worldId: 'world-1', actionId: 'action-1', actorIds: ['lin'], type: 'rest_completed', visibility: 'local', createdAt: 9 },
    ...overrides,
  };
}

function receipt(id = 'receipt-1'): TaixuGodotAuthorityReceipt {
  return { contractVersion: 'taixu.embodiment-receipt.v1', authority: 'godot', receiptId: id, actorId: 'lin', decisionId: 'decision-1', candidateId: 'candidate:rest', revision: 1, actionRecordId: 'action-1', executionId: 'execution-1', status: 'arrived', terminalSourceRef: 'world-event:event-1', reportedAt: 9 };
}

function admit(input: Parameters<typeof admitTaixuResultFromFactOwner>[0] = { snapshot: snapshot(), receipt: receipt(), expectedRevision: 0 }) {
  return admitTaixuResultFromFactOwner(input);
}

describe('taixu.result-fact-owner-admission.v1', () => {
  test('materializes an arrived H5 receipt only from an exact canonical terminal chain', () => {
    const serverReceipt = buildServerTaixuH5TerminalReceipt({
      trace: trace(),
      action: { id: 'action-1', actorId: 'lin', candidateId: 'candidate:rest' },
      execution: { id: 'execution-1', actorId: 'lin', actionRecordId: 'action-1', revision: 1 },
      event: { id: 'event-1', actionId: 'action-1', createdAt: 9 },
    });
    expect(serverReceipt).toEqual(receipt('taixu-h5:execution-1:event-1'));
    expect(() => buildServerTaixuH5TerminalReceipt({
      trace: trace(),
      action: { id: 'action-1', actorId: 'lin', candidateId: 'candidate:rest' },
      execution: { id: 'execution-1', actorId: 'lin', actionRecordId: 'other', revision: 1 },
      event: { id: 'event-1', actionId: 'action-1', createdAt: 9 },
    })).toThrow('taixu_result_admission_terminal_binding_invalid');
  });

  test('admits only a canonical completed event, then forms a habit on a distinct event without world consequences', () => {
    const first = admit();
    expect(first).toMatchObject({ kind: 'applied', state: { actorId: 'lin', revision: 1, completionReceipts: [{ terminalSourceRef: 'world-event:event-1' }], habits: [] }, fence: { terminalEventId: 'event-1', visibility: 'actor_private' } });
    if (first.kind !== 'applied') return;
    const secondSnapshot = snapshot({ execution: { ...snapshot().execution, id: 'execution-2', revision: 2, terminalEventId: 'event-2' }, event: { ...snapshot().event, id: 'event-2', createdAt: 10 } });
    const secondReceipt = { ...receipt('receipt-2'), executionId: 'execution-2', revision: 2, terminalSourceRef: 'world-event:event-2', reportedAt: 10 };
    const second = admit({ snapshot: secondSnapshot, receipt: secondReceipt, current: first.state, expectedRevision: 1 });
    expect(second).toMatchObject({ kind: 'applied', state: { revision: 2, habits: [{ candidateId: 'candidate:rest', strength: 1, receiptIds: ['receipt-1', 'receipt-2'] }] } });
    expect(Object.keys(second)).not.toEqual(expect.arrayContaining(['worldEvent', 'effects', 'action']));
  });

  test('fails closed for world, trace, action/execution/event, receipt and terminal mismatches', () => {
    expect(admit({ snapshot: snapshot({ event: { ...snapshot().event, worldId: 'other' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_world_mismatch' });
    expect(admit({ snapshot: snapshot({ action: { ...snapshot().action, candidateId: 'other' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_trace_invalid' });
    expect(admit({ snapshot: snapshot({ execution: { ...snapshot().execution, actionRecordId: 'other' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_action_execution_mismatch' });
    expect(admit({ snapshot: snapshot({ execution: { ...snapshot().execution, status: 'blocked' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_terminal_invalid' });
    expect(admit({ snapshot: snapshot({ event: { ...snapshot().event, actionId: 'other' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_event_mismatch' });
    expect(admit({ snapshot: snapshot(), receipt: { ...receipt(), revision: 2 }, expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_receipt_fence_mismatch' });
  });

  test('maps only canonical visibility and rejects rumor or an unaudienced actor', () => {
    expect(admit({ snapshot: snapshot({ event: { ...snapshot().event, visibility: 'public' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'applied', fence: { visibility: 'public' } });
    expect(admit({ snapshot: snapshot({ event: { ...snapshot().event, visibility: 'rumor' } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_visibility_denied' });
    expect(admit({ snapshot: snapshot({ event: { ...snapshot().event, actorIds: [], targetActorIds: [], witnessActorIds: [] } }), receipt: receipt(), expectedRevision: 0 })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_visibility_denied' });
  });

  test('replays only the exact event fence and rejects altered receipt or stale CAS', () => {
    const first = admit();
    if (first.kind !== 'applied') return;
    expect(admit({ snapshot: snapshot(), receipt: receipt(), current: first.state, expectedRevision: 1, priorFence: first.fence })).toMatchObject({ kind: 'replayed', state: first.state });
    expect(admit({ snapshot: snapshot(), receipt: receipt('other-receipt'), current: first.state, expectedRevision: 1, priorFence: first.fence })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_event_receipt_conflict' });
    expect(admit({ snapshot: snapshot(), receipt: receipt(), current: first.state, expectedRevision: 0, priorFence: first.fence })).toMatchObject({ kind: 'rejected', reasonCode: 'admission_state_revision_conflict' });
  });
});

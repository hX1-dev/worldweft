import { describe, expect, test } from '@jest/globals';
import type { AutonomyDecisionTraceV3 } from './autonomyDecisionContracts';
import type { TaixuGodotAuthorityReceipt } from './taixuEmbodimentReceiptLogic';
import { createTaixuEvidenceCard } from './taixuEvidenceContextLogic';
import {
  deriveTaixuResultSelectiveMemory,
  TAIXU_RESULT_PROPOSAL_HISTORY_LIMIT,
  type TaixuResultSelectiveProposalV1,
} from './taixuResultSelectiveMemoryLogic';

const trace = (): AutonomyDecisionTraceV3 => ({
  contractVersion: 'taixu.autonomy-decision.v3', decisionId: 'decision-1', actorId: 'lin', observationRevision: 'obs-1',
  candidates: [{ candidateId: 'candidate:travel', planner: 'rule', intentKind: 'travel', status: 'eligible', legacyOrder: 0, survivalUrgency: 0, survivalReasonCodes: [], needScore: 0, personaFit: 0, personaReasonCodes: [], commitmentUrgency: 0, relationshipReasons: [], memorySourceIds: [] }],
  decisionSource: 'rule', outcome: 'chosen', exceptionSourceIds: [], survivalEnvelope: { state: 'stable', urgency: 0, reasonCodes: [], decisionKind: 'travel' },
  personaPolicy: { policyVersion: 'taixu.persona-policy.v1', innerTraitKnown: false, outerTraitKnown: false, dimensions: { riskTolerance: 50, helpingBias: 0, commitmentBias: 0, conflictBias: 0, socialBias: 0, cultivationBias: 0, persistenceBias: 0, evidenceBias: 0, resourceReserveBias: 0 }, reasonCodes: [], policyDigest: 'policy' },
  bounds: { limit: 32, included: 1, total: 1, truncated: false }, createdAt: 1,
});

const receipt = (status: TaixuGodotAuthorityReceipt['status'] = 'arrived'): TaixuGodotAuthorityReceipt => ({
  contractVersion: 'taixu.embodiment-receipt.v1', authority: 'godot', receiptId: 'receipt-1', actorId: 'lin', decisionId: 'decision-1', candidateId: 'candidate:travel', revision: 1, actionRecordId: 'action-1', executionId: 'execution-1', status, terminalSourceRef: `movement:${status}`, reportedAt: 9,
});

const evidence = (overrides: Record<string, unknown> = {}) => {
  const current = receipt();
  return createTaixuEvidenceCard({
    actorId: 'lin', source: { kind: 'world_fact', id: current.terminalSourceRef, revision: 1 }, visibility: 'actor_private',
    observedAtSemanticTime: 9, subject: `receipt:${current.receiptId}`, topic: 'movement_result', polarity: 'supported', reliability: 80, importance: 70, summary: 'Lin arrived at the verified destination.',
    ...overrides,
  } as never);
};

const input = (overrides: Record<string, unknown> = {}) => ({
  trace: trace(), candidateId: 'candidate:travel', receipt: receipt(), evidence: { card: evidence(), validThroughGameHour: 10 }, semanticTime: 10,
  ...overrides,
});

describe('taixu.result-selective-memory.v1', () => {
  test('only a matching visible arrived result produces two bounded, non-mutating proposals', () => {
    const value = input();
    const original = JSON.parse(JSON.stringify(value));
    const result = deriveTaixuResultSelectiveMemory(value);
    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') return;
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.map((proposal) => proposal.kind)).toEqual(['memory_eligibility', 'habit_eligibility']);
    expect(result.proposals[0]).toMatchObject({ actorId: 'lin', receiptId: 'receipt-1', terminalSourceRef: 'movement:arrived', evidenceVisibility: 'actor_private', score: 70 });
    expect(result.proposals[1].score).toBeLessThanOrEqual(result.proposals[0].score);
    expect(value).toEqual(original);
  });

  test('missing, failed, malformed, and mismatched receipts cannot create completion proposals', () => {
    expect(deriveTaixuResultSelectiveMemory(input({ receipt: undefined }))).toMatchObject({ kind: 'ineligible', reasonCode: 'result_receipt_missing' });
    for (const status of ['blocked', 'cancelled'] as const) {
      expect(deriveTaixuResultSelectiveMemory(input({ receipt: receipt(status) }))).toMatchObject({ kind: 'ineligible', reasonCode: 'result_receipt_not_arrived' });
    }
    expect(deriveTaixuResultSelectiveMemory(input({ receipt: { ...receipt(), authority: 'rule' } }))).toMatchObject({ kind: 'rejected', reasonCode: 'result_receipt_invalid' });
    expect(deriveTaixuResultSelectiveMemory(input({ receipt: { ...receipt(), actorId: 'other' } }))).toMatchObject({ kind: 'rejected', reasonCode: 'result_receipt_invalid' });
  });

  test('secret, rumor, unknown, stale, future, and mismatched evidence fail closed', () => {
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ visibility: 'secret' }), validThroughGameHour: 10 } }))).toMatchObject({ reasonCode: 'result_evidence_visibility_denied' });
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ source: { kind: 'rumor', id: 'movement:arrived', revision: 1 } }), validThroughGameHour: 10 } }))).toMatchObject({ reasonCode: 'result_evidence_source_denied' });
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ polarity: 'unknown' }), validThroughGameHour: 10 } }))).toMatchObject({ reasonCode: 'result_evidence_polarity_denied' });
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ subject: 'receipt:other' }), validThroughGameHour: 10 } }))).toMatchObject({ reasonCode: 'result_evidence_fence_mismatch' });
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence(), validThroughGameHour: 9 } }))).toMatchObject({ reasonCode: 'result_evidence_expired' });
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ observedAtSemanticTime: 11 }), validThroughGameHour: 11 } }))).toMatchObject({ reasonCode: 'result_evidence_invalid' });
  });

  test('low salience, exact replay, receipt conflict, and capacity stay bounded', () => {
    expect(deriveTaixuResultSelectiveMemory(input({ evidence: { card: evidence({ importance: 49 }), validThroughGameHour: 10 } }))).toMatchObject({ kind: 'ineligible', reasonCode: 'result_insufficient_salience' });
    const first = deriveTaixuResultSelectiveMemory(input());
    expect(first.kind).toBe('proposal');
    if (first.kind !== 'proposal') return;
    expect(deriveTaixuResultSelectiveMemory(input({ priorProposals: first.proposals }))).toMatchObject({ kind: 'replay', proposals: first.proposals });
    expect(deriveTaixuResultSelectiveMemory(input({ priorProposals: [{ ...first.proposals[0], evidenceDigest: 'other' }] }))).toMatchObject({ kind: 'rejected', reasonCode: 'result_history_receipt_conflict' });
    const filled: TaixuResultSelectiveProposalV1[] = Array.from({ length: TAIXU_RESULT_PROPOSAL_HISTORY_LIMIT - 1 }, (_, index) => ({
      ...first.proposals[index % 2], proposalId: `prior-${index}`, receiptId: `prior-receipt-${index}`,
    }));
    expect(deriveTaixuResultSelectiveMemory(input({ priorProposals: filled }))).toMatchObject({ kind: 'ineligible', reasonCode: 'result_history_capacity_full' });
  });
});

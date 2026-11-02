import {
  domainOutcomeEvidenceIdempotencyKey,
  projectDomainOutcomeEvidence,
  type DomainOutcomeEvidenceDomain,
  type DomainOutcomeEvidenceSource,
} from './runtimeDomainOutcomeEvidencePort';
import { admitRelationshipMemoryOutcome } from './relationshipMemoryOutcomeAdmissionLogic';

function receipt(input: {
  domain: 'relationship' | 'memory';
  source: DomainOutcomeEvidenceSource;
  outcome?: 'applied' | 'rejected' | 'failed' | 'no_effect';
  replay?: boolean;
}) {
  const sourceRef = `${input.source}:terminal:1`;
  const sourceRevision = 3;
  return projectDomainOutcomeEvidence({
    domain: input.domain,
    source: input.source,
    sourceRef,
    sourceRevision,
    idempotencyKey: domainOutcomeEvidenceIdempotencyKey(
      input.domain as DomainOutcomeEvidenceDomain,
      sourceRef,
      sourceRevision,
    ),
    effectReceiptRef: `${input.domain}:effect:1`,
    outcome: input.outcome ?? 'applied',
    replay: input.replay ?? false,
  })!;
}

function expected(value: ReturnType<typeof receipt>) {
  return {
    domain: value.domain as 'relationship' | 'memory',
    source: value.source,
    sourceRef: value.sourceRef,
    sourceRevision: value.sourceRevision,
    effectReceiptRef: value.effectReceiptRef,
  };
}

describe('relationship/memory Domain Writer admission', () => {
  test.each([
    ['relationship', 'group_pair_duty'],
    ['memory', 'conversation_session'],
  ] as const)('admits an applied %s receipt from its authoritative source', (domain, source) => {
    const value = receipt({ domain, source });
    expect(admitRelationshipMemoryOutcome({ receipt: value, expected: expected(value) }))
      .toMatchObject({ status: 'admitted', domain, outcome: 'applied' });
  });

  test.each(['rejected', 'failed', 'no_effect'] as const)(
    '%s stays a formal zero-write outcome',
    (outcome) => {
      const value = receipt({ domain: 'memory', source: 'conversation_session', outcome });
      expect(admitRelationshipMemoryOutcome({ receipt: value, expected: expected(value) }))
        .toMatchObject({ status: 'no_effect', outcome, reasonCode: 'domain_outcome_no_effect' });
    },
  );

  test('exact replay preserves admission identity', () => {
    const first = receipt({ domain: 'relationship', source: 'group_pair_duty' });
    const replay = receipt({ domain: 'relationship', source: 'group_pair_duty', replay: true });
    const firstAdmission = admitRelationshipMemoryOutcome({ receipt: first, expected: expected(first) });
    const replayAdmission = admitRelationshipMemoryOutcome({ receipt: replay, expected: expected(replay) });
    expect(replayAdmission?.receiptKey).toBe(firstAdmission?.receiptKey);
    expect(replayAdmission?.replay).toBe(true);
  });

  test.each([
    ['domain', { domain: 'memory' }],
    ['source', { source: 'conversation_session' }],
    ['source ref', { sourceRef: 'other' }],
    ['revision', { sourceRevision: 4 }],
    ['effect receipt', { effectReceiptRef: 'other' }],
  ] as const)('%s drift fails closed before either writer', (_label, drift) => {
    const value = receipt({ domain: 'relationship', source: 'group_pair_duty' });
    expect(admitRelationshipMemoryOutcome({
      receipt: value,
      expected: { ...expected(value), ...drift },
    })).toBeUndefined();
  });

  test('forged receipt identity fails closed', () => {
    const value = receipt({ domain: 'memory', source: 'conversation_session' });
    expect(admitRelationshipMemoryOutcome({
      receipt: { ...value, receiptKey: 'forged' },
      expected: expected(value),
    })).toBeUndefined();
  });
});

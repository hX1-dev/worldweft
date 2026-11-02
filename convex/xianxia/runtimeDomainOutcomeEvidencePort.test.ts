import {
  domainOutcomeEvidenceIdempotencyKey,
  projectDomainOutcomeEvidence,
} from './runtimeDomainOutcomeEvidencePort';

const base = {
  domain: 'resource' as const,
  source: 'action_execution',
  sourceRef: 'execution:1',
  sourceRevision: 2,
  idempotencyKey: domainOutcomeEvidenceIdempotencyKey('resource', 'execution:1', 2),
  effectReceiptRef: 'resource-receipt:1',
  outcome: 'applied' as const,
  replay: false,
};

describe('DomainOutcomeEvidencePort', () => {
  test('unifies source/revision/idempotency evidence without owning a domain effect', () => {
    expect(projectDomainOutcomeEvidence(base)).toMatchObject({
      domain: 'resource', source: 'action_execution', outcome: 'applied',
    });
  });

  test.each([
    ['wrong domain source', { source: 'conversation_session' }],
    ['invalid revision', { sourceRevision: 0 }],
    ['missing effect receipt', { effectReceiptRef: '' }],
    ['forged key', { idempotencyKey: 'forged' }],
  ])('%s fails closed', (_label, patch) => {
    expect(projectDomainOutcomeEvidence({ ...base, ...patch })).toBeUndefined();
  });

  test('keeps non-effect outcomes and replay under the same receipt identity', () => {
    const first = projectDomainOutcomeEvidence(base);
    const replay = projectDomainOutcomeEvidence({ ...base, replay: true });
    expect(replay?.receiptKey).toBe(first?.receiptKey);
    expect(projectDomainOutcomeEvidence({
      domain: 'relationship', source: 'conversation_session', sourceRef: 'conversation:1', sourceRevision: 1,
      idempotencyKey: domainOutcomeEvidenceIdempotencyKey('relationship', 'conversation:1', 1),
      effectReceiptRef: 'relationship-receipt:1', outcome: 'no_effect', replay: false,
    })?.outcome).toBe('no_effect');
    expect(projectDomainOutcomeEvidence({
      domain: 'memory', source: 'group_pair_duty', sourceRef: 'terminal:1', sourceRevision: 3,
      idempotencyKey: domainOutcomeEvidenceIdempotencyKey('memory', 'terminal:1', 3),
      effectReceiptRef: 'memory-receipt:1', outcome: 'rejected', replay: false,
    })?.outcome).toBe('rejected');
  });
});

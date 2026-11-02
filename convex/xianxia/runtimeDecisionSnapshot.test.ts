import { buildAuthoritativeDecisionSnapshot } from './runtimeDecisionSnapshot';

const observation: any = {
  actorId: 'han-li', observationRevision: 'obs:1', targetRefs: ['actor:li'], beliefs: [], memories: [],
  bounds: {}, semanticDigest: 'semantic:1', observationDigest: 'observation:1', contractVersion: 'taixu.life_observation.v2',
};

describe('AuthoritativeDecisionSnapshot', () => {
  it('binds the existing observation and candidate digest without creating world state', () => {
    const snapshot = buildAuthoritativeDecisionSnapshot({ observation, candidateSetDigest: 'candidates:1', now: 10 });
    expect(snapshot.observation).toBe(observation);
    expect(snapshot.observationRevision).toBe('obs:1');
    expect(snapshot.candidateSetDigest).toBe('candidates:1');
    expect(snapshot.busy).toBe(false);
  });

  it('changes the binding for observation, candidate, privacy and busy drift', () => {
    const base = buildAuthoritativeDecisionSnapshot({ observation, candidateSetDigest: 'candidates:1', now: 10 });
    expect(buildAuthoritativeDecisionSnapshot({ observation: { ...observation, observationRevision: 'obs:2' }, candidateSetDigest: 'candidates:1', now: 10 }).snapshotDigest).not.toBe(base.snapshotDigest);
    expect(buildAuthoritativeDecisionSnapshot({ observation, candidateSetDigest: 'candidates:2', now: 10 }).snapshotDigest).not.toBe(base.snapshotDigest);
    expect(buildAuthoritativeDecisionSnapshot({ observation, candidateSetDigest: 'candidates:1', activeExecution: { executionId: 'x' }, now: 10 }).snapshotDigest).not.toBe(base.snapshotDigest);
  });

  it('fails closed for absent sources and expired leases', () => {
    expect(() => buildAuthoritativeDecisionSnapshot({ observation, now: 10 })).toThrow('source_missing');
    expect(() => buildAuthoritativeDecisionSnapshot({ observation, candidateSetDigest: 'candidates:1', lease: { leaseId: 'l', expiresAt: 10 }, now: 10 })).toThrow('lease_expired');
  });
});

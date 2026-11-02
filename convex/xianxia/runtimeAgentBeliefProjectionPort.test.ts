import { projectRuntimeAgentBeliefs } from './runtimeAgentBeliefProjectionPort';

const worldId = 'world-1' as never;
const eventId = 'event-1' as never;

function projectionContext({
  evidence = [],
  applications = [],
  event = { _id: eventId, worldId, actorIds: ['actor-1'], visibility: 'private' },
  memories = [],
}: {
  evidence?: Record<string, unknown>[];
  applications?: Record<string, unknown>[];
  event?: Record<string, unknown> | null;
  memories?: Record<string, unknown>[];
}) {
  const query = (table: string) => ({
    withIndex: () => ({
      collect: async () =>
        (table === 'beliefEvidence' ? evidence : applications) as never,
      take: async () => memories as never,
    }),
  });
  return { db: { query, get: async () => event as never } } as never;
}

function belief(overrides: Record<string, unknown> = {}) {
  return {
    beliefId: 'belief-1',
    active: true,
    validity: 'active',
    topicId: 'topic-1',
    subjectClaimId: 'claim-1',
    sourceClaimId: 'claim-fallback',
    beliefSeriesId: 'series-1',
    kind: 'rumor',
    summary: '可被证据支持的传闻',
    sourceActorId: 'actor-2',
    truthStatus: 'unknown',
    revision: 3,
    ...overrides,
  } as never;
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: 'evidence-1',
    topicId: 'topic-1',
    createdAt: 10,
    sourceEventId: eventId,
    verdict: 'confirm',
    ...overrides,
  } as never;
}

describe('RuntimeAgentBeliefProjectionPort', () => {
  test('projects the earliest accessible, unapplied evidence without changing the belief fields', async () => {
    const result = await projectRuntimeAgentBeliefs(
      projectionContext({ evidence: [evidence({ evidenceId: 'late', createdAt: 20 }), evidence()] }),
      worldId,
      'actor-1',
      'topic-1',
      [belief()],
    );

    expect(result).toEqual([
      expect.objectContaining({
        beliefId: 'belief-1',
        revision: 3,
        availableEvidenceEventId: String(eventId),
        availableEvidenceVerdict: 'confirm',
      }),
    ]);
  });

  test('fails closed for topic, terminal, applied and inaccessible private evidence while replay stays stable', async () => {
    const input = projectionContext({
      evidence: [evidence({ topicId: 'other-topic' }), evidence()],
      applications: [{ evidenceId: 'evidence-1' }],
      event: { _id: eventId, worldId, actorIds: [], visibility: 'private' },
    });
    const rows = [belief(), belief({ beliefId: 'inactive', active: false })];
    const first = await projectRuntimeAgentBeliefs(input, worldId, 'actor-1', 'topic-1', rows);
    const replay = await projectRuntimeAgentBeliefs(input, worldId, 'actor-1', 'topic-1', rows);

    expect(replay).toEqual(first);
    expect(first).toEqual([
      expect.objectContaining({ beliefId: 'belief-1', availableEvidenceEventId: undefined }),
    ]);
  });

  test('permits private evidence only through an exact undistorted actor memory', async () => {
    const result = await projectRuntimeAgentBeliefs(
      projectionContext({
        evidence: [evidence()],
        event: { _id: eventId, worldId, actorIds: [], visibility: 'private' },
        memories: [{ actorId: 'actor-1', source: 'direct', distorted: false }],
      }),
      worldId,
      'actor-1',
      'topic-1',
      [belief()],
    );

    expect(result[0]?.availableEvidenceEventId).toBe(String(eventId));
  });
});

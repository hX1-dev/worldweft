import {
  LIFE_SOCIAL_REVIEW_VERSION,
  buildLifeSocialReview,
  isValidLifeSocialReview,
  type LifeSocialReviewSource,
  type LifeSocialReviewWindow,
} from './lifeSocialReviewLogic';

const daily: LifeSocialReviewWindow = {
  windowId: 'life-rhythm:daily:2',
  windowDigest: 'stable64:daily',
  cadence: 'daily',
  periodIndex: 2,
  windowStartGameHour: 24,
  windowEndGameHour: 48,
};

const weekly: LifeSocialReviewWindow = {
  windowId: 'life-rhythm:weekly:1',
  windowDigest: 'stable64:weekly',
  cadence: 'weekly',
  periodIndex: 1,
  windowStartGameHour: 0,
  windowEndGameHour: 168,
};

function source(overrides: Partial<LifeSocialReviewSource> = {}): LifeSocialReviewSource {
  return {
    kind: 'personal_goal_terminal',
    sourceRef: 'personal-goal:1',
    sourceRevision: 'goal:1:1',
    sourceDigest: 'stable64:source',
    occurredGameHour: 30,
    visibility: 'actor_private',
    subjectActorIds: ['han'],
    ...overrides,
  };
}

describe('lifeSocialReviewLogic', () => {
  test('writes an explicit quiet receipt with literal zero side effects', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily, sources: [],
    });
    expect(result).toMatchObject({
      contractVersion: LIFE_SOCIAL_REVIEW_VERSION,
      reviewId: 'life-social-review:life-rhythm:daily:2:han',
      status: 'quiet', sourceRefs: [], sourcesTruncated: false,
      providerCalls: 0, createdWorldActions: 0, createdSocialCandidates: 0,
      createdRelationshipChanges: 0, createdMemories: 0,
    });
    expect(isValidLifeSocialReview(result)).toBe(true);
  });

  test('daily accepts only daily owner kinds', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [
        source(),
        source({ kind: 'social_session_terminal', sourceRef: 'session:1' }),
        source({ kind: 'social_consequence_open', sourceRef: 'consequence:1' }),
      ],
    });
    expect(result.sourceRefs.map((entry) => entry.kind)).toEqual(['personal_goal_terminal']);
  });

  test('weekly accepts only weekly owner kinds', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: weekly,
      sources: [
        source({ kind: 'personal_goal_terminal', sourceRef: 'goal:1' }),
        source({ kind: 'social_session_terminal', sourceRef: 'session:1' }),
        source({ kind: 'social_consequence_open', sourceRef: 'consequence:1' }),
      ],
    });
    expect(result.sourceRefs.map((entry) => entry.kind)).toEqual([
      'social_consequence_open', 'social_session_terminal',
    ]);
  });

  test('filters a private source from an unrelated actor', () => {
    const result = buildLifeSocialReview({
      actorId: 'lin', actorCreatedGameHour: 0, window: daily,
      sources: [source({ subjectActorIds: ['han'] })],
    });
    expect(result.status).toBe('quiet');
  });

  test('normalizes participant order and remains input-order stable', () => {
    const a = source({
      kind: 'group_duty_terminal', sourceRef: 'duty:1',
      subjectActorIds: ['lin', 'han'], visibility: 'participants',
    });
    const b = source({ sourceRef: 'goal:2', occurredGameHour: 31 });
    const left = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily, sources: [a, b],
    });
    const right = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [{ ...b }, { ...a, subjectActorIds: ['han', 'lin'] }],
    });
    expect(left.reviewDigest).toBe(right.reviewDigest);
    expect(left.sourceRefs).toEqual(right.sourceRefs);
  });

  test('uses a half-open terminal interval', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [
        source({ sourceRef: 'at-start', occurredGameHour: 24 }),
        source({ sourceRef: 'at-end', occurredGameHour: 48 }),
      ],
    });
    expect(result.sourceRefs.map((entry) => entry.sourceRef)).toEqual(['at-start']);
  });

  test('keeps an open duty created before the window but not after its end', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [
        source({ kind: 'group_duty_open', sourceRef: 'old', occurredGameHour: 1 }),
        source({ kind: 'group_duty_open', sourceRef: 'future', occurredGameHour: 48 }),
      ],
    });
    expect(result.sourceRefs.map((entry) => entry.sourceRef)).toEqual(['old']);
  });

  test('deduplicates an identical source', () => {
    const entry = source();
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily, sources: [entry, { ...entry }],
    });
    expect(result.sourceRefs).toHaveLength(1);
  });

  test('fails closed on the same sourceRef with conflicting provenance', () => {
    expect(() => buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [source(), source({ sourceDigest: 'stable64:changed' })],
    })).toThrow('life_social_review_source_conflict');
  });

  test('truncates deterministically at eight refs', () => {
    const sources = Array.from({ length: 12 }, (_, index) => source({
      sourceRef: `action:${index.toString().padStart(2, '0')}`,
      kind: 'action_terminal', occurredGameHour: 24 + index,
      sourceRevision: `revision:${index}`,
      sourceDigest: `stable64:${index}`,
    }));
    const left = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily, sources,
    });
    const right = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily, sources: [...sources].reverse(),
    });
    expect(left.sourceRefs).toHaveLength(8);
    expect(left.sourcesTruncated).toBe(true);
    expect(left.reviewDigest).toBe(right.reviewDigest);
  });

  test('preserves an upstream bounded-scan truncation marker', () => {
    const result = buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, window: daily,
      sources: [source()], scanTruncated: true,
    });
    expect(result.sourcesTruncated).toBe(true);
  });

  test('rejects windows before entry and after death', () => {
    expect(() => buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 48, window: daily, sources: [],
    })).toThrow('life_social_review_actor_ineligible');
    expect(() => buildLifeSocialReview({
      actorId: 'han', actorCreatedGameHour: 0, actorDeceasedGameHour: 47,
      window: daily, sources: [],
    })).toThrow('life_social_review_actor_ineligible');
  });
});

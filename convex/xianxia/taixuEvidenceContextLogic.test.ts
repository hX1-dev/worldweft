import {
  assertTaixuEvidenceSupersede,
  compileTaixuEvidenceContext,
  createTaixuEvidenceCard,
  TAIXU_CONTEXT_MAX_BYTES,
  TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS,
  TaixuEvidenceContextError,
  validateTaixuEvidenceCard,
  type CreateTaixuEvidenceCardInput,
  type TaixuEvidenceCardV1,
} from './taixuEvidenceContextLogic';

function cardInput(
  overrides: Partial<CreateTaixuEvidenceCardInput> = {},
): CreateTaixuEvidenceCardInput {
  return {
    actorId: 'npc-lin',
    source: { kind: 'direct_observation', id: 'event-herb-1', revision: 1 },
    visibility: 'actor_private',
    observedAtSemanticTime: 12,
    subject: 'npc-qiao',
    topic: 'kept_promise',
    polarity: 'supported',
    reliability: 90,
    importance: 70,
    summary: '乔守约按时交付了药草。',
    ...overrides,
  };
}

function card(
  overrides: Partial<CreateTaixuEvidenceCardInput> = {},
): TaixuEvidenceCardV1 {
  return createTaixuEvidenceCard(cardInput(overrides));
}

function compile(cards: unknown[], overrides: Record<string, unknown> = {}) {
  return compileTaixuEvidenceContext({
    query: {
      actorId: 'npc-lin',
      semanticTime: 20,
      topics: ['kept_promise'],
      ...overrides,
    },
    cards,
  });
}

function expectCode(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error('expected operation to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(TaixuEvidenceContextError);
    expect((error as TaixuEvidenceContextError).code).toBe(code);
  }
}

describe('taixu.evidence-memory.v1', () => {
  test('canonical creation and same source revision replay are stable', () => {
    const first = card();
    const replay = card();
    expect(replay).toEqual(first);
    expect(validateTaixuEvidenceCard(first, { actorId: 'npc-lin', digest: first.digest })).toBe(first);

    const compiled = compile([first, replay]);
    expect(compiled.included).toHaveLength(1);
    expect(compiled.excluded).toContainEqual({
      sourceRef: 'direct_observation:event-herb-1@1',
      reason: 'evidence_duplicate_revision',
    });
  });

  test('rejects actor, missing source, visibility enum, time, revision, digest and summary violations', () => {
    const valid = card();
    expectCode(() => validateTaixuEvidenceCard(valid, { actorId: 'npc-other' }), 'evidence_actor_mismatch');
    expectCode(
      () => validateTaixuEvidenceCard({ ...valid, source: undefined }),
      'evidence_source_missing',
    );
    expectCode(
      () => validateTaixuEvidenceCard({ ...valid, visibility: 'guild' }),
      'evidence_schema_invalid',
    );
    expectCode(
      () => validateTaixuEvidenceCard(valid, { semanticTime: 11 }),
      'evidence_time_invalid',
    );
    expectCode(
      () => createTaixuEvidenceCard(cardInput({
        source: { kind: 'rumor', id: 'rumor-1', revision: 2 },
      })),
      'evidence_supersede_invalid',
    );
    expectCode(
      () => validateTaixuEvidenceCard({ ...valid, digest: `${valid.digest}-tampered` }),
      'evidence_digest_mismatch',
    );
    expectCode(
      () => card({ summary: '缘'.repeat(TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS + 1) }),
      'evidence_schema_invalid',
    );
  });

  test('requires an explicit adjacent revision and preserves old history', () => {
    const oldCard = card();
    const nextCard = card({
      source: {
        kind: 'direct_observation',
        id: 'event-herb-1',
        revision: 2,
        supersedesRevision: 1,
      },
      observedAtSemanticTime: 18,
      polarity: 'contradicted',
      summary: '乔未在新约定期限内交付药草。',
    });
    expect(assertTaixuEvidenceSupersede(oldCard, nextCard)).toBe(nextCard);
    const result = compile([oldCard, nextCard]);
    expect(result.included.map(({ card: included }) => included.digest)).toEqual([nextCard.digest]);
    expect(result.excluded).toContainEqual({
      sourceRef: 'direct_observation:event-herb-1@1',
      reason: 'evidence_superseded',
    });
    expect(oldCard.polarity).toBe('supported');
    expect(nextCard.polarity).toBe('contradicted');
  });
});

describe('taixu.context-compiler.v1', () => {
  test('keeps supported, contradicted and hearsay/unknown evidence distinguishable', () => {
    const result = compile([
      card(),
      card({
        source: { kind: 'conversation', id: 'talk-1', revision: 1 },
        polarity: 'contradicted',
        summary: '乔否认曾作出承诺。',
      }),
      card({
        source: { kind: 'rumor', id: 'rumor-1', revision: 1 },
        polarity: 'unknown',
        reliability: 30,
        summary: '坊间听闻乔可能另有安排。',
      }),
    ]);
    expect(result.buckets.supported).toHaveLength(1);
    expect(result.buckets.contradicted).toHaveLength(1);
    expect(result.buckets.unknown).toHaveLength(1);
    expect(result.evidenceSection).toContain('source=rumor:rumor-1@1');
  });

  test('sorts deterministically by relevance, recency, reliability, importance and digest', () => {
    const otherTopic = card({
      source: { kind: 'world_fact', id: 'topic-first', revision: 1 },
      topic: 'shared_danger',
      observedAtSemanticTime: 19,
      reliability: 100,
      importance: 100,
    });
    const recent = card({
      source: { kind: 'world_fact', id: 'recent', revision: 1 },
      observedAtSemanticTime: 18,
      reliability: 10,
      importance: 10,
    });
    const reliable = card({
      source: { kind: 'world_fact', id: 'reliable', revision: 1 },
      observedAtSemanticTime: 17,
      reliability: 90,
      importance: 10,
    });
    const important = card({
      source: { kind: 'world_fact', id: 'important', revision: 1 },
      observedAtSemanticTime: 17,
      reliability: 90,
      importance: 80,
    });
    const result = compileTaixuEvidenceContext({
      query: {
        actorId: 'npc-lin',
        semanticTime: 20,
        topics: ['kept_promise', 'shared_danger'],
      },
      cards: [otherTopic, reliable, recent, important],
    });
    expect(result.included.map(({ card: included }) => included.source.id)).toEqual([
      'recent',
      'important',
      'reliable',
      'topic-first',
    ]);
    expect(result.included[0].reason).toEqual({
      relevance: 102,
      recency: 18,
      reliability: 10,
      importance: 10,
      tieBreakDigest: recent.digest,
    });
    expect(compileTaixuEvidenceContext({
      query: { actorId: 'npc-lin', semanticTime: 20, topics: ['kept_promise', 'shared_danger'] },
      cards: [important, recent, otherTopic, reliable],
    }).digest).toBe(result.digest);
  });

  test('handles zero, one, eight and more than eight cards with explicit exclusions', () => {
    expect(compile([]).included).toHaveLength(0);
    expect(compile([card()]).included).toHaveLength(1);
    const cards = Array.from({ length: 9 }, (_, index) => card({
      source: { kind: 'world_fact', id: `event-${index}`, revision: 1 },
      observedAtSemanticTime: index,
    }));
    expect(compile(cards.slice(0, 8)).included).toHaveLength(8);
    const bounded = compile(cards);
    expect(bounded.included).toHaveLength(8);
    expect(bounded.excluded.filter(({ reason }) => reason === 'context_card_limit')).toHaveLength(1);
  });

  test('unrelated long history does not alter selected cards or digest; relevant evidence can replace', () => {
    const baseCards = Array.from({ length: 8 }, (_, index) => card({
      source: { kind: 'relationship_event', id: `base-${index}`, revision: 1 },
      observedAtSemanticTime: index + 1,
    }));
    const base = compile(baseCards);
    const unrelated = Array.from({ length: 40 }, (_, index) => card({
      source: { kind: 'rumor', id: `unrelated-${index}`, revision: 1 },
      topic: 'market_weather',
    }));
    const withHistory = compile([...unrelated, ...baseCards]);
    expect(withHistory.included).toEqual(base.included);
    expect(withHistory.digest).toBe(base.digest);

    const newRelevant = card({
      source: { kind: 'direct_observation', id: 'new-relevant', revision: 1 },
      observedAtSemanticTime: 20,
      reliability: 100,
      importance: 100,
    });
    const replaced = compile([...baseCards, newRelevant]);
    expect(replaced.included.map(({ card: included }) => included.digest)).toContain(newRelevant.digest);
    expect(replaced.included.map(({ card: included }) => included.digest)).not.toContain(baseCards[0].digest);
  });

  test('hard-filters secret, wrong actor, future, unrelated and tampered evidence', () => {
    const secret = card({
      source: { kind: 'rumor', id: 'secret', revision: 1 },
      visibility: 'secret',
    });
    const otherActor = card({
      actorId: 'npc-other',
      source: { kind: 'world_fact', id: 'other-actor', revision: 1 },
    });
    const future = card({
      source: { kind: 'world_fact', id: 'future', revision: 1 },
      observedAtSemanticTime: 21,
    });
    const unrelated = card({
      source: { kind: 'world_fact', id: 'unrelated', revision: 1 },
      topic: 'market_weather',
    });
    const valid = card({ source: { kind: 'world_fact', id: 'valid', revision: 1 } });
    const tampered = { ...valid, summary: '被篡改的摘要。' };
    const result = compile([secret, otherActor, future, unrelated, tampered, valid]);
    expect(result.included.map(({ card: included }) => included.digest)).toEqual([valid.digest]);
    expect(result.excluded.map(({ reason }) => reason)).toEqual(expect.arrayContaining([
      'evidence_visibility_denied',
      'evidence_actor_mismatch',
      'evidence_time_invalid',
      'evidence_topic_mismatch',
      'evidence_digest_mismatch',
    ]));
  });

  test('honors 240 Unicode code points and never exceeds 4096 UTF-8 bytes', () => {
    const exact = card({ summary: '缘'.repeat(TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS) });
    expect(Array.from(exact.summary)).toHaveLength(TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS);
    const largeCards = Array.from({ length: 8 }, (_, index) => card({
      source: { kind: 'world_fact', id: `unicode-${index}-${'界'.repeat(80)}`, revision: 1 },
      subject: `乔${'道'.repeat(100)}`,
      topic: 'kept_promise',
      summary: `${index}${'缘'.repeat(TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS - 1)}`,
      observedAtSemanticTime: index,
    }));
    const result = compile(largeCards);
    expect(result.byteLength).toBeLessThanOrEqual(TAIXU_CONTEXT_MAX_BYTES);
    expect(new TextEncoder().encode(result.evidenceSection)).toHaveLength(result.byteLength);
    expect(result.excluded.some(({ reason }) => reason === 'context_budget_exceeded')).toBe(true);
  });

  test('rejects malformed queries and maxCards above the fixed limit', () => {
    expectCode(
      () => compileTaixuEvidenceContext({
        query: { actorId: 'npc-lin', semanticTime: 20, topics: [], maxCards: 9 },
        cards: [],
      }),
      'context_query_invalid',
    );
  });
});

import {
  CONVERSATION_ACTOR_COOLDOWN_MS,
  CONVERSATION_PAIR_COOLDOWN_MS,
  CONVERSATION_TOPIC_COOLDOWN_MS,
  conversationActorCooldownKey,
  conversationCooldownEntries,
  conversationPairCooldownKey,
  conversationTopicCooldownKey,
  evaluateConversationCooldown,
} from './conversationCooldownLogic';

describe('C012b conversation cooldown policy', () => {
  const actorId = 'actor_a';
  const targetActorId = 'actor_b';
  const topicId = 'herb_delivery';
  const startedAt = 10_000;

  test('writes actor, target, unordered pair and unordered topic clocks', () => {
    const entries = conversationCooldownEntries({ actorId, targetActorId, topicId, startedAt });
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.nextAllowedAt)).toEqual([
      startedAt + CONVERSATION_ACTOR_COOLDOWN_MS,
      startedAt + CONVERSATION_ACTOR_COOLDOWN_MS,
      startedAt + CONVERSATION_PAIR_COOLDOWN_MS,
      startedAt + CONVERSATION_TOPIC_COOLDOWN_MS,
    ]);
    expect(conversationPairCooldownKey(actorId, targetActorId)).toBe(
      conversationPairCooldownKey(targetActorId, actorId),
    );
    expect(conversationTopicCooldownKey(actorId, targetActorId, topicId)).toBe(
      conversationTopicCooldownKey(targetActorId, actorId, topicId),
    );
  });

  test.each([
    ['conversation_actor_cooldown', conversationActorCooldownKey(actorId)],
    ['conversation_target_cooldown', conversationActorCooldownKey(targetActorId)],
    ['conversation_pair_cooldown', conversationPairCooldownKey(actorId, targetActorId)],
    [
      'conversation_topic_cooldown',
      conversationTopicCooldownKey(actorId, targetActorId, topicId),
    ],
  ] as const)('returns stable %s without changing clocks', (reasonCode, cooldownKey) => {
    const result = evaluateConversationCooldown({
      actorId,
      targetActorId,
      topicId,
      now: startedAt,
      cooldowns: new Map([[cooldownKey, { nextAllowedAt: startedAt + 1 }]]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode, cooldownKey });
  });

  test('allows the exact boundary and a different topic after only topic cooldown remains', () => {
    const key = conversationTopicCooldownKey(actorId, targetActorId, topicId);
    expect(
      evaluateConversationCooldown({
        actorId,
        targetActorId,
        topicId,
        now: startedAt + CONVERSATION_TOPIC_COOLDOWN_MS,
        cooldowns: new Map([[key, { nextAllowedAt: startedAt + CONVERSATION_TOPIC_COOLDOWN_MS }]]),
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateConversationCooldown({
        actorId,
        targetActorId,
        topicId: 'different_topic',
        now: startedAt,
        cooldowns: new Map([[key, { nextAllowedAt: Number.MAX_SAFE_INTEGER }]]),
      }),
    ).toEqual({ ok: true });
  });
});

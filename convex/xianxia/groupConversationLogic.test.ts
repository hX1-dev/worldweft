import {
  GROUP_CONVERSATION_MAX_TURNS,
  planGroupConversationMembership,
  validateGroupConversationTurn,
  type GroupConversationView,
} from './groupConversationLogic';

const active: GroupConversationView = {
  status: 'active',
  participantActorIds: ['a', 'b', 'c'],
  observerActorIds: ['d'],
  currentSpeakerActorId: 'b',
  turnNumber: 1,
  maxTurns: GROUP_CONVERSATION_MAX_TURNS,
  expiresAt: 10_000,
};

const turn = {
  actorId: 'b',
  turnId: 'group:turn:2',
  expectedTurnNumber: 2,
  speechAct: 'inform' as const,
  utteranceText: '我亲眼见到了此事。',
  addressedActorIds: ['a', 'c'],
  referencedFactIds: ['event:1'],
  referencedBeliefIds: [],
  now: 100,
};

describe('C014a group membership and floor', () => {
  test('normalizes 3..5 participants while preserving initiator position in the ring', () => {
    expect(planGroupConversationMembership({
      actorId: 'c', participantActorIds: ['c', 'a', 'b'], observerActorIds: ['e', 'd'],
    })).toEqual({
      ok: true,
      participantActorIds: ['a', 'b', 'c'],
      observerActorIds: ['d', 'e'],
      firstSpeakerActorId: 'c',
      nextSpeakerActorId: 'a',
    });
    expect(planGroupConversationMembership({
      actorId: 'a', participantActorIds: ['a', 'b'],
    })).toMatchObject({ ok: false, reasonCode: 'group_participant_count_invalid' });
    expect(planGroupConversationMembership({
      actorId: 'a', participantActorIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    })).toMatchObject({ ok: false, reasonCode: 'group_participant_count_invalid' });
  });

  test('rejects duplicates, overlap and an initiator outside the participant set', () => {
    for (const input of [
      { actorId: 'a', participantActorIds: ['a', 'a', 'b', 'c'] },
      { actorId: 'a', participantActorIds: ['a', 'b', 'c'], observerActorIds: ['c'] },
      { actorId: 'z', participantActorIds: ['a', 'b', 'c'] },
    ]) {
      expect(planGroupConversationMembership(input)).toMatchObject({
        ok: false, reasonCode: 'group_membership_invalid',
      });
    }
  });

  test('advances a deterministic round-robin floor and broadcasts knowledge to all listeners', () => {
    expect(validateGroupConversationTurn(active, turn)).toEqual({
      ok: true,
      turnNumber: 2,
      text: turn.utteranceText,
      addressedActorIds: ['a', 'c'],
      referencedFactIds: ['event:1'],
      referencedBeliefIds: [],
      listenerActorIds: ['a', 'c', 'd'],
      nextSpeakerActorId: 'c',
      terminalStatus: undefined,
      terminalReasonCode: undefined,
    });
  });

  test('observer, non-owner, duplicate and stale turns fail before a write plan exists', () => {
    expect(validateGroupConversationTurn(active, { ...turn, actorId: 'd' })).toMatchObject({
      ok: false, reasonCode: 'group_observer_cannot_speak',
    });
    expect(validateGroupConversationTurn(active, { ...turn, actorId: 'c' })).toMatchObject({
      ok: false, reasonCode: 'group_wrong_speaker',
    });
    expect(validateGroupConversationTurn(active, turn, new Set([turn.turnId]))).toMatchObject({
      ok: false, reasonCode: 'group_duplicate_turn',
    });
    expect(validateGroupConversationTurn(active, { ...turn, expectedTurnNumber: 3 })).toMatchObject({
      ok: false, reasonCode: 'group_turn_mismatch',
    });
  });

  test('end_topic, turn limit and expiry terminate deterministically', () => {
    expect(validateGroupConversationTurn(active, { ...turn, speechAct: 'end_topic' })).toMatchObject({
      ok: true, terminalStatus: 'resolved', terminalReasonCode: 'group_conversation_ended',
      nextSpeakerActorId: undefined,
    });
    expect(validateGroupConversationTurn({ ...active, turnNumber: 14 }, { ...turn, expectedTurnNumber: 15 })).toMatchObject({
      ok: true, terminalReasonCode: 'group_conversation_turn_limit',
    });
    expect(validateGroupConversationTurn(active, { ...turn, now: 10_000 })).toMatchObject({
      ok: false, reasonCode: 'group_conversation_expired',
    });
  });
});

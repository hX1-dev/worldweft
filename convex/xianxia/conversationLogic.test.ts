import {
  CONVERSATION_MAX_KNOWLEDGE_REFS,
  CONVERSATION_MAX_UTTERANCE_CHARS,
  claimBeliefKind,
  initialSpeechAct,
  initialUtterance,
  orderedConversationActors,
  speechActCreatesClaim,
  validateConversationTurn,
  type ConversationView,
} from './conversationLogic';

const active = (overrides: Partial<ConversationView> = {}): ConversationView => ({
  conversationId: 'conversation:1',
  status: 'active',
  actorAId: 'a',
  actorBId: 'b',
  currentSpeakerActorId: 'a',
  turnNumber: 1,
  maxTurns: 12,
  expiresAt: 10_000,
  ...overrides,
});

const turn = (overrides: Record<string, unknown> = {}) => ({
  actorId: 'a',
  targetActorId: 'b',
  turnId: 'turn:2',
  expectedTurnNumber: 2,
  speechAct: 'inform' as const,
  utteranceText: '药草坡今日尚有灵草。',
  addressedActorIds: ['b'],
  referencedFactIds: ['event:1'],
  referencedBeliefIds: [],
  now: 1_000,
  ...overrides,
});

describe('conversation turn state machine', () => {
  test('accepts the authoritative speaker and advances to the other participant', () => {
    expect(validateConversationTurn(active(), turn())).toEqual({
      ok: true,
      turnNumber: 2,
      text: '药草坡今日尚有灵草。',
      addressedActorIds: ['b'],
      referencedFactIds: ['event:1'],
      referencedBeliefIds: [],
      nextSpeakerActorId: 'b',
      terminalStatus: undefined,
      terminalReasonCode: undefined,
    });
  });

  test.each([
    [{ status: 'resolved' }, {}, 'conversation_not_active'],
    [{ expiresAt: 1_000 }, {}, 'conversation_expired'],
    [{}, { actorId: 'c' }, 'conversation_not_participant'],
    [{}, { targetActorId: 'c' }, 'conversation_target_mismatch'],
    [{ currentSpeakerActorId: 'b' }, {}, 'conversation_wrong_speaker'],
    [{}, { expectedTurnNumber: 3 }, 'conversation_turn_mismatch'],
    [{}, { utteranceText: '   ' }, 'conversation_utterance_empty'],
    [
      {},
      { utteranceText: 'x'.repeat(CONVERSATION_MAX_UTTERANCE_CHARS + 1) },
      'conversation_utterance_too_long',
    ],
    [{}, { addressedActorIds: ['a'] }, 'conversation_address_invalid'],
    [
      {},
      { referencedFactIds: Array.from({ length: CONVERSATION_MAX_KNOWLEDGE_REFS + 1 }, (_, i) => `e${i}`) },
      'conversation_knowledge_limit',
    ],
  ] as const)('rejects invalid turn boundary %#', (sessionPatch, inputPatch, reasonCode) => {
    expect(validateConversationTurn(active(sessionPatch), turn(inputPatch))).toMatchObject({
      ok: false,
      reasonCode,
    });
  });

  test('rejects a reused turnId before any durable write', () => {
    expect(validateConversationTurn(active(), turn(), new Set(['turn:2']))).toMatchObject({
      ok: false,
      reasonCode: 'conversation_duplicate_turn',
    });
  });

  test('end_topic and the hard turn limit resolve instead of scheduling another speaker', () => {
    expect(
      validateConversationTurn(active(), turn({ speechAct: 'end_topic' })),
    ).toMatchObject({ terminalStatus: 'resolved', terminalReasonCode: 'conversation_ended' });
    expect(
      validateConversationTurn(active({ turnNumber: 11 }), turn({ expectedTurnNumber: 12 })),
    ).toMatchObject({ terminalStatus: 'resolved', terminalReasonCode: 'conversation_turn_limit' });
  });
});

describe('conversation epistemic helpers', () => {
  test('pair ordering and initial utterance are deterministic', () => {
    expect(orderedConversationActors('z', 'a')).toEqual({ actorAId: 'a', actorBId: 'z' });
    expect(initialSpeechAct()).toBe('greet');
    expect(initialSpeechAct('问药')).toBe('request');
    expect(initialUtterance('甲', '乙', '问药')).toContain('问药');
  });

  test('only inform/clarify create a claim and rumor provenance stays rumor', () => {
    expect(speechActCreatesClaim('inform')).toBe(true);
    expect(speechActCreatesClaim('clarify')).toBe(true);
    expect(speechActCreatesClaim('respond')).toBe(false);
    expect(claimBeliefKind(['belief', 'rumor'])).toBe('rumor');
    expect(claimBeliefKind(['belief'])).toBe('rumor');
    expect(claimBeliefKind(['claim'])).toBe('rumor');
    expect(claimBeliefKind([])).toBe('claim');
  });
});

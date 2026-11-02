import {
  admitTalk,
  conversationSessionIdempotencyKey,
  receiptForConversationSession,
} from './runtimeConversationSessionPort';

const base = {
  source: 'action_record',
  operation: 'speech' as const,
  actionRecordId: 'action:1',
  actorId: 'actor:1',
  sessionRef: 'conversation:1',
  sourceRevision: 3,
  idempotencyKey: conversationSessionIdempotencyKey('action:1', 3),
  result: {
    status: 'applied' as const,
    resultCode: 'conversation_turn_recorded',
    reason: 'spoken',
    effects: {},
    eventType: 'conversation_utterance',
    visibility: 'private' as const,
  },
};

describe('ConversationSessionPort', () => {
  test('admits only a complete existing-session speech shape and leaves a new talk as gateway work', () => {
    expect(admitTalk({ speechAct: 'greet' })).toEqual({ kind: 'start' });
    expect(admitTalk({
      conversationId: 'conversation:1', turnId: 'conversation:1:turn:2',
      expectedTurnNumber: 2, speechAct: 'clarify', utteranceText: '我明白。',
    })).toMatchObject({ kind: 'speech', expectedTurnNumber: 2, speechAct: 'clarify' });
    expect(admitTalk({ conversationId: 'conversation:1', speechAct: 'clarify' })).toMatchObject({
      kind: 'rejected', result: { resultCode: 'missing_param' },
    });
  });

  test('projects expression after authoritative session settlement without relationship effects', () => {
    expect(receiptForConversationSession(base)).toMatchObject({
      operation: 'speech',
      domainOutcome: 'no_effect',
      sourceRevision: 3,
    });
  });

  test.each([
    ['wrong source', { source: 'expression' }],
    ['missing session', { sessionRef: '' }],
    ['stale revision', { sourceRevision: 0 }],
    ['forged key', { idempotencyKey: 'forged' }],
  ])('%s fails closed', (_label, patch) => {
    expect(receiptForConversationSession({ ...base, ...patch })).toBeUndefined();
  });

  test('replay keeps one receipt identity and terminal/refusal remains distinct', () => {
    const first = receiptForConversationSession(base);
    const replay = receiptForConversationSession(base);
    expect(replay?.receiptKey).toBe(first?.receiptKey);
    expect(receiptForConversationSession({
      ...base,
      operation: 'refuse',
      result: { ...base.result, status: 'rejected', resultCode: 'social_invitation_declined' },
    })?.domainOutcome).toBe('rejected');
    expect(receiptForConversationSession({
      ...base,
      operation: 'expired',
      result: { ...base.result, status: 'interrupted', resultCode: 'conversation_expired' },
    })?.domainOutcome).toBe('failed');
  });
});

import {
  SOCIAL_LLM_CIRCUIT_FAILURE_THRESHOLD,
  SOCIAL_LLM_CIRCUIT_OPEN_MS,
  SOCIAL_LLM_AUTHORIZATION_MAX_LEASE_MS,
  SOCIAL_LLM_DAILY_TOKEN_BUDGET,
  SOCIAL_LLM_HOURLY_TOKEN_BUDGET,
  SOCIAL_LLM_INPUT_TOKEN_LIMIT,
  SOCIAL_LLM_WORLD_CONCURRENCY_LIMIT,
  estimateSocialPromptTokens,
  evaluateSocialModelReservation,
  parseConversationModelTurn,
  parseSocialCandidateTurn,
  socialAuthorizationLeaseState,
  socialLlmSwitches,
  socialModelCircuitAfterResult,
} from './socialModelPolicy';

describe('C012b social LLM reservation policy', () => {
  const base = {
    deploymentEnabled: true,
    liveAuthorized: true,
    promptAuthorized: true,
    authorizationLease: 'valid' as const,
    now: 10_000,
    estimatedInputTokens: 100,
    maxOutputTokens: 220,
    activeWorldCalls: 0,
    hourlyReservedTokens: 0,
    dailyReservedTokens: 0,
  };

  test.each([
    [{ deploymentEnabled: false }, 'social_llm_disabled'],
    [{ liveAuthorized: false }, 'social_llm_authorization_missing'],
    [{ promptAuthorized: false }, 'social_llm_prompt_authorization_mismatch'],
    [{ authorizationLease: 'missing' }, 'social_llm_authorization_lease_invalid'],
    [{ authorizationLease: 'expired' }, 'social_llm_authorization_expired'],
    [{ estimatedInputTokens: SOCIAL_LLM_INPUT_TOKEN_LIMIT + 1 }, 'social_llm_input_too_large'],
    [{ circuitOpenUntil: base.now + 1 }, 'social_llm_circuit_open'],
    [{ actorNextAllowedAt: base.now + 1 }, 'social_llm_actor_cooldown'],
    [{ activeWorldCalls: SOCIAL_LLM_WORLD_CONCURRENCY_LIMIT }, 'social_llm_concurrency_limit'],
    [{ hourlyReservedTokens: SOCIAL_LLM_HOURLY_TOKEN_BUDGET }, 'token_budget_blocked'],
    [{ dailyReservedTokens: SOCIAL_LLM_DAILY_TOKEN_BUDGET }, 'token_budget_blocked'],
  ] as const)('rejects %j as %s', (patch, reasonCode) => {
    expect(evaluateSocialModelReservation({ ...base, ...patch })).toEqual({ ok: false, reasonCode });
  });

  test('reserves a conservative input plus maximum output token amount', () => {
    expect(evaluateSocialModelReservation(base)).toEqual({ ok: true, reservedTokens: 320 });
    expect(socialLlmSwitches({})).toEqual({
      deploymentEnabled: false,
      liveAuthorized: false,
      promptAuthorized: false,
      authorizationLease: 'missing',
    });
    expect(socialLlmSwitches({
      XIANXIA_SOCIAL_LLM_ENABLED: '1',
      XIANXIA_SOCIAL_LLM_LIVE_AUTHORIZED: '1',
      XIANXIA_SOCIAL_LLM_AUTHORIZED_PROMPT_VERSION: 'c016c-live-social-v1',
      XIANXIA_SOCIAL_LLM_AUTHORIZED_PROMPT_BUNDLE_HASH:
        '45bfd2194d14a60e3685646b51037a7818325fbf40cb1d9cb2715cc67a61a29c',
      XIANXIA_SOCIAL_LLM_AUTHORIZATION_ID: 'user-approved-c016c',
      XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10000',
      XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: '20000',
    }, 10_000)).toEqual({
      deploymentEnabled: true,
      liveAuthorized: true,
      promptAuthorized: true,
      authorizationLease: 'valid',
    });
    expect(estimateSocialPromptTokens([{ content: '四个汉字' }, { content: 'abcd' }])).toBe(13);
  });

  test.each([
    [{}, 10_000, 'missing'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: 'nope', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: '20000' }, 10_000, 'malformed'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10000', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: '10000' }, 10_000, 'malformed'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10001', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: '20000' }, 10_000, 'not_started'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10000', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: '20000' }, 20_000, 'expired'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10000', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: String(10_000 + SOCIAL_LLM_AUTHORIZATION_MAX_LEASE_MS + 1) }, 10_000, 'too_long'],
    [{ XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT: '10000', XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT: String(10_000 + SOCIAL_LLM_AUTHORIZATION_MAX_LEASE_MS) }, 10_000, 'valid'],
  ] as const)('classifies authorization lease %j at %s as %s', (env, now, expected) => {
    expect(socialAuthorizationLeaseState(env, now)).toBe(expected);
  });

  test('opens the circuit on the third failure and success resets it', () => {
    const opened = socialModelCircuitAfterResult({
      currentFailures: SOCIAL_LLM_CIRCUIT_FAILURE_THRESHOLD - 1,
      status: 'invalid_output',
      now: base.now,
    });
    expect(opened).toEqual({
      consecutiveFailures: SOCIAL_LLM_CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenUntil: base.now + SOCIAL_LLM_CIRCUIT_OPEN_MS,
    });
    expect(
      socialModelCircuitAfterResult({ currentFailures: 9, status: 'succeeded', now: base.now }),
    ).toEqual({ consecutiveFailures: 0, circuitOpenUntil: undefined });
  });
});

describe('C012b fact-constrained conversation model parser', () => {
  const projection = {
    visibleFactIds: new Set(['event_public']),
    ownedBeliefIds: new Set(['belief_owned']),
  };

  test('accepts only projected knowledge and the bounded speech schema', () => {
    expect(
      parseConversationModelTurn(
        JSON.stringify({
          speechAct: 'clarify',
          utteranceText: '我记得这件事是从你那里听来的。',
          referencedFactIds: ['event_public'],
          referencedBeliefIds: ['belief_owned'],
        }),
        projection,
      ),
    ).toMatchObject({ ok: true, value: { speechAct: 'clarify' } });
  });

  test.each([
    ['not json', 'llm_invalid_json'],
    [
      JSON.stringify({
        speechAct: 'rewrite_world',
        utteranceText: '改写世界',
        referencedFactIds: [],
        referencedBeliefIds: [],
      }),
      'llm_invalid_speech_act',
    ],
    [
      JSON.stringify({
        speechAct: 'inform',
        utteranceText: '我们的好感已经增加。',
        referencedFactIds: [],
        referencedBeliefIds: [],
      }),
      'llm_claims_adjudicated_effect',
    ],
    [
      JSON.stringify({
        speechAct: 'inform',
        utteranceText: '我知道一个秘密。',
        referencedFactIds: ['event_secret'],
        referencedBeliefIds: [],
      }),
      'llm_fact_not_visible',
    ],
    [
      JSON.stringify({
        speechAct: 'clarify',
        utteranceText: '我相信这件事。',
        referencedFactIds: [],
        referencedBeliefIds: ['belief_other'],
      }),
      'llm_belief_not_owned',
    ],
  ] as const)('rejects unsafe output as %s', (content, reasonCode) => {
    expect(parseConversationModelTurn(content, projection)).toEqual({ ok: false, reasonCode });
  });
});

describe('C016c server-candidate social model parser', () => {
  const projection = {
    visibleFactIds: new Set(['event_visible']),
    ownedBeliefIds: new Set(['belief_owned']),
  };
  const candidates = new Set(['negotiation:counter', 'negotiation:reject']);

  test('accepts one listed candidate with only projected knowledge', () => {
    expect(parseSocialCandidateTurn(JSON.stringify({
      candidateId: 'negotiation:counter',
      utteranceText: '十一枚灵石太高，我愿意按十枚再谈。',
      referencedFactIds: ['event_visible'],
      referencedBeliefIds: ['belief_owned'],
    }), projection, candidates)).toMatchObject({
      ok: true,
      value: { candidateId: 'negotiation:counter' },
    });
  });

  test.each([
    [
      { candidateId: 'negotiation:accept', utteranceText: '接受', referencedFactIds: [], referencedBeliefIds: [] },
      'llm_candidate_not_allowed',
    ],
    [
      { candidateId: 'negotiation:reject', terms: { paymentQty: 1 }, utteranceText: '拒绝', referencedFactIds: [], referencedBeliefIds: [] },
      'llm_unknown_field',
    ],
    [
      { candidateId: 'negotiation:reject', utteranceText: '奖励已经到账。', referencedFactIds: [], referencedBeliefIds: [] },
      'llm_claims_adjudicated_effect',
    ],
    [
      { candidateId: 'negotiation:reject', utteranceText: '拒绝', referencedFactIds: ['event_secret'], referencedBeliefIds: [] },
      'llm_fact_not_visible',
    ],
  ])('rejects candidate attack as %s', (value, reasonCode) => {
    expect(parseSocialCandidateTurn(JSON.stringify(value), projection, candidates)).toEqual({
      ok: false,
      reasonCode,
    });
  });
});

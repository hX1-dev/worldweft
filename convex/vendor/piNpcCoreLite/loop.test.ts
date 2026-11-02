import {
  parsePiNpcIntent,
  runPiNpcRuleTurn,
  runPiNpcTurn,
} from './loop';
import {
  PI_NPC_KERNEL_VERSION,
  PI_NPC_MAX_INPUT_TOKENS,
  PI_NPC_MAX_OUTPUT_TOKENS,
  PI_NPC_MAX_SUMMARY_CODE_POINTS,
  PI_NPC_UPSTREAM_COMMIT,
  type PiNpcEvent,
  type PiNpcProvider,
  type PiNpcTurnInput,
} from './types';

const INPUT: PiNpcTurnInput = {
  turnId: 'turn:1',
  observationRevision: 'observation:1',
  candidateSetDigest: 'candidates:1',
  messages: [
    { role: 'system', content: 'Choose one legal intent.' },
    { role: 'user', content: 'You are tired.' },
  ],
  eligibleCandidateIds: ['rest:bed', 'routine:patrol'],
};
const submit = (candidateId = 'rest:bed') => JSON.stringify({
  kind: 'submit_intent',
  candidateId,
  reasonCode: 'survival',
  summary: '先休息，恢复体力。',
});
const collect = (events: PiNpcEvent[]) => (event: PiNpcEvent): void => {
  events.push(event);
};

describe('Pi NPC Core Lite v1', () => {
  test('accepts at most three bounded public reason factors and honors a lower turn output cap', async () => {
    const result = await runPiNpcTurn({ ...INPUT, maxOutputTokens: 120 }, {
      provider: (request) => {
        expect(request.maxOutputTokens).toBe(120);
        return JSON.stringify({
          kind: 'submit_intent', candidateId: 'rest:bed', reasonCode: 'survival',
          reasonFactorIds: ['cause:survival', 'urgency:critical'],
          summary: '先恢复身体。',
        });
      },
    });
    expect(result.intent).toMatchObject({
      kind: 'submit_intent',
      reasonFactorIds: ['cause:survival', 'urgency:critical'],
    });
    expect(parsePiNpcIntent(JSON.stringify({
      kind: 'submit_intent', candidateId: 'rest:bed', reasonCode: 'survival',
      reasonFactorIds: ['a', 'b', 'c', 'd'], summary: '越界。',
    }))).toEqual({ ok: false, reason: 'provider_invalid_output' });
  });

  test('pins upstream, selects one strict intent and emits a settled lifecycle', async () => {
    const events: PiNpcEvent[] = [];
    let maxOutputTokens = 0;
    const result = await runPiNpcTurn(INPUT, {
      provider: (request) => {
        maxOutputTokens = request.maxOutputTokens;
        return { text: submit(), inputTokens: 70, outputTokens: 20 };
      },
      emit: collect(events),
      now: () => 100,
    });
    expect(PI_NPC_UPSTREAM_COMMIT).toBe('7df73a00c6cf85c000bf1ce1594c9284067a92f0');
    expect(result).toMatchObject({
      kernelVersion: PI_NPC_KERNEL_VERSION,
      status: 'selected',
      selectedCandidateId: 'rest:bed',
      providerCalls: 1,
      inputTokens: 70,
      outputTokens: 20,
      latencyMs: 0,
    });
    expect(events.map(({ type }) => type)).toEqual([
      'agent_start', 'turn_start', 'turn_end', 'agent_end',
    ]);
    expect(maxOutputTokens).toBe(PI_NPC_MAX_OUTPUT_TOKENS);
  });

  test('transforms before both calls and performs exactly one repair', async () => {
    const seen: string[][] = [];
    const events: PiNpcEvent[] = [];
    let calls = 0;
    const provider: PiNpcProvider = ({ messages }) => {
      seen.push(messages.map(({ content }) => content));
      calls += 1;
      return calls === 1 ? 'not json' : submit();
    };
    const result = await runPiNpcTurn(INPUT, {
      provider,
      transformContext: (messages) => [
        ...messages, { role: 'user', content: 'bounded-context' },
      ],
      emit: collect(events),
    });
    expect(result).toMatchObject({ status: 'selected', providerCalls: 2 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('bounded-context');
    expect(seen[1]).toEqual(expect.arrayContaining(['not json', 'bounded-context']));
    expect(events.map(({ type }) => type)).toEqual([
      'agent_start', 'turn_start', 'turn_end',
      'turn_start', 'turn_end', 'agent_end',
    ]);
  });

  test('provider exceptions are terminal and never trigger format repair', async () => {
    const result = await runPiNpcTurn(INPUT, {
      provider: (): string => {
        throw new Error('secret');
      },
    });
    expect(result).toMatchObject({
      status: 'provider_failed',
      providerCalls: 1,
      failureReasonCode: 'provider_failed',
    });
    expect(result.intent).toBeUndefined();
  });

  test.each([
    ['empty responses', (): string => '', 'provider_empty'],
    ['invalid responses', (): string => '{"kind":"wait"}', 'provider_invalid_output'],
  ] as const)('%s fail explicitly after one format repair', async (_name, provider, reason) => {
    const result = await runPiNpcTurn(INPUT, { provider });
    expect(result).toMatchObject({
      status: 'provider_failed',
      providerCalls: 2,
      failureReasonCode: reason,
    });
    expect(result.intent).toBeUndefined();
  });

  test('rejects an unavailable candidate without substitution or repair', async () => {
    const result = await runPiNpcTurn(INPUT, {
      provider: () => submit('blocked:cliff'),
    });
    expect(result).toMatchObject({
      status: 'rejected',
      selectedCandidateId: 'blocked:cliff',
      providerCalls: 1,
      failureReasonCode: 'stale_or_invalid_candidate',
    });
  });

  test('supports explicit wait and zero-provider no-candidate wait', async () => {
    const explicit = await runPiNpcTurn(INPUT, { provider: () => JSON.stringify({
      kind: 'wait',
      reasonCode: 'insufficient_context',
      summary: '所知不足，暂不行动。',
    }) });
    let calls = 0;
    const noCandidate = await runPiNpcTurn(
      { ...INPUT, eligibleCandidateIds: [] },
      { provider: () => { calls += 1; return submit(); } },
    );
    expect(explicit).toMatchObject({
      status: 'wait', providerCalls: 1,
      intent: { kind: 'wait', reasonCode: 'insufficient_context' },
    });
    expect(noCandidate).toMatchObject({
      status: 'wait', providerCalls: 0,
      intent: { kind: 'wait', reasonCode: 'no_good_action' },
    });
    expect(calls).toBe(0);
  });

  test('removes wait from the output contract and repairs it once when required', async () => {
    const requests: Parameters<PiNpcProvider>[0][] = [];
    const result = await runPiNpcTurn({ ...INPUT, waitAllowed: false }, {
      provider: (request) => {
        requests.push(request);
        return request.attempt === 1
          ? JSON.stringify({
              kind: 'wait',
              reasonCode: 'no_good_action',
              summary: '先等待。',
            })
          : submit();
      },
    });
    expect(result).toMatchObject({
      status: 'selected',
      selectedCandidateId: 'rest:bed',
      providerCalls: 2,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.repair).toBe(true);
    expect(requests[1]?.messages.at(-1)?.content).toContain('禁止 wait');
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'kind,candidateId,reasonCode,reasonFactorIds,summary',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      'allowedReasonFactorIds',
    );
  });

  test('fails closed when submit-only output remains wait and safely waits with no candidates', async () => {
    let calls = 0;
    const provider = () => {
      calls += 1;
      return JSON.stringify({
        kind: 'wait',
        reasonCode: 'no_good_action',
        summary: '等待。',
      });
    };
    const repeatedWait = await runPiNpcTurn(
      { ...INPUT, waitAllowed: false },
      { provider },
    );
    expect(repeatedWait).toMatchObject({
      status: 'provider_failed',
      failureReasonCode: 'provider_invalid_output',
      providerCalls: 2,
    });
    const noCandidates = await runPiNpcTurn(
      { ...INPUT, eligibleCandidateIds: [], waitAllowed: false },
      { provider },
    );
    expect(noCandidates).toMatchObject({
      status: 'wait',
      intent: { kind: 'wait', reasonCode: 'no_good_action' },
      providerCalls: 0,
    });
    expect(calls).toBe(2);
  });

  test('settles a prevalidated rule intent with lifecycle and zero provider calls', async () => {
    const events: PiNpcEvent[] = [];
    const result = await runPiNpcRuleTurn(
      INPUT,
      {
        kind: 'submit_intent',
        candidateId: 'rest:bed',
        reasonCode: 'survival',
        summary: '生存规则要求先休息。',
      },
      { emit: collect(events) },
    );
    expect(result).toMatchObject({
      status: 'selected',
      selectedCandidateId: 'rest:bed',
      providerCalls: 0,
    });
    expect(events.map(({ type }) => type)).toEqual([
      'agent_start',
      'turn_start',
      'turn_end',
      'agent_end',
    ]);
  });

  test('abort settles a provider that never resolves', async () => {
    const controller = new AbortController();
    const events: PiNpcEvent[] = [];
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = runPiNpcTurn(INPUT, {
      provider: () => { markStarted(); return new Promise<string>(() => undefined); },
      signal: controller.signal,
      emit: collect(events),
    });
    await started;
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: 'aborted',
      providerCalls: 1,
      failureReasonCode: 'turn_aborted',
    });
    expect(events.at(-1)?.type).toBe('agent_end');
  });

  test('a signal aborted before the turn has an explicit failure code', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: PiNpcEvent[] = [];
    const result = await runPiNpcTurn(INPUT, {
      provider: () => {
        throw new Error('provider must not run');
      },
      signal: controller.signal,
      emit: collect(events),
    });
    expect(result).toMatchObject({
      status: 'aborted',
      failureReasonCode: 'turn_aborted',
      providerCalls: 0,
    });
    expect(events.map(({ type }) => type)).toEqual([
      'agent_start',
      'turn_start',
      'turn_end',
      'agent_end',
    ]);
  });

  test('keeps both the normal and repair requests within the input budget', async () => {
    const requests: Parameters<PiNpcProvider>[0][] = [];
    const almostFull = 'a'.repeat((PI_NPC_MAX_INPUT_TOKENS - 12) * 4);
    let calls = 0;
    const result = await runPiNpcTurn({
      ...INPUT,
      messages: [{ role: 'user', content: almostFull }],
    }, {
      provider: (request) => {
        requests.push(request);
        calls += 1;
        return calls === 1 ? 'bad' : submit();
      },
    });
    expect(result).toMatchObject({ status: 'selected', providerCalls: 2 });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const estimated = request.messages.reduce((total, message) => {
        let ascii = 0;
        let nonAscii = 0;
        for (const point of Array.from(message.content)) {
          if ((point.codePointAt(0) ?? 0) <= 0x7f) ascii += 1;
          else nonAscii += 1;
        }
        return total + 4 + nonAscii + Math.ceil(ascii / 4);
      }, 2);
      expect(estimated).toBeLessThanOrEqual(PI_NPC_MAX_INPUT_TOKENS);
    }
    expect(requests[1].repair).toBe(true);
  });

  test.each([
    [
      'reported output tokens',
      { text: submit(), outputTokens: PI_NPC_MAX_OUTPUT_TOKENS + 1 },
    ],
    [
      'estimated output tokens',
      { text: '界'.repeat(PI_NPC_MAX_OUTPUT_TOKENS + 1), outputTokens: 1 },
    ],
  ])('rejects provider output beyond the hard budget: %s', async (_name, response) => {
    const events: PiNpcEvent[] = [];
    const result = await runPiNpcTurn(INPUT, {
      provider: () => response,
      emit: collect(events),
    });
    expect(result).toMatchObject({
      status: 'provider_failed',
      providerCalls: 1,
      failureReasonCode: 'provider_invalid_output',
    });
    expect(events.map(({ type }) => type)).toEqual([
      'agent_start', 'turn_start', 'turn_end', 'agent_end',
    ]);
  });

  test('strict parser rejects hidden fields, bad reasons and overlong summaries', () => {
    const cases = [
      { kind: 'wait', reasonCode: 'no_good_action', summary: '等待。', hidden: 'thought' },
      { kind: 'submit_intent', candidateId: 'rest:bed', reasonCode: 'invented', summary: '等待。' },
      {
        kind: 'wait',
        reasonCode: 'no_good_action',
        summary: '界'.repeat(PI_NPC_MAX_SUMMARY_CODE_POINTS + 1),
      },
    ];
    for (const value of cases) {
      expect(parsePiNpcIntent(JSON.stringify(value))).toMatchObject({ ok: false });
    }
  });

  test('invalid input and transform errors make zero provider calls', async () => {
    let calls = 0;
    const provider = () => { calls += 1; return submit(); };
    const invalid = await runPiNpcTurn(
      { ...INPUT, eligibleCandidateIds: ['rest:bed', 'rest:bed'] },
      { provider },
    );
    const transform = await runPiNpcTurn(INPUT, {
      provider,
      transformContext: () => { throw new Error('transform'); },
    });
    expect(invalid).toMatchObject({
      status: 'rejected', failureReasonCode: 'invalid_turn_input', providerCalls: 0,
    });
    expect(transform).toMatchObject({
      status: 'provider_failed',
      failureReasonCode: 'provider_failed',
      providerCalls: 0,
    });
    expect(calls).toBe(0);
  });
});

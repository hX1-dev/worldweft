import {
  PI_NPC_DEEPSEEK_ENDPOINT,
  PI_NPC_DEEPSEEK_INPUT_RESERVATION_FRAMING_TOKENS,
  PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS,
  PiNpcDeepSeekTransportError,
  callPiNpcDeepSeek,
  estimatePiNpcDeepSeekReservedInputTokens,
  piNpcDeepSeekApiKeySource,
  readPiNpcDeepSeekTransportConfig,
} from './piNpcDeepSeekTransport';
import { estimatePiNpcMessageTokens } from '../vendor/piNpcCoreLite/loop';

const MESSAGES = [
  { role: 'system' as const, content: '只输出 JSON。' },
  { role: 'user' as const, content: '{"candidates":["rest"]}' },
];

function jsonResponse(
  content: string,
  init: {
    status?: number;
    finishReason?: string;
    usage?: Record<string, unknown>;
    reasoningContent?: string;
  } = {},
) {
  return new Response(JSON.stringify({
    id: 'response-fixture',
    model: 'deepseek-v4-flash',
    choices: [{
      finish_reason: init.finishReason ?? 'stop',
      message: {
        content,
        reasoning_content:
          init.reasoningContent ?? 'must never leave transport',
      },
    }],
    usage: init.usage ?? {
      prompt_tokens: 42,
      completion_tokens: 17,
      total_tokens: 59,
      prompt_cache_hit_tokens: 32,
      prompt_cache_miss_tokens: 10,
    },
  }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function call(
  fetchImpl: NonNullable<
    Parameters<typeof callPiNpcDeepSeek>[2]
  >['fetchImpl'],
  overrides: Partial<Parameters<typeof callPiNpcDeepSeek>[1]> = {},
  timeoutMs = 100,
) {
  return callPiNpcDeepSeek(
    {
      messages: MESSAGES,
      maxOutputTokens: PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS,
    },
    {
      apiKey: 'fixture-secret-key',
      endpoint: PI_NPC_DEEPSEEK_ENDPOINT,
      fixture: false,
      ...overrides,
    },
    { fetchImpl, timeoutMs, now: () => 1_000 },
  );
}

function expectCode(
  promise: Promise<unknown>,
  code: PiNpcDeepSeekTransportError['code'],
) {
  return expect(promise).rejects.toMatchObject({
    name: 'PiNpcDeepSeekTransportError',
    message: code,
    code,
  });
}

describe('Pi NPC DeepSeek transport', () => {
  test('reserves transport framing and tokenizer variance before provider I/O', () => {
    const productionLike = [
      MESSAGES[0],
      {
        role: 'user' as const,
        content: JSON.stringify({
          observationRevision:
            'taixu.life_observation.v2:stable64:a7c2422a24b01c0b',
          candidateSetDigest: 'stable64:cf33825da1922b5c',
          candidateIds: [
            'life:travel:alchemy_room:9f5ab0795b65092d',
            'life:travel:quiet_retreat:4b12cccd827905b1',
          ],
          summary: '谨慎权衡后选择一个可执行的高层意图。',
        }),
      },
    ];
    const kernelEstimate = estimatePiNpcMessageTokens(productionLike);
    const reserved =
      estimatePiNpcDeepSeekReservedInputTokens(productionLike);
    expect(reserved).toBeGreaterThanOrEqual(
      kernelEstimate +
        PI_NPC_DEEPSEEK_INPUT_RESERVATION_FRAMING_TOKENS,
    );
    // Regression for the live failure where provider usage exceeded the
    // kernel estimate by 45 tokens after chat-template framing.
    expect(reserved).toBeGreaterThanOrEqual(kernelEstimate + 45);
  });

  test('sends the exact bounded V4 Flash JSON request and drops reasoning', async () => {
    let request:
      | { url: string; init?: RequestInit }
      | undefined;
    const result = await call(async (url, init) => {
      request = { url: String(url), init };
      return jsonResponse('{"kind":"wait"}');
    });
    expect(request?.url).toBe(PI_NPC_DEEPSEEK_ENDPOINT);
    expect(request?.init?.method).toBe('POST');
    expect(request?.init?.redirect).toBe('manual');
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer fixture-secret-key');
    const body = JSON.parse(String(request?.init?.body));
    expect(body).toEqual({
      model: 'deepseek-v4-flash',
      messages: MESSAGES,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      stream: false,
      temperature: 0,
      max_tokens: 180,
    });
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(result)).not.toContain('reasoning');
    expect(result).toEqual({
      text: '{"kind":"wait"}',
      inputTokens: 42,
      outputTokens: 17,
      totalTokens: 59,
      promptCacheHitTokens: 32,
      promptCacheMissTokens: 10,
      latencyMs: 0,
      responseId: 'response-fixture',
      responseModel: 'deepseek-v4-flash',
    });
  });

  test('honors the smaller Prompt v3 output budget', async () => {
    let body: Record<string, unknown> | undefined;
    await callPiNpcDeepSeek(
      { messages: MESSAGES, maxOutputTokens: 120 },
      {
        apiKey: 'fixture-secret-key',
        endpoint: PI_NPC_DEEPSEEK_ENDPOINT,
        fixture: false,
      },
      {
        fetchImpl: async (_url, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return jsonResponse('{"kind":"wait"}');
        },
        timeoutMs: 100,
      },
    );
    expect(body?.max_tokens).toBe(120);
  });

  test('keeps an empty provider content for the kernel format-repair path', async () => {
    await expect(call(async () => jsonResponse(''))).resolves.toMatchObject({
      text: '',
      inputTokens: 42,
      outputTokens: 17,
    });
  });

  test.each([
    [401, 'pi_npc_provider_auth_failed'],
    [403, 'pi_npc_provider_auth_failed'],
    [429, 'pi_npc_provider_rate_limited'],
    [500, 'pi_npc_provider_unavailable'],
    [503, 'pi_npc_provider_unavailable'],
    [302, 'pi_npc_provider_http_error'],
    [418, 'pi_npc_provider_http_error'],
  ] as const)('maps HTTP %s without exposing its body', async (status, code) => {
    const secretBody = 'secret-provider-body';
    const promise = call(async () => new Response(secretBody, { status }));
    await expectCode(promise, code);
    await promise.catch((error: Error) => {
      expect(error.message).not.toContain(secretBody);
      expect(error.message).not.toContain('fixture-secret-key');
    });
  });

  test.each([
    [new Response('not-json'), 'pi_npc_provider_invalid_response'],
    [
      new Response(JSON.stringify({ choices: [] })),
      'pi_npc_provider_invalid_response',
    ],
    [
      jsonResponse('{}', { finishReason: 'length' }),
      'pi_npc_provider_invalid_response',
    ],
    [
      jsonResponse('{}', {
        usage: {
          prompt_tokens: -1,
          completion_tokens: 1,
          total_tokens: 0,
        },
      }),
      'pi_npc_provider_invalid_response',
    ],
  ] as const)('rejects malformed responses', async (response, code) => {
    await expectCode(call(async () => response), code);
  });

  test('rejects declared and streamed oversized responses', async () => {
    const declared = new Response('{}', {
      headers: { 'content-length': String(65 * 1024) },
    });
    await expectCode(
      call(async () => declared),
      'pi_npc_provider_response_too_large',
    );
    const streamed = new Response('x'.repeat(65 * 1024));
    await expectCode(
      call(async () => streamed),
      'pi_npc_provider_response_too_large',
    );
  });

  test('distinguishes timeout, caller abort and network failure', async () => {
    await expectCode(
      call((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }), {}, 5),
      'pi_npc_provider_timeout',
    );
    const controller = new AbortController();
    const aborted = callPiNpcDeepSeek(
      {
        messages: MESSAGES,
        maxOutputTokens: 180,
        signal: controller.signal,
      },
      {
        apiKey: 'fixture-secret-key',
        endpoint: PI_NPC_DEEPSEEK_ENDPOINT,
        fixture: false,
      },
      {
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true },
            );
            controller.abort();
          }),
      },
    );
    await expectCode(aborted, 'pi_npc_provider_aborted');
    await expectCode(
      call(async () => {
        throw new Error('dns and secret details');
      }),
      'pi_npc_provider_unavailable',
    );
  });

  test('only permits the official endpoint or explicit pi_ab loopback fixture', () => {
    expect(readPiNpcDeepSeekTransportConfig({
      XIANXIA_PI_NPC_DEEPSEEK_API_KEY: 'dedicated',
    }, 'npc:one')).toEqual({
      apiKey: 'dedicated',
      endpoint: PI_NPC_DEEPSEEK_ENDPOINT,
      fixture: false,
    });
    expect(readPiNpcDeepSeekTransportConfig({
      XIANXIA_PI_NPC_PROVIDER_ENDPOINT:
        'http://127.0.0.1:43210/chat/completions',
      XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE: '1',
      XIANXIA_PI_NPC_DEEPSEEK_API_KEY: 'fixture',
      DEEPSEEK_API_KEY: 'must-not-be-used',
    }, 'pi_ab:herbalist')).toEqual({
      apiKey: 'fixture',
      endpoint: 'http://127.0.0.1:43210/chat/completions',
      fixture: true,
    });
    for (const [endpoint, actorId] of [
      ['https://attacker.example/chat/completions', 'pi_ab:herbalist'],
      ['http://localhost:43210/chat/completions', 'pi_ab:herbalist'],
      ['http://127.0.0.1:43210/other', 'pi_ab:herbalist'],
      ['http://127.0.0.1:43210/chat/completions', 'npc:production'],
    ]) {
      expect(() => readPiNpcDeepSeekTransportConfig({
        XIANXIA_PI_NPC_PROVIDER_ENDPOINT: endpoint,
        XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE: '1',
        XIANXIA_PI_NPC_DEEPSEEK_API_KEY: 'fixture',
      }, actorId)).toThrow('pi_npc_provider_configuration_invalid');
    }
  });

  test('opens the production loopback only for an explicit Worker fixture context', () => {
    const env = {
      XIANXIA_PI_NPC_PROVIDER_ENDPOINT:
        'http://127.0.0.1:43210/chat/completions',
      XIANXIA_PI_NPC_ALLOW_PRODUCTION_LOOPBACK_FIXTURE: '1',
      XIANXIA_PI_NPC_DEEPSEEK_API_KEY: 'fixture',
    };
    expect(
      readPiNpcDeepSeekTransportConfig(
        env,
        '韩立',
        { productionFixture: true },
      ),
    ).toEqual({
      apiKey: 'fixture',
      endpoint: env.XIANXIA_PI_NPC_PROVIDER_ENDPOINT,
      fixture: true,
    });
    expect(() =>
      readPiNpcDeepSeekTransportConfig(env, '韩立'),
    ).toThrow('pi_npc_provider_configuration_invalid');
    expect(() =>
      readPiNpcDeepSeekTransportConfig(
        {
          ...env,
          XIANXIA_PI_NPC_ALLOW_PRODUCTION_LOOPBACK_FIXTURE:
            '0',
          XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE: '1',
        },
        '韩立',
        { productionFixture: true },
      ),
    ).toThrow('pi_npc_provider_configuration_invalid');
  });

  test('reuses the existing key pool deterministically without weakening fixture isolation', () => {
    const pool = ' pool-key-one, ,pool-key-two,pool-key-three ';
    const first = readPiNpcDeepSeekTransportConfig({
      DEEPSEEK_API_KEYS: pool,
    }, 'pi_ab:calm_herbalist');
    const repeated = readPiNpcDeepSeekTransportConfig({
      DEEPSEEK_API_KEYS: pool,
    }, 'pi_ab:calm_herbalist');
    expect(first).toEqual(repeated);
    expect([
      'pool-key-one',
      'pool-key-two',
      'pool-key-three',
    ]).toContain(first.apiKey);
    expect(first.fixture).toBe(false);
    expect(piNpcDeepSeekApiKeySource({
      DEEPSEEK_API_KEYS: pool,
    })).toBe('pool');
    expect(piNpcDeepSeekApiKeySource({
      XIANXIA_PI_NPC_DEEPSEEK_API_KEY: ' dedicated ',
      DEEPSEEK_API_KEY: 'single',
      DEEPSEEK_API_KEYS: pool,
    })).toBe('dedicated');
    expect(readPiNpcDeepSeekTransportConfig({
      XIANXIA_PI_NPC_DEEPSEEK_API_KEY: ' dedicated ',
      DEEPSEEK_API_KEY: 'single',
      DEEPSEEK_API_KEYS: pool,
    }, 'pi_ab:calm_herbalist').apiKey).toBe('dedicated');
    expect(readPiNpcDeepSeekTransportConfig({
      DEEPSEEK_API_KEY: ' single ',
      DEEPSEEK_API_KEYS: pool,
    }, 'pi_ab:calm_herbalist').apiKey).toBe('single');
    expect(piNpcDeepSeekApiKeySource({
      DEEPSEEK_API_KEYS: ' , , ',
    })).toBe('none');
    expect(() => readPiNpcDeepSeekTransportConfig({
      DEEPSEEK_API_KEYS: pool,
      XIANXIA_PI_NPC_PROVIDER_ENDPOINT:
        'http://127.0.0.1:43210/chat/completions',
      XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE: '1',
    }, 'pi_ab:calm_herbalist')).toThrow(
      'pi_npc_provider_configuration_invalid',
    );
  });
});

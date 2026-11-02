import type { PiNpcMessage } from '../vendor/piNpcCoreLite/types';

export const PI_NPC_DEEPSEEK_MODEL = 'deepseek-v4-flash' as const;
export const PI_NPC_DEEPSEEK_ENDPOINT =
  'https://api.deepseek.com/chat/completions' as const;
export const PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS = 180;
export const PI_NPC_DEEPSEEK_TIMEOUT_MS = 12_000;
export const PI_NPC_DEEPSEEK_MAX_RESPONSE_BYTES = 64 * 1024;
// DeepSeek reports usage after applying its chat template and tokenizer. The
// vendored kernel estimate deliberately stays lightweight, so it is not a
// safe upper bound for a durable pre-I/O budget reservation. Reserve a more
// conservative ASCII ratio plus fixed/message framing before every call.
export const PI_NPC_DEEPSEEK_INPUT_RESERVATION_FRAMING_TOKENS = 64;

export type PiNpcDeepSeekTransportErrorCode =
  | 'pi_npc_provider_configuration_invalid'
  | 'pi_npc_provider_auth_failed'
  | 'pi_npc_provider_rate_limited'
  | 'pi_npc_provider_unavailable'
  | 'pi_npc_provider_http_error'
  | 'pi_npc_provider_timeout'
  | 'pi_npc_provider_aborted'
  | 'pi_npc_provider_response_too_large'
  | 'pi_npc_provider_invalid_response';

export class PiNpcDeepSeekTransportError extends Error {
  readonly code: PiNpcDeepSeekTransportErrorCode;

  constructor(code: PiNpcDeepSeekTransportErrorCode) {
    super(code);
    this.name = 'PiNpcDeepSeekTransportError';
    this.code = code;
  }
}

export type PiNpcDeepSeekTransportConfig = {
  apiKey: string;
  endpoint: string;
  fixture: boolean;
};

export type PiNpcDeepSeekApiKeySource =
  | 'dedicated'
  | 'single'
  | 'pool'
  | 'none';

export type PiNpcDeepSeekTransportResult = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  latencyMs: number;
  responseId?: string;
  responseModel?: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function estimatePiNpcDeepSeekReservedInputTokens(
  messages: readonly PiNpcMessage[],
): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const message of messages) {
    for (const point of Array.from(message.content)) {
      if ((point.codePointAt(0) ?? 0) <= 0x7f) ascii += 1;
      else nonAscii += 1;
    }
  }
  return PI_NPC_DEEPSEEK_INPUT_RESERVATION_FRAMING_TOKENS +
    messages.length * 8 + nonAscii + Math.ceil(ascii / 2);
}

export function piNpcDeepSeekApiKeySource(
  env: Record<string, string | undefined>,
): PiNpcDeepSeekApiKeySource {
  if (nonEmpty(env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY)) {
    return 'dedicated';
  }
  if (nonEmpty(env.DEEPSEEK_API_KEY)) return 'single';
  if (deepSeekApiKeyPool(env.DEEPSEEK_API_KEYS).length > 0) {
    return 'pool';
  }
  return 'none';
}

export function readPiNpcDeepSeekTransportConfig(
  env: Record<string, string | undefined>,
  actorId: string,
  options: {
    productionFixture?: boolean;
  } = {},
): PiNpcDeepSeekTransportConfig {
  const requestedEndpoint =
    env.XIANXIA_PI_NPC_PROVIDER_ENDPOINT?.trim() ??
    PI_NPC_DEEPSEEK_ENDPOINT;
  const allowProductionFixture =
    options.productionFixture === true &&
    env.XIANXIA_PI_NPC_ALLOW_PRODUCTION_LOOPBACK_FIXTURE === '1';
  const allowFixture =
    env.XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE === '1' ||
    allowProductionFixture;
  const fixture = isAllowedLoopbackEndpoint(requestedEndpoint);
  if (
    requestedEndpoint !== PI_NPC_DEEPSEEK_ENDPOINT &&
    !(
      allowFixture &&
      fixture &&
      (
        actorId.startsWith('pi_ab:') ||
        allowProductionFixture
      )
    )
  ) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_configuration_invalid',
    );
  }
  const dedicatedKey = nonEmpty(
    env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY,
  );
  const apiKey = fixture
    ? dedicatedKey
    : dedicatedKey ??
      nonEmpty(env.DEEPSEEK_API_KEY) ??
      selectDeepSeekApiKeyFromPool(
        env.DEEPSEEK_API_KEYS,
        actorId,
      );
  if (!apiKey) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_configuration_invalid',
    );
  }
  return {
    apiKey,
    endpoint: requestedEndpoint,
    fixture,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function deepSeekApiKeyPool(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function selectDeepSeekApiKeyFromPool(
  raw: string | undefined,
  actorId: string,
): string | undefined {
  const keys = deepSeekApiKeyPool(raw);
  if (keys.length === 0) return undefined;
  let hash = 2_166_136_261;
  for (let index = 0; index < actorId.length; index += 1) {
    hash ^= actorId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return keys[(hash >>> 0) % keys.length];
}

export async function callPiNpcDeepSeek(
  input: {
    messages: readonly PiNpcMessage[];
    maxOutputTokens: number;
    signal?: AbortSignal;
  },
  config: PiNpcDeepSeekTransportConfig,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<PiNpcDeepSeekTransportResult> {
  assertTransportInput(input, config);
  if (input.signal?.aborted) {
    throw new PiNpcDeepSeekTransportError('pi_npc_provider_aborted');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PI_NPC_DEEPSEEK_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PI_NPC_DEEPSEEK_TIMEOUT_MS
  ) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_configuration_invalid',
    );
  }
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  input.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: PI_NPC_DEEPSEEK_MODEL,
          messages: input.messages.map((message) => ({ ...message })),
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          stream: false,
          temperature: 0,
          max_tokens: input.maxOutputTokens,
        }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new PiNpcDeepSeekTransportError(
          'pi_npc_provider_timeout',
        );
      }
      if (input.signal?.aborted || controller.signal.aborted) {
        throw new PiNpcDeepSeekTransportError(
          'pi_npc_provider_aborted',
        );
      }
      throw new PiNpcDeepSeekTransportError(
        'pi_npc_provider_unavailable',
      );
    }

    if (!response.ok) throw httpError(response.status);
    const body = await readBoundedBody(response);
    const payload = parseResponse(body);
    return {
      ...payload,
      latencyMs: Math.max(0, now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', forwardAbort);
  }
}

function assertTransportInput(
  input: {
    messages: readonly PiNpcMessage[];
    maxOutputTokens: number;
  },
  config: PiNpcDeepSeekTransportConfig,
) {
  if (
    !Number.isInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS ||
    input.messages.length < 1 ||
    input.messages.length > 6 ||
    input.messages.some(
      (message) =>
        !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length === 0,
    ) ||
    !config.apiKey ||
    !isPermittedEndpoint(config.endpoint, config.fixture)
  ) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_configuration_invalid',
    );
  }
}

function isPermittedEndpoint(endpoint: string, fixture: boolean) {
  return endpoint === PI_NPC_DEEPSEEK_ENDPOINT ||
    (fixture && isAllowedLoopbackEndpoint(endpoint));
}

function isAllowedLoopbackEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port.length > 0 &&
      url.pathname === '/chat/completions' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function httpError(status: number): PiNpcDeepSeekTransportError {
  if (status === 401 || status === 403) {
    return new PiNpcDeepSeekTransportError(
      'pi_npc_provider_auth_failed',
    );
  }
  if (status === 429) {
    return new PiNpcDeepSeekTransportError(
      'pi_npc_provider_rate_limited',
    );
  }
  if (status >= 500) {
    return new PiNpcDeepSeekTransportError(
      'pi_npc_provider_unavailable',
    );
  }
  return new PiNpcDeepSeekTransportError(
    'pi_npc_provider_http_error',
  );
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (/^(?:0|[1-9]\d*)$/u.test(contentLength) === false ||
      Number(contentLength) > PI_NPC_DEEPSEEK_MAX_RESPONSE_BYTES)
  ) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_response_too_large',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteCount += chunk.value.byteLength;
    if (byteCount > PI_NPC_DEEPSEEK_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new PiNpcDeepSeekTransportError(
        'pi_npc_provider_response_too_large',
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function parseResponse(body: string): Omit<
  PiNpcDeepSeekTransportResult,
  'latencyMs'
> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_invalid_response',
    );
  }
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_invalid_response',
    );
  }
  const choice: unknown = value.choices[0] as unknown;
  if (
    !isRecord(choice) ||
    choice.finish_reason === 'length' ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_invalid_response',
    );
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  const inputTokens = optionalTokenCount(usage.prompt_tokens);
  const outputTokens = optionalTokenCount(usage.completion_tokens);
  const totalTokens = optionalTokenCount(usage.total_tokens);
  const promptCacheHitTokens = optionalTokenCount(
    usage.prompt_cache_hit_tokens,
  );
  const promptCacheMissTokens = optionalTokenCount(
    usage.prompt_cache_miss_tokens,
  );
  return {
    text: choice.message.content,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(promptCacheHitTokens === undefined
      ? {}
      : { promptCacheHitTokens }),
    ...(promptCacheMissTokens === undefined
      ? {}
      : { promptCacheMissTokens }),
    ...(typeof value.id === 'string'
      ? { responseId: value.id.slice(0, 160) }
      : {}),
    ...(typeof value.model === 'string'
      ? { responseModel: value.model.slice(0, 160) }
      : {}),
  };
}

function optionalTokenCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PiNpcDeepSeekTransportError(
      'pi_npc_provider_invalid_response',
    );
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const BOUNDED_TURN_MAX_PROVIDER_CALLS = 2;
export const BOUNDED_TURN_MAX_CANDIDATES = 12;
export const BOUNDED_TURN_MAX_INPUT_TOKENS = 2_500;
export const BOUNDED_TURN_MAX_OUTPUT_TOKENS = 180;

const MAX_REPAIR_ECHO_CODE_POINTS = 1_000;

export type CoreMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type StructuredModelRequest = {
  requestId: string;
  observationRevision: string;
  candidateSetDigest: string;
  messages: readonly CoreMessage[];
  eligibleSelectionKeys: readonly string[];
  attempt: 1 | 2;
  repair: boolean;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type StructuredModelResponse = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type BoundedModelPort = (
  request: StructuredModelRequest,
) =>
  | string
  | StructuredModelResponse
  | Promise<string | StructuredModelResponse>;

export type BoundedDecodeResult<T> =
  | { ok: true; value: T; selectionKey?: string }
  | { ok: false; reasonCode: string };

export type BoundedDecisionCodec<T> = {
  decode(text: string): BoundedDecodeResult<T>;
  repairInstruction(reasonCode: string): string;
};

export type BoundedTurnStatus =
  | 'accepted'
  | 'no_candidates'
  | 'provider_unavailable'
  | 'invalid_input'
  | 'provider_failed'
  | 'invalid_output'
  | 'stale_selection'
  | 'aborted'
  | 'input_over_budget';

export type BoundedTurnResult<T> = {
  requestId: string;
  observationRevision: string;
  candidateSetDigest: string;
  status: BoundedTurnStatus;
  value?: T;
  selectedKey?: string;
  failureReasonCode?: string;
  providerCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
};

export type BoundedTurnAttemptStatus = BoundedTurnStatus | 'retry';

export type BoundedLifecycleEvent<T> =
  | { type: 'agent_start'; requestId: string }
  | { type: 'turn_start'; requestId: string; attempt: 1 | 2; repair: boolean }
  | {
      type: 'turn_end';
      requestId: string;
      attempt: 1 | 2;
      status: BoundedTurnAttemptStatus;
      failureReasonCode?: string;
      value?: T;
      selectedKey?: string;
    }
  | { type: 'agent_end'; requestId: string; result: BoundedTurnResult<T> };

export type BoundedTurnInput<T> = {
  requestId: string;
  observationRevision: string;
  candidateSetDigest: string;
  messages: readonly CoreMessage[];
  eligibleSelectionKeys: readonly string[];
  codec: BoundedDecisionCodec<T>;
  noCandidateValue: T;
  ruleValue?: T;
};

export type BoundedTurnOptions<T> = {
  model?: BoundedModelPort;
  transformContext?: (
    messages: readonly CoreMessage[],
    signal?: AbortSignal,
  ) => readonly CoreMessage[] | Promise<readonly CoreMessage[]>;
  emit?: (
    event: BoundedLifecycleEvent<T>,
  ) => void | Promise<void>;
  signal?: AbortSignal;
  now: () => number;
  maxCandidates?: number;
  maxProviderCalls?: 1 | 2;
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

type AwaitResult<T> =
  | { ok: true; value: T }
  | { ok: false; aborted: boolean };

class BoundedTurnAbortedError extends Error {}

export async function runBoundedStructuredTurn<T>(
  input: BoundedTurnInput<T>,
  options: BoundedTurnOptions<T>,
): Promise<BoundedTurnResult<T>> {
  const startedAt = options.now();
  const maxCandidates = Math.min(
    options.maxCandidates ?? BOUNDED_TURN_MAX_CANDIDATES,
    BOUNDED_TURN_MAX_CANDIDATES,
  );
  const maxProviderCalls = Math.min(
    options.maxProviderCalls ?? BOUNDED_TURN_MAX_PROVIDER_CALLS,
    BOUNDED_TURN_MAX_PROVIDER_CALLS,
  ) as 1 | 2;
  const maxInputTokens = Math.min(
    options.maxInputTokens ?? BOUNDED_TURN_MAX_INPUT_TOKENS,
    BOUNDED_TURN_MAX_INPUT_TOKENS,
  );
  const maxOutputTokens = Math.min(
    options.maxOutputTokens ?? BOUNDED_TURN_MAX_OUTPUT_TOKENS,
    BOUNDED_TURN_MAX_OUTPUT_TOKENS,
  );
  let providerCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let attempt: 1 | 2 = 1;

  const result = (
    status: BoundedTurnStatus,
    fields: Partial<BoundedTurnResult<T>> = {},
  ): BoundedTurnResult<T> => ({
    requestId: input.requestId,
    observationRevision: input.observationRevision,
    candidateSetDigest: input.candidateSetDigest,
    status,
    providerCalls,
    ...(inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    latencyMs: Math.max(0, options.now() - startedAt),
    ...fields,
  });
  const finish = async (
    terminal: BoundedTurnResult<T>,
  ): Promise<BoundedTurnResult<T>> => {
    await emitSafely(options.emit, {
      type: 'turn_end',
      requestId: input.requestId,
      attempt,
      status: terminal.status,
      failureReasonCode: terminal.failureReasonCode,
      value: terminal.value,
      selectedKey: terminal.selectedKey,
    });
    await emitSafely(options.emit, {
      type: 'agent_end',
      requestId: input.requestId,
      result: terminal,
    });
    return terminal;
  };

  await emitSafely(options.emit, {
    type: 'agent_start',
    requestId: input.requestId,
  });
  await emitSafely(options.emit, {
    type: 'turn_start',
    requestId: input.requestId,
    attempt,
    repair: false,
  });

  if (options.signal?.aborted) {
    return finish(result('aborted', { failureReasonCode: 'turn_aborted' }));
  }
  const baseMessages = copyCoreMessages(input.messages);
  if (
    !validIdentity(input.requestId) ||
    !validIdentity(input.observationRevision) ||
    !validIdentity(input.candidateSetDigest) ||
    !baseMessages ||
    !validSelectionKeys(input.eligibleSelectionKeys, maxCandidates)
  ) {
    return finish(
      result('invalid_input', { failureReasonCode: 'invalid_turn_input' }),
    );
  }
  if (estimateCoreMessageTokens(baseMessages) > maxInputTokens) {
    return finish(
      result('input_over_budget', {
        failureReasonCode: 'core_required_context_over_budget',
      }),
    );
  }

  if (input.ruleValue !== undefined) {
    const decoded = input.codec.decode(JSON.stringify(input.ruleValue));
    return finishDecoded(decoded, 'invalid_turn_input');
  }
  if (input.eligibleSelectionKeys.length === 0) {
    const decoded = input.codec.decode(JSON.stringify(input.noCandidateValue));
    if (!decoded.ok) {
      return finish(
        result('invalid_input', {
          failureReasonCode: 'invalid_turn_input',
        }),
      );
    }
    return finish(
      result('no_candidates', {
        value: decoded.value,
        selectedKey: decoded.selectionKey,
      }),
    );
  }
  if (!options.model) {
    return finish(
      result('provider_unavailable', {
        failureReasonCode: 'provider_unavailable',
      }),
    );
  }

  let lastRaw = '';
  let lastFailure = 'provider_invalid_output';
  while (attempt <= maxProviderCalls) {
    const untransformed =
      attempt === 1
        ? baseMessages
        : boundedRepairMessages(
            baseMessages,
            lastRaw,
            input.codec.repairInstruction(lastFailure),
            maxInputTokens,
          );
    let messages = untransformed;
    if (options.transformContext) {
      const transformed = await invoke(
        () =>
          options.transformContext?.(untransformed, options.signal) ??
          untransformed,
        options.signal,
      );
      if (!transformed.ok) {
        return finish(
          result(transformed.aborted ? 'aborted' : 'provider_failed', {
            failureReasonCode: transformed.aborted
              ? 'turn_aborted'
              : 'provider_failed',
          }),
        );
      }
      const copied = copyCoreMessages(transformed.value);
      if (!copied) {
        return finish(
          result('provider_failed', {
            failureReasonCode: 'provider_failed',
          }),
        );
      }
      messages = copied;
    }
    if (estimateCoreMessageTokens(messages) > maxInputTokens) {
      return finish(
        result('input_over_budget', {
          failureReasonCode: 'core_required_context_over_budget',
        }),
      );
    }

    providerCalls += 1;
    const provided = await invoke(
      () =>
        options.model?.({
          requestId: input.requestId,
          observationRevision: input.observationRevision,
          candidateSetDigest: input.candidateSetDigest,
          messages,
          eligibleSelectionKeys: [...input.eligibleSelectionKeys],
          attempt,
          repair: attempt === 2,
          maxOutputTokens,
          signal: options.signal,
        }) ?? '',
      options.signal,
    );
    if (!provided.ok) {
      return finish(
        result(provided.aborted ? 'aborted' : 'provider_failed', {
          failureReasonCode: provided.aborted
            ? 'turn_aborted'
            : 'provider_failed',
        }),
      );
    }
    const response = normalizeModelResponse(provided.value);
    if (!response) {
      lastFailure = 'provider_invalid_output';
    } else {
      const callInputTokens = normalizedTokenCount(response.inputTokens);
      const callOutputTokens = normalizedTokenCount(response.outputTokens);
      inputTokens += callInputTokens;
      outputTokens += callOutputTokens;
      lastRaw = response.text;
      if (callInputTokens > maxInputTokens) {
        return finish(
          result('provider_failed', { failureReasonCode: 'provider_failed' }),
        );
      }
      if (
        callOutputTokens > maxOutputTokens ||
        estimateCoreTextTokens(response.text) > maxOutputTokens
      ) {
        return finish(
          result('invalid_output', {
            failureReasonCode: 'provider_invalid_output',
          }),
        );
      }
      const decoded = input.codec.decode(response.text);
      if (decoded.ok) {
        return finishDecoded(decoded, 'stale_or_invalid_candidate');
      }
      lastFailure = decoded.reasonCode;
    }
    if (attempt === maxProviderCalls) {
      return finish(
        result('invalid_output', { failureReasonCode: lastFailure }),
      );
    }
    await emitSafely(options.emit, {
      type: 'turn_end',
      requestId: input.requestId,
      attempt,
      status: 'retry',
      failureReasonCode: lastFailure,
    });
    attempt = 2;
    await emitSafely(options.emit, {
      type: 'turn_start',
      requestId: input.requestId,
      attempt,
      repair: true,
    });
  }

  return finish(
    result('invalid_output', { failureReasonCode: lastFailure }),
  );

  async function finishDecoded(
    decoded: BoundedDecodeResult<T>,
    invalidReason: string,
  ): Promise<BoundedTurnResult<T>> {
    if (!decoded.ok) {
      return finish(
        result('invalid_input', { failureReasonCode: decoded.reasonCode }),
      );
    }
    if (
      decoded.selectionKey !== undefined &&
      !input.eligibleSelectionKeys.includes(decoded.selectionKey)
    ) {
      return finish(
        result('stale_selection', {
          value: decoded.value,
          selectedKey: decoded.selectionKey,
          failureReasonCode: invalidReason,
        }),
      );
    }
    return finish(
      result('accepted', {
        value: decoded.value,
        selectedKey: decoded.selectionKey,
      }),
    );
  }
}

export function estimateCoreMessageTokens(
  messages: readonly CoreMessage[],
): number {
  return messages.reduce(
    (total, message) => total + 4 + estimateCoreTextTokens(message.content),
    2,
  );
}

export function estimateCoreTextTokens(value: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const point of Array.from(value)) {
    if ((point.codePointAt(0) ?? 0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return nonAscii + Math.ceil(ascii / 4);
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

function validSelectionKeys(
  value: readonly string[],
  maxCandidates: number,
): boolean {
  if (!Array.isArray(value) || value.length > maxCandidates) return false;
  const unique = new Set<string>();
  return value.every((entry) => {
    if (!validIdentity(entry)) return false;
    const valid = !unique.has(entry);
    unique.add(entry);
    return valid;
  });
}

function copyCoreMessages(value: unknown): CoreMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const copied: CoreMessage[] = [];
  for (const message of value) {
    if (
      !isRecord(message) ||
      (message.role !== 'system' &&
        message.role !== 'user' &&
        message.role !== 'assistant') ||
      typeof message.content !== 'string'
    ) {
      return undefined;
    }
    copied.push({ role: message.role, content: message.content });
  }
  return copied;
}

function boundedRepairMessages(
  messages: readonly CoreMessage[],
  raw: string,
  instruction: string,
  maxInputTokens: number,
): CoreMessage[] {
  const boundedRaw = Array.from(raw)
    .slice(0, MAX_REPAIR_ECHO_CODE_POINTS)
    .join('');
  const full = [
    ...messages,
    ...(boundedRaw
      ? [{ role: 'assistant' as const, content: boundedRaw }]
      : []),
    { role: 'user' as const, content: instruction },
  ];
  if (estimateCoreMessageTokens(full) <= maxInputTokens) return full;
  const withoutEcho = [
    ...messages,
    { role: 'user' as const, content: instruction },
  ];
  if (estimateCoreMessageTokens(withoutEcho) <= maxInputTokens) {
    return withoutEcho;
  }
  return messages.map((message) => ({ ...message }));
}

function normalizeModelResponse(
  response: string | StructuredModelResponse,
): StructuredModelResponse | undefined {
  if (typeof response === 'string') return { text: response };
  return isRecord(response) && typeof response.text === 'string'
    ? (response as unknown as StructuredModelResponse)
    : undefined;
}

function normalizedTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function invoke<T>(
  callback: () => T | Promise<T>,
  signal?: AbortSignal,
): Promise<AwaitResult<T>> {
  return abortable(Promise.resolve().then(callback), signal);
}

async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<AwaitResult<T>> {
  if (signal?.aborted) return { ok: false, aborted: true };
  if (!signal) {
    try {
      return { ok: true, value: await operation };
    } catch {
      return { ok: false, aborted: false };
    }
  }
  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(new BoundedTurnAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return { ok: true, value: await Promise.race([operation, abort]) };
  } catch (error) {
    return {
      ok: false,
      aborted: error instanceof BoundedTurnAbortedError || signal.aborted,
    };
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function emitSafely<T>(
  sink: BoundedTurnOptions<T>['emit'],
  event: BoundedLifecycleEvent<T>,
): Promise<void> {
  try {
    await sink?.(event);
  } catch {
    // Optional observers cannot change or hide the authoritative result.
  }
}

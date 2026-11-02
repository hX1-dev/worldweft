import {
  estimateCoreMessageTokens,
  runBoundedStructuredTurn,
  type BoundedDecisionCodec,
  type BoundedLifecycleEvent,
  type BoundedTurnResult,
} from '../../../packages/humanlike-agent-core/src/boundedTurn';
import {
  PI_NPC_KERNEL_VERSION,
  PI_NPC_MAX_CANDIDATES,
  PI_NPC_MAX_INPUT_TOKENS,
  PI_NPC_MAX_OUTPUT_TOKENS,
  PI_NPC_MAX_PROVIDER_CALLS,
  PI_NPC_MAX_SUMMARY_CODE_POINTS,
  type PiNpcEvent,
  type PiNpcFailureReasonCode,
  type PiNpcIntent,
  type PiNpcKernelOptions,
  type PiNpcMessage,
  type PiNpcRuleKernelOptions,
  type PiNpcSubmitReasonCode,
  type PiNpcTurnAttemptStatus,
  type PiNpcTurnInput,
  type PiNpcTurnResult,
  type PiNpcWaitReasonCode,
} from './types';

const SUBMIT_REASONS = new Set<PiNpcSubmitReasonCode>([
  'survival',
  'personal_goal',
  'obligation',
  'relationship',
  'routine',
]);
const WAIT_REASONS = new Set<PiNpcWaitReasonCode>([
  'no_good_action',
  'insufficient_context',
]);
const SUBMIT_KEYS = ['candidateId', 'kind', 'reasonCode', 'summary'];
const SUBMIT_WITH_FACTORS_KEYS = [
  'candidateId', 'kind', 'reasonCode', 'reasonFactorIds', 'summary',
];
const WAIT_KEYS = ['kind', 'reasonCode', 'summary'];
const REPAIR_INSTRUCTION =
  '修复上一条输出：只返回一个合法的 submit_intent 或 wait JSON 对象，不要 Markdown 或额外字段。';
const SUBMIT_ONLY_REPAIR_INSTRUCTION =
  '修复上一条输出：当前回合禁止 wait；只返回一个严格 JSON 对象，字段只能是 kind,candidateId,reasonCode,reasonFactorIds,summary；kind 必须为 submit_intent，candidateId 必须来自候选，reasonCode 必须为 survival|personal_goal|obligation|relationship|routine，reasonFactorIds 必须从候选 allowedReasonFactorIds 中选最多3项，summary 最多80字；不要 Markdown 或额外文字。';

type ParseResult =
  | { ok: true; intent: PiNpcIntent }
  | { ok: false; reason: 'provider_empty' | 'provider_invalid_output' };

const legacyCodec: BoundedDecisionCodec<PiNpcIntent> = {
  decode(text) {
    const parsed = parsePiNpcIntent(text);
    return parsed.ok
      ? {
          ok: true,
          value: parsed.intent,
          ...(parsed.intent.kind === 'submit_intent'
            ? { selectionKey: parsed.intent.candidateId }
            : {}),
        }
      : { ok: false, reasonCode: parsed.reason };
  },
  repairInstruction(reasonCode) {
    return `${REPAIR_INSTRUCTION} (${reasonCode})`;
  },
};

const submitOnlyCodec: BoundedDecisionCodec<PiNpcIntent> = {
  decode(text) {
    const parsed = parsePiNpcIntent(text);
    if (!parsed.ok) return { ok: false, reasonCode: parsed.reason };
    if (parsed.intent.kind !== 'submit_intent') {
      return { ok: false, reasonCode: 'provider_invalid_output' };
    }
    return {
      ok: true,
      value: parsed.intent,
      selectionKey: parsed.intent.candidateId,
    };
  },
  repairInstruction(reasonCode) {
    return `${SUBMIT_ONLY_REPAIR_INSTRUCTION} (${reasonCode})`;
  },
};

export function parsePiNpcIntent(text: string): ParseResult {
  if (text.trim().length === 0) {
    return { ok: false, reason: 'provider_empty' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'provider_invalid_output' };
  }
  if (!isRecord(value)) {
    return { ok: false, reason: 'provider_invalid_output' };
  }
  if (value.kind === 'submit_intent') {
    if (
      (!hasExactKeys(value, SUBMIT_KEYS) && !hasExactKeys(value, SUBMIT_WITH_FACTORS_KEYS)) ||
      typeof value.candidateId !== 'string' ||
      value.candidateId.length === 0 ||
      value.candidateId !== value.candidateId.trim() ||
      typeof value.reasonCode !== 'string' ||
      !SUBMIT_REASONS.has(value.reasonCode as PiNpcSubmitReasonCode) ||
      !validSummary(value.summary) ||
      (value.reasonFactorIds !== undefined && !validReasonFactorIds(value.reasonFactorIds))
    ) {
      return { ok: false, reason: 'provider_invalid_output' };
    }
    return {
      ok: true,
      intent: {
        kind: 'submit_intent',
        candidateId: value.candidateId,
        reasonCode: value.reasonCode as PiNpcSubmitReasonCode,
        ...(value.reasonFactorIds !== undefined
          ? { reasonFactorIds: [...value.reasonFactorIds] as string[] }
          : {}),
        summary: value.summary,
      },
    };
  }
  if (
    value.kind !== 'wait' ||
    !hasExactKeys(value, WAIT_KEYS) ||
    typeof value.reasonCode !== 'string' ||
    !WAIT_REASONS.has(value.reasonCode as PiNpcWaitReasonCode) ||
    !validSummary(value.summary)
  ) {
    return { ok: false, reason: 'provider_invalid_output' };
  }
  return {
    ok: true,
    intent: {
      kind: 'wait',
      reasonCode: value.reasonCode as PiNpcWaitReasonCode,
      summary: value.summary,
    },
  };
}

export function estimatePiNpcMessageTokens(
  messages: readonly PiNpcMessage[],
): number {
  return estimateCoreMessageTokens(messages);
}

export async function runPiNpcRuleTurn(
  input: PiNpcTurnInput,
  intent: PiNpcIntent,
  options: PiNpcRuleKernelOptions = {},
): Promise<PiNpcTurnResult> {
  return runLegacyTurn(input, {
    emit: options.emit,
    signal: options.signal,
    now: options.now,
    ruleValue: intent,
  });
}

export async function runPiNpcTurn(
  input: PiNpcTurnInput,
  options: PiNpcKernelOptions,
): Promise<PiNpcTurnResult> {
  return runLegacyTurn(input, {
    provider: options.provider,
    transformContext: options.transformContext,
    emit: options.emit,
    signal: options.signal,
    now: options.now,
  });
}

async function runLegacyTurn(
  input: PiNpcTurnInput,
  options: {
    provider?: PiNpcKernelOptions['provider'];
    transformContext?: PiNpcKernelOptions['transformContext'];
    emit?: PiNpcKernelOptions['emit'];
    signal?: AbortSignal;
    now?: () => number;
    ruleValue?: PiNpcIntent;
  },
): Promise<PiNpcTurnResult> {
  const now = options.now ?? Date.now;
  // An empty server candidate set always settles as a zero-call wait. A
  // submit-only contract is meaningful only when there is something legal
  // to select and must never force the provider to invent an action.
  const waitAllowed =
    input.eligibleCandidateIds.length === 0 || input.waitAllowed !== false;
  const bounded = await runBoundedStructuredTurn(
    {
      requestId: input.turnId,
      observationRevision: input.observationRevision,
      candidateSetDigest: input.candidateSetDigest,
      messages: input.messages,
      eligibleSelectionKeys: input.eligibleCandidateIds,
      codec: waitAllowed ? legacyCodec : submitOnlyCodec,
      noCandidateValue: {
        kind: 'wait',
        reasonCode: 'no_good_action',
        summary: '没有可执行候选，继续等待。',
      },
      ruleValue: options.ruleValue,
    },
    {
      model: options.provider
        ? async (request) =>
            options.provider?.({
              turnId: request.requestId,
              observationRevision: request.observationRevision,
              candidateSetDigest: request.candidateSetDigest,
              messages: request.messages,
              eligibleCandidateIds: request.eligibleSelectionKeys,
              attempt: request.attempt,
              repair: request.repair,
              maxOutputTokens:
                request.maxOutputTokens as typeof PI_NPC_MAX_OUTPUT_TOKENS,
              signal: request.signal,
            }) ?? ''
        : undefined,
      transformContext: options.transformContext
        ? async (messages, signal) =>
            options.transformContext?.(messages, signal) ?? messages
        : undefined,
      emit: options.emit
        ? async (event) => {
            const mapped = mapLegacyEvent(event);
            if (mapped) await options.emit?.(mapped);
          }
        : undefined,
      signal: options.signal,
      now,
      maxCandidates: PI_NPC_MAX_CANDIDATES,
      maxProviderCalls: PI_NPC_MAX_PROVIDER_CALLS,
      maxInputTokens: PI_NPC_MAX_INPUT_TOKENS,
      maxOutputTokens: validMaxOutputTokens(input.maxOutputTokens),
    },
  );
  return mapLegacyResult(bounded);
}

function validReasonFactorIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 3 &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 &&
      entry.length <= 96 && entry === entry.trim());
}

function validMaxOutputTokens(value: number | undefined): number {
  if (value === undefined) return PI_NPC_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(value) || value < 1 || value > PI_NPC_MAX_OUTPUT_TOKENS) {
    throw new Error('invalid_turn_input');
  }
  return value;
}

function mapLegacyEvent(
  event: BoundedLifecycleEvent<PiNpcIntent>,
): PiNpcEvent | undefined {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start', turnId: event.requestId };
    case 'turn_start':
      return {
        type: 'turn_start',
        turnId: event.requestId,
        attempt: event.attempt,
        repair: event.repair,
      };
    case 'turn_end':
      return {
        type: 'turn_end',
        turnId: event.requestId,
        attempt: event.attempt,
        status: mapAttemptStatus(event.status, event.value),
        failureReasonCode: legacyFailureReason(
          event.status,
          event.failureReasonCode,
        ),
      };
    case 'agent_end':
      return {
        type: 'agent_end',
        turnId: event.requestId,
        result: mapLegacyResult(event.result),
      };
  }
}

function mapLegacyResult(
  bounded: BoundedTurnResult<PiNpcIntent>,
): PiNpcTurnResult {
  const intent = bounded.value;
  const status = mapAttemptStatus(bounded.status, intent);
  return {
    kernelVersion: PI_NPC_KERNEL_VERSION,
    turnId: bounded.requestId,
    observationRevision: bounded.observationRevision,
    candidateSetDigest: bounded.candidateSetDigest,
    status: status === 'retry' ? 'provider_failed' : status,
    ...(intent ? { intent } : {}),
    ...(bounded.selectedKey
      ? { selectedCandidateId: bounded.selectedKey }
      : {}),
    ...(legacyFailureReason(bounded.status, bounded.failureReasonCode)
      ? {
          failureReasonCode: legacyFailureReason(
            bounded.status,
            bounded.failureReasonCode,
          ),
        }
      : {}),
    providerCalls: bounded.providerCalls,
    ...(bounded.inputTokens !== undefined
      ? { inputTokens: bounded.inputTokens }
      : {}),
    ...(bounded.outputTokens !== undefined
      ? { outputTokens: bounded.outputTokens }
      : {}),
    latencyMs: bounded.latencyMs,
  };
}

function mapAttemptStatus(
  status: BoundedTurnResult<PiNpcIntent>['status'] | 'retry',
  intent?: PiNpcIntent,
): PiNpcTurnAttemptStatus {
  if (status === 'retry') return 'retry';
  if (status === 'accepted' || status === 'no_candidates') {
    return intent?.kind === 'submit_intent' ? 'selected' : 'wait';
  }
  if (status === 'invalid_input' || status === 'stale_selection') {
    return 'rejected';
  }
  if (status === 'aborted') return 'aborted';
  return 'provider_failed';
}

function legacyFailureReason(
  status: BoundedTurnResult<PiNpcIntent>['status'] | 'retry',
  reason?: string,
): PiNpcFailureReasonCode | undefined {
  if (status === 'retry') {
    return reason === 'provider_empty'
      ? 'provider_empty'
      : 'provider_invalid_output';
  }
  if (status === 'invalid_input') {
    return reason === 'provider_empty' || reason === 'provider_invalid_output'
      ? reason
      : 'invalid_turn_input';
  }
  if (status === 'stale_selection') return 'stale_or_invalid_candidate';
  if (status === 'aborted') return 'turn_aborted';
  if (status === 'invalid_output') {
    return reason === 'provider_empty'
      ? 'provider_empty'
      : 'provider_invalid_output';
  }
  if (
    status === 'provider_failed' ||
    status === 'provider_unavailable' ||
    status === 'input_over_budget'
  ) {
    return 'provider_failed';
  }
  return undefined;
}

function validSummary(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= PI_NPC_MAX_SUMMARY_CODE_POINTS
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

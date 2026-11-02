import type { LLMMessage } from '../util/llm';
import type { SpeechAct } from './conversationContracts';
import { parseSpeechAct } from './conversationLogic';

export const SOCIAL_LLM_INPUT_TOKEN_LIMIT = 1_800;
export const SOCIAL_LLM_OUTPUT_TOKEN_LIMIT = 220;
export const SOCIAL_LLM_ACTOR_COOLDOWN_MS = 8_000;
export const SOCIAL_LLM_WORLD_CONCURRENCY_LIMIT = 2;
export const SOCIAL_LLM_HOURLY_TOKEN_BUDGET = 12_000;
export const SOCIAL_LLM_DAILY_TOKEN_BUDGET = 60_000;
export const SOCIAL_LLM_TIMEOUT_MS = 20_000;
export const SOCIAL_LLM_CALL_LEASE_MS = 30_000;
export const SOCIAL_LLM_MAX_ATTEMPTS = 2;
export const SOCIAL_LLM_CIRCUIT_FAILURE_THRESHOLD = 3;
export const SOCIAL_LLM_CIRCUIT_OPEN_MS = 5 * 60_000;
export const SOCIAL_LLM_AUTHORIZATION_MAX_LEASE_MS = 15 * 60_000;
export const SOCIAL_MODEL_PROMPT_VERSION = 'c016c-live-social-v1';
export const C016C_PROMPT_BUNDLE_HASH =
  '45bfd2194d14a60e3685646b51037a7818325fbf40cb1d9cb2715cc67a61a29c';

export type SocialLlmSwitches = {
  deploymentEnabled: boolean;
  liveAuthorized: boolean;
  promptAuthorized: boolean;
  authorizationLease: SocialAuthorizationLeaseState;
};

export type SocialAuthorizationLeaseState =
  | 'valid'
  | 'missing'
  | 'malformed'
  | 'not_started'
  | 'expired'
  | 'too_long';

export type SocialLlmGateReason =
  | 'social_llm_disabled'
  | 'social_llm_authorization_missing'
  | 'social_llm_prompt_authorization_mismatch'
  | 'social_llm_authorization_lease_invalid'
  | 'social_llm_authorization_expired';

export function socialAuthorizationLeaseState(
  env: Record<string, string | undefined>,
  now = Date.now(),
): SocialAuthorizationLeaseState {
  const startedRaw = env.XIANXIA_SOCIAL_LLM_AUTHORIZATION_STARTED_AT;
  const expiresRaw = env.XIANXIA_SOCIAL_LLM_AUTHORIZATION_EXPIRES_AT;
  if (!startedRaw?.trim() || !expiresRaw?.trim()) return 'missing';
  const startedAt = parseEpochMilliseconds(startedRaw);
  const expiresAt = parseEpochMilliseconds(expiresRaw);
  if (startedAt === null || expiresAt === null || expiresAt <= startedAt) return 'malformed';
  if (expiresAt - startedAt > SOCIAL_LLM_AUTHORIZATION_MAX_LEASE_MS) return 'too_long';
  if (now < startedAt) return 'not_started';
  if (now >= expiresAt) return 'expired';
  return 'valid';
}

export function socialLlmSwitches(
  env: Record<string, string | undefined>,
  now = Date.now(),
): SocialLlmSwitches {
  return {
    deploymentEnabled: env.XIANXIA_SOCIAL_LLM_ENABLED === '1',
    liveAuthorized: env.XIANXIA_SOCIAL_LLM_LIVE_AUTHORIZED === '1',
    promptAuthorized:
      env.XIANXIA_SOCIAL_LLM_AUTHORIZED_PROMPT_VERSION === SOCIAL_MODEL_PROMPT_VERSION &&
      env.XIANXIA_SOCIAL_LLM_AUTHORIZED_PROMPT_BUNDLE_HASH === C016C_PROMPT_BUNDLE_HASH &&
      !!env.XIANXIA_SOCIAL_LLM_AUTHORIZATION_ID?.trim(),
    authorizationLease: socialAuthorizationLeaseState(env, now),
  };
}

export function socialLlmGateReason(switches: SocialLlmSwitches): SocialLlmGateReason | undefined {
  if (!switches.deploymentEnabled) return 'social_llm_disabled';
  if (!switches.liveAuthorized) return 'social_llm_authorization_missing';
  if (!switches.promptAuthorized) return 'social_llm_prompt_authorization_mismatch';
  if (switches.authorizationLease === 'expired') return 'social_llm_authorization_expired';
  if (switches.authorizationLease !== 'valid') {
    return 'social_llm_authorization_lease_invalid';
  }
  return undefined;
}

export type SocialModelReservationInput = SocialLlmSwitches & {
  now: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  actorNextAllowedAt?: number;
  activeWorldCalls: number;
  hourlyReservedTokens: number;
  dailyReservedTokens: number;
  circuitOpenUntil?: number;
};

export type SocialModelReservationResult =
  | { ok: true; reservedTokens: number }
  | {
      ok: false;
      reasonCode:
        | 'social_llm_disabled'
        | 'social_llm_authorization_missing'
        | 'social_llm_prompt_authorization_mismatch'
        | 'social_llm_authorization_lease_invalid'
        | 'social_llm_authorization_expired'
        | 'social_llm_input_too_large'
        | 'social_llm_circuit_open'
        | 'social_llm_actor_cooldown'
        | 'social_llm_concurrency_limit'
        | 'token_budget_blocked';
    };

export function evaluateSocialModelReservation(
  input: SocialModelReservationInput,
): SocialModelReservationResult {
  const gateReason = socialLlmGateReason(input);
  if (gateReason) return { ok: false, reasonCode: gateReason };
  if (input.estimatedInputTokens > SOCIAL_LLM_INPUT_TOKEN_LIMIT) {
    return { ok: false, reasonCode: 'social_llm_input_too_large' };
  }
  if (input.circuitOpenUntil !== undefined && input.now < input.circuitOpenUntil) {
    return { ok: false, reasonCode: 'social_llm_circuit_open' };
  }
  if (input.actorNextAllowedAt !== undefined && input.now < input.actorNextAllowedAt) {
    return { ok: false, reasonCode: 'social_llm_actor_cooldown' };
  }
  if (input.activeWorldCalls >= SOCIAL_LLM_WORLD_CONCURRENCY_LIMIT) {
    return { ok: false, reasonCode: 'social_llm_concurrency_limit' };
  }
  const reservedTokens = input.estimatedInputTokens + input.maxOutputTokens;
  if (
    input.hourlyReservedTokens + reservedTokens > SOCIAL_LLM_HOURLY_TOKEN_BUDGET ||
    input.dailyReservedTokens + reservedTokens > SOCIAL_LLM_DAILY_TOKEN_BUDGET
  ) {
    return { ok: false, reasonCode: 'token_budget_blocked' };
  }
  return { ok: true, reservedTokens };
}

function parseEpochMilliseconds(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function socialModelWindowStart(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs;
}

export function socialModelCircuitAfterResult(args: {
  currentFailures: number;
  status: 'succeeded' | 'invalid_output' | 'failed' | 'timed_out' | 'cancelled';
  now: number;
}) {
  if (args.status === 'succeeded') return { consecutiveFailures: 0, circuitOpenUntil: undefined };
  if (args.status === 'cancelled') {
    return { consecutiveFailures: args.currentFailures, circuitOpenUntil: undefined };
  }
  const consecutiveFailures = args.currentFailures + 1;
  return {
    consecutiveFailures,
    circuitOpenUntil:
      consecutiveFailures >= SOCIAL_LLM_CIRCUIT_FAILURE_THRESHOLD
        ? args.now + SOCIAL_LLM_CIRCUIT_OPEN_MS
        : undefined,
  };
}

export function estimateSocialPromptTokens(messages: Pick<LLMMessage, 'content'>[]) {
  let asciiRun = 0;
  let tokens = 0;
  const flushAscii = () => {
    if (asciiRun > 0) tokens += Math.ceil(asciiRun / 4);
    asciiRun = 0;
  };
  for (const message of messages) {
    for (const char of message.content ?? '') {
      if (char.codePointAt(0)! > 0x7f) {
        flushAscii();
        tokens += 1;
      } else {
        asciiRun += 1;
      }
    }
    flushAscii();
    tokens += 4;
  }
  return tokens;
}

export type ConversationModelProjection = {
  visibleFactIds: ReadonlySet<string>;
  ownedBeliefIds: ReadonlySet<string>;
};

export type ParsedConversationModelTurn = {
  speechAct: SpeechAct;
  utteranceText: string;
  referencedFactIds: string[];
  referencedBeliefIds: string[];
};

export type ConversationModelParseResult =
  | { ok: true; value: ParsedConversationModelTurn }
  | {
      ok: false;
      reasonCode:
        | 'llm_invalid_json'
        | 'llm_unknown_field'
        | 'llm_invalid_speech_act'
        | 'llm_invalid_utterance'
        | 'llm_knowledge_limit'
        | 'llm_fact_not_visible'
        | 'llm_belief_not_owned'
        | 'llm_claims_adjudicated_effect';
    };

export type ParsedSocialCandidateTurn = {
  candidateId: string;
  utteranceText: string;
  referencedFactIds: string[];
  referencedBeliefIds: string[];
};

export type SocialCandidateParseResult =
  | { ok: true; value: ParsedSocialCandidateTurn }
  | {
      ok: false;
      reasonCode:
        | 'llm_invalid_json'
        | 'llm_unknown_field'
        | 'llm_candidate_not_allowed'
        | 'llm_invalid_utterance'
        | 'llm_knowledge_limit'
        | 'llm_fact_not_visible'
        | 'llm_belief_not_owned'
        | 'llm_claims_adjudicated_effect';
    };

const MODEL_OUTPUT_KEYS = new Set([
  'speechAct',
  'utteranceText',
  'referencedFactIds',
  'referencedBeliefIds',
]);

export function parseConversationModelTurn(
  content: string,
  projection: ConversationModelProjection,
): ConversationModelParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(content));
  } catch {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !MODEL_OUTPUT_KEYS.has(key))) {
    return { ok: false, reasonCode: 'llm_unknown_field' };
  }
  const speechAct = parseSpeechAct(record.speechAct);
  if (!speechAct) return { ok: false, reasonCode: 'llm_invalid_speech_act' };
  if (typeof record.utteranceText !== 'string') {
    return { ok: false, reasonCode: 'llm_invalid_utterance' };
  }
  const utteranceText = record.utteranceText.trim();
  if (!utteranceText || utteranceText.length > 600) {
    return { ok: false, reasonCode: 'llm_invalid_utterance' };
  }
  if (claimsAdjudicatedEffect(utteranceText)) {
    return { ok: false, reasonCode: 'llm_claims_adjudicated_effect' };
  }
  const referencedFactIds = parseStringArray(record.referencedFactIds);
  const referencedBeliefIds = parseStringArray(record.referencedBeliefIds);
  if (!referencedFactIds || !referencedBeliefIds) {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  if (referencedFactIds.length > 8 || referencedBeliefIds.length > 8) {
    return { ok: false, reasonCode: 'llm_knowledge_limit' };
  }
  if (referencedFactIds.some((id) => !projection.visibleFactIds.has(id))) {
    return { ok: false, reasonCode: 'llm_fact_not_visible' };
  }
  if (referencedBeliefIds.some((id) => !projection.ownedBeliefIds.has(id))) {
    return { ok: false, reasonCode: 'llm_belief_not_owned' };
  }
  return {
    ok: true,
    value: {
      speechAct,
      utteranceText,
      referencedFactIds,
      referencedBeliefIds,
    },
  };
}

const CANDIDATE_MODEL_OUTPUT_KEYS = new Set([
  'candidateId',
  'utteranceText',
  'referencedFactIds',
  'referencedBeliefIds',
]);

export function parseSocialCandidateTurn(
  content: string,
  projection: ConversationModelProjection,
  allowedCandidateIds: ReadonlySet<string>,
): SocialCandidateParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(content));
  } catch {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CANDIDATE_MODEL_OUTPUT_KEYS.has(key))) {
    return { ok: false, reasonCode: 'llm_unknown_field' };
  }
  if (typeof record.candidateId !== 'string' || !allowedCandidateIds.has(record.candidateId)) {
    return { ok: false, reasonCode: 'llm_candidate_not_allowed' };
  }
  if (typeof record.utteranceText !== 'string') {
    return { ok: false, reasonCode: 'llm_invalid_utterance' };
  }
  const utteranceText = record.utteranceText.trim();
  if (!utteranceText || utteranceText.length > 600) {
    return { ok: false, reasonCode: 'llm_invalid_utterance' };
  }
  if (claimsAdjudicatedEffect(utteranceText)) {
    return { ok: false, reasonCode: 'llm_claims_adjudicated_effect' };
  }
  const referencedFactIds = parseStringArray(record.referencedFactIds);
  const referencedBeliefIds = parseStringArray(record.referencedBeliefIds);
  if (!referencedFactIds || !referencedBeliefIds) {
    return { ok: false, reasonCode: 'llm_invalid_json' };
  }
  if (referencedFactIds.length > 8 || referencedBeliefIds.length > 8) {
    return { ok: false, reasonCode: 'llm_knowledge_limit' };
  }
  if (referencedFactIds.some((id) => !projection.visibleFactIds.has(id))) {
    return { ok: false, reasonCode: 'llm_fact_not_visible' };
  }
  if (referencedBeliefIds.some((id) => !projection.ownedBeliefIds.has(id))) {
    return { ok: false, reasonCode: 'llm_belief_not_owned' };
  }
  return {
    ok: true,
    value: {
      candidateId: record.candidateId,
      utteranceText,
      referencedFactIds,
      referencedBeliefIds,
    },
  };
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  const strings = value as string[];
  return [...new Set(strings.map((item) => item.trim()).filter(Boolean))];
}

function stripJsonFence(content: string) {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function claimsAdjudicatedEffect(text: string) {
  return [
    /(?:好感|信任|关系)(?:度)?(?:已经|已)?(?:增加|提升|改变|变成)/i,
    /(?:奖励|灵石|物品)(?:已经|已)(?:发放|给予|到账|获得)/i,
    /(?:relationship|trust).{0,24}(?:increased|changed|updated)/i,
    /(?:reward|item).{0,24}(?:granted|transferred|received)/i,
  ].some((pattern) => pattern.test(text));
}

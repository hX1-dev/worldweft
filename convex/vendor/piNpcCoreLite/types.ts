export const PI_NPC_KERNEL_VERSION = 'taixu.pi-npc-kernel.v1' as const;
export const PI_NPC_UPSTREAM_COMMIT = '7df73a00c6cf85c000bf1ce1594c9284067a92f0' as const;
export const PI_NPC_MAX_CANDIDATES = 12;
export const PI_NPC_MAX_PROVIDER_CALLS = 2;
export const PI_NPC_MAX_INPUT_TOKENS = 2_500;
export const PI_NPC_MAX_OUTPUT_TOKENS = 180;
export const PI_NPC_PROMPT_V3_MAX_OUTPUT_TOKENS = 120;
export const PI_NPC_MAX_SUMMARY_CODE_POINTS = 80;

export type PiNpcSubmitReasonCode =
  | 'survival' | 'personal_goal' | 'obligation' | 'relationship' | 'routine';
export type PiNpcWaitReasonCode = 'no_good_action' | 'insufficient_context';
export type PiNpcIntent =
  | {
      kind: 'submit_intent';
      candidateId: string;
      reasonCode: PiNpcSubmitReasonCode;
      reasonFactorIds?: string[];
      summary: string;
    }
  | { kind: 'wait'; reasonCode: PiNpcWaitReasonCode; summary: string };
export type PiNpcTurnStatus =
  | 'selected' | 'wait' | 'rejected' | 'provider_failed' | 'aborted';
export type PiNpcFailureReasonCode =
  | 'invalid_turn_input'
  | 'provider_empty'
  | 'provider_invalid_output'
  | 'provider_failed'
  | 'turn_aborted'
  | 'stale_or_invalid_candidate';

export interface PiNpcTurnResult {
  kernelVersion: typeof PI_NPC_KERNEL_VERSION;
  turnId: string;
  observationRevision: string;
  candidateSetDigest: string;
  status: PiNpcTurnStatus;
  intent?: PiNpcIntent;
  selectedCandidateId?: string;
  failureReasonCode?: PiNpcFailureReasonCode;
  providerCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}
export interface PiNpcMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface PiNpcTurnInput {
  turnId: string;
  observationRevision: string;
  candidateSetDigest: string;
  messages: readonly PiNpcMessage[];
  eligibleCandidateIds: readonly string[];
  /** Defaults to true. Set false only when the server requires a selection. */
  waitAllowed?: boolean;
  maxOutputTokens?: number;
}
export interface PiNpcProviderRequest {
  turnId: string;
  observationRevision: string;
  candidateSetDigest: string;
  messages: readonly PiNpcMessage[];
  eligibleCandidateIds: readonly string[];
  attempt: 1 | 2;
  repair: boolean;
  maxOutputTokens: number;
  signal?: AbortSignal;
}
export interface PiNpcProviderResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}
export type PiNpcProvider = (
  request: PiNpcProviderRequest,
) => string | PiNpcProviderResponse | Promise<string | PiNpcProviderResponse>;
export type PiNpcTransformContext = (
  messages: readonly PiNpcMessage[],
  signal?: AbortSignal,
) => readonly PiNpcMessage[] | Promise<readonly PiNpcMessage[]>;
export type PiNpcTurnAttemptStatus = PiNpcTurnStatus | 'retry';
export type PiNpcEvent =
  | { type: 'agent_start'; turnId: string }
  | { type: 'turn_start'; turnId: string; attempt: 1 | 2; repair: boolean }
  | {
      type: 'turn_end';
      turnId: string;
      attempt: 1 | 2;
      status: PiNpcTurnAttemptStatus;
      failureReasonCode?: PiNpcFailureReasonCode;
    }
  | { type: 'agent_end'; turnId: string; result: PiNpcTurnResult };
export type PiNpcEventSink = (event: PiNpcEvent) => void | Promise<void>;
export interface PiNpcKernelOptions {
  provider: PiNpcProvider;
  transformContext?: PiNpcTransformContext;
  emit?: PiNpcEventSink;
  signal?: AbortSignal;
  now?: () => number;
}
export type PiNpcRuleKernelOptions = Pick<
  PiNpcKernelOptions,
  'emit' | 'signal' | 'now'
>;

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { chatCompletion, getLLMConfig, type LLMMessage } from '../util/llm';
import type { AgentProposal } from './agentLogic';
import type { ActionResult } from './actionSchema';
import {
  SOCIAL_LLM_MAX_ATTEMPTS,
  SOCIAL_LLM_OUTPUT_TOKEN_LIMIT,
  SOCIAL_LLM_TIMEOUT_MS,
  SOCIAL_MODEL_PROMPT_VERSION,
  estimateSocialPromptTokens,
  socialLlmGateReason,
  socialLlmSwitches,
} from './socialModelPolicy';
import type { ReserveSocialModelCallResult } from './socialModelRuntime';
import {
  buildSocialModelTurnPlan,
  materializeSocialModelProposal,
  parseSocialModelTurn,
} from './socialModelTurnLogic';
import { buildAutonomyDecisionTrace } from './autonomyDecisionTraceLogic';
import type { AutonomyDecisionTrace } from './autonomyDecisionContracts';

type SubmittedResult = ActionResult & {
  eventId: Id<'worldEvents'>;
  actionRecordId: Id<'actionRecords'>;
};

export type ConversationModelTurnResult =
  | {
      actorId: string;
      skipped: string;
      callId?: string;
      decisionTrace?: AutonomyDecisionTrace;
      decisionTraceId?: Id<'autonomyDecisionTraces'>;
      decisionTraceReplay?: boolean;
    }
  | {
      actorId: string;
      proposal: AgentProposal;
      result: SubmittedResult;
      decisionSource: 'llm';
      callId: string;
      decisionTrace?: AutonomyDecisionTrace;
      decisionTraceId?: Id<'autonomyDecisionTraces'>;
      decisionTraceReplay?: boolean;
    };

// Production C012b entry point. It deliberately has no deterministic dialogue
// fallback: a disabled, unauthorised, over-budget or invalid model waits for a
// later tick/expiry instead of manufacturing an utterance that looks model-made.
export const runConversationModelTurn = internalAction({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    decisionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ConversationModelTurnResult> => {
    const now = Date.now();
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now,
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };
    const plan = buildSocialModelTurnPlan(context);
    if (!plan) return { actorId: args.actorId, skipped: 'conversation_waiting_turn' };
    const prompt = plan.prompt;

    const messages: LLMMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    const promptHash = await sha256Json(messages);
    const turnNumber =
      (context.activeGroupConversation?.turnNumber ?? context.activeConversation?.turnNumber ?? 0) + 1;
    const callId = boundedCallId(
      await sha256Text(
        `${args.actorId}:${plan.conversationId}:${plan.scenarioKind}:turn:${turnNumber}:${args.decisionId ?? 'auto'}`,
      ),
    );
    const switches = socialLlmSwitches(process.env);
    const initialGateReason = socialLlmGateReason(switches);

    // Deployment, live consent and the exact prompt contract are checked before
    // provider discovery and before any fetch.
    // The mutation persists the blocked attempt, making the absence of consent
    // auditable without exposing prompt text.
    if (initialGateReason) {
      const blocked: ReserveSocialModelCallResult = await ctx.runMutation(
        internal.xianxia.socialModelRuntime.reserveSocialModelCall,
        reservationArgs({
          worldId: args.worldId,
          actorId: args.actorId,
          callId,
          conversationId: plan.conversationId,
          scenarioKind: plan.scenarioKind,
          provider: 'unconfigured',
          model: 'unconfigured',
          promptHash,
          estimatedInputTokens: estimateSocialPromptTokens(messages),
          now,
        }),
      );
      return {
        actorId: args.actorId,
        skipped: blocked.reserved ? 'social_llm_block_invariant' : blocked.reasonCode,
        callId,
      };
    }

    let config: ReturnType<typeof getLLMConfig>;
    try {
      config = getLLMConfig();
    } catch {
      const configurationReservation: ReserveSocialModelCallResult = await ctx.runMutation(
        internal.xianxia.socialModelRuntime.reserveSocialModelCall,
        reservationArgs({
          worldId: args.worldId,
          actorId: args.actorId,
          callId,
          conversationId: plan.conversationId,
          scenarioKind: plan.scenarioKind,
          provider: 'configuration',
          model: 'unconfigured',
          promptHash,
          estimatedInputTokens: estimateSocialPromptTokens(messages),
          now,
        }),
      );
      if (configurationReservation.reserved) {
        await finish(ctx, {
          worldId: args.worldId,
          callId,
          status: 'failed',
          now: Date.now(),
          attemptCount: 0,
          reasonCode: 'llm_unavailable',
        });
      }
      return {
        actorId: args.actorId,
        skipped: configurationReservation.reserved
          ? 'llm_unavailable'
          : configurationReservation.reasonCode,
        callId,
      };
    }
    const reservation: ReserveSocialModelCallResult = await ctx.runMutation(
      internal.xianxia.socialModelRuntime.reserveSocialModelCall,
      reservationArgs({
        worldId: args.worldId,
        actorId: args.actorId,
        callId,
        conversationId: plan.conversationId,
        scenarioKind: plan.scenarioKind,
        provider: config.provider,
        model: config.chatModel,
        promptHash,
        estimatedInputTokens: estimateSocialPromptTokens(messages),
        now,
      }),
    );
    if (!reservation.reserved) {
      return { actorId: args.actorId, skipped: reservation.reasonCode, callId };
    }
    if (!reservation.cacheHit) {
      const started = await ctx.runMutation(
        internal.xianxia.socialModelRuntime.markSocialModelCallStarted,
        { worldId: args.worldId, callId, now: Date.now() },
      );
      if (!started.ok) return { actorId: args.actorId, skipped: started.reasonCode, callId };
    }

    let content = reservation.cachedResponseText ?? '';
    let attempts = 0;
    let stats:
      | {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        }
      | undefined;
    let parsed = content ? parseSocialModelTurn(content, plan) : null;

    for (let attempt = 0; !reservation.cacheHit && attempt < SOCIAL_LLM_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt + 1;
      const attemptGateReason = socialLlmGateReason(socialLlmSwitches(process.env));
      if (attemptGateReason) {
        await finish(ctx, {
          worldId: args.worldId,
          callId,
          status: 'cancelled',
          now: Date.now(),
          attemptCount: attempt,
          reasonCode: attemptGateReason,
        });
        return { actorId: args.actorId, skipped: attemptGateReason, callId };
      }
      try {
        const heartbeat = await ctx.runMutation(
          internal.xianxia.socialModelRuntime.markSocialModelCallStarted,
          {
            worldId: args.worldId,
            callId,
            now: Date.now(),
          },
        );
        if (!heartbeat.ok) {
          return { actorId: args.actorId, skipped: heartbeat.reasonCode, callId };
        }
        const response = await chatCompletion(
          {
            messages: [
              messages[0],
              {
                role: 'user',
                content:
                  attempt === 0
                    ? prompt.user
                    : `${prompt.user}\n上次输出未通过服务端结构或知识校验。只能引用给出的 ID，并严格输出指定 JSON。`,
              },
            ],
            max_tokens: SOCIAL_LLM_OUTPUT_TOKEN_LIMIT,
            temperature: 0.55,
            response_format: { type: 'json_object' },
          },
          { timeoutMs: SOCIAL_LLM_TIMEOUT_MS, maxRetries: 0 },
        );
        content = response.content;
        stats = response;
        parsed = parseSocialModelTurn(content, plan);
        if (parsed.ok) break;
      } catch (error) {
        const timedOut = (error as Error & { code?: string })?.code === 'llm_timeout';
        await finish(ctx, {
          worldId: args.worldId,
          callId,
          status: timedOut ? 'timed_out' : 'failed',
          now: Date.now(),
          attemptCount: attempts,
          reasonCode: timedOut ? 'llm_timeout' : 'llm_unavailable',
        });
        return {
          actorId: args.actorId,
          skipped: timedOut ? 'llm_timeout' : 'llm_unavailable',
          callId,
        };
      }
    }

    if (!parsed?.ok) {
      await finish(ctx, {
        worldId: args.worldId,
        callId,
        status: 'invalid_output',
        now: Date.now(),
        attemptCount: attempts,
        reasonCode: parsed?.reasonCode ?? 'llm_invalid_output',
        resultHash: content ? await sha256Text(content) : undefined,
        responseText: content || undefined,
        ...stats,
      });
      return { actorId: args.actorId, skipped: 'llm_invalid_output', callId };
    }

    const actionGateReason = socialLlmGateReason(socialLlmSwitches(process.env));
    if (actionGateReason) {
      await finish(ctx, {
        worldId: args.worldId,
        callId,
        status: 'cancelled',
        now: Date.now(),
        attemptCount: reservation.cacheHit ? 0 : attempts,
        reasonCode: actionGateReason,
        resultHash: content ? await sha256Text(content) : undefined,
        responseText: content || undefined,
        ...stats,
      });
      return { actorId: args.actorId, skipped: actionGateReason, callId };
    }

    const proposal = materializeSocialModelProposal(context, plan, parsed.value);
    if (!proposal) {
      await finish(ctx, {
        worldId: args.worldId,
        callId,
        status: 'invalid_output',
        now: Date.now(),
        attemptCount: attempts,
        reasonCode: 'llm_candidate_not_allowed',
        resultHash: await sha256Text(content),
        responseText: content,
        ...stats,
      });
      return { actorId: args.actorId, skipped: 'llm_invalid_output', callId };
    }
    // The model selects only from the bounded service plan. Persist the
    // autonomy trace before committing the resulting action so a revision
    // conflict cannot leave an unaudited social action behind.
    const trace = buildAutonomyDecisionTrace({
      context,
      now,
      selectedProposal: proposal,
      decisionSource: 'llm',
    });
    const recordedTrace = await ctx.runMutation(
      internal.xianxia.autonomyDecisionTrace.recordAutonomyDecisionTrace,
      { worldId: args.worldId, trace },
    );
    const result: SubmittedResult = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: proposal.type,
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `social-model:${callId}`.slice(0, 180),
      targetActorId: proposal.targetActorId,
      targetId: proposal.targetId,
      locationId: proposal.locationId,
      intent: proposal.intent,
      params: proposal.params,
    });
    await finish(ctx, {
      worldId: args.worldId,
      callId,
      status: 'succeeded',
      now: Date.now(),
      attemptCount: reservation.cacheHit ? 0 : attempts,
      reasonCode:
        result.status === 'applied' ? undefined : `action_rejected:${result.resultCode}`,
      resultHash: await sha256Text(content),
      responseText: content,
      ...stats,
    });
    return {
      actorId: args.actorId,
      proposal,
      result,
      decisionSource: 'llm',
      callId,
      decisionTrace: recordedTrace.trace,
      decisionTraceId: recordedTrace.traceId,
      decisionTraceReplay: recordedTrace.idempotentReplay,
    };
  },
});

function reservationArgs(args: {
  worldId: Id<'worlds'>;
  actorId: string;
  callId: string;
  conversationId: string;
  provider: string;
  model: string;
  scenarioKind: string;
  promptHash: string;
  estimatedInputTokens: number;
  now: number;
}) {
  return {
    ...args,
    promptVersion: SOCIAL_MODEL_PROMPT_VERSION,
    authorizationId: boundedAuthorizationId(process.env.XIANXIA_SOCIAL_LLM_AUTHORIZATION_ID),
    maxOutputTokens: SOCIAL_LLM_OUTPUT_TOKEN_LIMIT,
  };
}

async function finish(
  ctx: ActionCtx,
  args: {
    worldId: Id<'worlds'>;
    callId: string;
    status: 'succeeded' | 'invalid_output' | 'failed' | 'timed_out' | 'cancelled';
    now: number;
    attemptCount: number;
    reasonCode?: string;
    resultHash?: string;
    responseText?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  },
) {
  return await ctx.runMutation(internal.xianxia.socialModelRuntime.finishSocialModelCall, args);
}

function boundedCallId(seed: string) {
  return `social:${seed}`.slice(0, 180);
}

function boundedAuthorizationId(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

async function sha256Json(value: unknown) {
  return await sha256Text(JSON.stringify(value));
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

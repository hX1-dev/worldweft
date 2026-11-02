import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  SOCIAL_LLM_ACTOR_COOLDOWN_MS,
  SOCIAL_LLM_CALL_LEASE_MS,
  SOCIAL_LLM_OUTPUT_TOKEN_LIMIT,
  evaluateSocialModelReservation,
  socialLlmSwitches,
  socialModelCircuitAfterResult,
  socialModelWindowStart,
  type SocialLlmSwitches,
} from './socialModelPolicy';
import { SOCIAL_MODEL_ACTIVE_STATUSES } from './socialModelContracts';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export type ReserveSocialModelCallArgs = {
  worldId: Id<'worlds'>;
  callId: string;
  actorId: string;
  conversationId: string;
  provider: string;
  model: string;
  promptVersion: string;
  scenarioKind: string;
  authorizationId?: string;
  promptHash: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  /**
   * Pi NPC A/B calls must be attributable to the frozen experiment instead of
   * silently reusing a prior social response.
   */
  allowCache?: boolean;
  /**
   * A caller-specific, fail-closed gate. Keeping blocked attempts in the
   * shared ledger makes authorization failures auditable without reserving
   * tokens.
   */
  preflightReasonCode?: string;
  /**
   * A format-repair call belongs to the same bounded Pi turn, so the Pi
   * adapter enforces its own two-slot limit instead of the social chat
   * cooldown.
   */
  ignoreActorCooldown?: boolean;
  now: number;
};

export type ReserveSocialModelCallResult =
  | {
      reserved: true;
      callDocId: Id<'socialModelCalls'>;
      reservedTokens: number;
      cacheHit: boolean;
      cachedResponseText?: string;
      idempotentReplay?: boolean;
      existingStatus?: Doc<'socialModelCalls'>['status'];
    }
  | {
      reserved: false;
      reasonCode: string;
      callDocId?: Id<'socialModelCalls'>;
      idempotentReplay?: boolean;
      existingStatus?: Doc<'socialModelCalls'>['status'];
    };

export async function reserveSocialModelCallTx(
  ctx: MutationCtx,
  args: ReserveSocialModelCallArgs,
  switches: SocialLlmSwitches,
): Promise<ReserveSocialModelCallResult> {
  const existing = await ctx.db
    .query('socialModelCalls')
    .withIndex('byCall', (q) => q.eq('worldId', args.worldId).eq('callId', args.callId))
    .first();
  if (existing) {
    const same =
      existing.actorId === args.actorId &&
      existing.conversationId === args.conversationId &&
      existing.provider === args.provider &&
      existing.model === args.model &&
      existing.promptVersion === args.promptVersion &&
      existing.scenarioKind === args.scenarioKind &&
      existing.authorizationId === args.authorizationId &&
      existing.promptHash === args.promptHash;
    if (!same) {
      return {
        reserved: false,
        reasonCode: 'social_llm_call_conflict',
        callDocId: existing._id,
        idempotentReplay: true,
        existingStatus: existing.status,
      };
    }
    if (existing.status === 'reserved' || existing.status === 'calling') {
      if (existing.leaseExpiresAt <= args.now) {
        await ctx.db.patch(existing._id, {
          status: 'lease_expired',
          reasonCode: 'llm_lease_expired',
          completedAt: args.now,
          updatedAt: args.now,
        });
        return {
          reserved: false,
          reasonCode: 'llm_lease_expired',
          callDocId: existing._id,
          idempotentReplay: true,
          existingStatus: 'lease_expired',
        };
      }
      return {
        reserved: true,
        callDocId: existing._id,
        reservedTokens: existing.reservedTokens,
        cacheHit: existing.cacheHit,
        cachedResponseText: existing.cacheHit ? existing.responseText : undefined,
        idempotentReplay: true,
        existingStatus: existing.status,
      };
    }
    return {
      reserved: false,
      reasonCode: existing.reasonCode ?? `social_llm_${existing.status}`,
      callDocId: existing._id,
      idempotentReplay: true,
      existingStatus: existing.status,
    };
  }

  if (args.preflightReasonCode) {
    return await blockCall(ctx, args, args.preflightReasonCode);
  }
  if (!switches.deploymentEnabled) {
    return await blockCall(ctx, args, 'social_llm_disabled');
  }
  if (!switches.liveAuthorized) {
    return await blockCall(ctx, args, 'social_llm_authorization_missing');
  }
  const inputCheck = evaluateSocialModelReservation({
    ...switches,
    now: args.now,
    estimatedInputTokens: args.estimatedInputTokens,
    maxOutputTokens: args.maxOutputTokens,
    activeWorldCalls: 0,
    hourlyReservedTokens: 0,
    dailyReservedTokens: 0,
  });
  if (!inputCheck.ok && inputCheck.reasonCode === 'social_llm_input_too_large') {
    return await blockCall(ctx, args, inputCheck.reasonCode);
  }

  const cached =
    args.allowCache === false
      ? null
      : await ctx.db
          .query('socialModelCalls')
          .withIndex('byPromptStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('provider', args.provider)
              .eq('model', args.model)
              .eq('promptHash', args.promptHash)
              .eq('status', 'succeeded'),
          )
          .order('desc')
          .first();
  if (cached?.responseText) {
    const callDocId = await ctx.db.insert('socialModelCalls', {
      worldId: args.worldId,
      callId: args.callId,
      actorId: args.actorId,
      conversationId: args.conversationId,
      status: 'reserved',
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      scenarioKind: args.scenarioKind,
      authorizationId: args.authorizationId,
      promptHash: args.promptHash,
      resultHash: cached.resultHash,
      responseText: cached.responseText,
      estimatedInputTokens: args.estimatedInputTokens,
      maxOutputTokens: args.maxOutputTokens,
      reservedTokens: 0,
      attemptCount: 0,
      cacheHit: true,
      reasonCode: 'social_llm_cache_hit',
      reservedAt: args.now,
      leaseExpiresAt: args.now + SOCIAL_LLM_CALL_LEASE_MS,
      updatedAt: args.now,
    });
    return {
      reserved: true,
      callDocId,
      reservedTokens: 0,
      cacheHit: true,
      cachedResponseText: cached.responseText,
    };
  }

  const budget = await loadBudget(ctx, args.worldId, args.now);
  const activeCalls: Doc<'socialModelCalls'>[] = [];
  for (const status of SOCIAL_MODEL_ACTIVE_STATUSES) {
    const rows = await ctx.db
      .query('socialModelCalls')
      .withIndex('byWorldStatus', (q) => q.eq('worldId', args.worldId).eq('status', status))
      .take(16);
    for (const row of rows) {
      if (row.leaseExpiresAt <= args.now) {
        await ctx.db.patch(row._id, {
          status: 'lease_expired',
          reasonCode: 'llm_lease_expired',
          completedAt: args.now,
          updatedAt: args.now,
        });
      } else {
        activeCalls.push(row);
      }
    }
  }
  const recentActorCalls = await ctx.db
    .query('socialModelCalls')
    .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
    .order('desc')
    .take(16);
  const latestBilledCall = recentActorCalls.find(
    (call) => call.reservedTokens > 0 && call.status !== 'blocked',
  );
  const actorNextAllowedAt = latestBilledCall
    ? latestBilledCall.reservedAt + SOCIAL_LLM_ACTOR_COOLDOWN_MS
    : undefined;
  const reservation = evaluateSocialModelReservation({
    ...switches,
    now: args.now,
    estimatedInputTokens: args.estimatedInputTokens,
    maxOutputTokens: Math.min(args.maxOutputTokens, SOCIAL_LLM_OUTPUT_TOKEN_LIMIT),
    actorNextAllowedAt: args.ignoreActorCooldown ? undefined : actorNextAllowedAt,
    activeWorldCalls: activeCalls.length,
    hourlyReservedTokens: budget.hourlyReservedTokens,
    dailyReservedTokens: budget.dailyReservedTokens,
    circuitOpenUntil: budget.circuitOpenUntil,
  });
  if (!reservation.ok) return await blockCall(ctx, args, reservation.reasonCode);

  const callDocId = await ctx.db.insert('socialModelCalls', {
    worldId: args.worldId,
    callId: args.callId,
    actorId: args.actorId,
    conversationId: args.conversationId,
    status: 'reserved',
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    scenarioKind: args.scenarioKind,
    authorizationId: args.authorizationId,
    promptHash: args.promptHash,
    estimatedInputTokens: args.estimatedInputTokens,
    maxOutputTokens: Math.min(args.maxOutputTokens, SOCIAL_LLM_OUTPUT_TOKEN_LIMIT),
    reservedTokens: reservation.reservedTokens,
    attemptCount: 0,
    cacheHit: false,
    reservedAt: args.now,
    leaseExpiresAt: args.now + SOCIAL_LLM_CALL_LEASE_MS,
    updatedAt: args.now,
  });
  await saveBudget(ctx, budget, {
    hourlyReservedTokens: budget.hourlyReservedTokens + reservation.reservedTokens,
    dailyReservedTokens: budget.dailyReservedTokens + reservation.reservedTokens,
    updatedAt: args.now,
  });
  return { reserved: true, callDocId, reservedTokens: reservation.reservedTokens, cacheHit: false };
}

export async function finishSocialModelCallTx(
  ctx: MutationCtx,
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
    latencyMs?: number;
  },
) {
  const call = await ctx.db
    .query('socialModelCalls')
    .withIndex('byCall', (q) => q.eq('worldId', args.worldId).eq('callId', args.callId))
    .first();
  if (!call) return { ok: false, reasonCode: 'social_llm_call_not_found' } as const;
  if (!['reserved', 'calling'].includes(call.status)) {
    return { ok: true, idempotentReplay: true, status: call.status } as const;
  }
  await ctx.db.patch(call._id, {
    status: args.status,
    attemptCount: args.attemptCount,
    reasonCode: args.reasonCode,
    resultHash: args.resultHash,
    responseText: args.responseText?.slice(0, 800),
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    totalTokens: args.totalTokens,
    latencyMs: args.latencyMs,
    completedAt: args.now,
    updatedAt: args.now,
  });
  if (!call.cacheHit && args.status !== 'cancelled') {
    const budget = await loadBudget(ctx, args.worldId, args.now);
    const circuit = socialModelCircuitAfterResult({
      currentFailures: budget.consecutiveFailures,
      status: args.status,
      now: args.now,
    });
    await saveBudget(ctx, budget, { ...circuit, updatedAt: args.now });
  }
  return { ok: true, status: args.status } as const;
}

export async function markSocialModelCallStartedTx(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; callId: string; now: number },
) {
  const call = await ctx.db
    .query('socialModelCalls')
    .withIndex('byCall', (q) => q.eq('worldId', args.worldId).eq('callId', args.callId))
    .first();
  if (!call) return { ok: false, reasonCode: 'social_llm_call_not_found' } as const;
  if (call.status === 'calling') {
    await ctx.db.patch(call._id, {
      leaseExpiresAt: args.now + SOCIAL_LLM_CALL_LEASE_MS,
      updatedAt: args.now,
    });
    return { ok: true, idempotentReplay: true } as const;
  }
  if (call.status !== 'reserved') {
    return { ok: false, reasonCode: 'social_llm_call_not_reserved' } as const;
  }
  await ctx.db.patch(call._id, {
    status: 'calling',
    startedAt: args.now,
    leaseExpiresAt: args.now + SOCIAL_LLM_CALL_LEASE_MS,
    updatedAt: args.now,
  });
  return { ok: true } as const;
}

export const reserveSocialModelCall = internalMutation({
  args: {
    worldId: v.id('worlds'),
    callId: v.string(),
    actorId: v.string(),
    conversationId: v.string(),
    provider: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    scenarioKind: v.string(),
    authorizationId: v.optional(v.string()),
    promptHash: v.string(),
    estimatedInputTokens: v.number(),
    maxOutputTokens: v.number(),
    allowCache: v.optional(v.boolean()),
    preflightReasonCode: v.optional(v.string()),
    ignoreActorCooldown: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<ReserveSocialModelCallResult> => {
    return await reserveSocialModelCallTx(ctx, args, socialLlmSwitches(process.env));
  },
});

export const markSocialModelCallStarted = internalMutation({
  args: { worldId: v.id('worlds'), callId: v.string(), now: v.number() },
  handler: async (ctx, args) => await markSocialModelCallStartedTx(ctx, args),
});

export const finishSocialModelCall = internalMutation({
  args: {
    worldId: v.id('worlds'),
    callId: v.string(),
    status: v.union(
      v.literal('succeeded'),
      v.literal('invalid_output'),
      v.literal('failed'),
      v.literal('timed_out'),
      v.literal('cancelled'),
    ),
    now: v.number(),
    attemptCount: v.number(),
    reasonCode: v.optional(v.string()),
    resultHash: v.optional(v.string()),
    responseText: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => await finishSocialModelCallTx(ctx, args),
});

async function blockCall(
  ctx: MutationCtx,
  args: ReserveSocialModelCallArgs,
  reasonCode: string,
): Promise<ReserveSocialModelCallResult> {
  const callDocId = await ctx.db.insert('socialModelCalls', {
    worldId: args.worldId,
    callId: args.callId,
    actorId: args.actorId,
    conversationId: args.conversationId,
    status: 'blocked',
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    scenarioKind: args.scenarioKind,
    authorizationId: args.authorizationId,
    promptHash: args.promptHash,
    estimatedInputTokens: args.estimatedInputTokens,
    maxOutputTokens: Math.min(args.maxOutputTokens, SOCIAL_LLM_OUTPUT_TOKEN_LIMIT),
    reservedTokens: 0,
    attemptCount: 0,
    cacheHit: false,
    reasonCode,
    reservedAt: args.now,
    completedAt: args.now,
    leaseExpiresAt: args.now,
    updatedAt: args.now,
  });
  return { reserved: false, reasonCode, callDocId };
}

async function loadBudget(ctx: MutationCtx, worldId: Id<'worlds'>, now: number) {
  const existing = await ctx.db
    .query('socialModelBudgets')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .first();
  const hourlyWindowStartedAt = socialModelWindowStart(now, HOUR_MS);
  const dailyWindowStartedAt = socialModelWindowStart(now, DAY_MS);
  return {
    _id: existing?._id,
    worldId,
    hourlyWindowStartedAt,
    hourlyReservedTokens:
      existing?.hourlyWindowStartedAt === hourlyWindowStartedAt
        ? existing.hourlyReservedTokens
        : 0,
    dailyWindowStartedAt,
    dailyReservedTokens:
      existing?.dailyWindowStartedAt === dailyWindowStartedAt ? existing.dailyReservedTokens : 0,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
    circuitOpenUntil:
      existing?.circuitOpenUntil !== undefined && existing.circuitOpenUntil > now
        ? existing.circuitOpenUntil
        : undefined,
    updatedAt: now,
  };
}

type BudgetState = Awaited<ReturnType<typeof loadBudget>>;

async function saveBudget(
  ctx: MutationCtx,
  budget: BudgetState,
  patch: Partial<Omit<BudgetState, '_id' | 'worldId'>>,
) {
  const value = {
    hourlyWindowStartedAt: budget.hourlyWindowStartedAt,
    hourlyReservedTokens: patch.hourlyReservedTokens ?? budget.hourlyReservedTokens,
    dailyWindowStartedAt: budget.dailyWindowStartedAt,
    dailyReservedTokens: patch.dailyReservedTokens ?? budget.dailyReservedTokens,
    consecutiveFailures: patch.consecutiveFailures ?? budget.consecutiveFailures,
    circuitOpenUntil:
      'circuitOpenUntil' in patch ? patch.circuitOpenUntil : budget.circuitOpenUntil,
    updatedAt: patch.updatedAt ?? budget.updatedAt,
  };
  if (budget._id) await ctx.db.patch(budget._id, value);
  else await ctx.db.insert('socialModelBudgets', { worldId: budget.worldId, ...value });
}

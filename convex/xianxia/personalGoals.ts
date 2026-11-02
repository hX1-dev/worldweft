import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { readGameHour } from './config';
import {
  ACTIVE_ACTION_EXECUTION_STATUSES,
  TERMINAL_ACTION_EXECUTION_STATUSES,
} from './actionExecutionContracts';
import { isActorIncapacitated } from './lifeStateLogic';
import { AGENT_REST_FATIGUE_THRESHOLD, normalizeFatigue } from './fatigueLogic';
import {
  PERSONAL_GOAL_CONTRACT_VERSION,
  PERSONAL_GOAL_HARD_DEADLINE_HOURS,
  PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
  personalGoalBacklogEntryValidator,
  personalGoalCandidateValidator,
  type ActivePersonalGoal,
  type PersonalGoalStatus,
} from './personalGoalContracts';
import {
  evaluatePurposeGoalArrival,
  evaluateSocialSessionGoalTerminal,
  evaluatePurposeGoalTerminal,
  initialPurposeGoalStage,
  purposeGoalExpectedAction,
} from './purposeBoundLifeGoalLogic';
import { purposeBoundLifeIntentDigest } from './purposeBoundLifeIntentContracts';
import {
  evaluatePurposeGoalCadence,
  evaluatePurposeGoalReplacement,
  purposeGoalCadenceKey,
  purposeGoalCooldownHours,
  PURPOSE_GOAL_CADENCE_HISTORY_LIMIT,
} from './purposeGoalCadenceLogic';
import {
  ACTIVE_MOVEMENT_STATUSES,
  TERMINAL_MOVEMENT_STATUSES,
} from './valleyMovementContracts';
import {
  cancelSocialInvitationTx,
  linkSocialInvitationConversationTx,
  linkSocialInvitationGoalTx,
  loadAcceptedSocialInvitationSource,
} from './socialInvitations';
import {
  projectAcceptedSocialInvitationIntent,
} from './socialInvitationGoalLogic';
import { commitConversationExpiration } from './conversations';

type GoalRow = Doc<'personalGoals'>;

export const preparePersonalGoal = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    return await preparePersonalGoalTx(ctx, args);
  },
});

export const selectPersonalGoal = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    observationRevision: v.string(),
    selected: v.optional(personalGoalCandidateValidator),
    backlog: v.array(personalGoalBacklogEntryValidator),
    idleReasonCode: v.optional(v.string()),
    interruption: v.optional(
      v.object({
        reasonCode: v.union(
          v.literal('higher_priority_survival'),
          v.literal('higher_priority_hard_obligation'),
          v.literal('higher_priority_major_event'),
        ),
        sourceRef: v.string(),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.backlog.length > 3) throw new Error('personal_goal_backlog_overflow');
    await preparePersonalGoalTx(ctx, args);
    const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
    let active = await activeGoalRow(ctx, args.worldId, args.actorId);
    const latest = await latestGoalRow(ctx, args.worldId, args.actorId);

    if (!args.selected) {
      if (active) {
        if (active.purposeIntent && active.purposeIntentDigest) {
          if (
            args.interruption?.reasonCode === 'higher_priority_survival' &&
            validSurvivalInterruptionSource(args.interruption.sourceRef, args.actorId)
          ) {
            await terminalizeGoal(
              ctx,
              active,
              'cancelled',
              'higher_priority_survival',
              args.now,
            );
            return {
              state: 'interrupted' as const,
              goalId: active.goalId,
              reasonCode: 'higher_priority_survival' as const,
            };
          }
          return {
            state: 'committed' as const,
            goal: personalGoalRowToActiveGoal(active),
            reasonCode: 'purpose_goal_committed' as const,
          };
        }
        await terminalizeGoal(ctx, active, 'cancelled', 'goal_no_longer_eligible', args.now);
        active = null;
      }
      const currentLatest = await latestGoalRow(ctx, args.worldId, args.actorId);
      if (
        currentLatest?.status === 'idle' &&
        currentLatest.idleReasonCode === (args.idleReasonCode ?? 'no_meaningful_action')
      ) {
        await ctx.db.patch(currentLatest._id, {
          observationRevision: args.observationRevision,
          backlog: args.backlog,
          updatedAt: args.now,
        });
        return { state: 'idle' as const, goalId: currentLatest.goalId, revision: currentLatest.revision };
      }
      const revision = (currentLatest?.revision ?? latest?.revision ?? 0) + 1;
      const goalId = personalGoalId(args.actorId, revision);
      await ctx.db.insert('personalGoals', {
        worldId: args.worldId,
        contractVersion: PERSONAL_GOAL_CONTRACT_VERSION,
        goalId,
        actorId: args.actorId,
        revision,
        status: 'idle',
        progressRevision: 0,
        backlog: args.backlog,
        observationRevision: args.observationRevision,
        attemptCount: 0,
        idleReasonCode: args.idleReasonCode ?? 'no_meaningful_action',
        createdAt: args.now,
        updatedAt: args.now,
      });
      return { state: 'idle' as const, goalId, revision };
    }

    if (active?.goalKey === args.selected.goalKey) {
      if (
        active.purposeIntentDigest !== args.selected.purposeIntentDigest ||
        Boolean(active.purposeIntent) !== Boolean(args.selected.purposeIntent)
      ) {
        throw new Error('purpose_goal_intent_digest_stale');
      }
      const realProgress =
        args.selected.progressScore > (active.progressScore ?? Number.NEGATIVE_INFINITY) &&
        args.selected.progressKey !== active.progressKey;
      const hardDeadline =
        active.hardDeadlineGameHour ?? nowGameHour + PERSONAL_GOAL_HARD_DEADLINE_HOURS;
      await ctx.db.patch(active._id, {
        candidateId: args.selected.candidateId,
        targetRef: args.selected.targetRef,
        intent: args.selected.intent,
        purposeIntent: args.selected.purposeIntent,
        purposeIntentDigest: args.selected.purposeIntentDigest,
        purposeCadenceKey: args.selected.purposeCadenceKey,
        backlog: args.backlog,
        observationRevision: args.observationRevision,
        progressScore: realProgress ? args.selected.progressScore : active.progressScore,
        progressKey: realProgress ? args.selected.progressKey : active.progressKey,
        progressRevision: realProgress ? active.progressRevision + 1 : active.progressRevision,
        lastProgressGameHour: realProgress ? nowGameHour : active.lastProgressGameHour,
        deadlineGameHour: realProgress
          ? boundedSoftDeadline(nowGameHour, active.deadlineGameHour, hardDeadline)
          : active.deadlineGameHour,
        updatedAt: args.now,
      });
      const refreshed = await ctx.db.get(active._id);
      if (!refreshed) throw new Error('personal_goal_disappeared');
      return { state: 'active' as const, goal: personalGoalRowToActiveGoal(refreshed), continued: true };
    }

    if (active) {
      const replacement = evaluatePurposeGoalReplacement({
        active: personalGoalRowToActiveGoal(active),
        selected: args.selected,
      });
      if (replacement.kind === 'retain') {
        return {
          state: 'committed' as const,
          goal: personalGoalRowToActiveGoal(active),
          reasonCode: replacement.reasonCode,
        };
      }
      if (replacement.kind === 'continue') {
        throw new Error('personal_goal_continue_branch_unreachable');
      }
      await terminalizeGoal(
        ctx,
        active,
        'cancelled',
        replacement.reasonCode === 'legacy_goal_reselected'
          ? 'goal_reselected'
          : replacement.reasonCode,
        args.now,
      );
      active = null;
    }
    if (args.selected.purposeIntent) {
      const expectedCadenceKey = purposeGoalCadenceKey(args.selected.purposeIntent);
      if (args.selected.purposeCadenceKey !== expectedCadenceKey) {
        throw new Error('purpose_goal_cadence_key_stale');
      }
      const [profileForCadence, cadenceWindows] = await Promise.all([
        ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .first(),
        recentPurposeCadenceWindows(ctx, args.worldId, args.actorId, nowGameHour),
      ]);
      const cadence = evaluatePurposeGoalCadence({
        candidate: args.selected,
        currentGameHour: nowGameHour,
        windows: cadenceWindows,
        fatigue: profileForCadence?.fatigue,
      });
      if (!cadence.allowed) {
        return {
          state: 'cadence_wait' as const,
          reasonCode: cadence.reasonCode,
          cadenceKey: cadence.cadenceKey,
          priorGoalId: cadence.priorGoalId,
          nextEligibleGameHour: cadence.nextEligibleGameHour,
        };
      }
    }
    const currentLatest = await latestGoalRow(ctx, args.worldId, args.actorId);
    const revision = (currentLatest?.revision ?? 0) + 1;
    const goalId = personalGoalId(args.actorId, revision);
    const hardDeadlineGameHour = nowGameHour + PERSONAL_GOAL_HARD_DEADLINE_HOURS;
    const profile = args.selected.purposeIntent
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .first()
      : null;
    const goalIdDoc = await ctx.db.insert('personalGoals', {
      worldId: args.worldId,
      contractVersion: PERSONAL_GOAL_CONTRACT_VERSION,
      goalId,
      actorId: args.actorId,
      revision,
      status: 'active',
      goalKey: args.selected.goalKey,
      kind: args.selected.kind,
      sourceRef: args.selected.sourceRef,
      targetRef: args.selected.targetRef,
      candidateId: args.selected.candidateId,
      intent: args.selected.intent,
      purposeIntent: args.selected.purposeIntent,
      purposeIntentDigest: args.selected.purposeIntentDigest,
      purposeCadenceKey: args.selected.purposeCadenceKey,
      purposeStage: args.selected.purposeIntent
        ? initialPurposeGoalStage(
            args.selected.purposeIntent,
            profile?.currentLocationId,
          )
        : undefined,
      socialInvitationId: invitationIdFromIntent(args.selected.purposeIntent),
      socialInvitationRevision: invitationRevisionFromIntent(args.selected.purposeIntent),
      progressScore: args.selected.progressScore,
      progressKey: args.selected.progressKey,
      progressRevision: 0,
      backlog: args.backlog,
      observationRevision: args.observationRevision,
      startedGameHour: nowGameHour,
      lastProgressGameHour: nowGameHour,
      deadlineGameHour: nowGameHour + PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
      hardDeadlineGameHour,
      attemptCount: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
    const inserted = await ctx.db.get(goalIdDoc);
    if (!inserted) throw new Error('personal_goal_insert_failed');
    if (inserted.socialInvitationId && inserted.socialInvitationRevision) {
      const linked = await linkSocialInvitationGoalTx(ctx, {
        worldId: args.worldId,
        invitationId: inserted.socialInvitationId,
        actorId: args.actorId,
        expectedRevision: inserted.socialInvitationRevision,
        personalGoalId: inserted.goalId,
        now: args.now,
      });
      if (!linked.ok) throw new Error(linked.reasonCode);
    }
    return { state: 'active' as const, goal: personalGoalRowToActiveGoal(inserted), continued: false };
  },
});

export const recordPersonalGoalAttempt = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    goalId: v.string(),
    actionRecordId: v.id('actionRecords'),
    actionType: v.string(),
    resultStatus: v.union(
      v.literal('applied'),
      v.literal('rejected'),
      v.literal('interrupted'),
    ),
    resultCode: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const goal = await ctx.db
      .query('personalGoals')
      .withIndex('byGoal', (q) => q.eq('worldId', args.worldId).eq('goalId', args.goalId))
      .unique();
    if (!goal || goal.actorId !== args.actorId || goal.status !== 'active') {
      return { recorded: false, reason: 'personal_goal_inactive' as const };
    }
    if (goal.purposeIntent && goal.purposeIntentDigest && goal.purposeStage) {
      if (
        purposeBoundLifeIntentDigest(goal.purposeIntent) !==
          goal.purposeIntentDigest ||
        args.actionType !==
          purposeGoalExpectedAction(goal.purposeStage, goal.purposeIntent)
      ) {
        await terminalizeGoal(
          ctx,
          goal,
          'failed',
          'purpose_goal_action_mismatch',
          args.now,
        );
        return { recorded: true, status: 'failed' as const };
      }
      const actionRecord = await ctx.db.get(args.actionRecordId);
      if (
        !actionRecord ||
        actionRecord.personalGoalId !== goal.goalId ||
        actionRecord.personalGoalRevision !== goal.revision ||
        actionRecord.purposeIntentDigest !== goal.purposeIntentDigest
      ) {
        await terminalizeGoal(
          ctx,
          goal,
          'failed',
          'purpose_goal_causal_fence_mismatch',
          args.now,
        );
        return { recorded: true, status: 'failed' as const };
      }
    }
    if (args.resultStatus !== 'applied') {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        `action_rejected:${args.resultCode}`,
        args.now,
      );
      return { recorded: true, status: 'failed' as const };
    }
    await ctx.db.patch(goal._id, {
      attemptCount: goal.attemptCount + 1,
      lastActionRecordId: args.actionRecordId,
      lastActionType: args.actionType,
      purposeStage:
        goal.purposeIntent && args.actionType !== 'travel'
          ? 'activity_pending'
          : goal.purposeStage,
      purposeActivityActionRecordId:
        goal.purposeIntent && args.actionType !== 'travel'
          ? args.actionRecordId
          : goal.purposeActivityActionRecordId,
      updatedAt: args.now,
    });
    const [execution, movement] = await Promise.all([
      ctx.db
        .query('actionExecutions')
        .withIndex('byAction', (q) =>
          q.eq('worldId', args.worldId).eq('actionRecordId', args.actionRecordId),
        )
        .order('desc')
        .first(),
      ctx.db
        .query('movementCommands')
        .withIndex('byAction', (q) =>
          q.eq('worldId', args.worldId).eq('actionRecordId', args.actionRecordId),
        )
        .order('desc')
        .first(),
    ]);
    if (execution || movement || args.actionType === 'travel') {
      if (goal.purposeIntent && args.actionType !== 'travel' && execution) {
        await ctx.db.patch(goal._id, {
          purposeActivityExecutionId: execution._id,
          updatedAt: args.now,
        });
      }
      return { recorded: true, status: 'active' as const };
    }
    const refreshed = await ctx.db.get(goal._id);
    if (!refreshed || refreshed.status !== 'active') {
      return { recorded: false, reason: 'personal_goal_inactive' as const };
    }
    return await advanceOrCompleteAfterAction(ctx, refreshed, args.now);
  },
});

export const failPurposePersonalGoal = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    goalId: v.string(),
    intentDigest: v.string(),
    reasonCode: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const goal = await ctx.db
      .query('personalGoals')
      .withIndex('byGoal', (q) =>
        q.eq('worldId', args.worldId).eq('goalId', args.goalId),
      )
      .unique();
    if (
      !goal ||
      goal.actorId !== args.actorId ||
      goal.status !== 'active' ||
      goal.purposeIntentDigest !== args.intentDigest
    ) {
      return { failed: false, reasonCode: 'purpose_goal_causal_fence_mismatch' as const };
    }
    await terminalizeGoal(ctx, goal, 'failed', args.reasonCode, args.now);
    return { failed: true, reasonCode: args.reasonCode };
  },
});

export const latestPersonalGoal = internalQuery({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query('personalGoals')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId).eq('status', 'active'),
      )
      .order('desc')
      .first();
    if (active) return personalGoalRowToActiveGoal(active);
    const latest = await ctx.db
      .query('personalGoals')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    return latest
      ? {
          contractVersion: latest.contractVersion,
          goalId: latest.goalId,
          actorId: latest.actorId,
          revision: latest.revision,
          status: latest.status,
          idleReasonCode: latest.idleReasonCode,
          terminalReasonCode: latest.terminalReasonCode,
          purposeCadenceKey: latest.purposeCadenceKey,
          terminalGameHour: latest.terminalGameHour,
          nextEligibleGameHour: latest.nextEligibleGameHour,
        }
      : null;
  },
});

async function preparePersonalGoalTx(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actorId: string; now: number },
) {
  const goal = await activeGoalRow(ctx, args.worldId, args.actorId);
  if (!goal) return { state: 'none' as const };
  const profile = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId),
    )
    .first();
  if (!profile || isActorIncapacitated(profile.health)) {
    await terminalizeGoal(ctx, goal, 'failed', 'actor_incapacitated', args.now);
    return { state: 'failed' as const, reasonCode: 'actor_incapacitated' };
  }
  const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
  if (
    goal.hardDeadlineGameHour !== undefined &&
    nowGameHour >= goal.hardDeadlineGameHour
  ) {
    await terminalizeGoal(
      ctx,
      goal,
      'expired',
      'goal_hard_deadline_expired',
      args.now,
    );
    return { state: 'expired' as const, reasonCode: 'goal_hard_deadline_expired' };
  }
  if (goal.deadlineGameHour !== undefined && nowGameHour >= goal.deadlineGameHour) {
    await terminalizeGoal(ctx, goal, 'expired', 'goal_deadline_expired', args.now);
    return { state: 'expired' as const, reasonCode: 'goal_deadline_expired' };
  }
  if (goal.socialInvitationId) {
    const source = await loadAcceptedSocialInvitationSource(
      ctx,
      args.worldId,
      goal.socialInvitationId,
      args.now,
    );
    const projected = source ? projectAcceptedSocialInvitationIntent(source) : undefined;
    if (
      !source ||
      !projected?.ok ||
      source.receipt.revision !== goal.socialInvitationRevision ||
      projected.projection.intentDigest !== goal.purposeIntentDigest
    ) {
      await terminalizeGoal(
        ctx,
        goal,
        'cancelled',
        projected && !projected.ok
          ? projected.reasonCode
          : 'social_invitation_cancelled',
        args.now,
      );
      return { state: 'cancelled' as const, reasonCode: 'social_invitation_cancelled' };
    }
  }
  if (goal.purposeStage === 'session_pending') {
    return await advanceSocialSessionGoal(ctx, goal, args.now);
  }
  if (!goal.lastActionRecordId) {
    // A v2 purpose goal may only complete from its own causally fenced
    // activity terminal. External fact changes are reconsideration inputs,
    // never a substitute for the promised action chain.
    if (goal.purposeIntent && goal.purposeIntentDigest && goal.purposeStage) {
      return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
    }
    const sourceState = await personalGoalSourceState(ctx, goal, profile);
    if (sourceState.state === 'completed') {
      await terminalizeGoal(ctx, goal, 'completed', sourceState.reasonCode, args.now);
      return { state: 'completed' as const, reasonCode: sourceState.reasonCode };
    }
    if (sourceState.state === 'failed' || sourceState.state === 'cancelled') {
      await terminalizeGoal(
        ctx,
        goal,
        sourceState.state,
        sourceState.reasonCode,
        args.now,
      );
      return { state: sourceState.state, reasonCode: sourceState.reasonCode };
    }
    return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
  }
  const [actionRecord, execution, movement] = await Promise.all([
    ctx.db.get(goal.lastActionRecordId),
    ctx.db
      .query('actionExecutions')
      .withIndex('byAction', (q) =>
        q.eq('worldId', args.worldId).eq('actionRecordId', goal.lastActionRecordId!),
      )
      .order('desc')
      .first(),
    ctx.db
      .query('movementCommands')
      .withIndex('byAction', (q) =>
        q.eq('worldId', args.worldId).eq('actionRecordId', goal.lastActionRecordId!),
      )
      .order('desc')
      .first(),
  ]);
  if (!actionRecord || actionRecord.actorId !== args.actorId) {
    await terminalizeGoal(ctx, goal, 'failed', 'goal_source_invalid', args.now);
    return { state: 'failed' as const, reasonCode: 'goal_source_invalid' };
  }
  if (execution) {
    if (ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status)) {
      return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
    }
    if (TERMINAL_ACTION_EXECUTION_STATUSES.has(execution.status)) {
      if (execution.status === 'completed') {
        return await advanceOrCompleteAfterAction(ctx, goal, args.now);
      }
      const reason = execution.reasonCode ?? execution.resultCode ?? 'unknown';
      const status = execution.status === 'blocked' ? 'blocked' : 'interrupted';
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        `execution_${status}:${reason}`,
        args.now,
      );
      return { state: 'failed' as const, reasonCode: `execution_${status}:${reason}` };
    }
  }
  if (movement) {
    if (ACTIVE_MOVEMENT_STATUSES.has(movement.status)) {
      return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
    }
    if (TERMINAL_MOVEMENT_STATUSES.has(movement.status)) {
      if (movement.status === 'arrived') {
        return await advanceOrCompleteAfterAction(ctx, goal, args.now);
      }
      const reason = movement.reasonCode ?? 'unknown';
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        `movement_${movement.status}:${reason}`,
        args.now,
      );
      return { state: 'failed' as const, reasonCode: `movement_${movement.status}:${reason}` };
    }
  }
  if (actionRecord.status === 'rejected' || actionRecord.status === 'interrupted') {
    const code = actionRecord.result?.resultCode ?? 'unknown';
    await terminalizeGoal(ctx, goal, 'failed', `action_rejected:${code}`, args.now);
    return { state: 'failed' as const, reasonCode: `action_rejected:${code}` };
  }
  if (goal.lastActionType === 'travel') {
    if (!actionRecord.targetId || profile.currentLocationId !== actionRecord.targetId) {
      return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
    }
  }
  return await advanceOrCompleteAfterAction(ctx, goal, args.now);
}

async function advanceOrCompleteAfterAction(
  ctx: MutationCtx,
  goal: GoalRow,
  now: number,
) {
  const nowGameHour = await readGameHour(ctx, goal.worldId, now);
  const profile = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) =>
      q.eq('worldId', goal.worldId).eq('actorId', goal.actorId),
    )
    .first();
  if (goal.purposeIntent && goal.purposeIntentDigest && goal.purposeStage) {
    if (!profile || !goal.lastActionRecordId || !goal.lastActionType) {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        'purpose_goal_causal_fence_mismatch',
        now,
      );
      return { state: 'failed' as const, goalId: goal.goalId };
    }
    if (
      purposeBoundLifeIntentDigest(goal.purposeIntent) !==
      goal.purposeIntentDigest
    ) {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        'purpose_goal_intent_digest_stale',
        now,
      );
      return { state: 'failed' as const, goalId: goal.goalId };
    }
    const terminalEvent = await latestActionEvent(
      ctx,
      goal.worldId,
      goal.lastActionRecordId,
    );
    if (!terminalEvent) {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        'purpose_goal_terminal_event_missing',
        now,
      );
      return { state: 'failed' as const, goalId: goal.goalId };
    }
    if (goal.lastActionType === 'travel') {
      const arrival = evaluatePurposeGoalArrival({
        intent: goal.purposeIntent,
        intentDigest: goal.purposeIntentDigest,
        stage: goal.purposeStage,
        actionType: goal.lastActionType,
        actionRecordId: String(goal.lastActionRecordId),
        terminalEventActionId: terminalEvent.actionId
          ? String(terminalEvent.actionId)
          : undefined,
        currentLocationId: profile.currentLocationId,
      });
      if (!arrival.ok) {
        await terminalizeGoal(
          ctx,
          goal,
          'failed',
          arrival.reasonCode,
          now,
        );
        return { state: 'failed' as const, goalId: goal.goalId };
      }
      const hardDeadline =
        goal.hardDeadlineGameHour ??
        nowGameHour + PERSONAL_GOAL_HARD_DEADLINE_HOURS;
      await ctx.db.patch(goal._id, {
        progressScore: (goal.progressScore ?? 0) + 1,
        progressKey: `purpose_arrival:${String(goal.lastActionRecordId)}`,
        progressRevision: goal.progressRevision + 1,
        lastProgressGameHour: nowGameHour,
        deadlineGameHour: boundedSoftDeadline(
          nowGameHour,
          goal.deadlineGameHour,
          hardDeadline,
        ),
        purposeStage: 'activity_ready',
        purposeArrivalActionRecordId: goal.lastActionRecordId,
        purposeArrivalEventId: terminalEvent._id,
        lastActionRecordId: undefined,
        lastActionType: undefined,
        updatedAt: now,
      });
      const refreshed = await ctx.db.get(goal._id);
      if (!refreshed) throw new Error('personal_goal_disappeared');
      return {
        state: 'active' as const,
        goal: personalGoalRowToActiveGoal(refreshed),
        progressed: true,
      };
    }
    if (
      goal.purposeStage !== 'activity_pending' ||
      goal.lastActionType !== goal.purposeIntent.intendedActivity
    ) {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        'purpose_goal_action_mismatch',
        now,
      );
      return { state: 'failed' as const, goalId: goal.goalId };
    }
    if (goal.purposeIntent.completionCondition.kind === 'social_session_terminal') {
      const session = await ctx.db
        .query('conversationSessions')
        .withIndex('byOpenedAction', (q) =>
          q.eq('worldId', goal.worldId).eq('openedByActionId', goal.lastActionRecordId!),
        )
        .unique();
      if (
        !session ||
        session.proposerActorId !== goal.actorId ||
        ![session.actorAId, session.actorBId].includes(
          goal.purposeIntent.completionCondition.targetActorId,
        ) ||
        session.locationId !== goal.purposeIntent.targetLocationId
      ) {
        await terminalizeGoal(ctx, goal, 'failed', 'social_invitation_session_failed', now);
        return { state: 'failed' as const, goalId: goal.goalId };
      }
      if (!goal.socialInvitationId || !goal.socialInvitationRevision) {
        await terminalizeGoal(ctx, goal, 'failed', 'purpose_goal_causal_fence_mismatch', now);
        return { state: 'failed' as const, goalId: goal.goalId };
      }
      const linked = await linkSocialInvitationConversationTx(ctx, {
        worldId: goal.worldId,
        invitationId: goal.socialInvitationId,
        actorId: goal.actorId,
        expectedRevision: goal.socialInvitationRevision,
        conversationId: session.conversationId,
        now,
      });
      if (!linked.ok) {
        await terminalizeGoal(ctx, goal, 'failed', linked.reasonCode, now);
        return { state: 'failed' as const, goalId: goal.goalId };
      }
      await ctx.db.patch(goal._id, {
        purposeStage: 'session_pending',
        socialConversationId: session.conversationId,
        lastActionRecordId: undefined,
        lastActionType: undefined,
        updatedAt: now,
      });
      const refreshed = await ctx.db.get(goal._id);
      if (!refreshed) throw new Error('personal_goal_disappeared');
      return await advanceSocialSessionGoal(ctx, refreshed, now);
    }
    const completion = await evaluatePurposeCompletion(
      ctx,
      goal,
      profile,
      terminalEvent,
    );
    if (!completion.ok) {
      await terminalizeGoal(
        ctx,
        goal,
        'failed',
        completion.reasonCode,
        now,
      );
      return { state: 'failed' as const, goalId: goal.goalId };
    }
    await ctx.db.patch(goal._id, {
      purposeActivityTerminalEventId: terminalEvent._id,
      updatedAt: now,
    });
    await terminalizeGoal(
      ctx,
      goal,
      'completed',
      'purpose_goal_activity_completed',
      now,
    );
    return { state: 'completed' as const, goalId: goal.goalId };
  }
  const sourceState = profile
    ? await personalGoalSourceState(ctx, goal, profile)
    : { state: 'failed' as const, reasonCode: 'goal_source_invalid' };
  if (sourceState.state === 'failed' || sourceState.state === 'cancelled') {
    await terminalizeGoal(ctx, goal, sourceState.state, sourceState.reasonCode, now);
    return { state: sourceState.state, goalId: goal.goalId };
  }
  if (sourceState.state === 'completed' && goal.kind === 'commitment') {
    await terminalizeGoal(ctx, goal, 'completed', sourceState.reasonCode, now);
    return { state: 'completed' as const, goalId: goal.goalId };
  }
  if (goal.lastActionType === 'travel' || sourceState.state === 'pending') {
    const hardDeadline =
      goal.hardDeadlineGameHour ?? nowGameHour + PERSONAL_GOAL_HARD_DEADLINE_HOURS;
    await ctx.db.patch(goal._id, {
      progressScore: (goal.progressScore ?? 0) + 1,
      progressKey: `action:${String(goal.lastActionRecordId)}:completed`,
      progressRevision: goal.progressRevision + 1,
      lastProgressGameHour: nowGameHour,
      deadlineGameHour: boundedSoftDeadline(
        nowGameHour,
        goal.deadlineGameHour,
        hardDeadline,
      ),
      lastActionRecordId: undefined,
      lastActionType: undefined,
      updatedAt: now,
    });
    const refreshed = await ctx.db.get(goal._id);
    if (!refreshed) throw new Error('personal_goal_disappeared');
    return { state: 'active' as const, goal: personalGoalRowToActiveGoal(refreshed), progressed: true };
  }
  await terminalizeGoal(ctx, goal, 'completed', 'goal_action_completed', now);
  return { state: 'completed' as const, goalId: goal.goalId };
}

async function latestActionEvent(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actionRecordId: Id<'actionRecords'>,
) {
  return await ctx.db
    .query('worldEvents')
    .withIndex('byAction', (q) =>
      q.eq('worldId', worldId).eq('actionId', actionRecordId),
    )
    .order('desc')
    .first();
}

async function evaluatePurposeCompletion(
  ctx: MutationCtx,
  goal: GoalRow,
  profile: Doc<'xianxiaProfiles'>,
  terminalEvent: Doc<'worldEvents'>,
) {
  const condition = goal.purposeIntent!.completionCondition;
  let requestStatus: string | undefined;
  if (condition.kind === 'request_status_equals') {
    const requestId = ctx.db.normalizeId(
      'requests',
      condition.subjectRef.slice('request:'.length),
    );
    const request = requestId ? await ctx.db.get(requestId) : null;
    if (request?.worldId === goal.worldId) requestStatus = request.status;
  }
  return evaluatePurposeGoalTerminal({
    intent: goal.purposeIntent!,
    intentDigest: goal.purposeIntentDigest!,
    actionType: goal.lastActionType!,
    actionRecordId: String(goal.lastActionRecordId),
    terminalEventActionId: terminalEvent.actionId
      ? String(terminalEvent.actionId)
      : undefined,
    terminalEventType: terminalEvent.type,
    actor: {
      health: profile.health,
      fatigue: profile.fatigue,
      cultivationXp: profile.cultivationXp,
      currentLocationId: profile.currentLocationId,
      inventory: profile.inventory ?? [],
    },
    requestStatus,
  });
}

async function personalGoalSourceState(
  ctx: MutationCtx,
  goal: GoalRow,
  profile: Doc<'xianxiaProfiles'>,
): Promise<{
  state: 'pending' | 'completed' | 'failed' | 'cancelled' | 'unchanged';
  reasonCode: string;
}> {
  if (!goal.sourceRef) return { state: 'failed', reasonCode: 'goal_source_invalid' };
  if (goal.sourceRef.startsWith('request:')) {
    const id = ctx.db.normalizeId('requests', goal.sourceRef.slice('request:'.length));
    const request = id ? await ctx.db.get(id) : null;
    if (
      !request ||
      request.worldId !== goal.worldId ||
      request.assigneeActorId !== goal.actorId
    ) {
      return { state: 'failed', reasonCode: 'goal_source_invalid' };
    }
    if (['offered', 'accepted', 'ready_to_turn_in'].includes(request.status)) {
      return { state: 'pending', reasonCode: 'request_pending' };
    }
    if (request.status === 'completed') {
      return { state: 'completed', reasonCode: 'request_completed' };
    }
    if (request.status === 'declined') {
      return { state: 'cancelled', reasonCode: 'request_declined' };
    }
    return { state: 'failed', reasonCode: `request_${request.status}` };
  }
  if (goal.sourceRef.startsWith('commitment:')) {
    const commitmentId = goal.sourceRef.slice('commitment:'.length);
    const commitment = await ctx.db
      .query('groupCommitments')
      .withIndex('byCommitment', (q) =>
        q.eq('worldId', goal.worldId).eq('commitmentId', commitmentId),
      )
      .first();
    if (!commitment) return { state: 'failed', reasonCode: 'goal_source_invalid' };
    if (commitment.status === 'pending') {
      return { state: 'pending', reasonCode: 'commitment_pending' };
    }
    if (commitment.status === 'fulfilled') {
      return { state: 'completed', reasonCode: 'commitment_fulfilled' };
    }
    if (commitment.status === 'invalidated') {
      return { state: 'cancelled', reasonCode: 'commitment_invalidated' };
    }
    return { state: 'failed', reasonCode: 'commitment_breached' };
  }
  if (goal.kind === 'recovery') {
    const recovered =
      profile.health >= Math.max(1, profile.maxHealth ?? 10) &&
      normalizeFatigue(profile.fatigue) < AGENT_REST_FATIGUE_THRESHOLD;
    return recovered
      ? { state: 'completed', reasonCode: 'recovery_satisfied' }
      : { state: 'unchanged', reasonCode: 'recovery_needed' };
  }
  if (goal.kind === 'avoid_threat' && goal.sourceRef.startsWith('encounter:')) {
    const encounter = await ctx.db
      .query('combatEncounters')
      .withIndex('byEncounter', (q) =>
        q
          .eq('worldId', goal.worldId)
          .eq('encounterId', goal.sourceRef!.slice('encounter:'.length)),
      )
      .first();
    return encounter?.status === 'active'
      ? { state: 'unchanged', reasonCode: 'threat_active' }
      : { state: 'completed', reasonCode: 'threat_cleared' };
  }
  return { state: 'unchanged', reasonCode: 'source_unchanged' };
}

async function activeGoalRow(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
): Promise<GoalRow | null> {
  const rows = await ctx.db
    .query('personalGoals')
    .withIndex('byActorStatus', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('status', 'active'),
    )
    .order('desc')
    .take(2);
  if (rows.length > 1) throw new Error('personal_goal_multiple_active');
  return rows[0] ?? null;
}

async function latestGoalRow(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
): Promise<GoalRow | null> {
  return await ctx.db
    .query('personalGoals')
    .withIndex('byActorRevision', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    )
    .order('desc')
    .first();
}

async function terminalizeGoal(
  ctx: MutationCtx,
  goal: GoalRow,
  status: Exclude<PersonalGoalStatus, 'active' | 'idle'>,
  reasonCode: string,
  now: number,
) {
  if (goal.status !== 'active') return;
  if (
    goal.socialInvitationId &&
    goal.socialInvitationRevision &&
    status !== 'completed'
  ) {
    await cancelSocialInvitationTx(ctx, {
      worldId: goal.worldId,
      invitationId: goal.socialInvitationId,
      actorId: goal.actorId,
      expectedRevision: goal.socialInvitationRevision,
      reasonCode,
      now,
    });
  }
  const nowGameHour = await readGameHour(ctx, goal.worldId, now);
  const cadenceKey = goal.purposeIntent
    ? (goal.purposeCadenceKey ?? purposeGoalCadenceKey(goal.purposeIntent))
    : undefined;
  const cooldownHours = goal.purposeIntent
    ? purposeGoalCooldownHours({
        intent: goal.purposeIntent,
        terminalStatus: status,
        reasonCode,
      })
    : 0;
  await ctx.db.patch(goal._id, {
    status,
    terminalReasonCode: reasonCode.slice(0, 240),
    purposeCadenceKey: cadenceKey,
    terminalGameHour: goal.purposeIntent ? nowGameHour : undefined,
    nextEligibleGameHour: goal.purposeIntent
      ? nowGameHour + cooldownHours
      : undefined,
    terminalAt: now,
    updatedAt: now,
  });
}

async function recentPurposeCadenceWindows(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  nowGameHour: number,
) {
  const rows = await ctx.db
    .query('personalGoals')
    .withIndex('byActorRevision', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    )
    .order('desc')
    .take(PURPOSE_GOAL_CADENCE_HISTORY_LIMIT);
  return rows.flatMap((row) => {
    if (
      !row.purposeIntent ||
      !row.purposeCadenceKey ||
      row.status === 'active' ||
      row.status === 'idle' ||
      row.terminalGameHour === undefined ||
      row.nextEligibleGameHour === undefined ||
      row.nextEligibleGameHour <= nowGameHour ||
      !row.terminalReasonCode
    ) {
      return [];
    }
    return [{
      goalId: row.goalId,
      cadenceKey: row.purposeCadenceKey,
      sourceRef: row.purposeIntent.sourceRef,
      sourceRevision: row.purposeIntent.sourceRevision,
      purposeKind: row.purposeIntent.purposeKind,
      intendedActivity: row.purposeIntent.intendedActivity,
      terminalStatus: row.status,
      terminalReasonCode: row.terminalReasonCode,
      terminalGameHour: row.terminalGameHour,
      nextEligibleGameHour: row.nextEligibleGameHour,
    }];
  });
}

function validSurvivalInterruptionSource(sourceRef: string, actorId: string) {
  return (
    sourceRef === `body:${actorId}` ||
    sourceRef.startsWith('encounter:') ||
    sourceRef.startsWith('pressure:')
  );
}

function boundedSoftDeadline(
  nowGameHour: number,
  currentDeadline: number | undefined,
  hardDeadline: number,
) {
  return Math.min(
    hardDeadline,
    Math.max(currentDeadline ?? nowGameHour, nowGameHour + PERSONAL_GOAL_SOFT_DEADLINE_HOURS),
  );
}

function personalGoalId(actorId: string, revision: number) {
  return `personal_goal:${actorId}:${revision}`.slice(0, 240);
}

export function personalGoalRowToActiveGoal(row: GoalRow): ActivePersonalGoal {
  if (
    row.status !== 'active' ||
    !row.goalKey ||
    !row.kind ||
    !row.sourceRef ||
    !row.candidateId ||
    !row.intent ||
    row.progressScore === undefined ||
    !row.progressKey ||
    row.startedGameHour === undefined ||
    row.lastProgressGameHour === undefined ||
    row.deadlineGameHour === undefined ||
    row.hardDeadlineGameHour === undefined
  ) {
    throw new Error('personal_goal_active_contract_incomplete');
  }
  return {
    contractVersion: PERSONAL_GOAL_CONTRACT_VERSION,
    goalId: row.goalId,
    actorId: row.actorId,
    revision: row.revision,
    status: 'active',
    goalKey: row.goalKey,
    kind: row.kind,
    sourceRef: row.sourceRef,
    targetRef: row.targetRef,
    candidateId: row.candidateId,
    intent: row.intent,
    progressScore: row.progressScore,
    progressKey: row.progressKey,
    progressRevision: row.progressRevision,
    backlog: row.backlog,
    observationRevision: row.observationRevision,
    startedGameHour: row.startedGameHour,
    lastProgressGameHour: row.lastProgressGameHour,
    deadlineGameHour: row.deadlineGameHour,
    hardDeadlineGameHour: row.hardDeadlineGameHour,
    attemptCount: row.attemptCount,
    lastActionRecordId: row.lastActionRecordId ? String(row.lastActionRecordId) : undefined,
    lastActionType: row.lastActionType,
    purposeIntent: row.purposeIntent,
    purposeIntentDigest: row.purposeIntentDigest,
    purposeCadenceKey: row.purposeCadenceKey,
    purposeStage: row.purposeStage,
    purposeArrivalActionRecordId: row.purposeArrivalActionRecordId
      ? String(row.purposeArrivalActionRecordId)
      : undefined,
    purposeArrivalEventId: row.purposeArrivalEventId
      ? String(row.purposeArrivalEventId)
      : undefined,
    purposeActivityActionRecordId: row.purposeActivityActionRecordId
      ? String(row.purposeActivityActionRecordId)
      : undefined,
    purposeActivityExecutionId: row.purposeActivityExecutionId
      ? String(row.purposeActivityExecutionId)
      : undefined,
    purposeActivityTerminalEventId: row.purposeActivityTerminalEventId
      ? String(row.purposeActivityTerminalEventId)
      : undefined,
    socialInvitationId: row.socialInvitationId,
    socialInvitationRevision: row.socialInvitationRevision,
    socialConversationId: row.socialConversationId,
  };
}

async function advanceSocialSessionGoal(
  ctx: MutationCtx,
  goal: GoalRow,
  now: number,
) {
  if (!goal.socialConversationId) {
    await terminalizeGoal(ctx, goal, 'failed', 'social_invitation_session_failed', now);
    return { state: 'failed' as const, reasonCode: 'social_invitation_session_failed' };
  }
  const session = await ctx.db
    .query('conversationSessions')
    .withIndex('byConversation', (q) =>
      q.eq('worldId', goal.worldId).eq('conversationId', goal.socialConversationId!),
    )
    .unique();
  if (!session) {
    await terminalizeGoal(ctx, goal, 'failed', 'social_invitation_session_failed', now);
    return { state: 'failed' as const, reasonCode: 'social_invitation_session_failed' };
  }
  if (session.status === 'active' && session.expiresAt <= now) {
    await commitConversationExpiration(ctx, session, now);
    await terminalizeGoal(ctx, goal, 'failed', 'conversation_expired', now);
    return { state: 'failed' as const, reasonCode: 'conversation_expired' };
  }
  if (session.status === 'active') {
    return { state: 'active' as const, goal: personalGoalRowToActiveGoal(goal) };
  }
  if (session.status !== 'resolved') {
    const reasonCode = session.terminalReasonCode ?? `conversation_${session.status}`;
    await terminalizeGoal(ctx, goal, 'failed', reasonCode, now);
    return { state: 'failed' as const, reasonCode };
  }
  const terminalEvent = await latestConversationTerminalEvent(
    ctx,
    goal.worldId,
    session.conversationId,
  );
  if (!terminalEvent) {
    await terminalizeGoal(ctx, goal, 'failed', 'purpose_goal_terminal_event_missing', now);
    return { state: 'failed' as const, reasonCode: 'purpose_goal_terminal_event_missing' };
  }
  if (!goal.purposeIntent || !goal.purposeIntentDigest || !goal.socialInvitationId || !goal.socialInvitationRevision) {
    await terminalizeGoal(ctx, goal, 'failed', 'purpose_goal_causal_fence_mismatch', now);
    return { state: 'failed' as const, reasonCode: 'purpose_goal_causal_fence_mismatch' };
  }
  const terminalFacts = terminalEvent.facts as {
    conversationId?: string;
    terminalStatus?: string;
  } | undefined;
  const terminal = evaluateSocialSessionGoalTerminal({
    intent: goal.purposeIntent,
    intentDigest: goal.purposeIntentDigest,
    actorId: goal.actorId,
    invitationId: goal.socialInvitationId,
    invitationRevision: goal.socialInvitationRevision,
    conversation: {
      conversationId: session.conversationId,
      status: session.status,
      actorAId: session.actorAId,
      actorBId: session.actorBId,
      locationId: session.locationId,
    },
    terminalEvent: terminalFacts,
  });
  if (!terminal.ok) {
    await terminalizeGoal(ctx, goal, 'failed', terminal.reasonCode, now);
    return { state: 'failed' as const, reasonCode: terminal.reasonCode };
  }
  await ctx.db.patch(goal._id, {
    purposeActivityTerminalEventId: terminalEvent._id,
    updatedAt: now,
  });
  await terminalizeGoal(ctx, goal, 'completed', 'social_session_resolved', now);
  return { state: 'completed' as const, goalId: goal.goalId };
}

async function latestConversationTerminalEvent(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  conversationId: string,
) {
  for (const type of ['conversation_utterance', 'conversation_expired']) {
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('byType', (q) => q.eq('worldId', worldId).eq('type', type))
      .order('desc')
      .take(128);
    const event = events.find(
      (entry) =>
        (entry.facts as { conversationId?: string; terminalStatus?: string } | undefined)
          ?.conversationId === conversationId &&
        !!(entry.facts as { terminalStatus?: string } | undefined)?.terminalStatus,
    );
    if (event) return event;
  }
  return null;
}

function invitationIdFromIntent(intent: GoalRow['purposeIntent'] | undefined) {
  return intent?.sourceRef.startsWith('invitation:')
    ? intent.sourceRef.slice('invitation:'.length)
    : undefined;
}

function invitationRevisionFromIntent(intent: GoalRow['purposeIntent'] | undefined) {
  if (!intent?.sourceRef.startsWith('invitation:')) return undefined;
  const match = /^invitation:rev:(\d+):/.exec(intent.sourceRevision);
  const revision = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
}

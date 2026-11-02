import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, query } from '../_generated/server';
import { stableObservationDigest } from './lifeObservation';
import {
  LIFE_SOCIAL_REVIEW_VERSION,
  MAX_LIFE_SOCIAL_REVIEW_ACTORS,
  MAX_LIFE_SOCIAL_REVIEWS_PER_TICK,
  MAX_LIFE_SOCIAL_REVIEW_SOURCES,
  buildLifeSocialReview,
  isValidLifeSocialReview,
  sameLifeSocialReview,
  type LifeSocialReviewReceipt,
  type LifeSocialReviewSource,
} from './lifeSocialReviewLogic';
import {
  buildLifeRhythmWindow,
  sameLifeRhythmWindow,
  type LifeRhythmCadence,
} from './lifeRhythmWindowLogic';
import { MS_PER_GAME_HOUR, gameTimeAt } from './timeLogic';

const LIFE_SOCIAL_REVIEW_STATE_VERSION = 'taixu.life-social-review-state.v1' as const;
const OWNER_SCAN_LIMIT = MAX_LIFE_SOCIAL_REVIEW_SOURCES;

type Profile = Doc<'xianxiaProfiles'>;
type Window = Doc<'lifeRhythmWindows'>;
type ReviewState = Doc<'lifeSocialReviewStates'>;

type ReviewJob = {
  profile: Profile;
  state: ReviewState;
  window: Window;
  actorCreatedGameHour: number;
  actorDeceasedGameHour?: number;
};

/**
 * Projects bounded, actor-private factual reviews from already closed LWSE-3a
 * windows. The only writes are review receipts and their per-actor checkpoint.
 */
export const tickLifeSocialReviews = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const config = await ctx.db.query('xianxiaConfig').withIndex('byWorld', (q) =>
      q.eq('worldId', args.worldId)).unique();
    if (config?.clockStartedAt === undefined) return unavailableResult();
    const clockStartedAt = config.clockStartedAt;
    const [latestDay, latestWeek] = await Promise.all([
      latestWindow(ctx, args.worldId, 'daily', clockStartedAt),
      latestWindow(ctx, args.worldId, 'weekly', clockStartedAt),
    ]);
    if (!latestDay && !latestWeek) return noOpResult();

    const profiles = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
      q.eq('worldId', args.worldId)).take(MAX_LIFE_SOCIAL_REVIEW_ACTORS + 1);
    if (profiles.length > MAX_LIFE_SOCIAL_REVIEW_ACTORS) {
      throw new Error('life_social_review_actor_capacity_exceeded');
    }
    profiles.sort((left, right) => left.actorId.localeCompare(right.actorId));

    const jobs: ReviewJob[] = [];
    let totalDue = 0;
    for (const profile of profiles) {
      const actorCreatedGameHour = gameTimeAt(profile._creationTime, clockStartedAt).totalHours;
      const actorDeceasedGameHour = profile.deceasedAt === undefined
        ? undefined
        : gameTimeAt(profile.deceasedAt, clockStartedAt).totalHours;
      const state = await loadOrCreateState(ctx, {
        worldId: args.worldId,
        profile,
        actorCreatedGameHour,
        now: args.now,
      });
      for (const cadence of ['daily', 'weekly'] as const) {
        const latest = cadence === 'daily' ? latestDay : latestWeek;
        if (!latest) continue;
        await assertReviewCursorIntegrity(ctx, {
          worldId: args.worldId,
          profile,
          state,
          cadence,
          clockStartedAt,
        });
        const applied = cadence === 'daily' ? state.appliedDayIndex : state.appliedWeekIndex;
        const first = cadence === 'daily' ? state.firstDayIndex : state.firstWeekIndex;
        const duration = cadence === 'daily' ? 24 : 168;
        const deathBound = actorDeceasedGameHour === undefined
          ? latest.periodIndex
          : Math.floor(actorDeceasedGameHour / duration);
        const target = Math.min(latest.periodIndex, deathBound);
        const due = Math.max(0, target - applied);
        totalDue += due;
        if (due === 0) continue;
        const nextPeriod = Math.max(first, applied + 1);
        const window = await ctx.db.query('lifeRhythmWindows').withIndex('byCadencePeriod', (q) =>
          q.eq('worldId', args.worldId).eq('cadence', cadence).eq('periodIndex', nextPeriod))
          .unique();
        if (!window) throw new Error('life_social_review_invalid_window');
        jobs.push({ profile, state, window, actorCreatedGameHour, actorDeceasedGameHour });
      }
    }

    jobs.sort((left, right) =>
      left.window.windowEndGameHour - right.window.windowEndGameHour ||
      cadenceOrder(left.window.cadence) - cadenceOrder(right.window.cadence) ||
      left.profile.actorId.localeCompare(right.profile.actorId));
    const selected = jobs.slice(0, MAX_LIFE_SOCIAL_REVIEWS_PER_TICK);
    const stateUpdates = new Map<string, {
      state: ReviewState;
      appliedDayIndex: number;
      appliedWeekIndex: number;
      count: number;
    }>();
    let quietCount = 0;
    let factualCount = 0;
    let truncatedCount = 0;

    for (const job of selected) {
      const reviewId = `life-social-review:${job.window.windowId}:${job.profile.actorId}`;
      const duplicate = await ctx.db.query('lifeSocialReviews').withIndex('byReview', (q) =>
        q.eq('worldId', args.worldId).eq('reviewId', reviewId)).take(2);
      if (duplicate.length > 1) throw new Error('life_social_review_duplicate');
      if (duplicate.length === 1) throw new Error('life_social_review_conflict');
      const loaded = await loadActorReviewSources(ctx, {
        worldId: args.worldId,
        actorId: job.profile.actorId,
        window: job.window,
        clockStartedAt,
      });
      const receipt = buildLifeSocialReview({
        actorId: job.profile.actorId,
        actorCreatedGameHour: job.actorCreatedGameHour,
        actorDeceasedGameHour: job.actorDeceasedGameHour,
        window: windowView(job.window),
        sources: loaded.sources,
        scanTruncated: loaded.scanTruncated,
      });
      await ctx.db.insert('lifeSocialReviews', {
        worldId: args.worldId,
        ...receipt,
        recordedAt: args.now,
      });
      if (receipt.status === 'quiet') quietCount += 1;
      else factualCount += 1;
      if (receipt.sourcesTruncated) truncatedCount += 1;
      const key = job.profile.actorId;
      const update = stateUpdates.get(key) ?? {
        state: job.state,
        appliedDayIndex: job.state.appliedDayIndex,
        appliedWeekIndex: job.state.appliedWeekIndex,
        count: 0,
      };
      if (job.window.cadence === 'daily') update.appliedDayIndex = job.window.periodIndex;
      else update.appliedWeekIndex = job.window.periodIndex;
      update.count += 1;
      stateUpdates.set(key, update);
    }
    for (const update of stateUpdates.values()) {
      await ctx.db.patch(update.state._id, {
        appliedDayIndex: update.appliedDayIndex,
        appliedWeekIndex: update.appliedWeekIndex,
        revision: update.state.revision + update.count,
        updatedAt: args.now,
      });
    }
    const createdReviewCount = selected.length;
    return {
      status: createdReviewCount > 0 ? 'advanced' as const : 'no_op' as const,
      contractVersion: LIFE_SOCIAL_REVIEW_VERSION,
      processed: createdReviewCount,
      createdReviewCount,
      quietCount,
      factualCount,
      truncatedCount,
      providerCalls: 0 as const,
      createdWorldActions: 0 as const,
      createdSocialCandidates: 0 as const,
      remainingReviews: Math.max(0, totalDue - createdReviewCount),
      caughtUp: totalDue === createdReviewCount,
    };
  },
});

export const getLifeSocialReviewState = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const [states, reviews] = await Promise.all([
      ctx.db.query('lifeSocialReviewStates').withIndex('byActor', (q) =>
        q.eq('worldId', args.worldId)).take(MAX_LIFE_SOCIAL_REVIEW_ACTORS + 1),
      ctx.db.query('lifeSocialReviews').withIndex('byRecordedAt', (q) =>
        q.eq('worldId', args.worldId)).order('desc').take(32),
    ]);
    return { contractVersion: LIFE_SOCIAL_REVIEW_VERSION, states, recentReviews: reviews };
  },
});

async function loadOrCreateState(
  ctx: MutationCtx,
  input: {
    worldId: Id<'worlds'>;
    profile: Profile;
    actorCreatedGameHour: number;
    now: number;
  },
) {
  const firstDayIndex = Math.floor(input.actorCreatedGameHour / 24) + 1;
  const firstWeekIndex = Math.floor(input.actorCreatedGameHour / 168) + 1;
  const matches = await ctx.db.query('lifeSocialReviewStates').withIndex('byActor', (q) =>
    q.eq('worldId', input.worldId).eq('actorId', input.profile.actorId)).take(2);
  if (matches.length > 1) throw new Error('life_social_review_duplicate');
  const existing = matches[0];
  if (existing) {
    if (
      existing.contractVersion !== LIFE_SOCIAL_REVIEW_STATE_VERSION ||
      existing.actorCreatedGameHour !== input.actorCreatedGameHour ||
      existing.firstDayIndex !== firstDayIndex || existing.firstWeekIndex !== firstWeekIndex ||
      !Number.isSafeInteger(existing.revision) || existing.revision < 0
    ) throw new Error('life_social_review_actor_ineligible');
    return existing;
  }
  const stateId = await ctx.db.insert('lifeSocialReviewStates', {
    worldId: input.worldId,
    contractVersion: LIFE_SOCIAL_REVIEW_STATE_VERSION,
    actorId: input.profile.actorId,
    actorCreatedGameHour: input.actorCreatedGameHour,
    firstDayIndex,
    firstWeekIndex,
    appliedDayIndex: firstDayIndex - 1,
    appliedWeekIndex: firstWeekIndex - 1,
    revision: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const created = await ctx.db.get(stateId);
  if (!created) throw new Error('life_social_review_actor_ineligible');
  return created;
}

async function assertReviewCursorIntegrity(
  ctx: MutationCtx,
  input: {
    worldId: Id<'worlds'>;
    profile: Profile;
    state: ReviewState;
    cadence: LifeRhythmCadence;
    clockStartedAt: number;
  },
) {
  const applied = input.cadence === 'daily'
    ? input.state.appliedDayIndex
    : input.state.appliedWeekIndex;
  const first = input.cadence === 'daily' ? input.state.firstDayIndex : input.state.firstWeekIndex;
  if (!Number.isSafeInteger(applied) || applied < first - 1) {
    throw new Error('life_social_review_invalid_window');
  }
  const latest = await ctx.db.query('lifeSocialReviews').withIndex('byActorCadencePeriod', (q) =>
    q.eq('worldId', input.worldId).eq('actorId', input.profile.actorId)
      .eq('cadence', input.cadence)).order('desc').first();
  if (applied === first - 1) {
    if (latest) throw new Error('life_social_review_conflict');
    return;
  }
  if (!latest || latest.periodIndex !== applied) throw new Error('life_social_review_conflict');
  const duplicates = await ctx.db.query('lifeSocialReviews').withIndex('byActorCadencePeriod', (q) =>
    q.eq('worldId', input.worldId).eq('actorId', input.profile.actorId)
      .eq('cadence', input.cadence).eq('periodIndex', applied)).take(2);
  if (duplicates.length !== 1) throw new Error('life_social_review_duplicate');
  const window = await ctx.db.query('lifeRhythmWindows').withIndex('byCadencePeriod', (q) =>
    q.eq('worldId', input.worldId).eq('cadence', input.cadence).eq('periodIndex', applied))
    .unique();
  if (!window || window.clockStartedAt !== input.clockStartedAt) {
    throw new Error('life_social_review_window_conflict');
  }
  const receipt = rowAsReceipt(duplicates[0]);
  const rebuilt = buildLifeSocialReview({
    actorId: input.profile.actorId,
    actorCreatedGameHour: input.state.actorCreatedGameHour,
    window: windowView(window),
    sources: receipt.sourceRefs,
    scanTruncated: receipt.sourcesTruncated,
  });
  if (!isValidLifeSocialReview(receipt) || !sameLifeSocialReview(receipt, rebuilt)) {
    throw new Error('life_social_review_conflict');
  }
}

async function latestWindow(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  cadence: LifeRhythmCadence,
  clockStartedAt: number,
) {
  const latest = await ctx.db.query('lifeRhythmWindows').withIndex('byCadencePeriod', (q) =>
    q.eq('worldId', worldId).eq('cadence', cadence)).order('desc').first();
  if (!latest) return null;
  const expected = buildLifeRhythmWindow(cadence, latest.periodIndex, clockStartedAt);
  if (!sameLifeRhythmWindow({
    windowId: latest.windowId,
    cadence: latest.cadence,
    periodIndex: latest.periodIndex,
    windowStartGameHour: latest.windowStartGameHour,
    windowEndGameHour: latest.windowEndGameHour,
    clockStartedAt: latest.clockStartedAt,
    status: latest.status,
    providerCalls: latest.providerCalls,
    createdWorldActions: latest.createdWorldActions,
    createdSocialCandidates: latest.createdSocialCandidates,
    windowDigest: latest.windowDigest,
  }, expected)) throw new Error('life_social_review_window_conflict');
  return latest;
}

async function loadActorReviewSources(
  ctx: MutationCtx,
  input: {
    worldId: Id<'worlds'>;
    actorId: string;
    window: Window;
    clockStartedAt: number;
  },
) {
  const sources: LifeSocialReviewSource[] = [];
  let scanTruncated = false;
  const startAt = input.clockStartedAt + input.window.windowStartGameHour * MS_PER_GAME_HOUR;
  const endAt = input.clockStartedAt + input.window.windowEndGameHour * MS_PER_GAME_HOUR;
  const addRows = <T>(rows: T[], convert: (row: T) => LifeSocialReviewSource | undefined) => {
    if (rows.length > OWNER_SCAN_LIMIT) scanTruncated = true;
    for (const row of rows.slice(0, OWNER_SCAN_LIMIT)) {
      const converted = convert(row);
      if (converted) sources.push(converted);
    }
  };

  if (input.window.cadence === 'daily') {
    const activeGoals = await ctx.db.query('personalGoals').withIndex('byActorStatus', (q) =>
      q.eq('worldId', input.worldId).eq('actorId', input.actorId).eq('status', 'active'))
      .order('desc').take(2);
    if (activeGoals.length > 1) throw new Error('life_social_review_source_conflict');
    addRows(activeGoals, (goal) => goal.createdAt < endAt
      ? sourceFromPersonalGoal(goal, 'personal_goal_open', input.clockStartedAt)
      : undefined);
    const terminalGoals = await ctx.db.query('personalGoals').withIndex(
      'byActorTerminalGameHour', (q) => q.eq('worldId', input.worldId)
        .eq('actorId', input.actorId)
        .gte('terminalGameHour', input.window.windowStartGameHour)
        .lt('terminalGameHour', input.window.windowEndGameHour),
    ).take(OWNER_SCAN_LIMIT + 1);
    addRows(terminalGoals.filter((goal) => !['active', 'idle'].includes(goal.status)), (goal) =>
      sourceFromPersonalGoal(goal, 'personal_goal_terminal', input.clockStartedAt));
    for (const status of ['completed', 'interrupted', 'blocked'] as const) {
      const executions = await ctx.db.query('actionExecutions').withIndex('byActorStatus', (q) =>
        q.eq('worldId', input.worldId).eq('actorId', input.actorId).eq('status', status)
          .gte('updatedAt', startAt).lt('updatedAt', endAt))
        .take(OWNER_SCAN_LIMIT + 1);
      if (executions.length > OWNER_SCAN_LIMIT) scanTruncated = true;
      for (const execution of executions.slice(0, OWNER_SCAN_LIMIT)) {
        if (execution.terminalAt === undefined || execution.terminalAt < startAt ||
          execution.terminalAt >= endAt || !execution.terminalEventId) continue;
        const [event, action] = await Promise.all([
          ctx.db.get(execution.terminalEventId),
          ctx.db.get(execution.actionRecordId),
        ]);
        if (!event || !action || event.actionId !== execution.actionRecordId ||
          action.actorId !== execution.actorId || !event.actorIds.includes(execution.actorId)) {
          throw new Error('life_social_review_source_invalid');
        }
        sources.push(sourceFromExecution(execution, input.clockStartedAt));
      }
    }
    const duties = await loadActorDuties(ctx, input, startAt, endAt, true);
    sources.push(...duties.sources);
    scanTruncated ||= duties.scanTruncated;
  } else {
    const sessions = await loadActorSocialSessions(ctx, input, startAt, endAt);
    sources.push(...sessions.sources);
    scanTruncated ||= sessions.scanTruncated;
    const groups = await loadActorGroupSessions(ctx, input, startAt, endAt);
    sources.push(...groups.sources);
    scanTruncated ||= groups.scanTruncated;
    const duties = await loadActorDuties(ctx, input, startAt, endAt, true);
    sources.push(...duties.sources);
    scanTruncated ||= duties.scanTruncated;
    const consequences = await loadActorConsequences(ctx, input);
    sources.push(...consequences.sources);
    scanTruncated ||= consequences.scanTruncated;
  }
  return { sources, scanTruncated };
}

async function loadActorDuties(
  ctx: MutationCtx,
  input: { worldId: Id<'worlds'>; actorId: string; window: Window; clockStartedAt: number },
  startAt: number,
  endAt: number,
  includeOpen: boolean,
) {
  const sources: LifeSocialReviewSource[] = [];
  let scanTruncated = false;
  const add = (rows: Doc<'groupCommitments'>[], open: boolean) => {
    if (rows.length > OWNER_SCAN_LIMIT) scanTruncated = true;
    for (const row of rows.slice(0, OWNER_SCAN_LIMIT)) {
      if (open && row.createdAt >= endAt) continue;
      if (!open && (row.terminalAt === undefined || row.terminalAt < startAt || row.terminalAt >= endAt)) continue;
      sources.push(sourceFromDuty(row, open ? 'group_duty_open' : 'group_duty_terminal', input.clockStartedAt));
    }
  };
  if (includeOpen) {
    for (const index of ['byDonorStatus', 'byRecipientStatus'] as const) {
      const rows = await ctx.db.query('groupCommitments').withIndex(index, (q) =>
        q.eq('worldId', input.worldId)
          .eq(index === 'byDonorStatus' ? 'donorActorId' : 'recipientActorId', input.actorId)
          .eq('status', 'pending')).order('desc').take(OWNER_SCAN_LIMIT + 1);
      add(rows, true);
    }
  }
  for (const status of ['fulfilled', 'breached', 'invalidated'] as const) {
    for (const index of ['byDonorStatus', 'byRecipientStatus'] as const) {
      const rows = await ctx.db.query('groupCommitments').withIndex(index, (q) =>
        q.eq('worldId', input.worldId)
          .eq(index === 'byDonorStatus' ? 'donorActorId' : 'recipientActorId', input.actorId)
          .eq('status', status).gte('updatedAt', startAt).lt('updatedAt', endAt))
        .take(OWNER_SCAN_LIMIT + 1);
      add(rows, false);
    }
  }
  return { sources, scanTruncated };
}

async function loadActorSocialSessions(
  ctx: MutationCtx,
  input: { worldId: Id<'worlds'>; actorId: string; clockStartedAt: number },
  startAt: number,
  endAt: number,
) {
  const sources: LifeSocialReviewSource[] = [];
  let scanTruncated = false;
  for (const status of ['resolved', 'cancelled', 'expired'] as const) {
    for (const index of ['byActorAStatus', 'byActorBStatus'] as const) {
      const rows = await ctx.db.query('conversationSessions').withIndex(index, (q) =>
        q.eq('worldId', input.worldId)
          .eq(index === 'byActorAStatus' ? 'actorAId' : 'actorBId', input.actorId)
          .eq('status', status).gte('updatedAt', startAt).lt('updatedAt', endAt))
        .take(OWNER_SCAN_LIMIT + 1);
      if (rows.length > OWNER_SCAN_LIMIT) scanTruncated = true;
      for (const row of rows.slice(0, OWNER_SCAN_LIMIT)) {
        if (!row.socialOutcomeId || row.terminalAt === undefined ||
          row.terminalAt < startAt || row.terminalAt >= endAt) continue;
        const outcome = await ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
          q.eq('worldId', input.worldId).eq('outcomeId', row.socialOutcomeId!)).unique();
        if (!outcome || outcome.conversationId !== row.conversationId ||
          !['resolved', 'failed', 'cancelled', 'expired'].includes(outcome.status) ||
          ![outcome.actorId, ...outcome.targetActorIds].includes(input.actorId)) {
          throw new Error('life_social_review_source_invalid');
        }
        sources.push(sourceFromSocialSession(row, outcome, input.clockStartedAt));
      }
    }
  }
  return { sources, scanTruncated };
}

async function loadActorGroupSessions(
  ctx: MutationCtx,
  input: { worldId: Id<'worlds'>; actorId: string; clockStartedAt: number },
  startAt: number,
  endAt: number,
) {
  const sources: LifeSocialReviewSource[] = [];
  let scanTruncated = false;
  for (const status of ['resolved', 'cancelled', 'expired'] as const) {
    const memberships = await ctx.db.query('groupConversationMemberships').withIndex(
      'byActorStatus', (q) => q.eq('worldId', input.worldId).eq('actorId', input.actorId)
        .eq('status', status).gte('updatedAt', startAt).lt('updatedAt', endAt),
    ).take(OWNER_SCAN_LIMIT + 1);
    if (memberships.length > OWNER_SCAN_LIMIT) scanTruncated = true;
    for (const membership of memberships.slice(0, OWNER_SCAN_LIMIT)) {
      if (membership.terminalAt === undefined || membership.terminalAt < startAt ||
        membership.terminalAt >= endAt) continue;
      const session = await ctx.db.query('groupConversationSessions').withIndex(
        'byGroupConversation', (q) => q.eq('worldId', input.worldId)
          .eq('groupConversationId', membership.groupConversationId),
      ).unique();
      if (!session || session.status !== membership.status || session.terminalAt !== membership.terminalAt) {
        throw new Error('life_social_review_source_invalid');
      }
      sources.push(sourceFromGroupSession(session, membership, input.clockStartedAt));
    }
  }
  return { sources, scanTruncated };
}

async function loadActorConsequences(
  ctx: MutationCtx,
  input: { worldId: Id<'worlds'>; actorId: string; window: Window },
) {
  const sources: LifeSocialReviewSource[] = [];
  let scanTruncated = false;
  const active = await ctx.db.query('socialConsequences').withIndex('bySubjectStatus', (q) =>
    q.eq('worldId', input.worldId).eq('subjectActorId', input.actorId).eq('status', 'active'))
    .order('desc').take(OWNER_SCAN_LIMIT + 1);
  if (active.length > OWNER_SCAN_LIMIT) scanTruncated = true;
  for (const row of active.slice(0, OWNER_SCAN_LIMIT)) {
    if (row.createdGameHour < input.window.windowEndGameHour) {
      sources.push(sourceFromConsequence(row, 'social_consequence_open'));
    }
  }
  for (const status of ['fulfilled', 'breached', 'expired', 'cancelled', 'superseded'] as const) {
    const rows = await ctx.db.query('socialConsequences').withIndex('bySubjectStatus', (q) =>
      q.eq('worldId', input.worldId).eq('subjectActorId', input.actorId).eq('status', status))
      .order('desc').take(OWNER_SCAN_LIMIT + 1);
    if (rows.length > OWNER_SCAN_LIMIT) scanTruncated = true;
    for (const row of rows.slice(0, OWNER_SCAN_LIMIT)) {
      if (row.terminalGameHour !== undefined &&
        row.terminalGameHour >= input.window.windowStartGameHour &&
        row.terminalGameHour < input.window.windowEndGameHour) {
        sources.push(sourceFromConsequence(row, 'social_consequence_terminal'));
      }
    }
  }
  return { sources, scanTruncated };
}

function sourceFromPersonalGoal(
  row: Doc<'personalGoals'>,
  kind: 'personal_goal_open' | 'personal_goal_terminal',
  clockStartedAt: number,
) {
  const occurredGameHour = kind === 'personal_goal_terminal'
    ? row.terminalGameHour ?? gameTimeAt(row.updatedAt, clockStartedAt).totalHours
    : row.startedGameHour ?? gameTimeAt(row.createdAt, clockStartedAt).totalHours;
  return makeSource({
    kind, sourceRef: `personal-goal:${row.goalId}`,
    sourceRevision: `goal:${row.revision}:${row.progressRevision}:${row.status}`,
    occurredGameHour, visibility: 'actor_private', subjectActorIds: [row.actorId],
    owner: {
      goalId: row.goalId, revision: row.revision, progressRevision: row.progressRevision,
      status: row.status, sourceRef: row.sourceRef, targetRef: row.targetRef,
      terminalReasonCode: row.terminalReasonCode,
    },
  });
}

function sourceFromExecution(row: Doc<'actionExecutions'>, clockStartedAt: number) {
  return makeSource({
    kind: 'action_terminal', sourceRef: `action-execution:${String(row._id)}`,
    sourceRevision: `execution:${row.revision}:${row.status}`,
    occurredGameHour: gameTimeAt(row.terminalAt!, clockStartedAt).totalHours,
    visibility: 'actor_private', subjectActorIds: [row.actorId],
    owner: {
      executionId: String(row._id), actionRecordId: String(row.actionRecordId),
      revision: row.revision, status: row.status, actionType: row.actionType,
      terminalEventId: String(row.terminalEventId), resultCode: row.resultCode,
      reasonCode: row.reasonCode,
    },
  });
}

export function sourceFromDuty(
  row: Doc<'groupCommitments'>,
  kind: 'group_duty_open' | 'group_duty_terminal',
  clockStartedAt: number,
) {
  return makeSource({
    kind, sourceRef: `group-commitment:${row.commitmentId}`,
    sourceRevision: `commitment:${row.status}:${row.updatedAt}`,
    occurredGameHour: gameTimeAt(
      kind === 'group_duty_terminal' ? row.terminalAt! : row.createdAt,
      clockStartedAt,
    ).totalHours,
    visibility: 'participants', subjectActorIds: [row.donorActorId, row.recipientActorId],
    owner: {
      commitmentId: row.commitmentId, proposalId: row.proposalId, status: row.status,
      donorActorId: row.donorActorId, recipientActorId: row.recipientActorId,
      approvedEventId: String(row.approvedEventId),
      settlementEventId: row.settlementEventId ? String(row.settlementEventId) : undefined,
      terminalReasonCode: row.terminalReasonCode,
    },
  });
}

function sourceFromSocialSession(
  row: Doc<'conversationSessions'>,
  outcome: Doc<'socialOutcomeReceipts'>,
  clockStartedAt: number,
) {
  return makeSource({
    kind: 'social_session_terminal', sourceRef: `social-session:${row.conversationId}`,
    sourceRevision: `session:${row.revision}:${row.status}`,
    occurredGameHour: gameTimeAt(row.terminalAt!, clockStartedAt).totalHours,
    visibility: 'participants', subjectActorIds: [row.actorAId, row.actorBId],
    owner: {
      conversationId: row.conversationId, revision: row.revision, status: row.status,
      socialOutcomeId: row.socialOutcomeId, socialOutcomeRevision: outcome.revision,
      socialOutcomeStatus: outcome.status, terminalReasonCode: row.terminalReasonCode,
    },
  });
}

function sourceFromGroupSession(
  row: Doc<'groupConversationSessions'>,
  membership: Doc<'groupConversationMemberships'>,
  clockStartedAt: number,
) {
  return makeSource({
    kind: 'group_session_terminal', sourceRef: `group-session:${row.groupConversationId}`,
    sourceRevision: `group-session:${row.revision}:${row.status}`,
    occurredGameHour: gameTimeAt(row.terminalAt!, clockStartedAt).totalHours,
    visibility: 'participants',
    subjectActorIds: [...row.participantActorIds, ...row.observerActorIds],
    owner: {
      groupConversationId: row.groupConversationId, revision: row.revision,
      status: row.status, terminalEventId: row.terminalEventId
        ? String(row.terminalEventId) : undefined,
      terminalReasonCode: row.terminalReasonCode, membershipRole: membership.role,
    },
  });
}

function sourceFromConsequence(
  row: Doc<'socialConsequences'>,
  kind: 'social_consequence_open' | 'social_consequence_terminal',
) {
  return makeSource({
    kind, sourceRef: `social-consequence:${row.consequenceId}`,
    sourceRevision: `consequence:${row.revision}:${row.status}`,
    occurredGameHour: kind === 'social_consequence_terminal'
      ? row.terminalGameHour! : row.createdGameHour,
    visibility: row.audience === 'private' ? 'actor_private' : 'participants',
    subjectActorIds: [row.subjectActorId],
    owner: {
      consequenceId: row.consequenceId, revision: row.revision, status: row.status,
      consequenceKind: row.kind, sourceOutcomeId: row.sourceOutcomeId,
      sourceOutcomeRevision: row.sourceOutcomeRevision,
      sourceActionId: String(row.sourceActionId), sourceEventId: String(row.sourceEventId),
      subjectActorId: row.subjectActorId, counterpartActorIds: row.counterpartActorIds,
      remainingProjectionBudget: row.remainingProjectionBudget,
      terminalReasonCode: row.terminalReasonCode,
    },
  });
}

function makeSource(input: Omit<LifeSocialReviewSource, 'sourceDigest'> & { owner: unknown }) {
  const { owner, ...source } = input;
  return { ...source, sourceDigest: stableObservationDigest({ ...source, owner }) };
}

export function rowAsReceipt(row: Doc<'lifeSocialReviews'>): LifeSocialReviewReceipt {
  return {
    contractVersion: row.contractVersion,
    reviewId: row.reviewId,
    actorId: row.actorId,
    windowId: row.windowId,
    windowDigest: row.windowDigest,
    cadence: row.cadence,
    periodIndex: row.periodIndex,
    windowStartGameHour: row.windowStartGameHour,
    windowEndGameHour: row.windowEndGameHour,
    status: row.status,
    sourceRefs: row.sourceRefs,
    sourceSetDigest: row.sourceSetDigest,
    sourcesTruncated: row.sourcesTruncated,
    providerCalls: row.providerCalls,
    createdWorldActions: row.createdWorldActions,
    createdSocialCandidates: row.createdSocialCandidates,
    createdRelationshipChanges: row.createdRelationshipChanges,
    createdMemories: row.createdMemories,
    reviewDigest: row.reviewDigest,
  };
}

function windowView(window: Window) {
  return {
    windowId: window.windowId,
    windowDigest: window.windowDigest,
    cadence: window.cadence,
    periodIndex: window.periodIndex,
    windowStartGameHour: window.windowStartGameHour,
    windowEndGameHour: window.windowEndGameHour,
  };
}

function cadenceOrder(cadence: LifeRhythmCadence) {
  return cadence === 'daily' ? 0 : 1;
}

function unavailableResult() {
  return {
    status: 'unavailable' as const,
    reasonCode: 'life_social_review_clock_unavailable' as const,
    contractVersion: LIFE_SOCIAL_REVIEW_VERSION,
    processed: 0,
    createdReviewCount: 0,
    quietCount: 0,
    factualCount: 0,
    truncatedCount: 0,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdSocialCandidates: 0 as const,
    remainingReviews: 0,
    caughtUp: true,
  };
}

function noOpResult() {
  return { ...unavailableResult(), status: 'no_op' as const, reasonCode: undefined };
}

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('life_social_review_invalid_time');
}

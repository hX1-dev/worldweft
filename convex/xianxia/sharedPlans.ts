import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internalMutation, internalQuery, query } from '../_generated/server';
import { readGameHour } from './config';
import { normalizeFatigue } from './fatigueLogic';
import { isActorDeceased, isActorIncapacitated } from './lifeStateLogic';
import { stableObservationDigest } from './lifeObservation';
import { rowAsReceipt, sourceFromDuty } from './lifeSocialReviews';
import { roleAllows } from './policy';
import { availableResourceStock, resourceAccessAllowed } from './resourceNodeLogic';
import {
  MAX_SHARED_PLANS_PER_TICK,
  MAX_SHARED_PLAN_RECONCILE,
  buildSharedGatherPlanProposal,
  buildSharedStudyRestPlanProposal,
  isValidSharedGuardHandoffPlan,
  isValidSharedGatherPlan,
  isValidSharedStudyRestPlan,
  reconcileSharedGatherPlan,
  reconcileSharedStudyRestPlan,
  respondToSharedPlan,
  sharedPlanSourceRevision,
  type SharedGatherPlanReceipt,
  type SharedGuardHandoffPlanReceipt,
  type SharedStudyRestPlanReceipt,
  type SharedPlanReceipt,
  type SharedPlanParticipantGoalFacts,
  type SharedPlanParticipantRuntimeSource,
} from './sharedPlanLogic';
import { isSocialActorBusy } from './socialInvitations';
import { admitGuardHandoffOwner } from './guardHandoffOwnerAdmissionLogic';

type ReadCtx = MutationCtx | QueryCtx;
type PlanRow = Doc<'sharedPlans'>;

const NONTERMINAL_STATUSES = ['proposed', 'scheduled', 'active'] as const;

export const tickSharedPlans = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
    const reconciled = await reconcileExistingPlans(ctx, args.worldId, nowGameHour, args.now);
    const created = await proposeFromLatestReviews(ctx, args.worldId, nowGameHour, args.now);
    return {
      contractVersion: 'taixu.shared-plan.v1' as const,
      reconciled,
      created,
      providerCalls: 0 as const,
      createdWorldActions: 0 as const,
    };
  },
});

export const respondSharedPlan = internalMutation({
  args: {
    worldId: v.id('worlds'),
    planId: v.string(),
    actorId: v.string(),
    expectedRevision: v.number(),
    response: v.union(v.literal('accept'), v.literal('decline')),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const rows = await ctx.db.query('sharedPlans').withIndex('byPlan', (q) =>
      q.eq('worldId', args.worldId).eq('planId', args.planId)).take(2);
    if (rows.length !== 1) return { ok: false as const, reasonCode: 'shared_plan_not_found' };
    const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
    const plan = sharedPlanRowToReceipt(rows[0]);
    if (plan.kind === 'guard_handoff' && !await sharedPlanSourceCurrent(ctx, args.worldId, plan)) {
      return { ok: false as const, reasonCode: 'shared_plan_source_stale' };
    }
    const transition = respondToSharedPlan({
      plan,
      actorId: args.actorId,
      expectedRevision: args.expectedRevision,
      response: args.response,
      nowGameHour,
      now: args.now,
    });
    if (!transition.ok) return transition;
    await ctx.db.patch(rows[0]._id, receiptPatch(transition.plan));
    return { ok: true as const, plan: transition.plan };
  },
});

export const reconcileSharedPlansNow = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
    return await reconcileExistingPlans(ctx, args.worldId, nowGameHour, args.now);
  },
});

export const getSharedPlanState = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('sharedPlans').withIndex('byStatus', (q) =>
      q.eq('worldId', args.worldId)).order('desc').take(32);
    return rows.map(sharedPlanRowToReceipt);
  },
});

export const projectGuardHandoffOwnerAdmission = internalQuery({
  args: { worldId: v.id('worlds'), planId: v.string(), assignmentId: v.string(), participantActorId: v.string(), nowGameHour: v.number() },
  handler: async (ctx, args) => {
    const [owners, assignments] = await Promise.all([
      ctx.db.query('sharedPlans').withIndex('byPlan', (q) => q.eq('worldId', args.worldId).eq('planId', args.planId)).take(2),
      ctx.db.query('guardDutyAssignments').withIndex('byAssignment', (q) => q.eq('worldId', args.worldId).eq('assignmentId', args.assignmentId)).take(2),
    ]);
    return admitGuardHandoffOwner({
      worldId: args.worldId, planId: args.planId, assignmentId: args.assignmentId, participantActorId: args.participantActorId, nowGameHour: args.nowGameHour,
      owners: owners.filter((row) => row.kind === 'guard_handoff').map((row) => ({ worldId: row.worldId, plan: sharedPlanRowToReceipt(row) as SharedGuardHandoffPlanReceipt })),
      records: assignments.map(guardDutyAssignmentRowAsOwnerRecord),
    });
  },
});


export async function loadActorSharedPlanSources(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
): Promise<SharedPlanParticipantRuntimeSource[]> {
  const rows: PlanRow[] = [];
  for (const status of ['scheduled', 'active'] as const) {
    const [proposed, invited] = await Promise.all([
      ctx.db.query('sharedPlans').withIndex('byProposerStatus', (q) =>
        q.eq('worldId', worldId).eq('proposerActorId', actorId).eq('status', status))
        .order('desc').take(4),
      ctx.db.query('sharedPlans').withIndex('byInviteeStatus', (q) =>
        q.eq('worldId', worldId).eq('inviteeActorId', actorId).eq('status', status))
        .order('desc').take(4),
    ]);
    rows.push(...proposed, ...invited);
  }
  const byId = new Map(rows.map((row) => [row.planId, row]));
  const sources: SharedPlanParticipantRuntimeSource[] = [];
  for (const row of [...byId.values()].sort((left, right) => left.planId.localeCompare(right.planId))) {
    const plan = sharedPlanRowToReceipt(row);
    if (plan.kind === 'guard_handoff') continue;
    const participant = plan.participants.find((entry) => entry.actorId === actorId);
    if (!participant || !['accepted', 'goal_active'].includes(participant.status)) continue;
    if (plan.kind === 'shared_study' && actorId !== plan.learnerActorId) continue;
    const profile = await loadProfile(ctx, worldId, actorId);
    const [sourceCurrent, busy] = await Promise.all([
      sharedPlanSourceCurrent(ctx, worldId, plan),
      isSocialActorBusy(ctx, worldId, actorId, now),
    ]);
    if (plan.kind === 'shared_gather') {
      const [resource, reservations] = await Promise.all([
        loadResource(ctx, worldId, plan.resourceNodeId),
        activeResourceReservations(ctx, worldId, plan.resourceNodeId),
      ]);
      sources.push({
        plan, sourceCurrent,
        actorAliveAndCapable: Boolean(profile && actorAliveAndCapable(profile)), actorBusy: busy,
        resourceAvailable: resource ? availableResourceStock(resource.stock, reservations) : 0,
        resourceAccess: Boolean(resource && resourceAccessAllowed(resource, actorId)),
      });
      continue;
    }
    const counterpartId = actorId === plan.proposerActorId ? plan.inviteeActorId : plan.proposerActorId;
    const [counterpart, counterpartBusy, location] = await Promise.all([
      loadProfile(ctx, worldId, counterpartId),
      isSocialActorBusy(ctx, worldId, counterpartId, now),
      ctx.db.query('locations').withIndex('byLocationId', (q) =>
        q.eq('worldId', worldId).eq('locationId', plan.locationId)).unique(),
    ]);
    const actionType = plan.kind === 'shared_study' ? 'request_teaching' : 'rest';
    sources.push({
      plan, sourceCurrent,
      actorAliveAndCapable: Boolean(profile && actorAliveAndCapable(profile)), actorBusy: busy,
      actionAllowed: Boolean(profile && roleAllows(profile.role, actionType) && location?.allowedActions.includes(actionType)),
      actorFatigue: normalizeFatigue(profile?.fatigue),
      counterpartAliveAndCapable: Boolean(counterpart && actorAliveAndCapable(counterpart)),
      counterpartBusy,
      counterpartAtLocation: Boolean(counterpart && counterpart.currentLocationId === plan.locationId &&
        (counterpart.mapId ?? 'world') === plan.mapId),
    });
  }
  return sources;
}

async function proposeFromLatestReviews(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  nowGameHour: number,
  now: number,
) {
  const reviews = await ctx.db.query('lifeSocialReviews').withIndex('byRecordedAt', (q) =>
    q.eq('worldId', worldId)).order('desc').take(64);
  const eligible = reviews
    .filter((row) => row.cadence === 'weekly' && row.status === 'factual' && !row.sourcesTruncated)
    .sort((left, right) =>
      right.periodIndex - left.periodIndex || left.actorId.localeCompare(right.actorId));
  let created = 0;
  for (const row of eligible) {
    if (created >= MAX_SHARED_PLANS_PER_TICK) break;
    for (const source of row.sourceRefs.filter((entry) => entry.kind === 'group_duty_open')) {
      if (created >= MAX_SHARED_PLANS_PER_TICK) break;
      const duplicate = await ctx.db.query('sharedPlans').withIndex('bySourceReview', (q) =>
        q.eq('worldId', worldId).eq('sourceReviewId', row.reviewId).eq('sourceRef', source.sourceRef))
        .take(2);
      if (duplicate.length > 1) throw new Error('shared_plan_duplicate');
      if (duplicate.length === 1) continue;
      const commitment = await loadCommitmentBySource(ctx, worldId, source.sourceRef);
      if (!commitment || commitment.status !== 'pending' || commitment.donorActorId !== row.actorId) continue;
      if (await actorHasNonterminalPlan(ctx, worldId, commitment.donorActorId) ||
        await actorHasNonterminalPlan(ctx, worldId, commitment.recipientActorId)) continue;
      const [proposer, invitee] = await Promise.all([
        loadProfile(ctx, worldId, commitment.donorActorId),
        loadProfile(ctx, worldId, commitment.recipientActorId),
      ]);
      if (!proposer || !invitee || (proposer.mapId ?? 'world') !== (invitee.mapId ?? 'world')) continue;
      const clock = await ctx.db.query('xianxiaConfig').withIndex('byWorld', (q) =>
        q.eq('worldId', worldId)).unique();
      if (clock?.clockStartedAt === undefined) continue;
      const latestOwnerSource = sourceFromDuty(commitment, 'group_duty_open', clock.clockStartedAt);
      // P9a: profile role/current location and a duty candidate are not a
      // current guard-duty/home receipt. Guard handoff proposals remain zero
      // until a later authoritative owner exists.
      const commonLocation = proposer.currentLocationId && proposer.currentLocationId === invitee.currentLocationId
        ? await ctx.db.query('locations').withIndex('byLocationId', (q) =>
          q.eq('worldId', worldId).eq('locationId', proposer.currentLocationId!)).unique()
        : null;
      if (commonLocation && normalizeFatigue(proposer.fatigue) >= 40 && normalizeFatigue(invitee.fatigue) >= 40 &&
        commonLocation.allowedActions.includes('rest')) {
        const built = buildSharedStudyRestPlanProposal({
          kind: 'shared_rest', review: rowAsReceipt(row), reviewSource: source, latestOwnerSource,
          commitment,
          proposer: await studyRestActorFacts(ctx, worldId, proposer, 'rest', now),
          invitee: await studyRestActorFacts(ctx, worldId, invitee, 'rest', now),
          location: { mapId: proposer.mapId ?? 'world', locationId: commonLocation.locationId, actionAllowed: true },
          nowGameHour, now,
        });
        if (built.ok) {
          await ctx.db.insert('sharedPlans', { worldId, ...built.plan });
          created += 1;
          continue;
        }
      }
      const node = await chooseSharedGatherNode(ctx, worldId, proposer, invitee, now);
      if (node) {
        const location = await ctx.db.query('locations').withIndex('byLocationId', (q) =>
          q.eq('worldId', worldId).eq('locationId', node.locationId)).unique();
        if (location) {
          const built = buildSharedGatherPlanProposal({
            review: rowAsReceipt(row), reviewSource: source, latestOwnerSource, commitment,
            proposer: await actorFacts(ctx, worldId, proposer, node.itemId, now),
            invitee: await actorFacts(ctx, worldId, invitee, node.itemId, now),
            resource: {
              resourceNodeId: node.resourceNodeId, sourceRevision: resourceRevision(node), mapId: node.mapId,
              locationId: node.locationId, itemId: node.itemId,
              available: availableResourceStock(node.stock, await activeResourceReservations(ctx, worldId, node.resourceNodeId)),
              gatherAllowed: location.allowedActions.includes('gather'),
              proposerAccess: resourceAccessAllowed(node, proposer.actorId),
              inviteeAccess: resourceAccessAllowed(node, invitee.actorId),
            }, nowGameHour, now,
          });
          if (built.ok) {
            await ctx.db.insert('sharedPlans', { worldId, ...built.plan });
            created += 1;
            continue;
          }
        }
      }
      if (commonLocation?.allowedActions.includes('request_teaching')) {
        const built = buildSharedStudyRestPlanProposal({
          kind: 'shared_study', review: rowAsReceipt(row), reviewSource: source, latestOwnerSource,
          commitment,
          proposer: await studyRestActorFacts(ctx, worldId, proposer, 'request_teaching', now),
          invitee: await studyRestActorFacts(ctx, worldId, invitee, 'request_teaching', now),
          location: { mapId: proposer.mapId ?? 'world', locationId: commonLocation.locationId, actionAllowed: true },
          nowGameHour, now,
        });
        if (built.ok) {
          await ctx.db.insert('sharedPlans', { worldId, ...built.plan });
          created += 1;
        }
      }
    }
  }
  return created;
}

async function reconcileExistingPlans(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  nowGameHour: number,
  now: number,
) {
  const rows: PlanRow[] = [];
  for (const status of NONTERMINAL_STATUSES) {
    rows.push(...await ctx.db.query('sharedPlans').withIndex('byStatus', (q) =>
      q.eq('worldId', worldId).eq('status', status)).order('asc').take(MAX_SHARED_PLAN_RECONCILE));
  }
  rows.sort((left, right) => left.updatedAt - right.updatedAt || left.planId.localeCompare(right.planId));
  let changed = 0;
  for (const row of rows.slice(0, MAX_SHARED_PLAN_RECONCILE)) {
    const plan = sharedPlanRowToReceipt(row);
    if (plan.kind === 'guard_handoff') continue;
    const sourceCurrent = await sharedPlanSourceCurrent(ctx, worldId, plan);
    const participantGoals = await Promise.all(plan.participants.map((participant) =>
      loadParticipantGoalFacts(ctx, worldId, plan, participant.actorId)));
    const result = plan.kind === 'shared_gather'
      ? reconcileSharedGatherPlan({
          plan, sourceCurrent,
          resourceFailureReasonCode: await sharedPlanResourceFailureReason(ctx, worldId, plan),
          nowGameHour, now, participantGoals,
        })
      : reconcileSharedStudyRestPlan({
          plan, sourceCurrent,
          permissionFailureReasonCode: await sharedPlanActivityFailureReason(ctx, worldId, plan, now),
          nowGameHour, now, participantGoals,
        });
    if (!result.changed) continue;
    await ctx.db.patch(row._id, receiptPatch(result.plan));
    changed += 1;
  }
  return changed;
}

async function sharedPlanActivityFailureReason(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  plan: SharedStudyRestPlanReceipt,
  now: number,
) {
  const location = await ctx.db.query('locations').withIndex('byLocationId', (q) =>
    q.eq('worldId', worldId).eq('locationId', plan.locationId)).unique();
  const actionType = plan.kind === 'shared_study' ? 'request_teaching' : 'rest';
  if (!location || !location.allowedActions.includes(actionType)) return 'shared_plan_permission_revoked';
  if (plan.kind === 'shared_study') {
    const teacher = await loadProfile(ctx, worldId, plan.teacherActorId);
    if (!teacher || !actorAliveAndCapable(teacher) || await isSocialActorBusy(ctx, worldId, teacher.actorId, now)) {
      return 'shared_plan_teacher_unavailable';
    }
  }
  return undefined;
}

async function sharedPlanResourceFailureReason(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  plan: SharedGatherPlanReceipt,
) {
  const resource = await loadResource(ctx, worldId, plan.resourceNodeId);
  if (!resource) return 'shared_plan_resource_missing';
  const unfinished = plan.participants.filter((participant) => participant.status !== 'completed');
  if (unfinished.some((participant) => !resourceAccessAllowed(resource, participant.actorId))) {
    return 'shared_plan_resource_access_revoked';
  }
  return undefined;
}

async function sharedPlanSourceCurrent(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  plan: SharedPlanReceipt,
) {
  if (plan.kind === 'shared_gather' && !isValidSharedGatherPlan(plan)) return false;
  if (plan.kind === 'guard_handoff' && !isValidSharedGuardHandoffPlan(plan)) return false;
  if ((plan.kind === 'shared_study' || plan.kind === 'shared_rest') && !isValidSharedStudyRestPlan(plan)) return false;
  const [commitment, review, config] = await Promise.all([
    ctx.db.query('groupCommitments').withIndex('byCommitment', (q) =>
      q.eq('worldId', worldId).eq('commitmentId', plan.sourceCommitmentId)).first(),
    ctx.db.query('lifeSocialReviews').withIndex('byReview', (q) =>
      q.eq('worldId', worldId).eq('reviewId', plan.sourceReviewId)).unique(),
    ctx.db.query('xianxiaConfig').withIndex('byWorld', (q) => q.eq('worldId', worldId)).unique(),
  ]);
  if (!commitment || commitment.status !== 'pending' || !review ||
    review.reviewDigest !== plan.sourceReviewDigest || config?.clockStartedAt === undefined) return false;
  const latest = sourceFromDuty(commitment, 'group_duty_open', config.clockStartedAt);
  return latest.sourceRef === plan.sourceRef && latest.sourceRevision === plan.sourceRevision &&
    latest.sourceDigest === plan.sourceDigest && review.sourceRefs.some((source) =>
      stableObservationDigest(source) === stableObservationDigest(latest));
}

async function loadParticipantGoalFacts(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  plan: SharedGatherPlanReceipt | SharedStudyRestPlanReceipt,
  actorId: string,
): Promise<SharedPlanParticipantGoalFacts> {
  const rows = await ctx.db.query('personalGoals').withIndex('byActorRevision', (q) =>
    q.eq('worldId', worldId).eq('actorId', actorId)).order('desc').take(32);
  const sourceRef = `shared_plan:${plan.planId}`;
  const goal = rows.find((entry) => entry.purposeIntent?.sourceRef === sourceRef);
  if (!goal?.purposeIntent || !goal.purposeIntentDigest) return { actorId, status: 'missing' };
  const base = {
    actorId,
    sourceRef,
    sourceRevision: goal.purposeIntent.sourceRevision,
    intentDigest: goal.purposeIntentDigest,
    personalGoalId: goal.goalId,
    personalGoalRevision: goal.revision,
    terminalReasonCode: goal.terminalReasonCode,
  };
  if (goal.status === 'active') return { ...base, status: 'active' };
  if (goal.status !== 'completed') {
    return { ...base, status: goal.status === 'cancelled' ? 'cancelled' : 'failed' };
  }
  const execution = goal.purposeActivityExecutionId
    ? await ctx.db.get(goal.purposeActivityExecutionId)
    : null;
  const event = goal.purposeActivityTerminalEventId
    ? await ctx.db.get(goal.purposeActivityTerminalEventId)
    : null;
  const profile = await loadProfile(ctx, worldId, actorId);
  return {
    ...base,
    status: 'completed',
    actionType: execution?.actionType,
    actionRecordId: execution ? String(execution.actionRecordId) : undefined,
    actionExecutionId: execution ? String(execution._id) : undefined,
    terminalEventId: event ? String(event._id) : undefined,
    resourceNodeId: execution?.resourceNodeId,
    itemId: plan.kind === 'shared_gather' ? plan.itemId : undefined,
    inventoryQuantity: plan.kind === 'shared_gather'
      ? inventoryQuantity(profile?.inventory ?? [], plan.itemId)
      : undefined,
    fatigue: normalizeFatigue(profile?.fatigue),
    targetActorId: execution?.targetActorId,
    teachingTopic: execution?.teachingTopic,
  };
}

async function chooseSharedGatherNode(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  proposer: Doc<'xianxiaProfiles'>,
  invitee: Doc<'xianxiaProfiles'>,
  _now: number,
) {
  const mapId = proposer.mapId ?? 'world';
  const nodes = await ctx.db.query('resourceNodes').withIndex('byMap', (q) =>
    q.eq('worldId', worldId).eq('mapId', mapId)).take(32);
  for (const node of nodes.sort((left, right) => left.resourceNodeId.localeCompare(right.resourceNodeId))) {
    if (!resourceAccessAllowed(node, proposer.actorId) || !resourceAccessAllowed(node, invitee.actorId)) continue;
    const reservations = await activeResourceReservations(ctx, worldId, node.resourceNodeId);
    if (availableResourceStock(node.stock, reservations) >= 2) return node;
  }
  return null;
}

async function actorFacts(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  profile: Doc<'xianxiaProfiles'>,
  itemId: string,
  now: number,
) {
  return {
    actorId: profile.actorId,
    aliveAndCapable: actorAliveAndCapable(profile),
    busy: await isSocialActorBusy(ctx, worldId, profile.actorId, now),
    mapId: profile.mapId ?? 'world',
    currentLocationId: profile.currentLocationId,
    gatherAllowed: roleAllows(profile.role, 'gather'),
    itemQuantity: inventoryQuantity(profile.inventory ?? [], itemId),
  };
}

async function studyRestActorFacts(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  profile: Doc<'xianxiaProfiles'>,
  actionType: 'request_teaching' | 'rest',
  now: number,
) {
  return {
    actorId: profile.actorId,
    aliveAndCapable: actorAliveAndCapable(profile),
    busy: await isSocialActorBusy(ctx, worldId, profile.actorId, now),
    mapId: profile.mapId ?? 'world',
    currentLocationId: profile.currentLocationId,
    fatigue: normalizeFatigue(profile.fatigue),
    actionAllowed: roleAllows(profile.role, actionType),
  };
}

function actorAliveAndCapable(profile: Doc<'xianxiaProfiles'>) {
  return !isActorDeceased(profile) && !isActorIncapacitated(profile.health) &&
    normalizeFatigue(profile.fatigue) < 100;
}

async function actorHasNonterminalPlan(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  for (const status of NONTERMINAL_STATUSES) {
    const [proposer, invitee] = await Promise.all([
      ctx.db.query('sharedPlans').withIndex('byProposerStatus', (q) =>
        q.eq('worldId', worldId).eq('proposerActorId', actorId).eq('status', status)).first(),
      ctx.db.query('sharedPlans').withIndex('byInviteeStatus', (q) =>
        q.eq('worldId', worldId).eq('inviteeActorId', actorId).eq('status', status)).first(),
    ]);
    if (proposer || invitee) return true;
  }
  return false;
}

async function activeResourceReservations(
  ctx: ReadCtx,
  worldId: Id<'worlds'>,
  resourceNodeId: string,
) {
  let total = 0;
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const rows = await ctx.db.query('actionExecutions').withIndex('byResourceStatus', (q) =>
      q.eq('worldId', worldId).eq('resourceNodeId', resourceNodeId).eq('status', status)).take(64);
    total += rows.reduce((sum, row) => sum + (row.reservedQuantity ?? 0), 0);
  }
  return total;
}

async function loadProfile(ctx: ReadCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
    q.eq('worldId', worldId).eq('actorId', actorId)).unique();
}

async function loadResource(ctx: ReadCtx, worldId: Id<'worlds'>, resourceNodeId: string) {
  return await ctx.db.query('resourceNodes').withIndex('byNode', (q) =>
    q.eq('worldId', worldId).eq('resourceNodeId', resourceNodeId)).unique();
}

async function loadCommitmentBySource(ctx: ReadCtx, worldId: Id<'worlds'>, sourceRef: string) {
  if (!sourceRef.startsWith('group-commitment:')) return null;
  return await ctx.db.query('groupCommitments').withIndex('byCommitment', (q) =>
    q.eq('worldId', worldId).eq('commitmentId', sourceRef.slice('group-commitment:'.length))).first();
}

function resourceRevision(node: Doc<'resourceNodes'>) {
  return `resource:${stableObservationDigest({
    resourceNodeId: node.resourceNodeId,
    stock: node.stock,
    accessRule: node.accessRule,
    ownerActorId: node.ownerActorId,
    updatedAt: node.updatedAt,
  })}`;
}

function inventoryQuantity(items: readonly { itemId: string; qty: number }[], itemId: string) {
  return items.find((item) => item.itemId === itemId)?.qty ?? 0;
}

export function sharedPlanRowToReceipt(row: PlanRow): SharedPlanReceipt {
  if (row.kind === 'guard_handoff') {
    if (!row.handoffFacts || !row.handoffFactsDigest) throw new Error('guard_handoff_affordance_missing');
    return {
      contractVersion: row.contractVersion, planId: row.planId, planKey: row.planKey,
      revision: row.revision, kind: row.kind, status: row.status,
      proposerActorId: row.proposerActorId, inviteeActorId: row.inviteeActorId,
      sourceReviewId: row.sourceReviewId, sourceReviewDigest: row.sourceReviewDigest,
      sourceWindowId: row.sourceWindowId, sourceRef: row.sourceRef,
      sourceRevision: row.sourceRevision, sourceDigest: row.sourceDigest,
      sourceCommitmentId: row.sourceCommitmentId, mapId: row.mapId,
      locationId: row.locationId, handoffFacts: row.handoffFacts,
      handoffFactsDigest: row.handoffFactsDigest, participants: row.participants,
      scheduleRevision: row.scheduleRevision, scheduleDigest: row.scheduleDigest,
      expiresGameHour: row.expiresGameHour, terminalGameHour: row.terminalGameHour,
      terminalReasonCode: row.terminalReasonCode, providerCalls: row.providerCalls,
      createdWorldActions: row.createdWorldActions, createdAt: row.createdAt,
      updatedAt: row.updatedAt, planDigest: row.planDigest,
    } as SharedGuardHandoffPlanReceipt;
  }
  if (row.kind === 'shared_study' || row.kind === 'shared_rest') {
    if (row.kind === 'shared_study' && (!row.teachingTopic || !row.learnerActorId || !row.teacherActorId)) {
      throw new Error('shared_plan_study_fields_missing');
    }
    const common = {
      contractVersion: row.contractVersion, planId: row.planId, planKey: row.planKey,
      revision: row.revision, kind: row.kind, status: row.status,
      proposerActorId: row.proposerActorId, inviteeActorId: row.inviteeActorId,
      sourceReviewId: row.sourceReviewId, sourceReviewDigest: row.sourceReviewDigest,
      sourceWindowId: row.sourceWindowId, sourceRef: row.sourceRef,
      sourceRevision: row.sourceRevision, sourceDigest: row.sourceDigest,
      sourceCommitmentId: row.sourceCommitmentId, mapId: row.mapId, locationId: row.locationId,
      participants: row.participants, scheduleRevision: row.scheduleRevision,
      scheduleDigest: row.scheduleDigest, expiresGameHour: row.expiresGameHour,
      terminalGameHour: row.terminalGameHour, terminalReasonCode: row.terminalReasonCode,
      providerCalls: row.providerCalls, createdWorldActions: row.createdWorldActions,
      createdAt: row.createdAt, updatedAt: row.updatedAt, planDigest: row.planDigest,
    };
    return row.kind === 'shared_study'
      ? { ...common, kind: 'shared_study', teachingTopic: row.teachingTopic!, learnerActorId: row.learnerActorId!, teacherActorId: row.teacherActorId! }
      : { ...common, kind: 'shared_rest' };
  }
  if (!row.resourceNodeId || !row.resourceNodeRevision || !row.itemId) {
    throw new Error('shared_plan_gather_fields_missing');
  }
  return {
    contractVersion: row.contractVersion,
    planId: row.planId,
    planKey: row.planKey,
    revision: row.revision,
    kind: row.kind,
    status: row.status,
    proposerActorId: row.proposerActorId,
    inviteeActorId: row.inviteeActorId,
    sourceReviewId: row.sourceReviewId,
    sourceReviewDigest: row.sourceReviewDigest,
    sourceWindowId: row.sourceWindowId,
    sourceRef: row.sourceRef,
    sourceRevision: row.sourceRevision,
    sourceDigest: row.sourceDigest,
    sourceCommitmentId: row.sourceCommitmentId,
    resourceNodeId: row.resourceNodeId,
    resourceNodeRevision: row.resourceNodeRevision,
    mapId: row.mapId,
    locationId: row.locationId,
    itemId: row.itemId,
    participants: row.participants,
    scheduleRevision: row.scheduleRevision,
    scheduleDigest: row.scheduleDigest,
    expiresGameHour: row.expiresGameHour,
    terminalGameHour: row.terminalGameHour,
    terminalReasonCode: row.terminalReasonCode,
    providerCalls: row.providerCalls,
    createdWorldActions: row.createdWorldActions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    planDigest: row.planDigest,
  };
}

function guardDutyAssignmentRowAsOwnerRecord(row: Doc<'guardDutyAssignments'>) {
  return { ownerContractVersion: row.ownerContractVersion, contractVersion: row.contractVersion, worldId: row.worldId, assignmentId: row.assignmentId, assignmentRevision: row.assignmentRevision, actorId: row.actorId, status: row.status, role: row.role, homeZoneId: row.homeZoneId, dutyState: row.dutyState, mapId: row.mapId, currentLocationId: row.currentLocationId, aliveAndCapable: row.aliveAndCapable, busy: row.busy, validFromGameHour: row.validFromGameHour, validUntilGameHour: row.validUntilGameHour, authoritySourceRef: row.authoritySourceRef, authoritySourceRevision: row.authoritySourceRevision, authoritySourceDigest: row.authoritySourceDigest, assignmentDigest: row.assignmentDigest, admissionCommandDigest: row.admissionCommandDigest, authorization: { authorizationRef: row.authorizationRef, authorizationRevision: row.authorizationRevision, authorizationDigest: row.authorizationDigest }, revokedByCommandDigest: row.revokedByCommandDigest };
}


function receiptPatch(plan: SharedPlanReceipt) {
  return {
    revision: plan.revision,
    status: plan.status,
    participants: plan.participants,
    scheduleRevision: plan.scheduleRevision,
    scheduleDigest: plan.scheduleDigest,
    expiresGameHour: plan.expiresGameHour,
    terminalGameHour: plan.terminalGameHour,
    terminalReasonCode: plan.terminalReasonCode,
    updatedAt: plan.updatedAt,
    planDigest: plan.planDigest,
  };
}

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('shared_plan_time_invalid');
}

export { sharedPlanSourceRevision };

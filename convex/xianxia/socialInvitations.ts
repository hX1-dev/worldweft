import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { ACTIVE_ACTION_EXECUTION_STATUSES } from './actionExecutionContracts';
import { ownedHealingItemId } from './agentLogic';
import { MAX_HEALTH, isActorDeceased, isActorIncapacitated } from './lifeStateLogic';
import { stableObservationDigest } from './lifeObservation';
import { relationshipDimsAt } from './relationshipLogic';
import { requestRevision } from './questLogic';
import {
  SOCIAL_INVITATION_CAPACITY,
  SOCIAL_INVITATION_COOLDOWN_MS,
  SOCIAL_INVITATION_TTL_MS,
  SOCIAL_INVITATION_VERSION,
  createSocialInvitationReceipt,
  selectSocialMeetingLocation,
  socialInvitationKey,
  socialMeetingCapacity,
  transitionSocialInvitation,
  type SocialInvitationActivity,
  type SocialInvitationReasonCode,
  type SocialInvitationReceipt,
} from './socialInvitationContracts';
import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  socialWarrantDigest,
  socialWarrantValidator,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';
import { readGameHour } from './config';
import {
  ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION,
  type AcceptedSocialInvitationSource,
} from './socialInvitationGoalLogic';

const MAX_SOCIAL_LOCATIONS = 128;
const ACTIVE_INVITATION_STATUSES = ['pending', 'accepted'] as const;

export type PendingSocialInvitationSource = {
  receipt: SocialInvitationReceipt;
  warrant: SocialWarrant;
  candidate: SocialOpportunityCandidate;
  inviterName: string;
  canAccept: boolean;
  acceptanceBlockedReasonCode?: SocialInvitationReasonCode;
};

export const createSocialInvitation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    warrant: socialWarrantValidator,
    candidateId: v.string(),
    intendedActivity: v.union(
      v.literal('talk'),
      v.literal('gift'),
      v.literal('trade'),
      v.literal('teach'),
      v.literal('negotiate'),
    ),
    summary: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => createSocialInvitationTx(ctx, args),
});

export const respondToSocialInvitation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    invitationId: v.string(),
    targetActorId: v.string(),
    expectedRevision: v.number(),
    response: v.union(v.literal('accept'), v.literal('decline')),
    now: v.number(),
  },
  handler: async (ctx, args) => respondToSocialInvitationTx(ctx, args),
});

export const cancelSocialInvitation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    invitationId: v.string(),
    actorId: v.string(),
    expectedRevision: v.number(),
    reasonCode: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => cancelSocialInvitationTx(ctx, args),
});

export const linkSocialInvitationGoal = internalMutation({
  args: {
    worldId: v.id('worlds'),
    invitationId: v.string(),
    actorId: v.string(),
    expectedRevision: v.number(),
    personalGoalId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => linkSocialInvitationGoalTx(ctx, args),
});

export const linkSocialInvitationConversation = internalMutation({
  args: {
    worldId: v.id('worlds'),
    invitationId: v.string(),
    actorId: v.string(),
    expectedRevision: v.number(),
    conversationId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => linkSocialInvitationConversationTx(ctx, args),
});

export const getSocialInvitation = internalQuery({
  args: { worldId: v.id('worlds'), invitationId: v.string() },
  handler: async (ctx, args) => {
    const row = await invitationById(ctx, args.worldId, args.invitationId);
    return row ? invitationRowToReceipt(row) : null;
  },
});

export async function createSocialInvitationTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId: string;
    warrant: SocialWarrant;
    candidateId: string;
    intendedActivity: SocialInvitationActivity;
    summary: string;
    now: number;
  },
) {
  if (args.warrant.actorId !== args.actorId || !args.warrant.eligibleTargetActorIds.includes(args.targetActorId)) {
    return rejected('social_invitation_source_stale');
  }
  const [actor, target] = await Promise.all([
    profile(ctx, args.worldId, args.actorId),
    profile(ctx, args.worldId, args.targetActorId),
  ]);
  if (!availableProfile(actor) || !availableProfile(target)) {
    return rejected('social_invitation_target_unavailable');
  }
  const actorMapId = actor.mapId ?? 'world';
  const targetMapId = target.mapId ?? 'world';
  if (actorMapId !== targetMapId || actor.currentLocationId === target.currentLocationId) {
    return rejected('social_invitation_meeting_unavailable');
  }
  if (!(await socialWarrantSourceIsCurrent(ctx, args.worldId, args.warrant, args.now))) {
    return rejected('social_invitation_source_stale');
  }
  const invitationKey = socialInvitationKey({
    actorId: args.actorId,
    targetActorId: args.targetActorId,
    warrantId: args.warrant.warrantId,
  });
  for (const status of ACTIVE_INVITATION_STATUSES) {
    const existing = await ctx.db
      .query('socialInvitations')
      .withIndex('byKeyStatus', (q) =>
        q.eq('worldId', args.worldId).eq('invitationKey', invitationKey).eq('status', status),
      )
      .first();
    if (existing) return { ok: true as const, replay: true, receipt: invitationRowToReceipt(existing) };
  }
  const recent = await ctx.db
    .query('socialInvitations')
    .filter((q) => q.eq(q.field('worldId'), args.worldId))
    .filter((q) => q.eq(q.field('invitationKey'), invitationKey))
    .order('desc')
    .first();
  if (recent?.terminalAt && recent.terminalAt + SOCIAL_INVITATION_COOLDOWN_MS > args.now) {
    return rejected('social_invitation_cooldown_active');
  }
  const meeting = await chooseMeeting(ctx, {
    worldId: args.worldId,
    mapId: actorMapId,
    actorLocationId: actor.currentLocationId,
    targetLocationId: target.currentLocationId,
    intendedActivity: args.intendedActivity,
  });
  if (!meeting) return rejected('social_invitation_meeting_unavailable');
  const warrantDigest = socialWarrantDigest(args.warrant);
  const invitationId = `social_invitation:${stableObservationDigest({ invitationKey, warrantDigest, meetingLocationId: meeting.locationId }).slice('stable64:'.length)}`;
  const candidate: SocialOpportunityCandidate = {
    contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
    candidateId: args.candidateId,
    warrantId: args.warrant.warrantId,
    mode: 'invite_then_travel',
    targetActorIds: [args.targetActorId],
    meetingLocationId: meeting.locationId,
    intendedActivity: args.intendedActivity,
    summary: args.summary.slice(0, 120),
  };
  const receipt = createSocialInvitationReceipt({
    invitationId,
    actorId: args.actorId,
    targetActorId: args.targetActorId,
    warrant: args.warrant,
    candidate,
    meetingMapId: meeting.mapId,
    meetingLocationId: meeting.locationId,
    now: args.now,
    expiresAt: args.now + SOCIAL_INVITATION_TTL_MS,
  });
  await ctx.db.insert('socialInvitations', {
    worldId: args.worldId,
    invitationKey,
    warrant: args.warrant,
    candidate,
    ...receipt,
    updatedAt: args.now,
  });
  return { ok: true as const, replay: false, receipt };
}

export async function respondToSocialInvitationTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    invitationId: string;
    targetActorId: string;
    expectedRevision: number;
    response: 'accept' | 'decline';
    now: number;
  },
) {
  const row = await invitationById(ctx, args.worldId, args.invitationId);
  if (!row) return rejected('social_invitation_not_found');
  if (row.targetActorId !== args.targetActorId) return rejected('social_invitation_target_unavailable');
  if (row.revision !== args.expectedRevision) return rejected('social_invitation_stale_revision');
  if (row.status === (args.response === 'accept' ? 'accepted' : 'declined')) {
    return { ok: true as const, replay: true, receipt: invitationRowToReceipt(row) };
  }
  if (row.status !== 'pending') return rejected(reasonForStatus(row.status));
  if (args.now >= row.expiresAt) {
    const expired = transitionSocialInvitation({
      receipt: invitationRowToReceipt(row),
      expectedRevision: row.revision,
      operation: 'expire',
      now: args.now,
    });
    if (!expired.ok) return rejected(expired.reasonCode);
    await patchReceipt(ctx, row, expired.receipt, args.now);
    return rejected('social_invitation_expired');
  }
  if (args.response === 'decline') {
    const declined = transitionSocialInvitation({
      receipt: invitationRowToReceipt(row),
      expectedRevision: row.revision,
      operation: 'decline',
      now: args.now,
    });
    if (!declined.ok) return rejected(declined.reasonCode);
    await patchReceipt(ctx, row, declined.receipt, args.now);
    return { ok: true as const, replay: false, receipt: declined.receipt };
  }
  const [actor, target, sourceCurrent, targetBusy, capacityAvailable] = await Promise.all([
    profile(ctx, args.worldId, row.actorId),
    profile(ctx, args.worldId, row.targetActorId),
    socialWarrantSourceIsCurrent(ctx, args.worldId, row.warrant, args.now),
    isSocialActorBusy(ctx, args.worldId, row.targetActorId, args.now),
    meetingCapacityAvailable(ctx, row, true),
  ]);
  if (!sourceCurrent) return await cancelAndReject(ctx, row, args.now, 'social_invitation_source_stale');
  if (!availableProfile(actor) || !availableProfile(target)) {
    return await cancelAndReject(ctx, row, args.now, 'social_invitation_target_unavailable');
  }
  if ((target.mapId ?? 'world') !== row.meetingMapId || target.currentLocationId !== row.meetingLocationId) {
    return await cancelAndReject(ctx, row, args.now, 'social_invitation_target_moved');
  }
  if (targetBusy) return await cancelAndReject(ctx, row, args.now, 'social_invitation_target_busy');
  if (!capacityAvailable) return await cancelAndReject(ctx, row, args.now, 'social_invitation_capacity_full');
  const accepted = transitionSocialInvitation({
    receipt: invitationRowToReceipt(row),
    expectedRevision: row.revision,
    operation: 'accept',
    now: args.now,
    capacityAvailable: true,
  });
  if (!accepted.ok) return rejected(accepted.reasonCode);
  await patchReceipt(ctx, row, accepted.receipt, args.now);
  return { ok: true as const, replay: false, receipt: accepted.receipt };
}

export async function cancelSocialInvitationTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    invitationId: string;
    actorId: string;
    expectedRevision: number;
    reasonCode: string;
    now: number;
  },
) {
  const row = await invitationById(ctx, args.worldId, args.invitationId);
  if (!row) return rejected('social_invitation_not_found');
  if (row.actorId !== args.actorId) return rejected('social_invitation_target_unavailable');
  if (row.revision !== args.expectedRevision) return rejected('social_invitation_stale_revision');
  if (['declined', 'expired', 'cancelled'].includes(row.status)) {
    return { ok: true as const, replay: true, receipt: invitationRowToReceipt(row) };
  }
  const cancelled = transitionSocialInvitation({
    receipt: invitationRowToReceipt(row),
    expectedRevision: row.revision,
    operation: 'cancel',
    now: args.now,
    reasonCode: args.reasonCode as SocialInvitationReasonCode,
  });
  if (!cancelled.ok) return rejected(cancelled.reasonCode);
  await patchReceipt(ctx, row, cancelled.receipt, args.now);
  return { ok: true as const, replay: false, receipt: cancelled.receipt };
}

export async function linkSocialInvitationGoalTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    invitationId: string;
    actorId: string;
    expectedRevision: number;
    personalGoalId: string;
    now: number;
  },
) {
  const row = await invitationById(ctx, args.worldId, args.invitationId);
  if (!row) return rejected('social_invitation_not_found');
  if (row.actorId !== args.actorId || row.status !== 'accepted') {
    return rejected('social_invitation_not_pending');
  }
  if (row.revision !== args.expectedRevision) return rejected('social_invitation_stale_revision');
  if (row.personalGoalId) {
    return row.personalGoalId === args.personalGoalId
      ? { ok: true as const, replay: true, receipt: invitationRowToReceipt(row) }
      : rejected('social_invitation_terminal_replay');
  }
  await ctx.db.patch(row._id, { personalGoalId: args.personalGoalId, updatedAt: args.now });
  return { ok: true as const, replay: false, receipt: { ...invitationRowToReceipt(row), personalGoalId: args.personalGoalId } };
}

export async function linkSocialInvitationConversationTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    invitationId: string;
    actorId: string;
    expectedRevision: number;
    conversationId: string;
    now: number;
  },
) {
  const row = await invitationById(ctx, args.worldId, args.invitationId);
  if (!row) return rejected('social_invitation_not_found');
  if (row.actorId !== args.actorId || row.status !== 'accepted') {
    return rejected('social_invitation_not_pending');
  }
  if (row.revision !== args.expectedRevision) return rejected('social_invitation_stale_revision');
  if (row.conversationId) {
    return row.conversationId === args.conversationId
      ? { ok: true as const, replay: true, receipt: invitationRowToReceipt(row) }
      : rejected('social_invitation_terminal_replay');
  }
  await ctx.db.patch(row._id, { conversationId: args.conversationId, updatedAt: args.now });
  return { ok: true as const, replay: false, receipt: { ...invitationRowToReceipt(row), conversationId: args.conversationId } };
}

export async function socialWarrantSourceIsCurrent(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  warrant: SocialWarrant,
  now: number,
) {
  const currentGameHour = await readGameHour(ctx, worldId, now);
  if (currentGameHour < warrant.createdAt || currentGameHour >= warrant.expiresAt) return false;
  const [namespace, identifier] = splitRef(warrant.sourceRef);
  if (!namespace || !identifier) return false;
  if (namespace === 'body') {
    const actor = await profile(ctx, worldId, identifier);
    if (!actor) return false;
    const maxHealth = actor.maxHealth ?? MAX_HEALTH;
    const revision = `body:${stableObservationDigest({
      health: actor.health,
      maxHealth,
      hasHealingItem: ownedHealingItemId({ inventory: actor.inventory ?? [] }) !== null,
    })}`;
    return revision === warrant.sourceRevision;
  }
  if (namespace === 'request') {
    const id = ctx.db.normalizeId('requests', identifier);
    const request = id ? await ctx.db.get(id) : null;
    return !!request && request.worldId === worldId &&
      request.assigneeActorId === warrant.actorId &&
      warrant.eligibleTargetActorIds.includes(request.issuerActorId) &&
      ['accepted', 'ready_to_turn_in'].includes(request.status) &&
      `request:rev:${requestRevision(request)}` === warrant.sourceRevision;
  }
  if (namespace === 'belief') {
    const belief = await ctx.db
      .query('actorBeliefs')
      .withIndex('byActorBelief', (q) =>
        q.eq('worldId', worldId).eq('actorId', warrant.actorId).eq('beliefId', identifier),
      )
      .first();
    return !!belief && belief.active && belief.validity !== 'superseded' &&
      `belief:rev:${belief.revision ?? 1}` === warrant.sourceRevision;
  }
  if (namespace === 'event') {
    const id = ctx.db.normalizeId('worldEvents', identifier);
    const event = id ? await ctx.db.get(id) : null;
    return !!event && event.worldId === worldId &&
      `event:${stableObservationDigest({ type: event.type, createdAt: event.createdAt })}` === warrant.sourceRevision;
  }
  if (namespace === 'relationship') {
    const row = await ctx.db
      .query('relationships')
      .withIndex('pair', (q) =>
        q.eq('worldId', worldId).eq('fromActorId', warrant.actorId).eq('toActorId', identifier),
      )
      .first();
    if (!row) return false;
    const actor = await profile(ctx, worldId, warrant.actorId);
    const currentGameDay = Math.floor(currentGameHour / 24);
    const dims = relationshipDimsAt(
      { affinity: row.value, trust: row.trust, suspicion: row.suspicion, debt: row.debt, fear: row.fear },
      row.lastTouchedDay,
      currentGameDay,
      actor?.innerTrait ?? '',
      actor?.outerTrait ?? '',
      row.dimensionTouchedDays,
    );
    return `relationship:${stableObservationDigest({
      relationship: dims.affinity,
      trust: dims.trust,
      suspicion: dims.suspicion,
      debt: dims.debt,
      fear: dims.fear,
      lastTouchedDay: row.lastTouchedDay,
    })}` === warrant.sourceRevision;
  }
  return false;
}

export async function loadAcceptedSocialInvitationSource(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  invitationId: string,
  now: number,
): Promise<AcceptedSocialInvitationSource | undefined> {
  const row = await invitationById(ctx, worldId, invitationId);
  if (!row || row.status !== 'accepted' || row.expiresAt <= now) return undefined;
  const target = await profile(ctx, worldId, row.targetActorId);
  const receipt = invitationRowToReceipt(row);
  const boundSession = row.conversationId
    ? await ctx.db
        .query('conversationSessions')
        .withIndex('byConversation', (q) =>
          q.eq('worldId', worldId).eq('conversationId', row.conversationId!),
        )
        .first()
    : null;
  const boundSessionValid = !!boundSession &&
    [boundSession.actorAId, boundSession.actorBId].includes(row.actorId) &&
    [boundSession.actorAId, boundSession.actorBId].includes(row.targetActorId) &&
    boundSession.locationId === row.meetingLocationId;
  return {
    contractVersion: ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION,
    receipt,
    receiptDigest: stableObservationDigest(receipt),
    warrant: row.warrant,
    candidate: row.candidate,
    targetLocationId: row.meetingLocationId,
    targetAliveAndCapable: availableProfile(target),
    targetBusy: boundSessionValid
      ? false
      : await isSocialActorBusy(ctx, worldId, row.targetActorId, now),
    targetStillAtMeeting:
      !!target &&
      (target.mapId ?? 'world') === row.meetingMapId &&
      target.currentLocationId === row.meetingLocationId,
    sourceCurrent: await socialWarrantSourceIsCurrent(ctx, worldId, row.warrant, now),
    capacityAvailable: boundSessionValid
      ? true
      : await meetingCapacityAvailable(ctx, row, true),
  };
}

export async function loadPendingSocialInvitationSource(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  invitationId: string,
  targetActorId: string,
  now: number,
): Promise<PendingSocialInvitationSource | undefined> {
  const row = await invitationById(ctx, worldId, invitationId);
  if (!row || row.targetActorId !== targetActorId || row.status !== 'pending') return undefined;
  const receipt = invitationRowToReceipt(row);
  if (row.expiresAt <= now) {
    return {
      receipt,
      warrant: row.warrant,
      candidate: row.candidate,
      inviterName: row.actorId,
      canAccept: false,
      acceptanceBlockedReasonCode: 'social_invitation_expired',
    };
  }
  const [actor, target, sourceCurrent, targetBusy, capacityAvailable] = await Promise.all([
    profile(ctx, worldId, row.actorId),
    profile(ctx, worldId, row.targetActorId),
    socialWarrantSourceIsCurrent(ctx, worldId, row.warrant, now),
    isSocialActorBusy(ctx, worldId, row.targetActorId, now),
    meetingCapacityAvailable(ctx, row, true),
  ]);
  let acceptanceBlockedReasonCode: SocialInvitationReasonCode | undefined;
  if (!sourceCurrent) acceptanceBlockedReasonCode = 'social_invitation_source_stale';
  else if (!availableProfile(actor) || !availableProfile(target)) {
    acceptanceBlockedReasonCode = 'social_invitation_target_unavailable';
  } else if (
    (target.mapId ?? 'world') !== row.meetingMapId ||
    target.currentLocationId !== row.meetingLocationId
  ) {
    acceptanceBlockedReasonCode = 'social_invitation_target_moved';
  } else if (targetBusy) acceptanceBlockedReasonCode = 'social_invitation_target_busy';
  else if (!capacityAvailable) acceptanceBlockedReasonCode = 'social_invitation_capacity_full';
  return {
    receipt,
    warrant: row.warrant,
    candidate: row.candidate,
    inviterName: actor?.name ?? row.actorId,
    canAccept: acceptanceBlockedReasonCode === undefined,
    acceptanceBlockedReasonCode,
  };
}

async function chooseMeeting(
  ctx: MutationCtx,
  input: {
    worldId: Id<'worlds'>;
    mapId: string;
    actorLocationId?: string;
    targetLocationId?: string;
    intendedActivity: SocialInvitationActivity;
  },
) {
  const locations = await ctx.db
    .query('locations')
    .withIndex('byMap', (q) => q.eq('worldId', input.worldId).eq('mapId', input.mapId))
    .take(MAX_SOCIAL_LOCATIONS);
  const projected = await Promise.all(locations.map(async (location) => ({
    locationId: location.locationId,
    mapId: location.mapId ?? 'world',
    dangerLevel: location.dangerLevel,
    allowedActions: location.allowedActions,
    capacity: socialMeetingCapacity({
      entryPointCount: location.entryPoints.length,
      bounds: location.bounds,
    }),
    occupiedCapacity: await occupiedMeetingCapacity(
      ctx,
      input.worldId,
      location.mapId ?? 'world',
      location.locationId,
    ),
  })));
  return selectSocialMeetingLocation({ ...input, locations: projected });
}

async function meetingCapacityAvailable(
  ctx: MutationCtx | QueryCtx,
  row: Doc<'socialInvitations'>,
  excludeSelf: boolean,
) {
  const location = await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) =>
      q.eq('worldId', row.worldId).eq('locationId', row.meetingLocationId),
    )
    .first();
  if (!location || (location.mapId ?? 'world') !== row.meetingMapId) return false;
  const capacity = socialMeetingCapacity({
    entryPointCount: location.entryPoints.length,
    bounds: location.bounds,
  });
  const occupied = await occupiedMeetingCapacity(
    ctx,
    row.worldId,
    row.meetingMapId,
    row.meetingLocationId,
    excludeSelf ? row.invitationId : undefined,
  );
  return capacity - occupied >= SOCIAL_INVITATION_CAPACITY;
}

async function occupiedMeetingCapacity(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  locationId: string,
  excludedInvitationId?: string,
) {
  const accepted = await ctx.db
    .query('socialInvitations')
    .withIndex('byMeetingStatus', (q) =>
      q.eq('worldId', worldId).eq('meetingMapId', mapId).eq('meetingLocationId', locationId).eq('status', 'accepted'),
    )
    .collect();
  const sessions = await ctx.db
    .query('conversationSessions')
    .filter((q) => q.eq(q.field('worldId'), worldId))
    .filter((q) => q.eq(q.field('mapId'), mapId))
    .filter((q) => q.eq(q.field('locationId'), locationId))
    .filter((q) => q.eq(q.field('status'), 'active'))
    .collect();
  return accepted
    .filter((row) => row.invitationId !== excludedInvitationId)
    .reduce((sum, row) => sum + row.reservedCapacity, 0) + sessions.length * 2;
}

export async function isSocialActorBusy(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
) {
  for (const status of ACTIVE_ACTION_EXECUTION_STATUSES) {
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', worldId).eq('actorId', actorId).eq('status', status),
      )
      .first();
    if (execution && execution.expiresAt > now && execution.hardDeadlineAt > now) return true;
  }
  const [actorA, actorB, group] = await Promise.all([
    ctx.db.query('conversationSessions').withIndex('byActorAStatus', (q) =>
      q.eq('worldId', worldId).eq('actorAId', actorId).eq('status', 'active')).first(),
    ctx.db.query('conversationSessions').withIndex('byActorBStatus', (q) =>
      q.eq('worldId', worldId).eq('actorBId', actorId).eq('status', 'active')).first(),
    ctx.db.query('groupConversationMemberships').withIndex('byActorStatus', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('status', 'active')).first(),
  ]);
  return Boolean(actorA || actorB || group);
}

async function cancelAndReject(
  ctx: MutationCtx,
  row: Doc<'socialInvitations'>,
  now: number,
  reasonCode: SocialInvitationReasonCode,
) {
  const cancelled = transitionSocialInvitation({
    receipt: invitationRowToReceipt(row),
    expectedRevision: row.revision,
    operation: 'cancel',
    now,
    reasonCode,
  });
  if (cancelled.ok) await patchReceipt(ctx, row, cancelled.receipt, now);
  return rejected(reasonCode);
}

async function patchReceipt(
  ctx: MutationCtx,
  row: Doc<'socialInvitations'>,
  receipt: SocialInvitationReceipt,
  now: number,
) {
  await ctx.db.patch(row._id, {
    revision: receipt.revision,
    status: receipt.status,
    respondedAt: receipt.respondedAt,
    terminalAt: receipt.terminalAt,
    terminalReasonCode: receipt.terminalReasonCode,
    personalGoalId: receipt.personalGoalId,
    conversationId: receipt.conversationId,
    updatedAt: now,
  });
}

async function invitationById(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  invitationId: string,
) {
  return await ctx.db
    .query('socialInvitations')
    .withIndex('byInvitation', (q) => q.eq('worldId', worldId).eq('invitationId', invitationId))
    .unique();
}

async function profile(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}

function availableProfile(profile: Doc<'xianxiaProfiles'> | null): profile is Doc<'xianxiaProfiles'> {
  return !!profile && !isActorDeceased(profile) && !isActorIncapacitated(profile.health) &&
    !!profile.currentLocationId;
}

function invitationRowToReceipt(row: Doc<'socialInvitations'>): SocialInvitationReceipt {
  return {
    contractVersion: SOCIAL_INVITATION_VERSION,
    invitationId: row.invitationId,
    revision: row.revision,
    actorId: row.actorId,
    targetActorId: row.targetActorId,
    warrantId: row.warrant.warrantId,
    warrantDigest: row.warrantDigest,
    sourceRef: row.sourceRef,
    sourceRevision: row.sourceRevision,
    candidateId: row.candidate.candidateId,
    candidateDigest: row.candidateDigest,
    intendedActivity: row.intendedActivity,
    meetingMapId: row.meetingMapId,
    meetingLocationId: row.meetingLocationId,
    reservedCapacity: SOCIAL_INVITATION_CAPACITY,
    status: row.status,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
    expiresAt: row.expiresAt,
    terminalAt: row.terminalAt,
    terminalReasonCode: row.terminalReasonCode,
    personalGoalId: row.personalGoalId,
    conversationId: row.conversationId,
  };
}

function splitRef(value: string) {
  const separator = value.indexOf(':');
  return separator > 0
    ? [value.slice(0, separator), value.slice(separator + 1)] as const
    : [undefined, undefined] as const;
}

function reasonForStatus(status: Doc<'socialInvitations'>['status']): SocialInvitationReasonCode {
  if (status === 'declined') return 'social_invitation_declined';
  if (status === 'expired') return 'social_invitation_expired';
  if (status === 'cancelled') return 'social_invitation_cancelled';
  return 'social_invitation_not_pending';
}

function rejected(reasonCode: SocialInvitationReasonCode) {
  return { ok: false as const, reasonCode };
}

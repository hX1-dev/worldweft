import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { readGameHour } from './config';
import {
  createGroupSocialInitiationReceipt,
  GROUP_SOCIAL_INITIATION_COOLDOWN_MS,
  startGroupSocialInitiation,
  transitionGroupSocialResponse,
  type GroupSocialInitiationMember,
  type GroupSocialInitiationReasonCode,
  type GroupSocialInitiationReceipt,
} from './groupSocialInitiationContracts';
import {
  deriveGroupSocialOpportunities,
  type GroupSocialOpportunity,
  type GroupSocialOpportunityInput,
} from './groupSocialOpportunityLogic';
import { isActorDeceased, isActorIncapacitated } from './lifeStateLogic';
import { stableObservationDigest } from './lifeObservation';
import { requestRevision } from './questLogic';
import { refreshResourceStock } from './resourceNodeLogic';
import { socialMeetingCapacity } from './socialInvitationContracts';
import { isSocialActorBusy } from './socialInvitations';
import { ACTIVE_ACTION_EXECUTION_STATUSES } from './actionExecutionContracts';
import { MS_PER_GAME_HOUR } from './timeLogic';
import { prepareSocialOutcomeBinding } from './socialOutcomeContracts';
import { socialOutcomeScopeAvailable } from './socialOutcomeReceipts';
import {
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
} from './socialWarrantContracts';

const ACTIVE_INITIATION_STATUSES = ['pending', 'ready'] as const;
const MAX_LOCAL_ACTORS = 32;
const MAX_LOCAL_EVENTS = 40;
const MAX_LOCAL_RESOURCES = 16;

export type GroupSocialInitiationRuntimeSource = {
  receipt: GroupSocialInitiationReceipt;
  members: GroupSocialInitiationMember[];
  canRespond: boolean;
  canStart: boolean;
  blockedReasonCode?: GroupSocialInitiationReasonCode;
};

export async function loadGroupSocialOpportunities(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
  options: { excludeInitiationId?: string } = {},
): Promise<GroupSocialOpportunity[]> {
  const actor = await profile(ctx, worldId, actorId);
  if (!availableProfile(actor) || !actor.currentLocationId) return [];
  const mapId = actor.mapId ?? 'world';
  const locationId = actor.currentLocationId;
  const [location, localActorPages, resources, eventPages, nowGameHour] = await Promise.all([
    ctx.db.query('locations').withIndex('byLocationId', (q) =>
      q.eq('worldId', worldId).eq('locationId', locationId)).first(),
    Promise.all((mapId === 'world' ? [undefined, 'world'] : [mapId]).map((storedMapId) =>
      ctx.db.query('xianxiaProfiles').withIndex('byLocation', (q) =>
        q.eq('worldId', worldId).eq('mapId', storedMapId).eq('currentLocationId', locationId)).take(MAX_LOCAL_ACTORS))),
    ctx.db.query('resourceNodes').withIndex('byLocation', (q) =>
      q.eq('worldId', worldId).eq('mapId', mapId).eq('locationId', locationId)).take(MAX_LOCAL_RESOURCES),
    Promise.all((mapId === 'world' ? [undefined, 'world'] : [mapId]).map((storedMapId) =>
      ctx.db.query('worldEvents').withIndex('byMap', (q) =>
        q.eq('worldId', worldId).eq('mapId', storedMapId)).order('desc').take(MAX_LOCAL_EVENTS))),
    readGameHour(ctx, worldId, now),
  ]);
  if (!location || (location.mapId ?? 'world') !== mapId) return [];
  const localActors = [...new Map(localActorPages.flat().map((entry) => [entry.actorId, entry])).values()]
    .sort((a, b) => a.actorId.localeCompare(b.actorId))
    .slice(0, MAX_LOCAL_ACTORS);
  const events = [...new Map(eventPages.flat().map((entry) => [String(entry._id), entry])).values()]
    .sort((a, b) => b.createdAt - a.createdAt || String(a._id).localeCompare(String(b._id)))
    .slice(0, MAX_LOCAL_EVENTS);
  const [requests, actors, occupiedCapacity, activeSourceRevisions, reservedResources] = await Promise.all([
    loadRelevantRequests(ctx, worldId, localActors.map((entry) => entry.actorId), nowGameHour),
    Promise.all(localActors.map(async (entry) => ({
      actorId: entry.actorId,
      role: entry.role,
      mapId: entry.mapId ?? 'world',
      locationId: entry.currentLocationId,
      aliveAndCapable: availableProfile(entry),
      busy: await isSocialActorBusy(ctx, worldId, entry.actorId, now),
      inventory: entry.inventory ?? [],
    }))),
    occupiedGroupCapacity(ctx, worldId, mapId, locationId, options.excludeInitiationId),
    activeInitiationSourceRevisions(ctx, worldId, options.excludeInitiationId),
    loadReservedResourceQuantities(ctx, worldId, mapId, now),
  ]);
  const input: GroupSocialOpportunityInput = {
    now,
    nowGameHour,
    actorId,
    mapId,
    locationId,
    location: {
      allowedActions: location.allowedActions,
      dangerLevel: location.dangerLevel,
      capacity: socialMeetingCapacity({ entryPointCount: location.entryPoints.length, bounds: location.bounds }),
      occupiedCapacity,
    },
    actors,
    requests,
    events: events
      .filter((event) =>
        event.locationId === locationId && event.createdAt >= now - 6 * MS_PER_GAME_HOUR)
      .map((event) => ({
        eventId: String(event._id),
        eventType: event.type,
        createdAt: event.createdAt,
        visibility: event.visibility,
        actorIds: event.actorIds,
        targetActorIds: event.targetActorIds ?? [],
        witnessActorIds: event.witnessActorIds ?? [],
        mapId: event.mapId ?? 'world',
        locationId: event.locationId,
      })),
    resources: resources
      .filter((resource) => resource.accessRule === 'public' || resource.ownerActorId === actorId)
      .map((resource) => {
        const projected = refreshResourceStock(resource, now);
        return {
          resourceNodeId: resource.resourceNodeId,
          itemId: resource.itemId,
          revision: `stock:${stableObservationDigest({
            stock: projected.stock,
            reserved: reservedResources.get(resource.resourceNodeId) ?? 0,
            nextRefreshAt: projected.nextRefreshAt,
            updatedAt: resource.updatedAt,
          })}`,
          available: Math.max(
            0,
            projected.stock - (reservedResources.get(resource.resourceNodeId) ?? 0),
          ),
        };
      }),
    activeSourceRevisions,
  };
  const opportunities = deriveGroupSocialOpportunities(input);
  const excludedInitiation = options.excludeInitiationId
    ? await ctx.db.query('groupSocialInitiations').withIndex('byInitiation', (q) =>
        q.eq('worldId', worldId).eq('initiationId', options.excludeInitiationId!)).first()
    : null;
  const excludedOutcomeId = excludedInitiation
    ? `social_outcome:${stableObservationDigest({
        warrantDigest: excludedInitiation.warrantDigest,
        candidateDigest: excludedInitiation.candidateDigest,
      })}`
    : undefined;
  const available: GroupSocialOpportunity[] = [];
  for (const opportunity of opportunities) {
    const warrantDigest = socialWarrantDigest(opportunity.warrant);
    const candidateDigest = socialOpportunityCandidateDigest(opportunity.candidate);
    const binding = prepareSocialOutcomeBinding({
      actorId,
      targetActorIds: opportunity.candidate.targetActorIds,
      actionType: 'group_talk',
      warrant: opportunity.warrant,
      candidate: opportunity.candidate,
      warrantDigest,
      candidateDigest,
      warrantCandidateDigest: socialWarrantCandidateDigest(
        opportunity.warrant,
        opportunity.candidate,
      ),
    });
    if (!binding.ok) continue;
    if (
      binding.binding.outcomeId === excludedOutcomeId ||
      await socialOutcomeScopeAvailable(ctx, worldId, binding.binding.scopeKey, nowGameHour)
    ) available.push(opportunity);
  }
  return available;
}

export async function createGroupSocialInitiationTx(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actorId: string; candidateId: string; now: number },
) {
  for (const status of ACTIVE_INITIATION_STATUSES) {
    const existingCandidate = await ctx.db.query('groupSocialInitiations')
      .filter((q) => q.eq(q.field('worldId'), args.worldId))
      .filter((q) => q.eq(q.field('candidateId'), args.candidateId))
      .filter((q) => q.eq(q.field('status'), status))
      .first();
    if (existingCandidate) {
      return { ok: true as const, replay: true, receipt: rowToReceipt(existingCandidate) };
    }
  }
  const opportunities = await loadGroupSocialOpportunities(ctx, args.worldId, args.actorId, args.now);
  const opportunity = opportunities.find((entry) => entry.candidate.candidateId === args.candidateId);
  if (!opportunity) return rejected('group_social_source_missing');
  for (const status of ACTIVE_INITIATION_STATUSES) {
    const existing = await ctx.db.query('groupSocialInitiations').withIndex('bySourceStatus', (q) =>
      q.eq('worldId', args.worldId)
        .eq('sourceRef', opportunity.warrant.sourceRef)
        .eq('sourceRevision', opportunity.warrant.sourceRevision)
        .eq('status', status)).first();
    if (existing) return { ok: true as const, replay: true, receipt: rowToReceipt(existing) };
  }
  const recent = await ctx.db.query('groupSocialInitiations')
    .filter((q) => q.eq(q.field('worldId'), args.worldId))
    .filter((q) => q.eq(q.field('sourceRef'), opportunity.warrant.sourceRef))
    .order('desc').first();
  if (recent?.terminalAt && recent.terminalAt + GROUP_SOCIAL_INITIATION_COOLDOWN_MS > args.now) {
    return rejected('group_social_session_conflict');
  }
  const actor = await profile(ctx, args.worldId, args.actorId);
  if (!actor) return rejected('group_social_actor_unavailable');
  const created = createGroupSocialInitiationReceipt({
    opportunity,
    meetingMapId: actor.mapId ?? 'world',
    now: args.now,
  });
  await ctx.db.insert('groupSocialInitiations', {
    worldId: args.worldId,
    ...created.receipt,
    updatedAt: args.now,
  });
  for (const member of created.members) {
    await ctx.db.insert('groupSocialInitiationMembers', {
      worldId: args.worldId,
      initiationId: created.receipt.initiationId,
      actorId: member.actorId,
      role: member.role,
      response: member.response,
      initiationStatus: created.receipt.status,
      respondedAt: member.respondedAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  return { ok: true as const, replay: false, receipt: created.receipt };
}

export async function respondGroupSocialInitiationTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    initiationId: string;
    actorId: string;
    expectedRevision: number;
    response: 'accept' | 'decline';
    now: number;
  },
) {
  const loaded = await loadInitiation(ctx, args.worldId, args.initiationId);
  if (!loaded) return rejected('group_social_invitation_not_found');
  if (args.now >= loaded.receipt.expiresAt &&
    ACTIVE_INITIATION_STATUSES.includes(loaded.receipt.status as typeof ACTIVE_INITIATION_STATUSES[number])) {
    await cancelInitiation(
      ctx,
      loaded.row,
      loaded.memberRows,
      'group_social_invitation_expired',
      args.now,
    );
    return rejected('group_social_invitation_expired');
  }
  if (args.response === 'accept') {
    const runtime = await validateInitiationRuntime(ctx, args.worldId, loaded.receipt, args.now);
    if (!runtime.ok) {
      await cancelInitiation(
        ctx, loaded.row, loaded.memberRows, runtime.reasonCode, args.now,
      );
      return rejected(runtime.reasonCode);
    }
  }
  const transitioned = transitionGroupSocialResponse({
    receipt: loaded.receipt,
    members: loaded.members,
    actorId: args.actorId,
    expectedRevision: args.expectedRevision,
    response: args.response,
    now: args.now,
  });
  if (!transitioned.ok) return rejected(transitioned.reasonCode);
  if (!transitioned.replay) {
    await patchInitiation(ctx, loaded.row, loaded.memberRows, transitioned.receipt, transitioned.members, args.now);
  }
  return { ok: true as const, replay: transitioned.replay, receipt: transitioned.receipt };
}

export async function prepareGroupSocialInitiationStart(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    initiationId: string;
    actorId: string;
    expectedRevision: number;
    now: number;
  },
) {
  const loaded = await loadInitiation(ctx, args.worldId, args.initiationId);
  if (!loaded) return rejected('group_social_invitation_not_found');
  if (loaded.receipt.revision !== args.expectedRevision) return rejected('group_social_stale_revision');
  if (loaded.receipt.hostActorId !== args.actorId) return rejected('group_social_participant_irrelevant');
  if (loaded.receipt.status !== 'ready' || !loaded.members.every((entry) => entry.response === 'accepted')) {
    return rejected('group_social_not_ready');
  }
  const runtime = await validateInitiationRuntime(ctx, args.worldId, loaded.receipt, args.now);
  if (!runtime.ok) {
    await cancelInitiation(
      ctx, loaded.row, loaded.memberRows, runtime.reasonCode, args.now,
    );
    return rejected(runtime.reasonCode);
  }
  return { ok: true as const, receipt: loaded.receipt, members: loaded.members };
}

export async function commitGroupSocialInitiationStarted(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    initiationId: string;
    actorId: string;
    expectedRevision: number;
    groupConversationId: string;
    now: number;
  },
) {
  const loaded = await loadInitiation(ctx, args.worldId, args.initiationId);
  if (!loaded) return rejected('group_social_invitation_not_found');
  const transitioned = startGroupSocialInitiation({
    receipt: loaded.receipt,
    members: loaded.members,
    actorId: args.actorId,
    expectedRevision: args.expectedRevision,
    groupConversationId: args.groupConversationId,
    now: args.now,
  });
  if (!transitioned.ok) return rejected(transitioned.reasonCode);
  if (!transitioned.replay) {
    await patchInitiation(ctx, loaded.row, loaded.memberRows, transitioned.receipt, loaded.members, args.now);
  }
  return { ok: true as const, replay: transitioned.replay, receipt: transitioned.receipt };
}

export async function loadActorGroupSocialCoordination(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
) {
  const memberships = await Promise.all(ACTIVE_INITIATION_STATUSES.map((status) =>
    ctx.db.query('groupSocialInitiationMembers').withIndex('byActorStatus', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('initiationStatus', status)).order('desc').take(4),
  ));
  const sources: GroupSocialInitiationRuntimeSource[] = [];
  for (const member of memberships.flat()) {
    const loaded = await loadInitiation(ctx, worldId, member.initiationId);
    if (!loaded) continue;
    const runtime = await validateInitiationRuntime(ctx, worldId, loaded.receipt, now);
    sources.push({
      receipt: loaded.receipt,
      members: loaded.members,
      canRespond: member.response === 'pending' && runtime.ok && now < loaded.receipt.expiresAt,
      canStart: actorId === loaded.receipt.hostActorId && loaded.receipt.status === 'ready' && runtime.ok,
      blockedReasonCode: runtime.ok ? undefined : runtime.reasonCode,
    });
  }
  return sources.sort((a, b) => b.receipt.createdAt - a.receipt.createdAt);
}

export async function loadGroupSocialInitiationReceipt(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  initiationId: string,
) {
  const loaded = await loadInitiation(ctx, worldId, initiationId);
  return loaded?.receipt ?? null;
}

async function validateInitiationRuntime(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  receipt: GroupSocialInitiationReceipt,
  now: number,
): Promise<{ ok: true } | { ok: false; reasonCode: GroupSocialInitiationReasonCode }> {
  if (now >= receipt.expiresAt) return rejected('group_social_invitation_expired');
  const allActorIds = [...receipt.participantActorIds, ...receipt.observerActorIds];
  const actors = await Promise.all(allActorIds.map((actorId) => profile(ctx, worldId, actorId)));
  for (const actor of actors) {
    if (!availableProfile(actor)) return rejected('group_social_actor_unavailable');
    if ((actor.mapId ?? 'world') !== receipt.meetingMapId ||
      actor.currentLocationId !== receipt.meetingLocationId) {
      return rejected('group_social_participant_moved');
    }
    if (await isSocialActorBusy(ctx, worldId, actor.actorId, now)) {
      return rejected('group_social_participant_busy');
    }
  }
  if (receipt.audience === 'participants' && receipt.observerActorIds.length > 0) {
    return rejected('group_social_privacy_forbidden');
  }
  const location = await ctx.db.query('locations').withIndex('byLocationId', (q) =>
    q.eq('worldId', worldId).eq('locationId', receipt.meetingLocationId)).first();
  if (!location || (location.mapId ?? 'world') !== receipt.meetingMapId ||
    !location.allowedActions.includes('group_talk') ||
    !location.allowedActions.includes('group_decide') || location.dangerLevel > 1) {
    return rejected('group_social_location_invalid');
  }
  const capacity = socialMeetingCapacity({
    entryPointCount: location.entryPoints.length,
    bounds: location.bounds,
  });
  const occupied = await occupiedGroupCapacity(
    ctx,
    worldId,
    receipt.meetingMapId,
    receipt.meetingLocationId,
    receipt.initiationId,
  );
  if (capacity - occupied < allActorIds.length) return rejected('group_social_capacity_full');
  const current = await loadGroupSocialOpportunities(
    ctx,
    worldId,
    receipt.hostActorId,
    now,
    { excludeInitiationId: receipt.initiationId },
  );
  if (!current.some((opportunity) =>
    opportunity.warrant.sourceRef === receipt.sourceRef &&
    opportunity.warrant.sourceRevision === receipt.sourceRevision &&
    opportunity.candidate.candidateId === receipt.candidateId &&
    stableObservationDigest(opportunity.participantRoles) ===
      stableObservationDigest(receipt.participantRoles))) {
    return rejected('group_social_source_stale');
  }
  return { ok: true };
}

async function loadRelevantRequests(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorIds: string[],
  nowGameHour: number,
) {
  const seen = new Map<string, GroupSocialOpportunityInput['requests'][number]>();
  for (const actorId of [...actorIds].sort()) {
    for (const status of ['accepted', 'ready_to_turn_in'] as const) {
      const [assigned, issued] = await Promise.all([
        ctx.db.query('requests').withIndex('byAssignee', (q) =>
          q.eq('worldId', worldId).eq('assigneeActorId', actorId).eq('status', status)).take(8),
        ctx.db.query('requests').withIndex('byIssuer', (q) =>
          q.eq('worldId', worldId).eq('issuerActorId', actorId).eq('status', status)).take(8),
      ]);
      for (const request of [...assigned, ...issued]) {
        if (request.type !== 'collect_item' && request.type !== 'explore_location') continue;
        if (request.expiresAt <= nowGameHour) continue;
        seen.set(String(request._id), {
          requestId: String(request._id),
          revision: requestRevision(request),
          status,
          type: request.type,
          issuerActorId: request.issuerActorId,
          assigneeActorId: request.assigneeActorId,
          itemId: request.requirements.itemId,
          locationId: request.requirements.locationId,
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.requestId.localeCompare(b.requestId));
}

async function activeInitiationSourceRevisions(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  excludedInitiationId?: string,
) {
  const rows = await Promise.all(ACTIVE_INITIATION_STATUSES.map((status) =>
    ctx.db.query('groupSocialInitiations')
      .filter((q) => q.eq(q.field('worldId'), worldId))
      .filter((q) => q.eq(q.field('status'), status))
      .take(64),
  ));
  return rows.flat()
    .filter((row) => row.initiationId !== excludedInitiationId)
    .map((row) => `${row.sourceRef}|${row.sourceRevision}`);
}

async function loadReservedResourceQuantities(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  now: number,
) {
  const result = new Map<string, number>();
  for (const status of ACTIVE_ACTION_EXECUTION_STATUSES) {
    const rows = await ctx.db.query('actionExecutions').withIndex('byMapStatus', (q) =>
      q.eq('worldId', worldId).eq('mapId', mapId).eq('status', status)).take(64);
    for (const row of rows) {
      if (!row.resourceNodeId || row.expiresAt <= now || row.hardDeadlineAt <= now) continue;
      result.set(
        row.resourceNodeId,
        (result.get(row.resourceNodeId) ?? 0) + (row.reservedQuantity ?? 0),
      );
    }
  }
  return result;
}

async function occupiedGroupCapacity(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  locationId: string,
  excludedInitiationId?: string,
) {
  const [sessions, invitations, pendingGroups, readyGroups] = await Promise.all([
    ctx.db.query('groupConversationSessions').withIndex('byStatusLocation', (q) =>
      q.eq('worldId', worldId).eq('status', 'active').eq('mapId', mapId).eq('locationId', locationId)).collect(),
    ctx.db.query('socialInvitations').withIndex('byMeetingStatus', (q) =>
      q.eq('worldId', worldId).eq('meetingMapId', mapId).eq('meetingLocationId', locationId).eq('status', 'accepted')).collect(),
    ctx.db.query('groupSocialInitiations').withIndex('byMeetingStatus', (q) =>
      q.eq('worldId', worldId).eq('meetingMapId', mapId).eq('meetingLocationId', locationId).eq('status', 'pending')).collect(),
    ctx.db.query('groupSocialInitiations').withIndex('byMeetingStatus', (q) =>
      q.eq('worldId', worldId).eq('meetingMapId', mapId).eq('meetingLocationId', locationId).eq('status', 'ready')).collect(),
  ]);
  return sessions.reduce((sum, row) =>
    sum + row.participantActorIds.length + row.observerActorIds.length, 0) +
    invitations.reduce((sum, row) => sum + row.reservedCapacity, 0) +
    [...pendingGroups, ...readyGroups]
      .filter((row) => row.initiationId !== excludedInitiationId)
      .reduce((sum, row) => sum + row.participantActorIds.length + row.observerActorIds.length, 0);
}

async function loadInitiation(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  initiationId: string,
) {
  const row = await ctx.db.query('groupSocialInitiations').withIndex('byInitiation', (q) =>
    q.eq('worldId', worldId).eq('initiationId', initiationId)).unique();
  if (!row) return undefined;
  const memberRows = await ctx.db.query('groupSocialInitiationMembers').withIndex('byInitiation', (q) =>
    q.eq('worldId', worldId).eq('initiationId', initiationId)).collect();
  return {
    row,
    memberRows,
    receipt: rowToReceipt(row),
    members: memberRows.map((member) => ({
      actorId: member.actorId,
      role: member.role,
      response: member.response,
      respondedAt: member.respondedAt,
    })).sort((a, b) => a.actorId.localeCompare(b.actorId)),
  };
}

async function patchInitiation(
  ctx: MutationCtx,
  row: Doc<'groupSocialInitiations'>,
  memberRows: Doc<'groupSocialInitiationMembers'>[],
  receipt: GroupSocialInitiationReceipt,
  members: GroupSocialInitiationMember[],
  now: number,
) {
  await ctx.db.patch(row._id, {
    revision: receipt.revision,
    status: receipt.status,
    terminalAt: receipt.terminalAt,
    terminalReasonCode: receipt.terminalReasonCode,
    groupConversationId: receipt.groupConversationId,
    updatedAt: now,
  });
  for (const memberRow of memberRows) {
    const member = members.find((entry) => entry.actorId === memberRow.actorId)!;
    await ctx.db.patch(memberRow._id, {
      response: member.response,
      respondedAt: member.respondedAt,
      initiationStatus: receipt.status,
      updatedAt: now,
    });
  }
}

async function cancelInitiation(
  ctx: MutationCtx,
  row: Doc<'groupSocialInitiations'>,
  members: Doc<'groupSocialInitiationMembers'>[],
  reasonCode: GroupSocialInitiationReasonCode,
  now: number,
) {
  if (!ACTIVE_INITIATION_STATUSES.includes(row.status as typeof ACTIVE_INITIATION_STATUSES[number])) {
    return rowToReceipt(row);
  }
  const status = reasonCode === 'group_social_invitation_expired' ? 'expired' as const : 'cancelled' as const;
  await ctx.db.patch(row._id, {
    revision: row.revision + 1,
    status,
    terminalAt: now,
    terminalReasonCode: reasonCode,
    updatedAt: now,
  });
  for (const member of members) {
    await ctx.db.patch(member._id, {
      initiationStatus: status,
      updatedAt: now,
    });
  }
  return {
    ...rowToReceipt(row),
    revision: row.revision + 1,
    status,
    terminalAt: now,
    terminalReasonCode: reasonCode,
  };
}

function rowToReceipt(row: Doc<'groupSocialInitiations'>): GroupSocialInitiationReceipt {
  return {
    contractVersion: row.contractVersion,
    initiationId: row.initiationId,
    revision: row.revision,
    hostActorId: row.hostActorId,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    sourceRevision: row.sourceRevision,
    warrantId: row.warrantId,
    warrantDigest: row.warrantDigest,
    candidateId: row.candidateId,
    candidateDigest: row.candidateDigest,
    topicRefs: row.topicRefs,
    audience: row.audience,
    meetingMapId: row.meetingMapId,
    meetingLocationId: row.meetingLocationId,
    participantActorIds: row.participantActorIds,
    participantRoles: row.participantRoles,
    observerActorIds: row.observerActorIds,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    terminalAt: row.terminalAt,
    terminalReasonCode: row.terminalReasonCode,
    groupConversationId: row.groupConversationId,
  };
}

async function profile(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  return await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
    q.eq('worldId', worldId).eq('actorId', actorId)).first();
}

function availableProfile(value: Doc<'xianxiaProfiles'> | null): value is Doc<'xianxiaProfiles'> {
  return !!value && !isActorDeceased(value) && !isActorIncapacitated(value.health) &&
    !!value.currentLocationId;
}

function rejected(reasonCode: GroupSocialInitiationReasonCode) {
  return { ok: false as const, reasonCode };
}

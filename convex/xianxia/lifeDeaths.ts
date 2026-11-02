import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { deceasedResidentPatch } from './qinglan';
import { MS_PER_LIFE_YEAR } from './lifeCalendarLogic';
import {
  ACTOR_DEATH_VERSION,
  OLD_AGE_DEATH_BATCH_SIZE,
  REALM_LIFESPAN_YEARS,
  effectiveLifeStatus,
  oldAgeDeathBoundary,
  realmLifespanYears,
} from './lifeProfileLogic';

const ACTIVE_EXECUTION_STATUSES = ['pending', 'accepted', 'acting'] as const;
const ACTIVE_MOVEMENT_STATUSES = ['pending', 'accepted', 'moving'] as const;
const ACTIVE_CONVERSATION_STATUSES = ['proposed', 'accepted', 'active'] as const;
const ACTIVE_NEGOTIATION_STATUSES = ['opened', 'active'] as const;
const ACTIVE_REQUEST_STATUSES = ['offered', 'accepted', 'ready_to_turn_in'] as const;

export const tickOldAgeDeaths = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.lifeCalendarStartedAt === undefined) {
      return emptyDeathBatch('calendar_uninitialized');
    }

    const candidates = new Map<string, Doc<'xianxiaProfiles'>>();
    for (const [realm, lifespanYears] of Object.entries(REALM_LIFESPAN_YEARS)) {
      const cutoff = args.now - lifespanYears * MS_PER_LIFE_YEAR;
      for (const lifeStatus of [undefined, 'alive'] as const) {
        const rows = await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byLifeStatusRealmBirth', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('lifeStatus', lifeStatus)
              .eq('realm', realm)
              .gte('lifeBornAt', 0)
              .lte('lifeBornAt', cutoff),
          )
          .order('asc')
          .take(OLD_AGE_DEATH_BATCH_SIZE);
        for (const row of rows) candidates.set(row.actorId, row);
      }
    }

    const due = [...candidates.values()]
      .filter(
        (profile) =>
          profile.lifeBornAt !== undefined &&
          effectiveLifeStatus(profile.lifeStatus) === 'alive' &&
          oldAgeDeathBoundary({
            lifeBornAt: profile.lifeBornAt,
            realm: profile.realm,
          }) <= args.now,
      )
      .sort((a, b) => {
        const byBoundary =
          oldAgeDeathBoundary({ lifeBornAt: a.lifeBornAt!, realm: a.realm }) -
          oldAgeDeathBoundary({ lifeBornAt: b.lifeBornAt!, realm: b.realm });
        return byBoundary || a.actorId.localeCompare(b.actorId);
      })
      .slice(0, OLD_AGE_DEATH_BATCH_SIZE);

    const actorIds: string[] = [];
    let terminalizedCount = 0;
    for (const profile of due) {
      const result = await finalizeOldAgeDeath(ctx, profile, args.now);
      if (result.status !== 'deceased') continue;
      actorIds.push(profile.actorId);
      terminalizedCount += result.terminalizedCount;
    }
    return {
      status: actorIds.length === 0 ? ('no_op' as const) : ('advanced' as const),
      contractVersion: ACTOR_DEATH_VERSION,
      deceasedCount: actorIds.length,
      actorIds,
      terminalizedCount,
      batchLimit: OLD_AGE_DEATH_BATCH_SIZE,
      mayHaveMore: due.length === OLD_AGE_DEATH_BATCH_SIZE,
    };
  },
});

export const listHistoricalPeople = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 32)));
    const profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('byLifeStatusRecorded', (q) =>
        q.eq('worldId', args.worldId).eq('lifeStatus', 'deceased'),
      )
      .order('desc')
      .take(limit);
    return profiles.map((profile) => ({
      actorId: profile.actorId,
      name: profile.name,
      role: profile.role,
      realm: profile.deathRealm ?? profile.realm,
      lifespanYears: profile.deathLifespanYears,
      lifeBornAt: profile.lifeBornAt,
      deceasedAt: profile.deceasedAt,
      deathRecordedAt: profile.deathRecordedAt,
      deathCause: profile.deathCause,
      deathActionId: profile.deathActionId,
      deathEventId: profile.deathEventId,
      mapId: profile.mapId,
      locationId: profile.currentLocationId,
    }));
  },
});

export async function finalizeOldAgeDeath(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  now: number,
) {
  if (profile.lifeStatus === 'deceased') {
    return {
      status: 'already_deceased' as const,
      eventId: profile.deathEventId,
      terminalizedCount: 0,
    };
  }
  if (profile.lifeBornAt === undefined) {
    return { status: 'birth_anchor_pending' as const, terminalizedCount: 0 };
  }
  const deceasedAt = oldAgeDeathBoundary({
    lifeBornAt: profile.lifeBornAt,
    realm: profile.realm,
  });
  if (now < deceasedAt) {
    return { status: 'not_due' as const, terminalizedCount: 0 };
  }

  const lifespanYears = realmLifespanYears(profile.realm);
  const actionId = `life-death:old-age:${profile.actorId}:${profile.lifeBornAt}`;
  let event = await ctx.db
    .query('worldEvents')
    .withIndex('byAction', (q) =>
      q.eq('worldId', profile.worldId).eq('actionId', actionId),
    )
    .first();
  if (!event) {
    const eventId = await appendWorldEvent(ctx, {
      worldId: profile.worldId,
      type: 'actor_died_of_old_age',
      createdAt: deceasedAt,
      actorIds: [profile.actorId],
      locationId: profile.currentLocationId,
      actionId,
      visibility: 'public',
      summary: `${profile.name}寿元已尽，于太虚界中安然坐化。`,
      facts: versionDurableEventFacts({
        resultCode: 'actor_died_of_old_age',
        deathContractVersion: ACTOR_DEATH_VERSION,
        actorId: profile.actorId,
        realm: profile.realm,
        lifespanYears,
        lifeBornAt: profile.lifeBornAt,
        deceasedAt,
      }),
      mapId: profile.mapId,
    });
    event = (await ctx.db.get(eventId))!;
  }

  await ctx.db.patch(profile._id, {
    lifeStatus: 'deceased',
    deceasedAt,
    deathRecordedAt: now,
    deathCause: 'old_age',
    deathActionId: actionId,
    deathEventId: event._id,
    deathRealm: profile.realm,
    deathLifespanYears: lifespanYears,
    currentIntent: '寿元已尽，安然坐化。',
    recoveryEligibleAt: undefined,
    recoveryToken: undefined,
  });

  const terminalizedCount = await terminalizeActorRuntime(
    ctx,
    profile,
    event._id,
    deceasedAt,
    now,
  );
  return {
    status: 'deceased' as const,
    eventId: event._id,
    actionId,
    deceasedAt,
    terminalizedCount,
  };
}

async function terminalizeActorRuntime(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  deathEventId: Id<'worldEvents'>,
  deceasedAt: number,
  now: number,
) {
  let changed = 0;
  const executions = new Map<string, { row: Doc<'actionExecutions'>; targetOnly: boolean }>();
  for (const status of ACTIVE_EXECUTION_STATUSES) {
    const [owned, targeted] = await Promise.all([
      ctx.db
        .query('actionExecutions')
        .withIndex('byActorStatus', (q) =>
          q.eq('worldId', profile.worldId).eq('actorId', profile.actorId).eq('status', status),
        )
        .take(32),
      ctx.db
        .query('actionExecutions')
        .withIndex('byTargetStatus', (q) =>
          q
            .eq('worldId', profile.worldId)
            .eq('targetActorId', profile.actorId)
            .eq('status', status),
        )
        .take(32),
    ]);
    for (const row of owned) executions.set(String(row._id), { row, targetOnly: false });
    for (const row of targeted) {
      if (!executions.has(String(row._id))) {
        executions.set(String(row._id), { row, targetOnly: true });
      }
    }
  }
  for (const { row, targetOnly } of executions.values()) {
    const resultCode = targetOnly ? 'target_deceased' : 'actor_deceased';
    await ctx.db.patch(row._id, {
      status: 'interrupted',
      terminalAt: now,
      terminalEventId: deathEventId,
      resultCode,
      reasonCode: resultCode,
      updatedAt: now,
      expiresAt: Math.min(row.expiresAt, now),
    });
    const action = await ctx.db.get(row.actionRecordId);
    if (
      action &&
      action.status !== 'applied' &&
      action.status !== 'rejected' &&
      action.status !== 'interrupted'
    ) {
      await ctx.db.patch(action._id, {
        status: 'interrupted',
        result: {
          schemaVersion: 1,
          status: 'interrupted',
          resultCode,
          reason: targetOnly ? '目标已经寿终，持续动作已中断。' : '行动者已经寿终，持续动作已中断。',
          effects: {},
          eventType: 'action_execution_interrupted',
          visibility: 'local',
        },
      });
    }
    changed += 1;
  }

  for (const status of ACTIVE_MOVEMENT_STATUSES) {
    const rows = await ctx.db
      .query('movementCommands')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', profile.worldId).eq('actorId', profile.actorId).eq('status', status),
      )
      .take(32);
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        status: 'cancelled',
        reasonCode: 'actor_deceased',
        updatedAt: now,
        expiresAt: Math.min(row.expiresAt, now),
      });
      changed += 1;
    }
  }

  const goals = await ctx.db
    .query('personalGoals')
    .withIndex('byActorStatus', (q) =>
      q.eq('worldId', profile.worldId).eq('actorId', profile.actorId).eq('status', 'active'),
    )
    .take(8);
  for (const goal of goals) {
    await ctx.db.patch(goal._id, {
      status: 'cancelled',
      terminalReasonCode: 'actor_deceased',
      terminalAt: now,
      updatedAt: now,
    });
    changed += 1;
  }

  changed += await cancelPairConversations(ctx, profile, now);
  changed += await cancelGroupConversations(ctx, profile, deathEventId, now);
  changed += await expireNegotiations(ctx, profile, deathEventId, now);
  changed += await invalidateGroupCommitments(ctx, profile, now);
  changed += await expireRequests(ctx, profile, deathEventId, now);
  changed += await closeCombatEncounters(ctx, profile, deathEventId, now);

  const residents = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) =>
      q.eq('worldId', profile.worldId).eq('actorId', profile.actorId),
    )
    .take(8);
  for (const resident of residents) {
    const patch = deceasedResidentPatch(resident, now);
    if (!patch) continue;
    await ctx.db.patch(resident._id, patch);
    changed += 1;
  }

  return changed;
}

async function cancelPairConversations(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  now: number,
) {
  const sessions = new Map<string, Doc<'conversationSessions'>>();
  for (const status of ACTIVE_CONVERSATION_STATUSES) {
    const [asA, asB] = await Promise.all([
      ctx.db
        .query('conversationSessions')
        .withIndex('byActorAStatus', (q) =>
          q.eq('worldId', profile.worldId).eq('actorAId', profile.actorId).eq('status', status),
        )
        .take(16),
      ctx.db
        .query('conversationSessions')
        .withIndex('byActorBStatus', (q) =>
          q.eq('worldId', profile.worldId).eq('actorBId', profile.actorId).eq('status', status),
        )
        .take(16),
    ]);
    for (const session of [...asA, ...asB]) sessions.set(String(session._id), session);
  }
  for (const session of sessions.values()) {
    await ctx.db.patch(session._id, {
      status: 'cancelled',
      currentSpeakerActorId: undefined,
      terminalAt: now,
      terminalReasonCode: 'actor_deceased',
      updatedAt: now,
    });
  }
  return sessions.size;
}

async function cancelGroupConversations(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  deathEventId: Id<'worldEvents'>,
  now: number,
) {
  const memberships = await ctx.db
    .query('groupConversationMemberships')
    .withIndex('byActorStatus', (q) =>
      q.eq('worldId', profile.worldId).eq('actorId', profile.actorId).eq('status', 'active'),
    )
    .take(16);
  let changed = 0;
  for (const membership of memberships) {
    const session = await ctx.db
      .query('groupConversationSessions')
      .withIndex('byGroupConversation', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('groupConversationId', membership.groupConversationId),
      )
      .first();
    if (session?.status === 'active') {
      await ctx.db.patch(session._id, {
        status: 'cancelled',
        currentSpeakerActorId: undefined,
        terminalEventId: deathEventId,
        terminalAt: now,
        terminalReasonCode: 'actor_deceased',
        updatedAt: now,
      });
      changed += 1;
    }
    const groupMemberships = await ctx.db
      .query('groupConversationMemberships')
      .withIndex('byGroupRole', (q) =>
        q.eq('worldId', profile.worldId).eq('groupConversationId', membership.groupConversationId),
      )
      .take(64);
    for (const row of groupMemberships) {
      if (row.status !== 'active') continue;
      await ctx.db.patch(row._id, {
        status: 'cancelled',
        terminalAt: now,
        terminalReasonCode: 'actor_deceased',
        updatedAt: now,
      });
      changed += 1;
    }
    const proposals = await ctx.db
      .query('groupProposals')
      .withIndex('byGroupStatus', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('groupConversationId', membership.groupConversationId)
          .eq('status', 'open'),
      )
      .take(16);
    for (const proposal of proposals) {
      await ctx.db.patch(proposal._id, {
        status: 'invalidated',
        terminalEventId: deathEventId,
        terminalReasonCode: 'actor_deceased',
        updatedAt: now,
      });
      changed += 1;
    }
  }
  return changed;
}

async function expireNegotiations(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  deathEventId: Id<'worldEvents'>,
  now: number,
) {
  const sessions = new Map<string, Doc<'negotiationSessions'>>();
  for (const status of ACTIVE_NEGOTIATION_STATUSES) {
    const [asA, asB] = await Promise.all([
      ctx.db
        .query('negotiationSessions')
        .withIndex('byActorAStatus', (q) =>
          q.eq('worldId', profile.worldId).eq('actorAId', profile.actorId).eq('status', status),
        )
        .take(16),
      ctx.db
        .query('negotiationSessions')
        .withIndex('byActorBStatus', (q) =>
          q.eq('worldId', profile.worldId).eq('actorBId', profile.actorId).eq('status', status),
        )
        .take(16),
    ]);
    for (const session of [...asA, ...asB]) sessions.set(String(session._id), session);
  }
  let changed = 0;
  for (const session of sessions.values()) {
    await ctx.db.patch(session._id, {
      status: 'expired',
      currentResponderActorId: undefined,
      terminalEventId: deathEventId,
      terminalAt: now,
      terminalReasonCode: 'actor_deceased',
      updatedAt: now,
    });
    const proposal = await ctx.db
      .query('negotiationProposals')
      .withIndex('byProposal', (q) =>
        q.eq('worldId', profile.worldId).eq('proposalId', session.currentProposalId),
      )
      .first();
    if (proposal?.status === 'active') {
      await ctx.db.patch(proposal._id, {
        status: 'expired',
        terminalEventId: deathEventId,
        terminalAt: now,
        terminalReasonCode: 'actor_deceased',
      });
    }
    changed += 1;
  }
  return changed;
}

async function invalidateGroupCommitments(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  now: number,
) {
  const [donor, recipient] = await Promise.all([
    ctx.db
      .query('groupCommitments')
      .withIndex('byDonorStatus', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('donorActorId', profile.actorId)
          .eq('status', 'pending'),
      )
      .take(16),
    ctx.db
      .query('groupCommitments')
      .withIndex('byRecipientStatus', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('recipientActorId', profile.actorId)
          .eq('status', 'pending'),
      )
      .take(16),
  ]);
  const commitments = new Map([...donor, ...recipient].map((row) => [String(row._id), row]));
  for (const commitment of commitments.values()) {
    await ctx.db.patch(commitment._id, {
      status: 'invalidated',
      terminalReasonCode: 'actor_deceased',
      terminalAt: now,
      updatedAt: now,
    });
  }
  return commitments.size;
}

async function expireRequests(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  deathEventId: Id<'worldEvents'>,
  now: number,
) {
  const requests = new Map<string, Doc<'requests'>>();
  for (const status of ACTIVE_REQUEST_STATUSES) {
    const [issued, assigned] = await Promise.all([
      ctx.db
        .query('requests')
        .withIndex('byIssuer', (q) =>
          q.eq('worldId', profile.worldId).eq('issuerActorId', profile.actorId).eq('status', status),
        )
        .take(16),
      ctx.db
        .query('requests')
        .withIndex('byAssignee', (q) =>
          q
            .eq('worldId', profile.worldId)
            .eq('assigneeActorId', profile.actorId)
            .eq('status', status),
        )
        .take(16),
    ]);
    for (const request of [...issued, ...assigned]) requests.set(String(request._id), request);
  }
  for (const request of requests.values()) {
    await ctx.db.patch(request._id, {
      status: 'expired',
      revision: (request.revision ?? 1) + 1,
      lastTransitionEventId: deathEventId,
      lastTransitionAt: now,
    });
  }
  return requests.size;
}

async function closeCombatEncounters(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  deathEventId: Id<'worldEvents'>,
  now: number,
) {
  const [attacking, defending] = await Promise.all([
    ctx.db
      .query('combatEncounters')
      .withIndex('byAttackerStatus', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('attackerActorId', profile.actorId)
          .eq('status', 'active'),
      )
      .take(8),
    ctx.db
      .query('combatEncounters')
      .withIndex('byDefenderStatus', (q) =>
        q
          .eq('worldId', profile.worldId)
          .eq('defenderActorId', profile.actorId)
          .eq('status', 'active'),
      )
      .take(8),
  ]);
  const encounters = new Map([...attacking, ...defending].map((row) => [String(row._id), row]));
  for (const encounter of encounters.values()) {
    await ctx.db.patch(encounter._id, {
      status: 'closed',
      terminalEventId: deathEventId,
      closedAt: now,
      updatedAt: now,
    });
  }
  return encounters.size;
}

function emptyDeathBatch(reason: string) {
  return {
    status: reason,
    contractVersion: ACTOR_DEATH_VERSION,
    deceasedCount: 0,
    actorIds: [] as string[],
    terminalizedCount: 0,
    batchLimit: OLD_AGE_DEATH_BATCH_SIZE,
    mayHaveMore: false,
  };
}

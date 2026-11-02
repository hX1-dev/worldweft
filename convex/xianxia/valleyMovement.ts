import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { QINGLAN_VALLEY_GATE_DATA } from '../../data/qinglanValleyGate.generated';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import {
  qinglanResidentProfileSeed,
  qinglanResidentProfileSyncPatch,
} from './qinglanProfiles';
import { deceasedResidentPatch } from './qinglan';
import {
  ACTIVE_MOVEMENT_STATUSES,
  MOVEMENT_CANCELLATION_RETENTION_MS,
  MOVEMENT_LEASE_MS,
  QINGLAN_VALLEY_GATE_MAP_ID,
  TERMINAL_MOVEMENT_STATUSES,
  movementDecisionSourceValidator,
  movementReportStatusValidator,
  movementTargetValidator,
  tilePointValidator,
  type MovementCancellation,
  type MovementDecisionSource,
  type MovementGoal,
  type MovementProtocolErrorCode,
  type MovementReport,
  type MovementTarget,
} from './valleyMovementContracts';
import { isActorDeceased, isActorIncapacitated } from './lifeStateLogic';
import {
  evaluateMovementReport,
  isStaleMovementRevision,
  locationAtValleyTile,
  nextMovementRevision,
  resolveValleyMovementTarget,
  type TargetResolutionFailureCode,
  valleyMapData,
} from './valleyMovementLogic';
import {
  SEASONAL_RESOURCE_VERSION,
  VALLEY_DEW_HERB_RESOURCE_NODE_ID,
  VALLEY_DEW_HERB_SEASONAL_RULE,
  seasonForAppliedIndex,
  seasonalResourceStateForSeason,
} from './seasonalResourceLogic';
import { MS_PER_LIFE_SEASON } from './lifeCalendarLogic';
import { createValleyTravelPort } from './runtimeValleyTravelPort';

const MAX_MOVEMENT_COMMANDS_PER_ACTOR = 32;
const MAX_ACTIVE_MOVEMENT_COMMANDS = 128;
const MAX_RECENT_VALLEY_EVENTS = 12;
export { VALLEY_DEW_HERB_RESOURCE_NODE_ID };
const VALLEY_DEW_HERB_CAPACITY = 3;
const VALLEY_DEW_HERB_REFRESH_INTERVAL_MS = 30_000;

type CreateMovementCommandArgs = {
  worldId: Id<'worlds'>;
  actionRecordId: Id<'actionRecords'>;
  actorId: string;
  intent: string;
  decisionSource: MovementDecisionSource;
  requestedTarget: MovementTarget;
  now: number;
};

export type CreateMovementCommandResult =
  | { ok: true; goal: MovementGoal; command: Doc<'movementCommands'> }
  | {
      ok: false;
      reasonCode:
        | 'invalid_action_record'
        | 'resident_not_found'
        | 'actor_profile_not_found'
        | 'actor_deceased'
        | 'actor_incapacitated'
        | TargetResolutionFailureCode;
      reason: string;
    };

/**
 * Same-transaction adapter used by the travel action. It deliberately does not
 * call another Convex mutation: the action record and movement command either
 * commit together, or neither does.
 */
async function createValleyMovementCommandFromAuthority(
  ctx: MutationCtx,
  args: CreateMovementCommandArgs,
): Promise<CreateMovementCommandResult> {
  const actionRecord = await ctx.db.get(args.actionRecordId);
  if (
    !actionRecord ||
    actionRecord.worldId !== args.worldId ||
    actionRecord.actorId !== args.actorId ||
    actionRecord.type !== 'travel'
  ) {
    return {
      ok: false,
      reasonCode: 'invalid_action_record',
      reason: 'Movement commands must be linked to the matching travel action record.',
    };
  }

  const profile = await movementActorProfile(ctx, args.worldId, args.actorId);
  if (!profile) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      args.actorId,
      args.now,
      'actor_profile_not_found',
    );
    return {
      ok: false,
      reasonCode: 'actor_profile_not_found',
      reason: `No xianxia profile is registered for ${args.actorId}.`,
    };
  }
  if (isActorDeceased(profile)) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      args.actorId,
      args.now,
      'actor_deceased',
    );
    return {
      ok: false,
      reasonCode: 'actor_deceased',
      reason: 'The movement actor is deceased and cannot receive a movement goal.',
    };
  }
  if (isActorIncapacitated(profile.health)) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      args.actorId,
      args.now,
      'actor_incapacitated',
    );
    return {
      ok: false,
      reasonCode: 'actor_incapacitated',
      reason: 'The movement actor is incapacitated and cannot receive a movement goal.',
    };
  }

  const existingForAction = await ctx.db
    .query('movementCommands')
    .withIndex('byAction', (q) =>
      q.eq('worldId', args.worldId).eq('actionRecordId', args.actionRecordId),
    )
    .first();
  if (existingForAction) {
    return {
      ok: true,
      command: existingForAction,
      goal: movementGoal(existingForAction),
    };
  }

  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
    .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
    .first();
  if (!resident) {
    return {
      ok: false,
      reasonCode: 'resident_not_found',
      reason: `No valley resident is registered for ${args.actorId}.`,
    };
  }

  const previousCommands = await ctx.db
    .query('movementCommands')
    .withIndex('byActorRevision', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
    .order('desc')
    .take(MAX_MOVEMENT_COMMANDS_PER_ACTOR);
  const revision = nextMovementRevision(previousCommands);
  const residents = await ctx.db
    .query('qinglanResidents')
    .withIndex('byMap', (q) =>
      q.eq('worldId', args.worldId).eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID),
    )
    .take(128);
  const reservedCommands = (
    await Promise.all(
      (['pending', 'accepted', 'moving'] as const).map((status) =>
        ctx.db
          .query('movementCommands')
          .withIndex('byMapStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID)
              .eq('status', status),
          )
          .take(MAX_ACTIVE_MOVEMENT_COMMANDS),
      ),
    )
  ).flat();
  const resolution = resolveValleyMovementTarget({
    actorId: args.actorId,
    revision,
    currentTile: resident.displayTile,
    requestedTarget: args.requestedTarget,
    actorTiles: residents.map((entry) => ({ actorId: entry.actorId, tile: entry.displayTile })),
    occupiedTiles: reservedCommands
      .filter((command) => command.actorId !== args.actorId && command.expiresAt > args.now)
      .map((command) => command.acceptedTile),
  });
  if (!resolution.ok) return resolution;

  for (const previous of previousCommands) {
    if (!ACTIVE_MOVEMENT_STATUSES.has(previous.status)) continue;
    if (previous.expiresAt <= args.now) {
      await expireMovementCommand(ctx, previous, args.now);
      continue;
    }
    await ctx.db.patch(previous._id, {
      status: 'cancelled',
      reasonCode: 'superseded',
      updatedAt: args.now,
    });
    await appendMovementTerminalEvent(ctx, previous, 'cancelled', args.now);
  }

  const commandId = await ctx.db.insert('movementCommands', {
    worldId: args.worldId,
    actionRecordId: args.actionRecordId,
    revision,
    actorId: args.actorId,
    personalGoalId: actionRecord.personalGoalId,
    personalGoalRevision: actionRecord.personalGoalRevision,
    purposeIntentDigest: actionRecord.purposeIntentDigest,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    intent: args.intent,
    decisionSource: args.decisionSource,
    requestedTarget: args.requestedTarget,
    originTile: resident.displayTile,
    acceptedTile: resolution.acceptedTile,
    acceptedMaskType: resolution.maskType,
    resolvedLocationId: resolution.resolvedLocationId,
    status: 'pending',
    lastTile: resident.displayTile,
    issuedAt: args.now,
    updatedAt: args.now,
    expiresAt: args.now + MOVEMENT_LEASE_MS,
  });
  await ctx.db.patch(resident._id, {
    status: 'thinking',
    currentIntent: args.intent,
    targetTile: resolution.acceptedTile,
    finalTargetTile: resolution.acceptedTile,
    pathTiles: resolution.path.slice(1),
    updatedAt: args.now,
  });
  const command = (await ctx.db.get(commandId))!;
  return { ok: true, command, goal: movementGoal(command) };
}

const valleyTravelPort = createValleyTravelPort({
  reserve: ({ ctx, args }: { ctx: MutationCtx; args: CreateMovementCommandArgs }) =>
    createValleyMovementCommandFromAuthority(ctx, args),
});

// A4b adapter boundary. This preserves the exact same transaction, reservation
// and downstream Godot/report terminal ownership as the existing authority.
export async function createValleyMovementCommand(
  ctx: MutationCtx,
  args: CreateMovementCommandArgs,
): Promise<CreateMovementCommandResult> {
  return valleyTravelPort.reserve({ ctx, args });
}

export const issueMovementCommand = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actionRecordId: v.id('actionRecords'),
    actorId: v.string(),
    intent: v.string(),
    decisionSource: movementDecisionSourceValidator,
    requestedTarget: movementTargetValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await createValleyMovementCommand(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const prepareMovementGoals = internalMutation({
  args: {
    worldId: v.id('worlds'),
    mapId: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await prepareValleyMovementGoals(ctx, {
      ...args,
      now: args.now ?? Date.now(),
    }),
});

export async function prepareValleyMovementGoals(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; mapId: string; now: number },
) {
  if (args.mapId !== QINGLAN_VALLEY_GATE_MAP_ID) {
    return {
      ok: true as const,
      mapId: args.mapId,
      goals: [] as MovementGoal[],
      cancellations: [] as MovementCancellation[],
    };
  }
  const commands = (
    await Promise.all(
      (['pending', 'accepted', 'moving'] as const).map((status) =>
        ctx.db
          .query('movementCommands')
          .withIndex('byMapStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID)
              .eq('status', status),
          )
          .order('desc')
          .take(MAX_ACTIVE_MOVEMENT_COMMANDS),
      ),
    )
  ).flat();

  const goals: MovementGoal[] = [];
  const actorProfiles = new Map<string, Doc<'xianxiaProfiles'> | null>();
  const cancelledActors = new Set<string>();
  for (const command of commands) {
    let profile = actorProfiles.get(command.actorId);
    if (profile === undefined) {
      profile = await movementActorProfile(ctx, args.worldId, command.actorId);
      actorProfiles.set(command.actorId, profile);
    }
    const cancellationReason = !profile
      ? 'actor_profile_not_found'
      : isActorDeceased(profile)
        ? 'actor_deceased'
        : isActorIncapacitated(profile.health)
        ? 'actor_incapacitated'
        : undefined;
    if (cancellationReason) {
      if (!cancelledActors.has(command.actorId)) {
        await cancelActiveValleyMovementCommands(
          ctx,
          args.worldId,
          command.actorId,
          args.now,
          cancellationReason,
        );
        cancelledActors.add(command.actorId);
      }
      continue;
    }
    if (command.expiresAt <= args.now) {
      await expireMovementCommand(ctx, command, args.now);
      continue;
    }
    goals.push(movementGoal(command));
  }

  const cancelledCommands = await ctx.db
    .query('movementCommands')
    .withIndex('byMapStatus', (q) =>
      q
        .eq('worldId', args.worldId)
        .eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID)
        .eq('status', 'cancelled')
        .gte('updatedAt', args.now - MOVEMENT_CANCELLATION_RETENTION_MS),
    )
    .order('desc')
    .take(MAX_ACTIVE_MOVEMENT_COMMANDS);
  const cancellations = cancelledCommands.map(movementCancellation);
  goals.sort((a, b) => a.issuedAt - b.issuedAt || a.actorId.localeCompare(b.actorId));
  cancellations.sort((a, b) => a.cancelledAt - b.cancelledAt || a.actorId.localeCompare(b.actorId));
  return {
    ok: true as const,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    goals,
    cancellations,
  };
}

export const reportMovement = internalMutation({
  args: {
    worldId: v.id('worlds'),
    commandId: v.id('movementCommands'),
    revision: v.number(),
    actorId: v.string(),
    status: movementReportStatusValidator,
    positionTiles: tilePointValidator,
    reasonCode: v.optional(v.string()),
    reportedAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await applyValleyMovementReport(ctx, {
      ...args,
      now: args.now ?? Date.now(),
    }),
});

export async function applyValleyMovementReport(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    commandId: Id<'movementCommands'>;
    revision: number;
    actorId: string;
    status: MovementReport['status'];
    positionTiles: MovementReport['positionTiles'];
    reasonCode?: string;
    reportedAt: number;
    now: number;
  },
) {
  const command = await ctx.db.get(args.commandId);
  if (!command || command.worldId !== args.worldId) {
    return reportFailure('command_not_found', 'The movement command does not exist.');
  }
  if (args.actorId !== command.actorId) {
    return reportFailure('actor_mismatch', 'The movement report actor does not own the command.');
  }
  const latestCommand = await ctx.db
    .query('movementCommands')
    .withIndex('byActorRevision', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', command.actorId),
    )
    .order('desc')
    .first();
  if (isStaleMovementRevision(args.revision, command, latestCommand)) {
    return reportFailure('stale_revision', 'The movement report revision is no longer current.');
  }
  if (TERMINAL_MOVEMENT_STATUSES.has(command.status)) {
    return reportFailure('command_terminal', 'The movement command is already terminal.');
  }

  const profile = await movementActorProfile(ctx, args.worldId, command.actorId);
  if (!profile) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      command.actorId,
      args.now,
      'actor_profile_not_found',
    );
    return reportFailure(
      'actor_profile_not_found',
      'The movement actor no longer has a xianxia profile.',
    );
  }
  if (isActorDeceased(profile)) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      command.actorId,
      args.now,
      'actor_deceased',
    );
    return reportFailure(
      'actor_deceased',
      'The movement actor is deceased; the active command was cancelled.',
    );
  }
  if (isActorIncapacitated(profile.health)) {
    await cancelActiveValleyMovementCommands(
      ctx,
      args.worldId,
      command.actorId,
      args.now,
      'actor_incapacitated',
    );
    return reportFailure(
      'actor_incapacitated',
      'The movement actor is incapacitated; the active command was cancelled.',
    );
  }
  if (command.expiresAt <= args.now) {
    await expireMovementCommand(ctx, command, args.now);
    return reportFailure('command_expired', 'The movement command lease has expired.');
  }
  const report: MovementReport = {
    commandId: args.commandId,
    revision: args.revision,
    actorId: args.actorId,
    status: args.status,
    positionTiles: args.positionTiles,
    reasonCode: args.reasonCode,
    reportedAt: args.reportedAt,
  };
  const decision = evaluateMovementReport(command, report, args.now);
  if (!decision.ok) return decision;

  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', command.actorId))
    .filter((q) => q.eq(q.field('mapId'), command.mapId))
    .first();
  if (!resident) {
    return reportFailure('resident_not_found', 'The command actor has no valley resident body.');
  }

  await ctx.db.patch(command._id, decision.patch);
  const terminal = ['arrived', 'blocked', 'cancelled'].includes(args.status);
  const residentPatch: Partial<Doc<'qinglanResidents'>> = {
    displayTile: decision.patch.lastTile,
    status: terminal ? 'idle' : 'moving',
    targetTile: terminal ? undefined : command.acceptedTile,
    finalTargetTile: terminal ? undefined : command.acceptedTile,
    pathTiles: terminal ? undefined : resident.pathTiles,
    currentIntent: command.intent,
    nextActionAt: terminal
      ? args.now + (args.status === 'arrived' ? arrivalDwellMs(command.actorId) : 2_000)
      : resident.nextActionAt,
    updatedAt: args.now,
  };
  if (args.status === 'arrived' && command.resolvedLocationId) {
    residentPatch.currentLocationId = command.resolvedLocationId;
  }
  await ctx.db.patch(resident._id, residentPatch);

  if (args.status === 'arrived' && command.resolvedLocationId) {
    await ctx.db.patch(profile._id, {
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      currentLocationId: command.resolvedLocationId,
      currentIntent: command.intent,
    });
  }
  if (args.status === 'arrived' || args.status === 'blocked' || args.status === 'cancelled') {
    await appendMovementTerminalEvent(ctx, command, args.status, args.now);
  }

  return {
    ok: true as const,
    commandId: command._id,
    revision: command.revision,
    status: args.status,
    positionTiles: decision.patch.lastTile,
    expiresAt: decision.patch.expiresAt,
  };
}

export const ensureValleyAutonomySeeded = internalMutation({
  args: { worldId: v.id('worlds'), now: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await ensureValleySurfaceSeeded(ctx, args.worldId, args.now ?? Date.now()),
});

export const getValleyAutonomyState = internalQuery({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const locations = await ctx.db
      .query('locations')
      .withIndex('byMap', (q) =>
        q.eq('worldId', args.worldId).eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID),
      )
      .take(64);
    const residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) =>
        q.eq('worldId', args.worldId).eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID),
      )
      .take(64);
    return {
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      dimensions: {
        width: QINGLAN_VALLEY_GATE_DATA.width,
        height: QINGLAN_VALLEY_GATE_DATA.height,
        tileSize: QINGLAN_VALLEY_GATE_DATA.tileSize,
      },
      locations,
      residents,
    };
  },
});

export const valleyAutonomyContext = internalQuery({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args) => {
    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
      .first();
    const history = await ctx.db
      .query('movementCommands')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .take(8);
    const active = history.find((command) => ACTIVE_MOVEMENT_STATUSES.has(command.status));
    const recentEvents = await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) =>
        q.eq('worldId', args.worldId).eq('mapId', QINGLAN_VALLEY_GATE_MAP_ID),
      )
      .order('desc')
      .take(MAX_RECENT_VALLEY_EVENTS);
    return {
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      residentTile: resident?.displayTile,
      currentLocationId: resident?.currentLocationId,
      fatigue: resident?.fatigue,
      herbNeed: resident?.herbNeed,
      hasMovementHistory: history.length > 0,
      activeCommand: active ? movementGoal(active) : undefined,
      recentMapEvents: recentEvents.map((event) => ({
        type: event.type,
        createdAt: event.createdAt,
        actorIds: event.actorIds,
        locationId: event.locationId,
        summary: event.summary,
      })),
    };
  },
});

export async function ensureValleySurfaceSeeded(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  now: number,
) {
  let createdLocations = 0;
  let createdResidents = 0;
  let createdProfiles = 0;
  let createdResourceNodes = 0;

  for (const location of QINGLAN_VALLEY_GATE_DATA.locations) {
    const payload = valleyLocationPayload(location);
    const existing = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) => q.eq('worldId', worldId).eq('locationId', location.id))
      .first();
    if (existing) await ctx.db.patch(existing._id, payload);
    else {
      await ctx.db.insert('locations', { worldId, ...payload });
      createdLocations += 1;
    }
  }

  for (let index = 0; index < QINGLAN_VALLEY_GATE_DATA.npcPoints.length; index += 1) {
    const point = QINGLAN_VALLEY_GATE_DATA.npcPoints[index];
    const seed = valleyResidentSeed(point, index, now);
    let resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byResident', (q) => q.eq('worldId', worldId).eq('residentId', seed.residentId))
      .first();
    if (!resident) {
      const residentId = await ctx.db.insert('qinglanResidents', { worldId, ...seed });
      resident = (await ctx.db.get(residentId))!;
      createdResidents += 1;
    } else {
      await ctx.db.patch(resident._id, {
        name: seed.name,
        role: seed.role,
        character: seed.character,
        fatigue: resident.fatigue ?? seed.fatigue,
        herbNeed: resident.herbNeed ?? seed.herbNeed,
      });
    }

    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', seed.actorId))
      .first();
    if (profile) {
      if (isActorDeceased(profile)) {
        await ctx.db.patch(profile._id, qinglanResidentProfileSyncPatch(profile, resident));
        const stopped = deceasedResidentPatch(resident, now);
        if (stopped) await ctx.db.patch(resident._id, stopped);
      } else {
        await ctx.db.patch(profile._id, qinglanResidentProfileSyncPatch(profile, resident));
      }
    } else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId,
        ...qinglanResidentProfileSeed(resident),
      });
      createdProfiles += 1;
    }
  }

  const herbInteraction = QINGLAN_VALLEY_GATE_DATA.interactions.find(
    (interaction) => interaction.id === VALLEY_DEW_HERB_RESOURCE_NODE_ID,
  );
  if (
    !herbInteraction ||
    herbInteraction.locationId !== 'herb_meadow' ||
    !herbInteraction.actions.includes('gather')
  ) {
    throw new Error('Valley dew herb interaction is missing from generated map data.');
  }
  const existingHerbNode = await ctx.db
    .query('resourceNodes')
    .withIndex('byNode', (q) =>
      q
        .eq('worldId', worldId)
        .eq('resourceNodeId', VALLEY_DEW_HERB_RESOURCE_NODE_ID),
    )
    .first();
  const lifeCalendarConfig = await ctx.db
    .query('xianxiaConfig')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .first();
  const registeredSeasonIndex =
    existingHerbNode?.seasonalAppliedSeasonIndex ??
    lifeCalendarConfig?.lifeCalendarAppliedSeasonIndex ??
    0;
  const registeredSeason = seasonForAppliedIndex(registeredSeasonIndex);
  const registeredSeasonalState =
    seasonalResourceStateForSeason(registeredSeason);
  const registeredSeasonalRefreshBlockedUntil =
    registeredSeasonalState === 'dormant' &&
    lifeCalendarConfig?.lifeCalendarStartedAt !== undefined
      ? lifeCalendarConfig.lifeCalendarStartedAt +
        (registeredSeasonIndex + 1) * MS_PER_LIFE_SEASON
      : undefined;
  const herbNodeIdentity = {
    name: herbInteraction.name,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    locationId: herbInteraction.locationId,
    itemId: 'spirit_herb',
    tile: herbInteraction.tile,
    capacity: VALLEY_DEW_HERB_CAPACITY,
    refreshAmount: 1,
    refreshIntervalMs: VALLEY_DEW_HERB_REFRESH_INTERVAL_MS,
    seasonalContractVersion: SEASONAL_RESOURCE_VERSION,
    seasonalRule: VALLEY_DEW_HERB_SEASONAL_RULE,
    seasonalState: registeredSeasonalState,
    seasonalAppliedSeasonIndex: registeredSeasonIndex,
    seasonalRefreshBlockedUntil: registeredSeasonalRefreshBlockedUntil,
    accessRule: 'public' as const,
    ownerActorId: undefined,
  };
  if (existingHerbNode) {
    const stock = Math.max(
      0,
      Math.min(VALLEY_DEW_HERB_CAPACITY, Math.floor(existingHerbNode.stock)),
    );
    await ctx.db.patch(existingHerbNode._id, {
      ...herbNodeIdentity,
      stock,
      nextRefreshAt:
        stock < VALLEY_DEW_HERB_CAPACITY
          ? Math.max(
              existingHerbNode.nextRefreshAt ??
                now + VALLEY_DEW_HERB_REFRESH_INTERVAL_MS,
              registeredSeasonalRefreshBlockedUntil ?? Number.NEGATIVE_INFINITY,
            )
          : undefined,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('resourceNodes', {
      worldId,
      resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
      ...herbNodeIdentity,
      stock: VALLEY_DEW_HERB_CAPACITY,
      nextRefreshAt: undefined,
      updatedAt: now,
    });
    createdResourceNodes += 1;
  }

  const enteredEvent = await ctx.db
    .query('worldEvents')
    .withIndex('byType', (q) => q.eq('worldId', worldId).eq('type', 'player_entered_valley'))
    .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
    .first();
  if (!enteredEvent) {
    await appendWorldEvent(ctx, {
      worldId,
      type: 'player_entered_valley',
      createdAt: now,
      actorIds: ['godot_player'],
      locationId: 'valley_west_entry',
      visibility: 'local',
      summary: '入世者走进青岚溪谷西口。',
      facts: versionDurableEventFacts({ resultCode: 'player_entered', source: 'godot' }),
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    });
  }

  return {
    ok: true as const,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    locations: QINGLAN_VALLEY_GATE_DATA.locations.length,
    residents: QINGLAN_VALLEY_GATE_DATA.npcPoints.length,
    profiles: QINGLAN_VALLEY_GATE_DATA.npcPoints.length,
    created: {
      locations: createdLocations,
      residents: createdResidents,
      profiles: createdProfiles,
      resourceNodes: createdResourceNodes,
      playerEnteredEvent: enteredEvent ? 0 : 1,
    },
  };
}

/**
 * Cancels every still-active revision for one valley actor. The function is
 * exported so the authoritative health transition can interrupt the body in
 * the same Convex transaction; the goal poll and report paths also call it as
 * a fail-closed backstop for races and older callers.
 */
export async function cancelActiveValleyMovementCommands(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
  reasonCode: 'actor_incapacitated' | 'actor_profile_not_found' | 'actor_deceased',
): Promise<MovementCancellation[]> {
  const commands = (
    await Promise.all(
      (['pending', 'accepted', 'moving'] as const).map((status) =>
        ctx.db
          .query('movementCommands')
          .withIndex('byActorStatus', (q) =>
            q.eq('worldId', worldId).eq('actorId', actorId).eq('status', status),
          )
          .order('desc')
          .take(MAX_MOVEMENT_COMMANDS_PER_ACTOR),
      ),
    )
  ).flat();
  const cancellations: MovementCancellation[] = [];
  for (const command of commands) {
    // A preceding cancellation in this transaction may have invalidated the
    // snapshot returned by another status query. Re-read before writing so a
    // terminal command never receives a second terminal event.
    const current = await ctx.db.get(command._id);
    if (!current || !ACTIVE_MOVEMENT_STATUSES.has(current.status)) continue;
    await ctx.db.patch(current._id, {
      status: 'cancelled',
      reasonCode,
      updatedAt: now,
    });
    const cancelled = { ...current, status: 'cancelled' as const, reasonCode, updatedAt: now };
    cancellations.push(movementCancellation(cancelled));
    await appendMovementTerminalEvent(ctx, current, 'cancelled', now, reasonCode);
  }

  if (cancellations.length > 0) {
    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
      .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
      .first();
    if (resident) {
      await ctx.db.patch(resident._id, {
        status: 'incapacitated',
        targetTile: undefined,
        finalTargetTile: undefined,
        pathTiles: undefined,
        currentIntent:
          reasonCode === 'actor_incapacitated'
            ? '气血耗尽，无法行动。'
            : '角色档案缺失，移动已停止。',
        activityLabel: '失能',
        updatedAt: now,
      });
    }
  }
  cancellations.sort((a, b) => a.revision - b.revision);
  return cancellations;
}

async function movementActorProfile(ctx: MutationCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}

async function expireMovementCommand(
  ctx: MutationCtx,
  command: Doc<'movementCommands'>,
  now: number,
) {
  await ctx.db.patch(command._id, {
    status: 'expired',
    reasonCode: 'lease_expired',
    updatedAt: now,
  });
  await appendMovementTerminalEvent(
    ctx,
    command,
    'cancelled',
    now,
    'lease_expired',
  );
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', command.worldId).eq('actorId', command.actorId))
    .filter((q) => q.eq(q.field('mapId'), command.mapId))
    .first();
  if (resident) {
    await ctx.db.patch(resident._id, {
      status: 'idle',
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      updatedAt: now,
    });
  }
}

function movementGoal(command: Doc<'movementCommands'>): MovementGoal {
  return {
    commandId: command._id,
    actionRecordId: command.actionRecordId,
    revision: command.revision,
    actorId: command.actorId,
    personalGoalId: command.personalGoalId,
    personalGoalRevision: command.personalGoalRevision,
    purposeIntentDigest: command.purposeIntentDigest,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    intent: command.intent,
    decisionSource: command.decisionSource,
    requestedTarget: command.requestedTarget,
    acceptedTile: command.acceptedTile,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt,
  };
}

function movementCancellation(command: Doc<'movementCommands'>): MovementCancellation {
  return {
    commandId: command._id,
    revision: command.revision,
    actorId: command.actorId,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    reasonCode: command.reasonCode ?? 'cancelled',
    cancelledAt: command.updatedAt,
  };
}

function valleyLocationPayload(location: (typeof QINGLAN_VALLEY_GATE_DATA.locations)[number]) {
  const traits = VALLEY_LOCATION_TRAITS[location.id];
  return {
    locationId: location.id,
    name: location.name,
    kind: traits.kind,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    dangerLevel: traits.dangerLevel,
    spiritualEnergy: traits.spiritualEnergy,
    allowedActions: [...traits.allowedActions],
    entryPoints: [location.entryPoint],
    bounds: {
      x1: location.bounds.x,
      y1: location.bounds.y,
      x2: location.bounds.x + location.bounds.width - 1,
      y2: location.bounds.y + location.bounds.height - 1,
    },
    description: traits.description,
  };
}

function valleyResidentSeed(
  point: (typeof QINGLAN_VALLEY_GATE_DATA.npcPoints)[number],
  index: number,
  now: number,
) {
  const role = ['bridge_guard', 'mist_sentinel'].includes(point.id) ? 'guard' : 'outer_disciple';
  const actorId = `${QINGLAN_VALLEY_GATE_MAP_ID}:${point.id}`;
  const intent =
    role === 'guard' ? '守在原地，等待溪谷中的异常事件。' : '观察附近动静，没有需要时留在原地。';
  return {
    residentId: actorId,
    actorId,
    name: point.name,
    role,
    character: `f${(index % 5) + 1}`,
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
    currentLocationId: point.locationId,
    displayTile: point.tile,
    orientation: 0,
    status: 'idle' as const,
    currentIntent: intent,
    activityLabel: role === 'guard' ? '守望' : '待机',
    nextActionAt: now + 5_000,
    fatigue: point.id === 'herb_gatherer' ? 80 : undefined,
    herbNeed: point.id === 'herb_gatherer' ? 70 : undefined,
    updatedAt: now,
  };
}

export async function markValleyResidentActionStarted(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    actionType: 'rest' | 'gather';
    intent: string;
    now: number;
  },
) {
  if (!args.actorId.startsWith(`${QINGLAN_VALLEY_GATE_MAP_ID}:`)) return null;
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId),
    )
    .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
    .first();
  if (!resident) return null;
  await ctx.db.patch(resident._id, {
    status: args.actionType === 'rest' ? 'resting' : 'arranging_herbs',
    currentIntent: args.intent,
    activityLabel: args.actionType === 'rest' ? '调息休息' : '采集凝露草',
    updatedAt: args.now,
  });
  return resident._id;
}

export async function finishValleyResidentAction(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    actionType: 'rest' | 'gather';
    fatigueAfter?: number;
    completed: boolean;
    now: number;
  },
) {
  if (!args.actorId.startsWith(`${QINGLAN_VALLEY_GATE_MAP_ID}:`)) return null;
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId),
    )
    .filter((q) => q.eq(q.field('mapId'), QINGLAN_VALLEY_GATE_MAP_ID))
    .first();
  if (!resident) return null;
  const patch: Partial<Doc<'qinglanResidents'>> = {
    status: 'idle',
    activityLabel: args.completed
      ? args.actionType === 'rest'
        ? '休息完毕'
        : '采药完毕'
      : '动作中止',
    nextActionAt: args.now + 2_000,
    updatedAt: args.now,
  };
  if (args.completed && args.fatigueAfter !== undefined) {
    patch.fatigue = args.fatigueAfter;
  }
  if (
    args.completed &&
    args.actionType === 'gather' &&
    args.actorId.endsWith(':herb_gatherer')
  ) {
    patch.herbNeed = 30;
  }
  await ctx.db.patch(resident._id, patch);
  return resident._id;
}

function arrivalDwellMs(actorId: string) {
  if (actorId.endsWith(':valley_guide')) return 6_000;
  return 8_000;
}

async function appendMovementTerminalEvent(
  ctx: MutationCtx,
  command: Doc<'movementCommands'>,
  status: 'arrived' | 'blocked' | 'cancelled',
  now: number,
  reasonCode?: string,
) {
  const locationId = command.resolvedLocationId ?? locationAtValleyTile(command.acceptedTile);
  await appendWorldEvent(ctx, {
    worldId: command.worldId,
    type: `movement_${status}`,
    createdAt: now,
    actorIds: [command.actorId],
    locationId,
    actionId: command.actionRecordId,
    visibility: 'local',
    summary:
      status === 'arrived'
        ? `${command.actorId}已到达移动目标。`
        : `${command.actorId}的移动已${status === 'blocked' ? '受阻' : '取消'}${reasonCode ? `（${reasonCode}）` : ''}。`,
    facts: reasonCode
      ? versionDurableEventFacts({ resultCode: reasonCode })
      : versionDurableEventFacts({ resultCode: `movement_${status}`, source: 'godot' }),
    mapId: QINGLAN_VALLEY_GATE_MAP_ID,
  });
}

function reportFailure(code: MovementProtocolErrorCode, reason: string) {
  return { ok: false as const, code, reason };
}

const VALLEY_LOCATION_TRAITS: Record<
  string,
  {
    kind: string;
    dangerLevel: number;
    spiritualEnergy: number;
    allowedActions: readonly string[];
    description: string;
  }
> = {
  valley_west_entry: {
    kind: 'mountain_gate',
    dangerLevel: 1,
    spiritualEnergy: 3,
    allowedActions: ['talk', 'travel'],
    description: '通往青岚坊市的溪谷西口。',
  },
  rest_clearing: {
    kind: 'camp',
    dangerLevel: 1,
    spiritualEnergy: 5,
    allowedActions: ['cultivate', 'rest', 'talk'],
    description: '松风间的歇脚地，适合调息。',
  },
  creek_bridge: {
    kind: 'bridge',
    dangerLevel: 2,
    spiritualEnergy: 4,
    allowedActions: ['explore', 'inspect', 'talk'],
    description: '横跨溪流的狭窄木桥。',
  },
  herb_meadow: {
    kind: 'resource_field',
    dangerLevel: 2,
    spiritualEnergy: 7,
    allowedActions: ['explore', 'gather', 'talk'],
    description: '长有凝露草的向阳山坡。',
  },
  sealed_shrine: {
    kind: 'sealed_shrine',
    dangerLevel: 5,
    spiritualEnergy: 8,
    allowedActions: ['explore', 'inspect'],
    description: '被封印的古老山祠。',
  },
  mist_gate: {
    kind: 'portal',
    dangerLevel: 4,
    spiritualEnergy: 6,
    allowedActions: ['travel', 'talk'],
    description: '通往溪谷深处的雾门。',
  },
};

// Keep the generated mask import live in this module and fail early if the
// build pipeline ever changes its public shape.
if (
  QINGLAN_VALLEY_GATE_DATA.mapId !== QINGLAN_VALLEY_GATE_MAP_ID ||
  valleyMapData().width !== 48 ||
  valleyMapData().height !== 36
) {
  throw new Error('Invalid qinglan_valley_gate generated data contract.');
}

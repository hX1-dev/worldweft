import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionResult } from './actionSchema';
import type { DurableEventFacts } from './durableContracts';
import { versionDurableEventFacts } from './durableContracts';
import { isQinglanTileWalkable } from './qinglanNavigation';
import {
  resolveValleyPortal,
  selectPortalDestinationTile,
  validateValleyPortalArrival,
  type PortalTile,
} from './valleyPortalLogic';

const MAX_PORTAL_DESTINATION_RESIDENTS = 128;

export type PreparedValleyPortalTransition = {
  residentId: Id<'qinglanResidents'>;
  portalId: string;
  sourceMovementCommandId: Id<'movementCommands'>;
  fromMapId: string;
  fromLocationId: string;
  toMapId: string;
  toLocationId: string;
  toTile: PortalTile;
  intent: string;
};

export type ValleyPortalPreparation =
  | {
      ok: true;
      result: ActionResult;
      eventFacts: DurableEventFacts;
      transition: PreparedValleyPortalTransition;
    }
  | {
      ok: false;
      reasonCode:
        | 'portal_unknown'
        | 'portal_destination_unavailable'
        | 'portal_source_mismatch'
        | 'portal_not_reached'
        | 'portal_body_mismatch'
        | 'portal_destination_unknown'
        | 'portal_destination_occupied';
      reason: string;
    };
type ValleyPortalFailureCode = Extract<
  ValleyPortalPreparation,
  { ok: false }
>['reasonCode'];

export async function prepareValleyPortalTransition(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    profile: Doc<'xianxiaProfiles'>;
    portalId: string;
    reportedTile?: PortalTile;
    intent?: string;
  },
): Promise<ValleyPortalPreparation> {
  const lookup = resolveValleyPortal(args.portalId);
  if (!lookup.ok) {
    return portalFailure(
      lookup.reasonCode,
      lookup.reasonCode === 'portal_unknown'
        ? `未知 Portal「${args.portalId}」。`
        : `Portal「${args.portalId}」尚未开放目的地。`,
    );
  }
  const portal = lookup.portal;
  const [resident, command] = await Promise.all([
    ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .first(),
    ctx.db
      .query('movementCommands')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first(),
  ]);
  const arrivalCommand =
    command?.lastTile
      ? {
          actorId: command.actorId,
          mapId: command.mapId,
          status: command.status,
          requestedTarget: command.requestedTarget,
          acceptedTile: command.acceptedTile,
          lastTile: command.lastTile,
          resolvedLocationId: command.resolvedLocationId,
        }
      : null;
  const arrival = validateValleyPortalArrival({
    actorId: args.actorId,
    portal,
    profile: args.profile,
    resident,
    command: arrivalCommand,
    reportedTile: args.reportedTile,
  });
  if (!arrival.ok) {
    return portalFailure(arrival.reasonCode, portalArrivalFailureReason(arrival.reasonCode));
  }

  const sourceTravelAction = await ctx.db.get(command!.actionRecordId);
  if (
    !sourceTravelAction ||
    sourceTravelAction.worldId !== args.worldId ||
    sourceTravelAction.actorId !== args.actorId ||
    sourceTravelAction.type !== 'travel' ||
    sourceTravelAction.status !== 'applied'
  ) {
    return portalFailure(
      'portal_not_reached',
      'Portal 抵达没有关联一条已应用的 travel ActionRecord。',
    );
  }

  const destinationLocation = await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) =>
      q
        .eq('worldId', args.worldId)
        .eq('locationId', portal.destinationLocationId),
    )
    .first();
  if (!destinationLocation || destinationLocation.mapId !== portal.destinationMapId) {
    return portalFailure(
      'portal_destination_unknown',
      `Portal 目的地 ${portal.destinationMapId}/${portal.destinationLocationId} 不存在。`,
    );
  }

  const destinationResidents = await ctx.db
    .query('qinglanResidents')
    .withIndex('byMap', (q) =>
      q.eq('worldId', args.worldId).eq('mapId', portal.destinationMapId),
    )
    .take(MAX_PORTAL_DESTINATION_RESIDENTS);
  const occupiedTiles = destinationResidents
    .filter((entry) => entry.actorId !== args.actorId)
    .map((entry) => entry.displayTile);
  const toTile = selectPortalDestinationTile(
    destinationLocation.entryPoints,
    occupiedTiles,
    (tile) =>
      portal.destinationMapId === 'qinglan' &&
      isQinglanTileWalkable(tile),
  );
  if (!toTile) {
    return portalFailure(
      'portal_destination_occupied',
      `Portal 目的地 ${destinationLocation.name} 暂无可用出口。`,
    );
  }

  const intent = args.intent ?? `经${portal.portalId}抵达${destinationLocation.name}`;
  const transition: PreparedValleyPortalTransition = {
    residentId: resident!._id,
    portalId: portal.portalId,
    sourceMovementCommandId: command!._id,
    fromMapId: portal.sourceMapId,
    fromLocationId: portal.sourceLocationId,
    toMapId: portal.destinationMapId,
    toLocationId: portal.destinationLocationId,
    toTile,
    intent,
  };
  const result: ActionResult = {
    status: 'applied',
    resultCode: 'portal_arrived',
    reason: `${args.profile.name}穿过入口，抵达${destinationLocation.name}。`,
    effects: {
      locationChange: {
        fromMapId: transition.fromMapId,
        fromLocationId: transition.fromLocationId,
        toMapId: transition.toMapId,
        toLocationId: transition.toLocationId,
        toTile: transition.toTile,
        intent,
      },
    },
    eventType: 'actor_arrived_location',
    visibility: 'local',
  };
  return {
    ok: true,
    result,
    eventFacts: versionDurableEventFacts({
      resultCode: 'portal_arrived',
      portalId: transition.portalId,
      sourceMovementCommandId: String(transition.sourceMovementCommandId),
      fromMapId: transition.fromMapId,
      fromLocationId: transition.fromLocationId,
      toMapId: transition.toMapId,
      toLocationId: transition.toLocationId,
      toTile: transition.toTile,
    }),
    transition,
  };
}

export async function commitValleyPortalTransition(
  ctx: MutationCtx,
  transition: PreparedValleyPortalTransition,
  now: number,
) {
  const resident = await ctx.db.get(transition.residentId);
  if (!resident) throw new Error('portal_resident_disappeared');
  await ctx.db.patch(resident._id, {
    mapId: transition.toMapId,
    currentLocationId: transition.toLocationId,
    displayTile: transition.toTile,
    targetTile: undefined,
    finalTargetTile: undefined,
    pathTiles: undefined,
    status: 'idle',
    currentIntent: transition.intent,
    activityLabel: '待机',
    waypointId: undefined,
    nextActionAt: now + 2_000,
    updatedAt: now,
  });
}

function portalFailure(
  reasonCode: ValleyPortalFailureCode,
  reason: string,
): ValleyPortalPreparation {
  return { ok: false, reasonCode, reason };
}

function portalArrivalFailureReason(
  reasonCode: 'portal_source_mismatch' | 'portal_not_reached' | 'portal_body_mismatch',
) {
  switch (reasonCode) {
    case 'portal_source_mismatch':
      return '角色的权威地图或地点与 Portal 源端不一致。';
    case 'portal_not_reached':
      return '角色尚未沿同一 travel 命令抵达 Portal 精确格。';
    case 'portal_body_mismatch':
      return 'Godot 上报格与服务器确认的 Portal 身体位置不一致。';
  }
}

import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionResult } from './actionSchema';
import type { DurableEventFacts } from './durableContracts';
import { versionDurableEventFacts } from './durableContracts';
import {
  resolveValleyInspection,
  validateValleyInspectionArrival,
  type InspectTile,
} from './valleyInspectLogic';

export type ValleyInspectionPreparation =
  | {
      ok: true;
      result: ActionResult;
      eventFacts: DurableEventFacts;
      sourceMovementCommandId: Id<'movementCommands'>;
    }
  | {
      ok: false;
      reasonCode:
        | 'inspect_target_unknown'
        | 'inspect_action_forbidden'
        | 'inspect_source_mismatch'
        | 'inspect_not_reached'
        | 'inspect_body_mismatch';
      reason: string;
    };

type ValleyInspectionFailureCode = Extract<
  ValleyInspectionPreparation,
  { ok: false }
>['reasonCode'];

export async function prepareValleyInspection(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    profile: Doc<'xianxiaProfiles'>;
    interactionId: string;
    reportedTile?: InspectTile;
  },
): Promise<ValleyInspectionPreparation> {
  const lookup = resolveValleyInspection(args.interactionId);
  if (!lookup.ok) {
    return inspectionFailure(
      lookup.reasonCode,
      lookup.reasonCode === 'inspect_action_forbidden'
        ? `交互物「${args.interactionId}」不允许查看。`
        : `未知或没有正式观察数据的交互物「${args.interactionId}」。`,
    );
  }
  const target = lookup.target;
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
  const arrival = validateValleyInspectionArrival({
    actorId: args.actorId,
    target,
    profile: args.profile,
    resident,
    command: arrivalCommand,
    reportedTile: args.reportedTile,
  });
  if (!arrival.ok) {
    return inspectionFailure(
      arrival.reasonCode,
      inspectionArrivalFailureReason(arrival.reasonCode),
    );
  }

  const sourceTravelAction = await ctx.db.get(command!.actionRecordId);
  if (
    !sourceTravelAction ||
    sourceTravelAction.worldId !== args.worldId ||
    sourceTravelAction.actorId !== args.actorId ||
    sourceTravelAction.type !== 'travel' ||
    sourceTravelAction.status !== 'applied'
  ) {
    return inspectionFailure(
      'inspect_not_reached',
      '交互物抵达没有关联一条已应用的 travel ActionRecord。',
    );
  }

  const result: ActionResult = {
    status: 'applied',
    resultCode: 'interaction_inspected',
    reason: `${args.profile.name}查看${target.interactionId}：${target.observation}`,
    effects: {},
    eventType: 'interaction_inspected',
    visibility: 'private',
  };
  return {
    ok: true,
    result,
    eventFacts: versionDurableEventFacts({
      resultCode: 'interaction_inspected',
      interactionId: target.interactionId,
      interactionKind: target.interactionKind,
      observationId: target.observationId,
      observationRevision: target.observationRevision,
      sourceMovementCommandId: String(command!._id),
      mapId: target.mapId,
      locationId: target.locationId,
      tile: target.tile,
    }),
    sourceMovementCommandId: command!._id,
  };
}

function inspectionFailure(
  reasonCode: ValleyInspectionFailureCode,
  reason: string,
): ValleyInspectionPreparation {
  return { ok: false, reasonCode, reason };
}

function inspectionArrivalFailureReason(
  reasonCode: 'inspect_source_mismatch' | 'inspect_not_reached' | 'inspect_body_mismatch',
) {
  switch (reasonCode) {
    case 'inspect_source_mismatch':
      return '角色的权威地图或地点与交互物不一致。';
    case 'inspect_not_reached':
      return '角色尚未沿同一 travel 命令抵达指定交互物精确格。';
    case 'inspect_body_mismatch':
      return 'Godot 上报格与服务器确认的交互物身体位置不一致。';
  }
}

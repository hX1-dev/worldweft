import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { appendWorldEvent } from './events';
import { generateMemories } from './memory';
import { toDurableActionResult, versionDurableEventFacts } from './durableContracts';
import { canTransitionRequest, nextRequestRevision, requestRevision, type RequestStatus } from './questLogic';

export type RequestTransitionPatch = {
  acceptedAt?: number;
  readyAt?: number;
  fulfilledAt?: number;
  declinedAt?: number;
  completedAt?: number;
  terminalAtGameHour?: number;
};

export async function commitRequestTransitionFromAction(
  ctx: MutationCtx,
  input: {
    request: Doc<'requests'>;
    fromStatus: RequestStatus;
    toStatus: RequestStatus;
    expectedRevision: number;
    actionRecordId: Id<'actionRecords'>;
    eventId: Id<'worldEvents'>;
    now: number;
    nowGameHour: number;
    patch?: RequestTransitionPatch;
  },
) {
  const current = await ctx.db.get(input.request._id);
  if (!current || current.worldId !== input.request.worldId) {
    throw new Error('request_transition_missing');
  }
  if (current.status !== input.fromStatus || requestRevision(current) !== input.expectedRevision) {
    throw new Error('request_transition_stale_revision');
  }
  if (!canTransitionRequest(input.fromStatus, input.toStatus)) {
    throw new Error(`request_transition_forbidden:${input.fromStatus}->${input.toStatus}`);
  }
  const revision = nextRequestRevision(current);
  const terminal = ['completed', 'declined', 'expired'].includes(input.toStatus);
  await ctx.db.patch(current._id, {
    status: input.toStatus,
    revision,
    ...input.patch,
    ...(terminal ? { terminalAtGameHour: input.nowGameHour } : {}),
    lastTransitionActionId: input.actionRecordId,
    lastTransitionEventId: input.eventId,
    lastTransitionAt: input.now,
  });
  return { revision, fromStatus: input.fromStatus, toStatus: input.toStatus };
}

export async function commitSystemRequestTransition(
  ctx: MutationCtx,
  input: {
    request: Doc<'requests'>;
    fromStatus: RequestStatus;
    toStatus: RequestStatus;
    now: number;
    nowGameHour: number;
    resultCode: string;
    eventType: string;
    reason: string;
    locationId?: string;
    mapId?: string;
    patch?: RequestTransitionPatch;
  },
) {
  const expectedRevision = requestRevision(input.request);
  const actionRecordId = await ctx.db.insert('actionRecords', {
    worldId: input.request.worldId,
    actorId: input.request.assigneeActorId,
    type: `system_${input.resultCode}`,
    status: 'proposed',
    targetActorId: input.request.issuerActorId,
    locationId: input.locationId,
    source: 'system',
    mapId: input.mapId,
    createdAt: input.now,
  });
  const nextRevision = expectedRevision + 1;
  const facts = versionDurableEventFacts({
    resultCode: input.resultCode,
    requestType: input.request.type,
    requestId: String(input.request._id),
    requestStatus: input.toStatus,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    requestRevision: nextRevision,
    sourceGameHour: input.nowGameHour,
  });
  const eventId = await appendWorldEvent(ctx, {
    worldId: input.request.worldId,
    type: input.eventType,
    createdAt: input.now,
    actorIds: [input.request.assigneeActorId],
    targetActorIds: [input.request.issuerActorId],
    locationId: input.locationId,
    actionId: actionRecordId,
    visibility: 'private',
    summary: input.reason,
    facts,
    effects: {},
    mapId: input.mapId,
  });
  const transition = await commitRequestTransitionFromAction(ctx, {
    request: input.request,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    expectedRevision,
    actionRecordId,
    eventId,
    now: input.now,
    nowGameHour: input.nowGameHour,
    patch: input.patch,
  });
  await ctx.db.patch(actionRecordId, {
    status: 'applied',
    result: toDurableActionResult({
      status: 'applied',
      resultCode: input.resultCode,
      reason: input.reason,
      effects: {},
      eventType: input.eventType,
      visibility: 'private',
    }),
  });
  await generateMemories(
    ctx,
    input.request.worldId,
    {
      eventId,
      type: input.eventType,
      visibility: 'private',
      actorIds: [input.request.assigneeActorId],
      targetActorIds: [input.request.issuerActorId],
      locationId: input.locationId,
      summary: input.reason,
      createdAt: input.now,
    },
    input.nowGameHour,
  );
  return { actionRecordId, eventId, ...transition };
}

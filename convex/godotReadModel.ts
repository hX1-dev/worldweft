import type { Doc } from './_generated/dataModel';
import { godotEventPresentation, godotTraceChain } from './godotPresentation';
import { buildQinglanResidentRoutePreview } from './xianxia/qinglan';

export function summarizePlayer(player: Doc<'worlds'>['players'][number]) {
  return {
    id: player.id,
    human: player.human,
    position: player.position,
    activity: player.activity,
    speed: player.speed,
  };
}

export function summarizeAgent(agent: Doc<'worlds'>['agents'][number]) {
  return {
    id: agent.id,
    playerId: agent.playerId,
    lastConversation: agent.lastConversation,
    inProgressOperation: agent.inProgressOperation?.name,
  };
}

export function summarizeGodotEvent(event: Doc<'worldEvents'>) {
  const facts = objectOrEmpty(event.facts);
  const effects: unknown = event.effects;
  const resultCode = typeof facts.resultCode === 'string' ? facts.resultCode : undefined;
  const presentation = godotEventPresentation({
    eventType: event.type,
    resultCode,
    summary: event.summary,
    effects,
  });
  return {
    id: event._id,
    worldEventId: event._id,
    actionRecordId: event.actionId,
    traceChain: godotTraceChain({
      source: 'event',
      actionType: event.type,
      worldEventId: event._id,
      actionRecordId: event.actionId,
      resultCode,
    }),
    type: event.type,
    createdAt: event.createdAt,
    actorIds: event.actorIds,
    targetActorIds: event.targetActorIds ?? [],
    locationId: event.locationId,
    mapId: event.mapId,
    visibility: event.visibility,
    factsSchemaVersion:
      typeof facts.schemaVersion === 'number' ? facts.schemaVersion : undefined,
    resultCode,
    summary: event.summary,
    effects,
    ...presentation,
  };
}

export function summarizeGodotResident(resident: Doc<'qinglanResidents'>) {
  return {
    actorId: resident.actorId,
    name: resident.name,
    role: resident.role,
    locationId: resident.currentLocationId,
    tile: resident.displayTile,
    targetTile: resident.targetTile,
    finalTargetTile: resident.finalTargetTile,
    waypointId: resident.waypointId,
    status: resident.status,
    activityLabel: resident.activityLabel,
    intent: resident.currentIntent,
    nextActionAt: resident.nextActionAt,
    updatedAt: resident.updatedAt,
    routePreview: buildQinglanResidentRoutePreview(resident),
  };
}

export function summarizeGodotActionTrace(
  record: Doc<'actionRecords'>,
  event?: Doc<'worldEvents'> | null,
) {
  const result = objectOrEmpty(record.result);
  const eventFacts = objectOrEmpty(event?.facts);
  const metadata = objectOrEmpty(record.metadata);
  const resultCode = typeof result.resultCode === 'string' ? result.resultCode : undefined;
  const reason = typeof result.reason === 'string' ? result.reason : undefined;
  const eventType = typeof result.eventType === 'string' ? result.eventType : event?.type;
  const summary = event?.summary ?? reason ?? `${record.type}/${record.status}`;
  const effects: unknown = result.effects ?? event?.effects;
  const presentation = godotEventPresentation({
    actionType: record.type,
    eventType,
    resultCode,
    status: record.status,
    summary,
    effects,
  });

  return {
    id: record._id,
    actionRecordId: record._id,
    worldEventId: event?._id,
    traceChain: godotTraceChain({
      source: 'action_record',
      actionType: record.type,
      worldEventId: event?._id,
      actionRecordId: record._id,
      resultCode,
    }),
    worldId: record.worldId,
    actorId: record.actorId,
    actorIds: [record.actorId],
    type: record.type,
    actionType: record.type,
    status: record.status,
    targetId: record.targetId,
    targetActorId: record.targetActorId,
    targetActorIds: record.targetActorId ? [record.targetActorId] : [],
    locationId: record.locationId,
    intent: record.intent,
    source: record.source,
    mapId: record.mapId,
    clientActionId: record.clientActionId,
    createdAt: record.createdAt,
    resultSchemaVersion:
      typeof result.schemaVersion === 'number' ? result.schemaVersion : undefined,
    eventFactsSchemaVersion:
      typeof eventFacts.schemaVersion === 'number' ? eventFacts.schemaVersion : undefined,
    metadataSchemaVersion:
      typeof metadata.schemaVersion === 'number' ? metadata.schemaVersion : undefined,
    resultCode,
    reason,
    eventType,
    summary,
    effects,
    ...presentation,
  };
}

export function eventInvolvesActor(event: Doc<'worldEvents'>, actorId: string) {
  return (
    event.actorIds.includes(actorId) ||
    (event.targetActorIds ?? []).includes(actorId) ||
    (event.witnessActorIds ?? []).includes(actorId)
  );
}

export function summarizeReplayTraceEntries(entries: Array<Record<string, unknown>>) {
  const actionTypes = new Map<string, number>();
  const resultCodes = new Map<string, number>();
  const linkStatuses = new Map<string, number>();
  const sources = new Map<string, number>();
  let actionCount = 0;
  let eventCount = 0;
  let linkedCount = 0;
  let eventOnlyCount = 0;
  let actionRecordOnlyCount = 0;
  let tickOnlyCount = 0;
  let durableCount = 0;
  let oldestCreatedAt: number | undefined;
  let newestCreatedAt: number | undefined;

  for (const entry of entries) {
    if (entry.kind === 'action') actionCount += 1;
    else eventCount += 1;

    const actionType =
      typeof entry.actionType === 'string'
        ? entry.actionType
        : typeof entry.type === 'string'
          ? entry.type
          : undefined;
    if (actionType) actionTypes.set(actionType, (actionTypes.get(actionType) ?? 0) + 1);

    const resultCode = typeof entry.resultCode === 'string' ? entry.resultCode : undefined;
    if (resultCode) resultCodes.set(resultCode, (resultCodes.get(resultCode) ?? 0) + 1);

    const source = typeof entry.source === 'string' ? entry.source : 'unknown';
    sources.set(source, (sources.get(source) ?? 0) + 1);
    const traceChain = objectOrEmpty(entry.traceChain);
    const linkStatus = typeof traceChain.linkStatus === 'string' ? traceChain.linkStatus : '';
    if (linkStatus) linkStatuses.set(linkStatus, (linkStatuses.get(linkStatus) ?? 0) + 1);
    if (linkStatus === 'action_record_linked') linkedCount += 1;
    else if (linkStatus === 'event_only') eventOnlyCount += 1;
    else if (linkStatus === 'action_record_only') actionRecordOnlyCount += 1;
    else if (linkStatus === 'tick_only') tickOnlyCount += 1;
    if (traceChain.durable === true) durableCount += 1;

    const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : undefined;
    if (createdAt !== undefined) {
      oldestCreatedAt =
        oldestCreatedAt === undefined ? createdAt : Math.min(oldestCreatedAt, createdAt);
      newestCreatedAt =
        newestCreatedAt === undefined ? createdAt : Math.max(newestCreatedAt, createdAt);
    }
  }
  const actionTypeCounts = sortedCountEntries(actionTypes, 'type');
  const resultCodeCounts = sortedCountEntries(resultCodes, 'resultCode');
  const linkStatusCounts = sortedCountEntries(linkStatuses, 'linkStatus');
  const sourceCounts = sortedCountEntries(sources, 'source');
  const timeWindowMs =
    oldestCreatedAt !== undefined && newestCreatedAt !== undefined
      ? Math.max(0, newestCreatedAt - oldestCreatedAt)
      : 0;

  return {
    entryCount: entries.length,
    actionCount,
    eventCount,
    linkedCount,
    eventOnlyCount,
    actionRecordOnlyCount,
    tickOnlyCount,
    durableCount,
    oldestCreatedAt,
    newestCreatedAt,
    generatedAt: Date.now(),
    timeWindowMs,
    timeWindowLabel: replayTimeWindowLabel(entries.length, timeWindowMs),
    actionTypes: actionTypeCounts,
    resultCodes: resultCodeCounts,
    linkStatuses: linkStatusCounts,
    sources: sourceCounts,
    topActionType: actionTypeCounts[0]?.type,
    topResultCode: resultCodeCounts[0]?.resultCode,
    topLinkStatus: linkStatusCounts[0]?.linkStatus,
    topSource: sourceCounts[0]?.source,
  };
}

function replayTimeWindowLabel(entryCount: number, timeWindowMs: number) {
  if (entryCount === 0) return 'no replay rows';
  if (entryCount === 1) return 'single replay row';
  if (timeWindowMs < 1000) return '<1s window';
  if (timeWindowMs < 60_000) return `${Math.ceil(timeWindowMs / 1000)}s window`;
  if (timeWindowMs < 3_600_000) return `${Math.ceil(timeWindowMs / 60_000)}m window`;
  return `${Math.ceil(timeWindowMs / 3_600_000)}h window`;
}

function sortedCountEntries<T extends string>(counts: Map<string, number>, key: T) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ [key]: value, count }) as Record<T, string> & { count: number });
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

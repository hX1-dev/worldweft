export type GodotViewerEvent = {
  _id?: string;
  visibility: 'public' | 'local' | 'private' | 'witnessed' | 'rumor';
  actorIds: string[];
  targetActorIds?: string[];
  witnessActorIds?: string[];
  locationId?: string;
};

export type GodotViewerState = {
  viewerActorId?: string;
  viewerLocationId?: string;
  knownEventIds?: ReadonlySet<string>;
  debugView?: boolean;
};

export function godotReadProjection(debugView: boolean | undefined) {
  return debugView === true ? 'debug' : 'player';
}

export function canGodotViewerReadEvent(
  event: GodotViewerEvent,
  viewer: GodotViewerState,
) {
  if (viewer.debugView === true) return true;
  const viewerActorId = viewer.viewerActorId;
  if (!viewerActorId) return event.visibility === 'public';
  const principalIds = new Set([
    ...event.actorIds,
    ...(event.targetActorIds ?? []),
  ]);
  if (principalIds.has(viewerActorId)) return true;
  const isWitness = (event.witnessActorIds ?? []).includes(viewerActorId);

  switch (event.visibility) {
    case 'public':
      return true;
    case 'local':
      return Boolean(
        isWitness ||
          (event.locationId &&
            viewer.viewerLocationId &&
            event.locationId === viewer.viewerLocationId),
      );
    case 'rumor':
      return Boolean(isWitness || (event._id && viewer.knownEventIds?.has(String(event._id))));
    case 'witnessed':
      return isWitness;
    case 'private':
      return false;
  }
}

export function canReadGodotActorPrivateState(
  viewerActorId: string | undefined,
  actorId: string,
  debugView: boolean | undefined,
) {
  return debugView === true || viewerActorId === actorId;
}

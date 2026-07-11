export type GodotTile = { x: number; y: number };

export type GodotLocationGeometry = {
  bounds?: { x1: number; y1: number; x2: number; y2: number };
  entryPoints: GodotTile[];
};

export type GodotSpatialIssue = {
  status: 400 | 409;
  resultCode: string;
  reason: string;
};

export type GodotSpatialState = {
  type: string;
  actorId: string;
  targetActorId?: string;
  mapId: string;
  locationId: string;
  actorTile?: GodotTile;
  interactionRangeTiles?: number;
  actorProfile: { mapId?: string; currentLocationId?: string };
  targetResident?: {
    mapId: string;
    currentLocationId: string;
    displayTile: GodotTile;
  } | null;
  location?: ({ mapId?: string } & GodotLocationGeometry) | null;
};

export function clampGodotRange(value: number | undefined) {
  return Math.max(1, Math.min(12, value ?? 5));
}

export function godotTileDistance(a: GodotTile, b: GodotTile) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function roundGodotDistance(value: number) {
  return Math.round(value * 100) / 100;
}

export function godotTileTouchesLocation(
  tile: GodotTile,
  location: GodotLocationGeometry,
  maxDistance: number,
) {
  const bounds = location.bounds;
  if (
    bounds &&
    tile.x >= bounds.x1 &&
    tile.x <= bounds.x2 &&
    tile.y >= bounds.y1 &&
    tile.y <= bounds.y2
  ) {
    return true;
  }
  return location.entryPoints.some((entry) => godotTileDistance(tile, entry) <= maxDistance);
}

export function godotLocationForTile<T extends GodotLocationGeometry>(
  tile: GodotTile,
  locations: T[],
  maxDistance: number,
): T | null {
  const containing = locations.find((location) => {
    const bounds = location.bounds;
    return (
      bounds &&
      tile.x >= bounds.x1 &&
      tile.x <= bounds.x2 &&
      tile.y >= bounds.y1 &&
      tile.y <= bounds.y2
    );
  });
  if (containing) return containing;

  let best: { location: T; distance: number } | null = null;
  for (const location of locations) {
    for (const entry of location.entryPoints) {
      const distance = godotTileDistance(tile, entry);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { location, distance };
      }
    }
  }
  return best?.location ?? null;
}

export function isGodotTargetedLocalAction(type: string) {
  return ['talk', 'trade', 'gift', 'request_teaching', 'spar', 'steal'].includes(type);
}

export function isGodotLocationLocalAction(type: string) {
  return ['arrive', 'explore', 'cultivate', 'breakthrough'].includes(type);
}

export function evaluateGodotSpatialState(args: GodotSpatialState): GodotSpatialIssue | null {
  const targetedAction = isGodotTargetedLocalAction(args.type);
  const locationAction = isGodotLocationLocalAction(args.type);
  if (!targetedAction && !locationAction) return null;
  if (!args.actorTile) {
    return issue(
      400,
      'missing_actor_tile',
      `Actor tile is required for Godot local action ${args.type}.`,
    );
  }

  const range = clampGodotRange(args.interactionRangeTiles);
  if (targetedAction) {
    if (
      !args.targetActorId ||
      !args.targetResident ||
      args.targetResident.mapId !== args.mapId
    ) {
      return issue(
        409,
        'target_not_on_map',
        `Godot target action ${args.type} requires a resident on map ${args.mapId}.`,
      );
    }
    if (!args.location || args.location.mapId !== args.mapId) {
      return issue(
        400,
        'unknown_location',
        `Unknown Godot action location ${args.locationId} on map ${args.mapId}.`,
      );
    }
    if (
      args.actorProfile.mapId !== args.mapId ||
      args.actorProfile.currentLocationId !== args.locationId
    ) {
      return issue(
        409,
        'actor_not_at_location',
        `Actor ${args.actorId} must formally arrive at ${args.locationId} before ${args.type}.`,
      );
    }
    if (args.targetResident.currentLocationId !== args.locationId) {
      return issue(
        409,
        'target_not_present',
        `Target ${args.targetActorId} is not present at location ${args.locationId}.`,
      );
    }
    const distance = godotTileDistance(args.actorTile, args.targetResident.displayTile);
    if (distance > range) {
      return issue(
        409,
        'target_out_of_range',
        `Target ${args.targetActorId} is ${roundGodotDistance(distance)} tiles away; Godot interaction range is ${range}.`,
      );
    }
  }

  if (locationAction) {
    if (!args.location) {
      return issue(400, 'unknown_location', `Unknown Godot action location ${args.locationId}.`);
    }
    if (args.location.mapId !== args.mapId) {
      return issue(
        400,
        'location_map_mismatch',
        `Location ${args.locationId} does not belong to map ${args.mapId}.`,
      );
    }
    if (
      args.type !== 'arrive' &&
      (args.actorProfile.mapId !== args.mapId ||
        args.actorProfile.currentLocationId !== args.locationId)
    ) {
      return issue(
        409,
        'actor_not_at_location',
        `Actor ${args.actorId} must formally arrive at ${args.locationId} before ${args.type}.`,
      );
    }
    if (!godotTileTouchesLocation(args.actorTile, args.location, Math.max(range, 4))) {
      return issue(
        409,
        'location_out_of_range',
        `Actor tile ${roundGodotDistance(args.actorTile.x)},${roundGodotDistance(args.actorTile.y)} is not near location ${args.locationId}.`,
      );
    }
  }

  return null;
}

function issue(status: 400 | 409, resultCode: string, reason: string): GodotSpatialIssue {
  return { status, resultCode, reason };
}

import { QINGLAN_VALLEY_GATE_DATA } from '../../data/qinglanValleyGate.generated';
import {
  ACTIVE_MOVEMENT_STATUSES,
  ARRIVAL_TOLERANCE_TILES,
  MAX_POINT_TARGET_DISTANCE_TILES,
  MAX_MOVEMENT_REPORT_CLOCK_SKEW_MS,
  MAX_REPORTED_SPEED_TILES_PER_SECOND,
  MOVEMENT_LEASE_MS,
  POINT_TARGET_SNAP_RADIUS_TILES,
  TERMINAL_MOVEMENT_STATUSES,
  type MovementCommandStatus,
  type MovementProtocolFailure,
  type MovementReport,
  type MovementReportStatus,
  type MovementTarget,
  type TilePoint,
} from './valleyMovementContracts';

export const VALLEY_NAVIGABLE_MASK_TYPES = new Set(['walkable', 'grass', 'dock']);

export type ValleyLocationData = {
  id: string;
  name?: string;
  bounds: { x: number; y: number; width: number; height: number };
  entryPoint: TilePoint;
};

export type ValleyPointData = {
  id: string;
  name?: string;
  kind?: string;
  tile: TilePoint;
  locationId: string;
};

export type ValleyMapData = {
  mapId: string;
  width: number;
  height: number;
  tileSize: number;
  navigableTypes: readonly string[];
  cells: readonly (readonly string[])[];
  locations: readonly ValleyLocationData[];
  npcPoints: readonly ValleyPointData[];
  interactions: readonly ValleyPointData[];
};

export type ActorTile = { actorId: string; tile: TilePoint };

export type TargetResolution =
  | {
      ok: true;
      acceptedTile: TilePoint;
      maskType: string;
      path: TilePoint[];
      resolvedLocationId?: string;
    }
  | {
      ok: false;
      reasonCode:
        | 'invalid_start'
        | 'location_unknown'
        | 'actor_unknown'
        | 'interaction_unknown'
        | 'point_out_of_bounds'
        | 'point_too_far'
        | 'no_legal_target'
        | 'target_unreachable';
      reason: string;
    };

export type TargetResolutionFailureCode = Extract<
  TargetResolution,
  { ok: false }
>['reasonCode'];

export type MovementCommandSnapshot = {
  revision: number;
  actorId: string;
  status: MovementCommandStatus;
  originTile: TilePoint;
  acceptedTile: TilePoint;
  lastTile?: TilePoint;
  lastReportedAt?: number;
  issuedAt: number;
  expiresAt: number;
};

export type MovementReportDecision =
  | {
      ok: true;
      patch: {
        status: MovementReportStatus;
        lastTile: TilePoint;
        lastReportedAt: number;
        updatedAt: number;
        expiresAt: number;
        reasonCode?: string;
      };
    }
  | MovementProtocolFailure;

const DEFAULT_MAP_DATA = QINGLAN_VALLEY_GATE_DATA as ValleyMapData;

export function valleyMapData(): ValleyMapData {
  return DEFAULT_MAP_DATA;
}

export function isValleyTileInBounds(tile: TilePoint, data: ValleyMapData = DEFAULT_MAP_DATA) {
  const cell = tileCell(tile);
  return cell.x >= 0 && cell.y >= 0 && cell.x < data.width && cell.y < data.height;
}

export function valleyMaskTypeAt(tile: TilePoint, data: ValleyMapData = DEFAULT_MAP_DATA) {
  const cell = tileCell(tile);
  if (cell.x < 0 || cell.y < 0 || cell.x >= data.width || cell.y >= data.height) {
    return undefined;
  }
  return data.cells[cell.y]?.[cell.x];
}

export function isValleyTileWalkable(tile: TilePoint, data: ValleyMapData = DEFAULT_MAP_DATA) {
  const maskType = valleyMaskTypeAt(tile, data);
  return typeof maskType === 'string' && VALLEY_NAVIGABLE_MASK_TYPES.has(maskType);
}

export function findValleyPath(
  from: TilePoint,
  to: TilePoint,
  data: ValleyMapData = DEFAULT_MAP_DATA,
): TilePoint[] {
  const start = tileCell(from);
  const goal = tileCell(to);
  if (!isValleyTileWalkable(start, data) || !isValleyTileWalkable(goal, data)) return [];
  if (sameTile(start, goal)) return [start];

  const goalKey = tileKey(goal);
  const open: Array<{ tile: TilePoint; priority: number }> = [
    { tile: start, priority: manhattan(start, goal) },
  ];
  const cameFrom = new Map<string, string>();
  const score = new Map<string, number>([[tileKey(start), 0]]);
  const closed = new Set<string>();

  while (open.length > 0 && closed.size <= data.width * data.height) {
    open.sort((a, b) => a.priority - b.priority || compareTiles(a.tile, b.tile));
    const current = open.shift()!;
    const currentKey = tileKey(current.tile);
    if (closed.has(currentKey)) continue;
    if (currentKey === goalKey) return reconstructPath(cameFrom, goalKey);
    closed.add(currentKey);

    const currentScore = score.get(currentKey) ?? Infinity;
    for (const neighbor of cardinalNeighbors(current.tile)) {
      if (!isValleyTileWalkable(neighbor, data)) continue;
      const neighborKey = tileKey(neighbor);
      if (closed.has(neighborKey)) continue;
      const tentative = currentScore + 1;
      if (tentative >= (score.get(neighborKey) ?? Infinity)) continue;
      cameFrom.set(neighborKey, currentKey);
      score.set(neighborKey, tentative);
      open.push({ tile: neighbor, priority: tentative + manhattan(neighbor, goal) });
    }
  }
  return [];
}

export function resolveValleyMovementTarget(args: {
  actorId: string;
  revision: number;
  currentTile: TilePoint;
  requestedTarget: MovementTarget;
  actorTiles?: readonly ActorTile[];
  occupiedTiles?: readonly TilePoint[];
  data?: ValleyMapData;
}): TargetResolution {
  const data = args.data ?? DEFAULT_MAP_DATA;
  const start = tileCell(args.currentTile);
  if (!isFiniteTile(args.currentTile) || !isValleyTileWalkable(start, data)) {
    return failure('invalid_start', 'The actor position is outside the legal valley mask.');
  }

  // Occupancy is owned by actors/reservations, not by coordinates. Exclude the
  // moving actor by identity before flattening positions; filtering every tile
  // equal to `start` would also erase another actor (or active reservation)
  // already claiming that same cell and would perpetuate an overlap.
  const occupied = new Set(
    [
      ...(args.occupiedTiles ?? []),
      ...(args.actorTiles ?? [])
        .filter((actor) => actor.actorId !== args.actorId)
        .map((actor) => actor.tile),
    ]
      .map(tileCell)
      .map(tileKey),
  );
  const target = args.requestedTarget;
  const seed = `${args.actorId}:${args.revision}:${targetStableKey(target)}`;
  let candidates: TilePoint[] = [];
  let resolvedLocationId: string | undefined;
  let nearestTo: TilePoint | undefined;

  switch (target.kind) {
    case 'location':
    case 'zone': {
      const locationId =
        target.kind === 'location' ? target.locationId : target.zoneId;
      const location = data.locations.find((entry) => entry.id === locationId);
      if (!location) return failure('location_unknown', `Unknown valley location: ${locationId}`);
      candidates = locationCandidates(location, data);
      resolvedLocationId = location.id;
      break;
    }
    case 'actor': {
      const actor = args.actorTiles?.find((entry) => entry.actorId === target.actorId);
      if (!actor) {
        return failure('actor_unknown', `Unknown or currently invisible actor: ${target.actorId}`);
      }
      const preferred = clampInt(target.preferredDistanceTiles ?? 1, 1, 2);
      candidates = actorApproachCandidates(tileCell(actor.tile), preferred);
      break;
    }
    case 'interactable': {
      const interaction = data.interactions.find(
        (entry) => entry.id === target.interactionId,
      );
      if (!interaction) {
        return failure(
          'interaction_unknown',
          `Unknown valley interaction: ${target.interactionId}`,
        );
      }
      // An interactable is an exact stand target in protocol v1. If that cell
      // is blocked or occupied, reject it rather than silently changing which
      // object the agent is approaching.
      candidates = [tileCell(interaction.tile)];
      nearestTo = interaction.tile;
      resolvedLocationId = interaction.locationId;
      break;
    }
    case 'point': {
      if (!isFiniteTile(target.tile) || !isValleyTileInBounds(target.tile, data)) {
        return failure('point_out_of_bounds', 'Point target lies outside the valley map.');
      }
      if (euclidean(args.currentTile, target.tile) > MAX_POINT_TARGET_DISTANCE_TILES) {
        return failure(
          'point_too_far',
          `Point targets are limited to ${MAX_POINT_TARGET_DISTANCE_TILES} tiles.`,
        );
      }
      candidates = snapCandidates(
        target.tile,
        POINT_TARGET_SNAP_RADIUS_TILES,
        data,
      );
      nearestTo = target.tile;
      break;
    }
  }

  const legal = uniqueTiles(candidates).filter(
    (tile) => isValleyTileWalkable(tile, data) && !occupied.has(tileKey(tile)),
  );
  if (legal.length === 0) {
    return failure('no_legal_target', 'No unoccupied walkable tile satisfies the target.');
  }

  const reachable = legal
    .map((candidate) => ({ candidate, path: findValleyPath(start, candidate, data) }))
    .filter(({ path }) => path.length > 0)
    .sort((a, b) => {
      // Exact/snap targets preserve semantic closeness first. For a location,
      // zone, or actor approach ring every candidate is semantically equivalent,
      // so choose the genuinely shortest legal route. The seeded rank only
      // distributes actors when two stand positions cost exactly the same.
      if (nearestTo) {
        const distanceOrder =
          euclidean(a.candidate, nearestTo) - euclidean(b.candidate, nearestTo);
        if (distanceOrder !== 0) return distanceOrder;
      }
      const pathOrder = a.path.length - b.path.length;
      if (pathOrder !== 0) return pathOrder;
      return (
        seededTileRank(seed, a.candidate) - seededTileRank(seed, b.candidate) ||
        compareTiles(a.candidate, b.candidate)
      );
    });
  const selected = reachable[0];
  if (selected) {
    return {
      ok: true,
      acceptedTile: selected.candidate,
      maskType: valleyMaskTypeAt(selected.candidate, data)!,
      path: selected.path,
      resolvedLocationId,
    };
  }
  return failure('target_unreachable', 'The target has no path through the legal valley mask.');
}

export function isValleySegmentWalkable(
  from: TilePoint,
  to: TilePoint,
  data: ValleyMapData = DEFAULT_MAP_DATA,
) {
  if (!isFiniteTile(from) || !isFiniteTile(to)) return false;
  return supercoverCells(from, to).every((tile) => isValleyTileWalkable(tile, data));
}

export function evaluateMovementReport(
  command: MovementCommandSnapshot,
  report: MovementReport,
  now: number,
  data: ValleyMapData = DEFAULT_MAP_DATA,
): MovementReportDecision {
  if (report.revision !== command.revision) {
    return protocolFailure('stale_revision', 'The movement report revision is no longer current.');
  }
  if (report.actorId !== command.actorId) {
    return protocolFailure('actor_mismatch', 'The report actor does not own this movement command.');
  }
  if (TERMINAL_MOVEMENT_STATUSES.has(command.status)) {
    return protocolFailure('command_terminal', `The command is already ${command.status}.`);
  }
  if (command.expiresAt <= now) {
    return protocolFailure('command_expired', 'The movement command lease has expired.');
  }
  if (!isLegalMovementTransition(command.status, report.status)) {
    return protocolFailure(
      'invalid_transition',
      `Movement status cannot transition from ${command.status} to ${report.status}.`,
    );
  }
  if (!isFiniteTile(report.positionTiles) || !isValleyTileWalkable(report.positionTiles, data)) {
    return protocolFailure('invalid_position', 'The reported position is outside the legal mask.');
  }

  const previous = command.lastTile ?? command.originTile;
  if (command.status === 'pending' && report.status === 'accepted') {
    if (euclidean(previous, report.positionTiles) > 0.75) {
      return protocolFailure('invalid_position', 'An accepted report must begin at the actor origin.');
    }
  }
  if (!isValleySegmentWalkable(previous, report.positionTiles, data)) {
    return protocolFailure('invalid_segment', 'The movement sample crosses a blocked mask cell.');
  }

  // Network queueing can compress server receive times even when the body's
  // real samples are legal. The protocol already carries reportedAt, so use it
  // after bounding clock skew and requiring a monotonic sample clock.
  const sampleAt = report.reportedAt > 0 ? report.reportedAt : now;
  if (Math.abs(sampleAt - now) > MAX_MOVEMENT_REPORT_CLOCK_SKEW_MS) {
    return protocolFailure(
      'invalid_report_time',
      `Movement sample time must be within ${MAX_MOVEMENT_REPORT_CLOCK_SKEW_MS}ms of the server.`,
    );
  }
  const previousSampleAt = command.lastReportedAt ?? command.issuedAt;
  if (sampleAt < previousSampleAt) {
    return protocolFailure(
      'invalid_report_time',
      'Movement sample time must be monotonic for one command revision.',
    );
  }
  const elapsedMs = Math.max(0, sampleAt - previousSampleAt);
  const allowedDistance =
    MAX_REPORTED_SPEED_TILES_PER_SECOND * (elapsedMs / 1000) + 0.35;
  if (euclidean(previous, report.positionTiles) > allowedDistance) {
    return protocolFailure(
      'speed_exceeded',
      `The movement sample exceeds ${MAX_REPORTED_SPEED_TILES_PER_SECOND} tiles per second.`,
    );
  }
  if (
    report.status === 'arrived' &&
    euclidean(report.positionTiles, command.acceptedTile) > ARRIVAL_TOLERANCE_TILES
  ) {
    return protocolFailure(
      'not_at_destination',
      `Arrival must be within ${ARRIVAL_TOLERANCE_TILES} tile of the accepted target.`,
    );
  }

  return {
    ok: true,
    patch: {
      status: report.status,
      lastTile: roundReportedTile(report.positionTiles),
      lastReportedAt: sampleAt,
      updatedAt: now,
      expiresAt: ACTIVE_MOVEMENT_STATUSES.has(report.status)
        ? now + MOVEMENT_LEASE_MS
        : command.expiresAt,
      reasonCode: report.reasonCode,
    },
  };
}

export function isLegalMovementTransition(
  current: MovementCommandStatus,
  next: MovementReportStatus,
) {
  if (current === 'pending') return next === 'accepted' || next === 'cancelled';
  if (current === 'accepted') {
    return next === 'moving' || next === 'arrived' || next === 'blocked' || next === 'cancelled';
  }
  if (current === 'moving') {
    return next === 'moving' || next === 'arrived' || next === 'blocked' || next === 'cancelled';
  }
  return false;
}

export function nextMovementRevision(commands: readonly { revision: number }[]) {
  return commands.reduce((highest, command) => Math.max(highest, command.revision), 0) + 1;
}

export function isStaleMovementRevision(
  reportRevision: number,
  command: { revision: number },
  latestCommand: { revision: number } | null | undefined,
) {
  return (
    reportRevision !== command.revision ||
    (latestCommand !== null &&
      latestCommand !== undefined &&
      latestCommand.revision !== command.revision)
  );
}

export function locationAtValleyTile(
  tile: TilePoint,
  data: ValleyMapData = DEFAULT_MAP_DATA,
) {
  const cell = tileCell(tile);
  return data.locations.find(
    (location) =>
      cell.x >= location.bounds.x &&
      cell.y >= location.bounds.y &&
      cell.x < location.bounds.x + location.bounds.width &&
      cell.y < location.bounds.y + location.bounds.height,
  )?.id;
}

function locationCandidates(location: ValleyLocationData, data: ValleyMapData) {
  const entryPoint = tileCell(location.entryPoint);
  const result: TilePoint[] = isInsideLocation(entryPoint, location)
    ? [entryPoint]
    : [];
  for (let y = location.bounds.y; y < location.bounds.y + location.bounds.height; y += 1) {
    for (let x = location.bounds.x; x < location.bounds.x + location.bounds.width; x += 1) {
      const tile = { x, y };
      if (isValleyTileWalkable(tile, data)) result.push(tile);
    }
  }
  return result;
}

function isInsideLocation(tile: TilePoint, location: ValleyLocationData) {
  return (
    tile.x >= location.bounds.x &&
    tile.y >= location.bounds.y &&
    tile.x < location.bounds.x + location.bounds.width &&
    tile.y < location.bounds.y + location.bounds.height
  );
}

function actorApproachCandidates(target: TilePoint, preferred: number) {
  const result: TilePoint[] = [];
  for (const radius of [preferred, preferred === 1 ? 2 : 1]) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        result.push({ x: target.x + dx, y: target.y + dy });
      }
    }
  }
  return result;
}

function snapCandidates(tile: TilePoint, radius: number, data: ValleyMapData) {
  const center = tileCell(tile);
  // A legal requested cell is authoritative. Snapping is only a repair for a
  // blocked cell, never a fallback that silently changes an unreachable goal.
  if (isValleyTileWalkable(center, data)) return [center];
  const result: TilePoint[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const candidate = { x: center.x + dx, y: center.y + dy };
      if (!isValleyTileWalkable(candidate, data)) continue;
      result.push(candidate);
    }
  }
  return result.sort(
    (a, b) => euclidean(a, center) - euclidean(b, center) || compareTiles(a, b),
  );
}

function reconstructPath(cameFrom: Map<string, string>, goalKey: string) {
  const result = [parseTileKey(goalKey)];
  let current = goalKey;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    result.unshift(parseTileKey(current));
  }
  return result;
}

// Amanatides-Woo traversal in tile-centre coordinates. At an exact corner it
// includes both orthogonal cells as well as the diagonal cell, so a sparse
// report cannot cut between two blocked footprints.
function supercoverCells(from: TilePoint, to: TilePoint) {
  let current = tileCell(from);
  const end = tileCell(to);
  const result: TilePoint[] = [current];
  const seen = new Set([tileKey(current)]);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = stepX === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = stepY === 0 ? Infinity : 1 / Math.abs(dy);
  let maxX =
    stepX === 0
      ? Infinity
      : ((stepX > 0 ? current.x + 0.5 : current.x - 0.5) - from.x) / dx;
  let maxY =
    stepY === 0
      ? Infinity
      : ((stepY > 0 ? current.y + 0.5 : current.y - 0.5) - from.y) / dy;

  const add = (tile: TilePoint) => {
    const key = tileKey(tile);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tile);
  };
  const guardLimit = Math.abs(end.x - current.x) + Math.abs(end.y - current.y) + 4;
  let guard = 0;
  while (!sameTile(current, end) && guard < guardLimit) {
    guard += 1;
    if (Math.abs(maxX - maxY) <= 1e-9) {
      add({ x: current.x + stepX, y: current.y });
      add({ x: current.x, y: current.y + stepY });
      current = { x: current.x + stepX, y: current.y + stepY };
      maxX += deltaX;
      maxY += deltaY;
    } else if (maxX < maxY) {
      current = { x: current.x + stepX, y: current.y };
      maxX += deltaX;
    } else {
      current = { x: current.x, y: current.y + stepY };
      maxY += deltaY;
    }
    add(current);
  }
  return result;
}

function cardinalNeighbors(tile: TilePoint) {
  return [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y - 1 },
  ];
}

function targetStableKey(target: MovementTarget) {
  switch (target.kind) {
    case 'location':
      return `location:${target.locationId}`;
    case 'zone':
      return `zone:${target.zoneId}`;
    case 'actor':
      return `actor:${target.actorId}:${target.preferredDistanceTiles ?? 1}`;
    case 'interactable':
      return `interactable:${target.interactionId}`;
    case 'point':
      return `point:${target.tile.x},${target.tile.y}`;
  }
}

function seededTileRank(seed: string, tile: TilePoint) {
  return hashString(`${seed}:${tile.x},${tile.y}`);
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniqueTiles(tiles: readonly TilePoint[]) {
  const seen = new Set<string>();
  return tiles.filter((tile) => {
    const cell = tileCell(tile);
    const key = tileKey(cell);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(tileCell);
}

function tileCell(tile: TilePoint): TilePoint {
  return { x: Math.round(tile.x), y: Math.round(tile.y) };
}

function roundReportedTile(tile: TilePoint): TilePoint {
  return { x: Math.round(tile.x * 1000) / 1000, y: Math.round(tile.y * 1000) / 1000 };
}

function tileKey(tile: TilePoint) {
  return `${tile.x},${tile.y}`;
}

function parseTileKey(key: string): TilePoint {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function sameTile(a: TilePoint, b: TilePoint) {
  return a.x === b.x && a.y === b.y;
}

function compareTiles(a: TilePoint, b: TilePoint) {
  return a.y - b.y || a.x - b.x;
}

function manhattan(a: TilePoint, b: TilePoint) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function euclidean(a: TilePoint, b: TilePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isFiniteTile(tile: TilePoint) {
  return Number.isFinite(tile.x) && Number.isFinite(tile.y);
}

function failure(code: TargetResolutionFailureCode, reason: string) {
  return { ok: false as const, reasonCode: code, reason };
}

function protocolFailure(
  code: MovementProtocolFailure['code'],
  reason: string,
): MovementProtocolFailure {
  return { ok: false, code, reason };
}

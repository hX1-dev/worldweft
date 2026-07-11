// 物理移动的「纯逻辑层」（Stage 2 · M1 §2.1 身体位置↔语义地点同步）。
// 不依赖 Convex / AI Town / DB：只做坐标与语义地点之间的换算，可被 Jest 直接单测。
// 落库与驱动身体（moveTo 输入、到达写事件）在接线层（actions.ts / 观察者 mutation）。
//
// 关键原则（架构铁律 #4）：Agent 只提语义地点，绝不输出 x/y；
// 这里把「语义地点 → 地图 entryPoint 坐标」和「身体坐标 → 所在语义地点」两个方向算清楚。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §2.1。

export type Point = { x: number; y: number };

export type LocationPoint = {
  locationId: string;
  entryPoints: Point[];
  bounds?: { x1: number; y1: number; x2: number; y2: number };
};

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type Bounds = { x1: number; y1: number; x2: number; y2: number };

// 坐标是否落在区域内（含边界）。区域 = 真实的一片地，而非一个点。
export function inZone(pos: Point, b: Bounds): boolean {
  return pos.x >= b.x1 && pos.x <= b.x2 && pos.y >= b.y1 && pos.y <= b.y2;
}

function inBounds(pos: Point, b: LocationPoint['bounds']): boolean {
  return !!b && inZone(pos, b);
}

// 地图可通行性（World Foundation v1）：与 AI Town blocked 同源——出界或踩到任一
// objectTiles 障碍层（值 ≠ -1）即不可走。纯函数，供 zones 可达性审计与 travel 校验。
export type TileMap = { width: number; height: number; objectTiles: number[][][] };
export function isWalkable(pos: Point, map: TileMap): boolean {
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  for (const layer of map.objectTiles) {
    if (layer[x]?.[y] !== -1) return false;
  }
  return true;
}

// 语义地点 → 目标坐标：第一阶段取第一个 entryPoint。无入口则不可达。
export function pickEntryPoint(loc: LocationPoint): Point | null {
  return loc.entryPoints.length > 0 ? loc.entryPoints[0] : null;
}

// 身体坐标 → 所在语义地点：
//   有 bounds 且落在内 → 该地点；
//   否则归到「最近 entryPoint」的地点，但须在 maxDistance 格内才算「在场」。
// 不在任何地点附近 → null（接线层据此保留原 currentLocationId，不强行改写）。
// 这条阈值很关键：地图大、入口稀疏时，没有它会把整片空地都误判进最近的那个角落地点。
export function locationAtPosition(
  pos: Point,
  locations: LocationPoint[],
  maxDistance = 4,
): string | null {
  for (const loc of locations) {
    if (inBounds(pos, loc.bounds)) return loc.locationId;
  }
  let best: { id: string; d: number } | null = null;
  for (const loc of locations) {
    for (const ep of loc.entryPoints) {
      const d = distance(pos, ep);
      if (!best || d < best.d) best = { id: loc.locationId, d };
    }
  }
  if (!best || best.d > maxDistance) return null;
  return best.id;
}

export type TravelTarget =
  | { ok: true; locationId: string; destination: Point }
  | { ok: false; reasonCode: string; reason: string };

// 校验并解析一个 travel 目标：地点须存在且有可达入口。
export function resolveTravelTarget(
  locations: LocationPoint[],
  targetLocationId: string,
): TravelTarget {
  const loc = locations.find((l) => l.locationId === targetLocationId);
  if (!loc) {
    return { ok: false, reasonCode: 'location_unknown', reason: `去不了未知之地「${targetLocationId}」。` };
  }
  const destination = pickEntryPoint(loc);
  if (!destination) {
    return { ok: false, reasonCode: 'no_entry_point', reason: `「${targetLocationId}」无可达入口。` };
  }
  return { ok: true, locationId: targetLocationId, destination };
}

// 是否已到达目标坐标附近（寻路误差容忍，单位=格）。
export function hasArrived(pos: Point, destination: Point, threshold = 1.5): boolean {
  return distance(pos, destination) <= threshold;
}

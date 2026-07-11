import { QINGLAN_REGION_SEED } from '../../data/qinglanRegions';
import { QINGLAN_COLLISION_VOLUME_SUMMARY } from '../../data/qinglanCollisionVolumes';
import {
  QINGLAN_BLOCKING_MASK_TYPES,
  QINGLAN_NAVIGABLE_MASK_TYPES,
  isQinglanNavigableMaskType,
  type QinglanMaskType,
} from '../../data/qinglanMaskContract';

export type QinglanTilePoint = { x: number; y: number };

export type QinglanNavigationCell = { col: number; row: number };
type CellRun = {
  row: number;
  from: number;
  to: number;
  type: QinglanMaskType;
};

const WORLD_TILES_W = 96;
const WORLD_TILES_H = 72;
const IMAGE_W = QINGLAN_REGION_SEED.image.width;
const IMAGE_H = QINGLAN_REGION_SEED.image.height;
const GRID_SIZE = QINGLAN_REGION_SEED.cellMask.gridSize;
const COLS = Math.ceil(IMAGE_W / GRID_SIZE);
const ROWS = Math.ceil(IMAGE_H / GRID_SIZE);
const MAX_SEARCH_CELLS = COLS * ROWS;
const NAVIGABLE_TYPES = new Set<QinglanMaskType>(QINGLAN_NAVIGABLE_MASK_TYPES);

const maskRows = buildMaskRows(QINGLAN_REGION_SEED.cellMask.runs as readonly CellRun[]);
const cellMaskStats = countMaskStats(maskRows);

export const QINGLAN_NAVIGATION_SUMMARY = {
  source: QINGLAN_REGION_SEED.image.url,
  gridSize: GRID_SIZE,
  gridCells: { cols: COLS, rows: ROWS },
  image: { width: IMAGE_W, height: IMAGE_H },
  worldTiles: { width: WORLD_TILES_W, height: WORLD_TILES_H },
  walkableTypes: QINGLAN_NAVIGABLE_MASK_TYPES,
  blockingTypes: QINGLAN_BLOCKING_MASK_TYPES,
  cellMaskStats,
  collisionVolumes: QINGLAN_COLLISION_VOLUME_SUMMARY,
} as const;

export function isQinglanTileWalkable(tile: QinglanTilePoint) {
  return isNavigableCell(tileToCell(tile));
}

export function getQinglanTileNavigationInfo(tile: QinglanTilePoint) {
  const cell = tileToCell(tile);
  const maskType = maskTypeAtCell(cell);
  const walkable = isNavigableCell(cell);
  return {
    tile: roundTilePoint(tile),
    cell,
    maskType,
    walkable,
    snappedTile: walkable ? roundTilePoint(tile) : snapQinglanTileToWalkable(tile),
  };
}

export function getQinglanMaskTypeAtTile(tile: QinglanTilePoint) {
  return maskTypeAtCell(tileToCell(tile));
}

export function snapQinglanTileToWalkable(tile: QinglanTilePoint) {
  const cell = nearestNavigableCell(tileToCell(tile), 28);
  return cell ? cellToTile(cell) : undefined;
}

export function findQinglanNavigationPath(from: QinglanTilePoint, to: QinglanTilePoint) {
  const start = nearestNavigableCell(tileToCell(from), 28);
  const goal = nearestNavigableCell(tileToCell(to), 28);
  if (!start || !goal) return [];

  if (sameCell(start, goal)) return [cellToTile(goal)];

  const cells = findCellPath(start, goal);
  if (cells.length === 0) return [];

  return simplifyCellPath(cells)
    .slice(1)
    .map(cellToTile);
}

export function moveQinglanTileToward(
  from: QinglanTilePoint,
  to: QinglanTilePoint,
  maxDistance: number,
) {
  const dist = distance(from, to);
  if (dist <= Math.max(0.01, maxDistance)) {
    const target = roundTilePoint(to);
    if (isQinglanTileWalkable(target) && isQinglanTileSegmentWalkable(from, target)) {
      return { tile: target, arrived: true, blocked: false };
    }
    return {
      tile: snapQinglanTileToWalkable(from) ?? roundTilePoint(from),
      arrived: false,
      blocked: true,
    };
  }

  const ratio = Math.min(1, maxDistance / Math.max(dist, 0.01));
  const next = roundTilePoint({
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  });

  if (isQinglanTileWalkable(next) && isQinglanTileSegmentWalkable(from, next)) {
    return { tile: next, arrived: false, blocked: false };
  }

  return {
    tile: snapQinglanTileToWalkable(from) ?? roundTilePoint(from),
    arrived: false,
    blocked: true,
  };
}

function buildMaskRows(runs: readonly CellRun[]) {
  const rows: (QinglanMaskType | undefined)[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => undefined),
  );

  for (const run of runs) {
    if (run.row < 0 || run.row >= ROWS) continue;
    for (let col = Math.max(0, run.from); col <= Math.min(COLS - 1, run.to); col++) {
      rows[run.row][col] = run.type;
    }
  }

  return rows;
}

function findCellPath(start: QinglanNavigationCell, goal: QinglanNavigationCell) {
  const open = new CellHeap();
  const startKey = cellKey(start);
  const goalKey = cellKey(goal);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();

  open.push({ cell: start, key: startKey, priority: heuristic(start, goal) });

  while (open.size > 0 && closed.size < MAX_SEARCH_CELLS) {
    const current = open.pop();
    if (!current || closed.has(current.key)) continue;
    if (current.key === goalKey) return reconstructCellPath(cameFrom, goalKey);

    closed.add(current.key);
    const currentScore = gScore.get(current.key) ?? Infinity;
    for (const neighbor of navigableNeighbors(current.cell)) {
      const neighborKey = cellKey(neighbor);
      if (closed.has(neighborKey)) continue;
      const tentative = currentScore + cellMoveCost(current.cell, neighbor);
      if (tentative >= (gScore.get(neighborKey) ?? Infinity)) continue;
      cameFrom.set(neighborKey, current.key);
      gScore.set(neighborKey, tentative);
      open.push({
        cell: neighbor,
        key: neighborKey,
        priority: tentative + heuristic(neighbor, goal),
      });
    }
  }

  return [];
}

function reconstructCellPath(cameFrom: Map<string, string>, goalKey: string) {
  const path = [parseCellKey(goalKey)];
  let currentKey = goalKey;
  while (cameFrom.has(currentKey)) {
    currentKey = cameFrom.get(currentKey)!;
    path.unshift(parseCellKey(currentKey));
  }
  return path;
}

function simplifyCellPath(cells: QinglanNavigationCell[]) {
  if (cells.length <= 2) return cells;

  const simplified: QinglanNavigationCell[] = [cells[0]];
  let anchor = cells[0];
  for (let i = 2; i < cells.length; i++) {
    if (segmentCellsAreNavigable(anchor, cells[i])) continue;
    const previous = cells[i - 1];
    simplified.push(previous);
    anchor = previous;
  }
  simplified.push(cells[cells.length - 1]);
  return simplified;
}

function navigableNeighbors(cell: QinglanNavigationCell) {
  const neighbors: QinglanNavigationCell[] = [];
  for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
    for (let colDelta = -1; colDelta <= 1; colDelta++) {
      if (rowDelta === 0 && colDelta === 0) continue;
      const neighbor = { col: cell.col + colDelta, row: cell.row + rowDelta };
      if (!isNavigableCell(neighbor)) continue;
      if (
        colDelta !== 0 &&
        rowDelta !== 0 &&
        (!isNavigableCell({ col: cell.col + colDelta, row: cell.row }) ||
          !isNavigableCell({ col: cell.col, row: cell.row + rowDelta }))
      ) {
        continue;
      }
      neighbors.push(neighbor);
    }
  }
  return neighbors;
}

export function isQinglanTileSegmentWalkable(from: QinglanTilePoint, to: QinglanTilePoint) {
  return segmentCellsAreNavigable(tileToCell(from), tileToCell(to));
}

function segmentCellsAreNavigable(from: QinglanNavigationCell, to: QinglanNavigationCell) {
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row), 1);
  for (let i = 0; i <= steps; i++) {
    const col = Math.round(from.col + ((to.col - from.col) * i) / steps);
    const row = Math.round(from.row + ((to.row - from.row) * i) / steps);
    if (!isNavigableCell({ col, row })) return false;
  }
  return true;
}

function nearestNavigableCell(origin: QinglanNavigationCell, maxRadius: number) {
  if (isNavigableCell(origin)) return origin;

  for (let radius = 1; radius <= maxRadius; radius++) {
    let best: QinglanNavigationCell | undefined;
    let bestDistance = Infinity;

    for (let row = origin.row - radius; row <= origin.row + radius; row++) {
      for (let col = origin.col - radius; col <= origin.col + radius; col++) {
        if (Math.abs(col - origin.col) !== radius && Math.abs(row - origin.row) !== radius) {
          continue;
        }
        const cell = { col, row };
        if (!isNavigableCell(cell)) continue;
        const cellDistance = Math.hypot(col - origin.col, row - origin.row);
        if (cellDistance < bestDistance) {
          best = cell;
          bestDistance = cellDistance;
        }
      }
    }

    if (best) return best;
  }

  return undefined;
}

function isNavigableCell(cell: QinglanNavigationCell) {
  const layer = maskTypeAtCell(cell);
  return isQinglanNavigableMaskType(layer) && NAVIGABLE_TYPES.has(layer);
}

function maskTypeAtCell(cell: QinglanNavigationCell) {
  return maskRows[cell.row]?.[cell.col];
}

function tileToCell(tile: QinglanTilePoint) {
  const x = clamp((tile.x / WORLD_TILES_W) * IMAGE_W, 0, IMAGE_W - 1);
  const y = clamp((tile.y / WORLD_TILES_H) * IMAGE_H, 0, IMAGE_H - 1);
  return {
    col: Math.floor(x / GRID_SIZE),
    row: Math.floor(y / GRID_SIZE),
  };
}

function cellToTile(cell: QinglanNavigationCell) {
  return roundTilePoint({
    x: (((cell.col + 0.5) * GRID_SIZE) / IMAGE_W) * WORLD_TILES_W,
    y: (((cell.row + 0.5) * GRID_SIZE) / IMAGE_H) * WORLD_TILES_H,
  });
}

function sameCell(a: QinglanNavigationCell, b: QinglanNavigationCell) {
  return a.col === b.col && a.row === b.row;
}

function cellMoveCost(from: QinglanNavigationCell, to: QinglanNavigationCell) {
  return from.col === to.col || from.row === to.row ? 1 : 1.414;
}

function heuristic(a: QinglanNavigationCell, b: QinglanNavigationCell) {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

function cellKey(cell: QinglanNavigationCell) {
  return `${cell.col},${cell.row}`;
}

function parseCellKey(key: string) {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

function distance(a: QinglanTilePoint, b: QinglanTilePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundTilePoint(tile: QinglanTilePoint) {
  return {
    x: roundTile(tile.x),
    y: roundTile(tile.y),
  };
}

function roundTile(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function countMaskStats(rows: (QinglanMaskType | undefined)[][]) {
  const stats: Record<QinglanMaskType | 'unclassified', number> = {
    walkable: 0,
    grass: 0,
    collision: 0,
    occlusion: 0,
    water: 0,
    dock: 0,
    unclassified: 0,
  };

  for (const row of rows) {
    for (const layer of row) {
      if (layer) stats[layer]++;
      else stats.unclassified++;
    }
  }

  return stats;
}

class CellHeap {
  private items: { cell: QinglanNavigationCell; key: string; priority: number }[] = [];

  get size() {
    return this.items.length;
  }

  push(item: { cell: QinglanNavigationCell; key: string; priority: number }) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return undefined;
    const first = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= this.items[index].priority) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }
      if (
        right < this.items.length &&
        this.items[right].priority < this.items[smallest].priority
      ) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}

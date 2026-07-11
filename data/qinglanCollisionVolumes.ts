import { QINGLAN_REGION_SEED } from './qinglanRegions';

type MaskType = 'walkable' | 'grass' | 'collision' | 'occlusion' | 'water' | 'dock';
type BlockingMaskType = 'collision' | 'occlusion' | 'water';
type CollisionKind = 'building' | 'tree' | 'water';

type CellRun = {
  row: number;
  from: number;
  to: number;
  type: MaskType;
};

type CellRect = {
  col: number;
  row: number;
  w: number;
  h: number;
};

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type QinglanCollisionVolume = {
  id: string;
  kind: CollisionKind;
  sourceType: BlockingMaskType;
  blocksMovement: true;
  cellRect: CellRect;
  imageRect: Rect;
  tileRect: Rect;
};

const WORLD_TILES_W = 96;
const WORLD_TILES_H = 72;
const IMAGE_W = QINGLAN_REGION_SEED.image.width;
const IMAGE_H = QINGLAN_REGION_SEED.image.height;
const GRID_SIZE = QINGLAN_REGION_SEED.cellMask.gridSize;

const BLOCKING_TYPES = new Set<MaskType>(['collision', 'occlusion', 'water']);

export const QINGLAN_COLLISION_VOLUMES = buildCollisionVolumes(
  QINGLAN_REGION_SEED.cellMask.runs as readonly CellRun[],
);

export const QINGLAN_COLLISION_VOLUME_SUMMARY = {
  source: QINGLAN_REGION_SEED.image.url,
  gridSize: GRID_SIZE,
  count: QINGLAN_COLLISION_VOLUMES.length,
  byKind: countVolumesByKind(QINGLAN_COLLISION_VOLUMES),
  image: { width: IMAGE_W, height: IMAGE_H },
  worldTiles: { width: WORLD_TILES_W, height: WORLD_TILES_H },
} as const;

export function getQinglanCollisionVolumes() {
  return QINGLAN_COLLISION_VOLUMES;
}

export function findQinglanCollisionVolumeAtTile(tile: { x: number; y: number }) {
  return QINGLAN_COLLISION_VOLUMES.find((volume) => pointInRect(tile, volume.tileRect));
}

function buildCollisionVolumes(runs: readonly CellRun[]) {
  const runsByRow = new Map<number, CellRun[]>();
  let maxRow = 0;

  for (const run of runs) {
    if (!BLOCKING_TYPES.has(run.type)) continue;
    maxRow = Math.max(maxRow, run.row);
    const rowRuns = runsByRow.get(run.row) ?? [];
    rowRuns.push(run);
    runsByRow.set(run.row, rowRuns);
  }

  let active = new Map<string, MutableVolume>();
  const finished: MutableVolume[] = [];

  for (let row = 0; row <= maxRow; row += 1) {
    const nextActive = new Map<string, MutableVolume>();
    const rowRuns = (runsByRow.get(row) ?? []).sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.from - b.from || a.to - b.to;
    });

    for (const run of rowRuns) {
      const key = volumeMergeKey(run);
      const existing = active.get(key);
      if (existing) {
        existing.cellRect.h += 1;
        nextActive.set(key, existing);
      } else {
        nextActive.set(key, {
          sourceType: run.type as BlockingMaskType,
          cellRect: {
            col: run.from,
            row,
            w: run.to - run.from + 1,
            h: 1,
          },
        });
      }
    }

    for (const [key, volume] of active) {
      if (!nextActive.has(key)) finished.push(volume);
    }

    active = nextActive;
  }

  finished.push(...active.values());

  return finished.map((volume, index): QinglanCollisionVolume => {
    const kind = kindForSourceType(volume.sourceType);
    return {
      id: `${kind}-${index.toString(36)}`,
      kind,
      sourceType: volume.sourceType,
      blocksMovement: true,
      cellRect: volume.cellRect,
      imageRect: imageRectForCellRect(volume.cellRect),
      tileRect: tileRectForCellRect(volume.cellRect),
    };
  });
}

type MutableVolume = {
  sourceType: BlockingMaskType;
  cellRect: CellRect;
};

function volumeMergeKey(run: CellRun) {
  return `${run.type}:${run.from}:${run.to}`;
}

function kindForSourceType(type: BlockingMaskType): CollisionKind {
  if (type === 'collision') return 'building';
  if (type === 'occlusion') return 'tree';
  return 'water';
}

function imageRectForCellRect(rect: CellRect) {
  return {
    x: rect.col * GRID_SIZE,
    y: rect.row * GRID_SIZE,
    w: rect.w * GRID_SIZE,
    h: rect.h * GRID_SIZE,
  };
}

function tileRectForCellRect(rect: CellRect) {
  return {
    x: roundTile((rect.col * GRID_SIZE * WORLD_TILES_W) / IMAGE_W),
    y: roundTile((rect.row * GRID_SIZE * WORLD_TILES_H) / IMAGE_H),
    w: roundTile((rect.w * GRID_SIZE * WORLD_TILES_W) / IMAGE_W),
    h: roundTile((rect.h * GRID_SIZE * WORLD_TILES_H) / IMAGE_H),
  };
}

function countVolumesByKind(volumes: readonly QinglanCollisionVolume[]) {
  return volumes.reduce(
    (counts, volume) => {
      counts[volume.kind] += 1;
      return counts;
    },
    { building: 0, tree: 0, water: 0 },
  );
}

function pointInRect(point: { x: number; y: number }, rect: Rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

function roundTile(value: number) {
  return Math.round(value * 100) / 100;
}

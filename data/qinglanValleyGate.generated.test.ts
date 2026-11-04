import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  QINGLAN_VALLEY_GATE_DATA,
  QINGLAN_VALLEY_GATE_WALKABILITY,
  getQinglanValleyGateCell,
  isQinglanValleyGateCellNavigable,
} from './qinglanValleyGate.generated';

type Tile = { x: number; y: number };
type SourceMask = {
  mapId: string;
  coordinateSpaces: {
    worldTiles: { width: number; height: number; tileSize: number };
  };
  navigableTypes: string[];
  blockingTypes: string[];
  cells: Record<string, string>;
};

const root = process.cwd();
const sourceDir = resolve(
  root,
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate',
);
const generatedPath = resolve(root, 'data/qinglanValleyGate.generated.ts');
const sourceFileNames = [
  'cellMask.json',
  'locations.json',
  'npcPoints.json',
  'interactions.json',
] as const;

function readJson<T>(fileName: (typeof sourceFileNames)[number]): T {
  return JSON.parse(readFileSync(resolve(sourceDir, fileName), 'utf8')) as T;
}

describe('qinglan_valley_gate Convex 可导入生成数据', () => {
  const mask = readJson<SourceMask>('cellMask.json');
  const locations = readJson<{ mapId: string; locations: unknown[] }>('locations.json');
  const npcPoints = readJson<{ mapId: string; points: { tile: Tile }[] }>('npcPoints.json');
  const interactions = readJson<{ mapId: string; points: { tile: Tile }[] }>(
    'interactions.json',
  );

  test('导出结构仅包含地图、色罩和语义点，不夹带手写路线', () => {
    expect(Object.keys(QINGLAN_VALLEY_GATE_DATA)).toEqual([
      'mapId',
      'width',
      'height',
      'tileSize',
      'navigableTypes',
      'cells',
      'locations',
      'npcPoints',
      'interactions',
    ]);
    expect(QINGLAN_VALLEY_GATE_DATA).toMatchObject({
      mapId: 'qinglan_valley_gate',
      width: 48,
      height: 36,
      tileSize: 32,
    });
    expect(QINGLAN_VALLEY_GATE_DATA.locations).toHaveLength(6);
    expect(QINGLAN_VALLEY_GATE_DATA.npcPoints).toHaveLength(5);
    expect(QINGLAN_VALLEY_GATE_DATA.interactions).toHaveLength(6);
  });

  test('行主序 cells 逐格匹配 48×36 cellMask 权威源', () => {
    expect(mask.coordinateSpaces.worldTiles).toEqual({ width: 48, height: 36, tileSize: 32 });
    expect(QINGLAN_VALLEY_GATE_DATA.cells).toHaveLength(mask.coordinateSpaces.worldTiles.height);

    for (let row = 0; row < mask.coordinateSpaces.worldTiles.height; row += 1) {
      expect(QINGLAN_VALLEY_GATE_DATA.cells[row]).toHaveLength(
        mask.coordinateSpaces.worldTiles.width,
      );
      for (let col = 0; col < mask.coordinateSpaces.worldTiles.width; col += 1) {
        const expectedType = mask.cells[`${col},${row}`];
        expect(getQinglanValleyGateCell(col, row)).toBe(expectedType);
        expect(isQinglanValleyGateCellNavigable(col, row)).toBe(
          mask.navigableTypes.includes(expectedType),
        );
      }
    }
    expect(getQinglanValleyGateCell(-1, 0)).toBeUndefined();
    expect(getQinglanValleyGateCell(48, 35)).toBeUndefined();
    expect(getQinglanValleyGateCell(47, 36)).toBeUndefined();
  });

  test('通行合同与地点、NPC 点、交互点逐项匹配 JSON 源', () => {
    expect(QINGLAN_VALLEY_GATE_DATA.navigableTypes).toEqual(mask.navigableTypes);
    expect(QINGLAN_VALLEY_GATE_WALKABILITY).toEqual({
      navigableTypes: mask.navigableTypes,
      blockingTypes: mask.blockingTypes,
    });
    expect(QINGLAN_VALLEY_GATE_DATA.locations).toEqual(locations.locations);
    expect(QINGLAN_VALLEY_GATE_DATA.npcPoints).toEqual(npcPoints.points);
    expect(QINGLAN_VALLEY_GATE_DATA.interactions).toEqual(interactions.points);

    for (const point of [...npcPoints.points, ...interactions.points]) {
      expect(isQinglanValleyGateCellNavigable(point.tile.x, point.tile.y)).toBe(true);
    }
  });

  test('Portal 明确区分已开放目的地与未开放移动锚点', () => {
    const west = QINGLAN_VALLEY_GATE_DATA.interactions.find(
      (entry) => entry.id === 'west_return_portal',
    );
    const mist = QINGLAN_VALLEY_GATE_DATA.interactions.find(
      (entry) => entry.id === 'mist_gate_portal',
    );
    expect(west).toMatchObject({
      kind: 'portal',
      locationId: 'valley_west_entry',
      portal: {
        status: 'available',
        destinationMapId: 'qinglan',
        destinationLocationId: 'market_west_gate',
      },
    });
    expect(mist).toMatchObject({
      kind: 'portal',
      locationId: 'mist_gate',
      portal: {
        status: 'unavailable',
        reasonCode: 'portal_destination_unavailable',
      },
    });
  });

  test('只生成 Convex 数据时输出确定，且不改写四份 JSON 源', () => {
    const generatedBefore = readFileSync(generatedPath, 'utf8');
    const sourceBefore = Object.fromEntries(
      sourceFileNames.map((fileName) => [
        fileName,
        readFileSync(resolve(sourceDir, fileName), 'utf8'),
      ]),
    );

    execFileSync(
      process.execPath,
      [resolve(root, 'scripts/buildQinglanValleyGatePrototype.mjs'), '--convex-data-only'],
      { cwd: root, stdio: 'pipe' },
    );

    // 只比内容，不比换行：Windows 上 git 检出时可能换成 CRLF，生成脚本写的是 LF。
    const lf = (text: string) => text.replace(/\r\n/g, '\n');
    expect(lf(readFileSync(generatedPath, 'utf8'))).toBe(lf(generatedBefore));
    for (const fileName of sourceFileNames) {
      expect(readFileSync(resolve(sourceDir, fileName), 'utf8')).toBe(sourceBefore[fileName]);
    }
  });
});

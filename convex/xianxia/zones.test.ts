import { ZONES } from './zones';
import { isWalkable, inZone, type TileMap } from './movementLogic';
import * as gentle from '../../data/gentle';

// World Foundation v1 · 可达性审计：把「地点坐标踩在可走地块上」做成可重复的硬保证。
// 读真实 gentle 地图，断言每个 zone 的入口/区域都可通行、区域互不重叠。
// 改了 zones.ts 坐标后，这条测试会立刻挡住「把入口设进墙里」的错误。

const MAP: TileMap = {
  width: gentle.mapwidth,
  height: gentle.mapheight,
  objectTiles: gentle.objmap as unknown as number[][][],
};

describe('zones 语义地图', () => {
  test('zoneId / 入口唯一且非空', () => {
    expect(ZONES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ZONES.map((z) => z.zoneId)).size).toBe(ZONES.length);
    for (const z of ZONES) expect(z.entryPoints.length).toBeGreaterThan(0);
  });
});

describe('zones 可达性审计', () => {
  test('每个入口都落在自己的 bounds 内', () => {
    for (const z of ZONES) {
      for (const ep of z.entryPoints) {
        expect({ zone: z.zoneId, inBounds: inZone(ep, z.bounds) }).toMatchObject({ inBounds: true });
      }
    }
  });

  test('每个入口都踩在可通行地块上（不在墙/水/障碍里）', () => {
    for (const z of ZONES) {
      for (const ep of z.entryPoints) {
        expect({ zone: z.zoneId, x: ep.x, y: ep.y, walkable: isWalkable(ep, MAP) }).toMatchObject({
          walkable: true,
        });
      }
    }
  });

  test('每个 zone 的整片 bounds 都可通行', () => {
    for (const z of ZONES) {
      for (let x = z.bounds.x1; x <= z.bounds.x2; x++) {
        for (let y = z.bounds.y1; y <= z.bounds.y2; y++) {
          expect({ zone: z.zoneId, x, y, walkable: isWalkable({ x, y }, MAP) }).toMatchObject({
            walkable: true,
          });
        }
      }
    }
  });

  test('zones 两两不重叠（区域互斥，避免归属歧义）', () => {
    for (let i = 0; i < ZONES.length; i++) {
      for (let j = i + 1; j < ZONES.length; j++) {
        const a = ZONES[i].bounds;
        const b = ZONES[j].bounds;
        const overlap = a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
        expect({ pair: `${ZONES[i].zoneId}/${ZONES[j].zoneId}`, overlap }).toMatchObject({
          overlap: false,
        });
      }
    }
  });
});

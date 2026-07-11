import {
  QINGLAN_NAVIGATION_SUMMARY,
  findQinglanNavigationPath,
  getQinglanTileNavigationInfo,
  isQinglanTileSegmentWalkable,
  isQinglanTileWalkable,
  snapQinglanTileToWalkable,
} from './qinglanNavigation';
import { buildQinglanResidentRoutePreview, QINGLAN_LIFE_SPOTS, RESIDENT_ROUTES } from './qinglan';

const CONNECTED_ROUTE_PAIRS = [
  {
    name: '西门门口到西门石阶',
    from: { x: 8, y: 20 },
    to: { x: 18, y: 20 },
  },
  {
    name: '西门石阶到主摊西',
    from: { x: 18, y: 20 },
    to: { x: 43, y: 35 },
  },
  {
    name: '主摊西到主摊东',
    from: { x: 43, y: 35 },
    to: { x: 51, y: 39 },
  },
  {
    name: '客栈到茶摊',
    from: { x: 58, y: 28 },
    to: { x: 56, y: 54 },
  },
  {
    name: '药铺柜台到药架',
    from: { x: 35, y: 30 },
    to: { x: 35, y: 32 },
  },
  {
    name: '茶摊到茶桥',
    from: { x: 56, y: 54 },
    to: { x: 60, y: 54 },
  },
  {
    name: '东坊路到客栈',
    from: { x: 78, y: 30 },
    to: { x: 58, y: 28 },
  },
];

describe('青岚坊市 cellMask 导航', () => {
  test('cellMask 是青岚导航的正式来源', () => {
    expect(QINGLAN_NAVIGATION_SUMMARY.source).toContain(
      'qinglan-reference-town-footprint-no-bamboo-v1.png',
    );
    expect(QINGLAN_NAVIGATION_SUMMARY.gridSize).toBe(8);
    expect(QINGLAN_NAVIGATION_SUMMARY.cellMaskStats.walkable).toBeGreaterThan(1000);
    expect(QINGLAN_NAVIGATION_SUMMARY.cellMaskStats.grass).toBeGreaterThan(1000);
    expect(QINGLAN_NAVIGATION_SUMMARY.cellMaskStats.occlusion).toBe(0);
    expect(QINGLAN_NAVIGATION_SUMMARY.cellMaskStats.collision).toBeGreaterThan(100);
    expect(QINGLAN_NAVIGATION_SUMMARY.cellMaskStats.water).toBeGreaterThan(100);
  });

  test('已连通的生活流小段都能找到全程可走的路径', () => {
    for (const pair of CONNECTED_ROUTE_PAIRS) {
      const from = snapQinglanTileToWalkable(pair.from);
      const to = snapQinglanTileToWalkable(pair.to);
      expect({ route: pair.name, from, to }).toMatchObject({
        from: expect.any(Object),
        to: expect.any(Object),
      });

      const path = findQinglanNavigationPath(from!, to!);
      expect({ route: pair.name, pathLength: path.length }).toMatchObject({
        pathLength: expect.any(Number),
      });
      expect(path.length).toBeGreaterThan(0);

      let previous = from!;
      for (const point of path) {
        const info = getQinglanTileNavigationInfo(point);
        expect({ route: pair.name, point, info }).toMatchObject({
          info: { walkable: true },
        });
        expect({
          route: pair.name,
          from: previous,
          to: point,
          segmentWalkable: isQinglanTileSegmentWalkable(previous, point),
        }).toMatchObject({
          segmentWalkable: true,
        });
        previous = point;
      }
    }
  });

  test('语义生活点都能吸附到 cellMask 可走区', () => {
    for (const spot of QINGLAN_LIFE_SPOTS) {
      const snapped = snapQinglanTileToWalkable(spot.tile);
      expect({ spot: spot.label, source: spot.tile, snapped }).toMatchObject({
        snapped: expect.any(Object),
      });
      expect({
        spot: spot.label,
        snapped,
        walkable: isQinglanTileWalkable(snapped!),
      }).toMatchObject({
        walkable: true,
      });
      expect(distance(spot.tile, snapped!)).toBeLessThan(8);
    }
  });

  test('居民生活流相邻语义点都能用 A* 连通', () => {
    const spotById = new Map(QINGLAN_LIFE_SPOTS.map((spot) => [spot.spotId, spot]));

    for (const [residentId, route] of Object.entries(RESIDENT_ROUTES)) {
      for (let i = 0; i < route.length - 1; i += 1) {
        const fromSpot = spotById.get(route[i]);
        const toSpot = spotById.get(route[i + 1]);
        expect({
          residentId,
          fromSpotId: route[i],
          toSpotId: route[i + 1],
          fromSpot,
          toSpot,
        }).toMatchObject({
          fromSpot: expect.any(Object),
          toSpot: expect.any(Object),
        });

        const from = snapQinglanTileToWalkable(fromSpot!.tile);
        const to = snapQinglanTileToWalkable(toSpot!.tile);
        const path = from && to ? findQinglanNavigationPath(from, to) : [];

        expect({
          residentId,
          route: `${fromSpot!.label} → ${toSpot!.label}`,
          from,
          to,
          pathLength: path.length,
        }).toMatchObject({
          from: expect.any(Object),
          to: expect.any(Object),
          pathLength: expect.any(Number),
        });
        expect(path.length).toBeGreaterThan(0);
      }
    }
  });

  test('临时 waypoint 不在常规生活流时仍保持 schedule currentStop 自洽', () => {
    const preview = buildQinglanResidentRoutePreview({
      residentId: 'qinglan-elder-mu',
      role: 'elder',
      displayTile: { x: 60, y: 54 },
      targetTile: { x: 60, y: 54 },
      finalTargetTile: { x: 60, y: 54 },
      pathTiles: [],
      waypointId: 'tea_bridge',
      status: 'thinking',
      currentLocationId: 'market_tea_stall',
      currentIntent: '在茶摊清静处暂歇。',
      activityLabel: '思量',
      nextActionAt: 1,
    });

    expect(preview.waypointId).toBe('tea_bridge');
    expect(preview.scheduleRoute.currentStop.spotId).toBe('tea_bridge');
    expect(preview.scheduleRoute.currentStop.offset).toBe(0);
    expect(preview.scheduleRoute.currentIndex).toBe(0);
  });

  test('红色地基和水域不会被当作可走区', () => {
    const samples = [
      { tile: { x: 35, y: 22 }, expected: 'collision' },
      { tile: { x: 84, y: 60 }, expected: 'water' },
    ];

    for (const sample of samples) {
      const info = getQinglanTileNavigationInfo(sample.tile);
      expect({
        tile: sample.tile,
        maskType: info.maskType,
        walkable: isQinglanTileWalkable(sample.tile),
      }).toMatchObject({
        maskType: sample.expected,
        walkable: false,
      });
    }
  });

  test('浅绿色草地可以通行，原竹林区域已替换为草地可走', () => {
    const samples = [
      { name: '西北浅草地', tile: { x: 1.33, y: 1.33 }, expected: 'grass', walkable: true },
      { name: '西侧浅草边', tile: { x: 2.32, y: 5.04 }, expected: 'grass', walkable: true },
      { name: '西北原竹林', tile: { x: 5.17, y: 3.71 }, expected: 'grass', walkable: true },
    ];

    for (const sample of samples) {
      const info = getQinglanTileNavigationInfo(sample.tile);
      expect({
        name: sample.name,
        tile: sample.tile,
        maskType: info.maskType,
        walkable: isQinglanTileWalkable(sample.tile),
      }).toMatchObject({
        maskType: sample.expected,
        walkable: sample.walkable,
      });
    }
  });

  test('西门入口按 footprint mask 保留门前、广场、石阶可走，红色地基阻挡', () => {
    const walkableSamples = [
      { name: '北侧入坊路', tile: { x: 8, y: 8 } },
      { name: '西门门前广场', tile: { x: 8, y: 20 } },
      { name: '西门石阶', tile: { x: 18, y: 20 } },
      { name: '东向主路', tile: { x: 24, y: 20 } },
      { name: '东向主路延伸', tile: { x: 28, y: 20 } },
    ];

    for (const sample of walkableSamples) {
      expect({
        name: sample.name,
        tile: sample.tile,
        info: getQinglanTileNavigationInfo(sample.tile),
      }).toMatchObject({
        info: { walkable: true },
      });
    }

    const blockedSamples = [
      { name: '西门左翼门楼', tile: { x: 2.5, y: 15 } },
      { name: '西门红色门楼地基', tile: { x: 8, y: 17 } },
      { name: '西门右翼门楼', tile: { x: 12, y: 15 } },
    ];

    for (const sample of blockedSamples) {
      expect({
        name: sample.name,
        tile: sample.tile,
        info: getQinglanTileNavigationInfo(sample.tile),
      }).toMatchObject({
        info: { walkable: false },
      });
    }
  });
});

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

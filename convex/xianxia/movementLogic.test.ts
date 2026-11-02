import {
  effectiveTravelTarget,
  distance,
  pickEntryPoint,
  locationAtPosition,
  pickAvailableTravelStandpoint,
  resolveTravelTarget,
  hasArrived,
  type LocationPoint,
} from './movementLogic';

// Stage 2 · M1 §2.1 物理移动纯逻辑单测：语义↔坐标双向换算 + 到达/可达判定。

// 与 seed.ts 对齐的 5 个地点入口坐标。
const LOCS: LocationPoint[] = [
  { locationId: 'mountain_gate', entryPoints: [{ x: 1, y: 1 }] },
  { locationId: 'quiet_retreat', entryPoints: [{ x: 4, y: 4 }] },
  { locationId: 'market', entryPoints: [{ x: 18, y: 12 }] },
  { locationId: 'alchemy_room', entryPoints: [{ x: 14, y: 5 }] },
  { locationId: 'secret_realm_gate', entryPoints: [{ x: 9, y: 9 }] },
];

describe('distance / pickEntryPoint', () => {
  test('欧氏距离', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  test('取第一个入口；无入口返回 null', () => {
    expect(pickEntryPoint({ locationId: 'm', entryPoints: [{ x: 18, y: 12 }] })).toEqual({ x: 18, y: 12 });
    expect(pickEntryPoint({ locationId: 'x', entryPoints: [] })).toBeNull();
  });
});

describe('locationAtPosition（身体→语义）', () => {
  test('站在入口点上即归该地', () => {
    expect(locationAtPosition({ x: 18, y: 12 }, LOCS)).toBe('market');
    expect(locationAtPosition({ x: 1, y: 1 }, LOCS)).toBe('mountain_gate');
  });

  test('归到附近最近的语义地点', () => {
    // 紧邻坊市(18,12)
    expect(locationAtPosition({ x: 17, y: 12 }, LOCS)).toBe('market');
    // 山门(1,1)与静修处(4,4)之间，更近山门
    expect(locationAtPosition({ x: 2, y: 1 }, LOCS)).toBe('mountain_gate');
  });

  test('远离所有入口的空地 → null（不强行归位，防整片地图塌进角落地点）', () => {
    // 地图 64×48 的中心，离任何入口都 >4 格
    expect(locationAtPosition({ x: 32, y: 24 }, LOCS)).toBeNull();
  });

  test('阈值可调：放大 maxDistance 后远点也能归位', () => {
    expect(locationAtPosition({ x: 32, y: 24 }, LOCS, 100)).not.toBeNull();
  });

  test('bounds 命中优先于最近入口', () => {
    const withBounds: LocationPoint[] = [
      { locationId: 'market', entryPoints: [{ x: 18, y: 12 }], bounds: { x1: 14, y1: 9, x2: 24, y2: 17 } },
      { locationId: 'mountain_gate', entryPoints: [{ x: 1, y: 1 }] },
    ];
    // (15,10) 落在坊市 bounds 内，即便离 mountain_gate 入口也不近
    expect(locationAtPosition({ x: 15, y: 10 }, withBounds)).toBe('market');
  });

  test('空地点表 → null', () => {
    expect(locationAtPosition({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('resolveTravelTarget（语义→坐标 + 校验）', () => {
  test('已知地点 → ok + 入口坐标', () => {
    const r = resolveTravelTarget(LOCS, 'market');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.destination).toEqual({ x: 18, y: 12 });
  });

  test('未知地点 → travel_failed: location_unknown', () => {
    const r = resolveTravelTarget(LOCS, 'atlantis');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('location_unknown');
  });

  test('无入口地点 → no_entry_point', () => {
    const r = resolveTravelTarget([{ locationId: 'void', entryPoints: [] }], 'void');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe('no_entry_point');
  });
});

describe('hasArrived', () => {
  test('误差容忍内算到达', () => {
    expect(hasArrived({ x: 18, y: 12 }, { x: 18, y: 12 })).toBe(true);
    expect(hasArrived({ x: 19, y: 12 }, { x: 18, y: 12 })).toBe(true); // 1 格内
    expect(hasArrived({ x: 18, y: 15 }, { x: 18, y: 12 })).toBe(false); // 3 格外
  });
});

describe('effectiveTravelTarget', () => {
  test('uses the live executor snap, then its persisted endpoint, never a broad zone shortcut', () => {
    expect(
      effectiveTravelTarget({
        executorTarget: { x: 42, y: 16 },
        persistedTarget: { x: 43, y: 16 },
        semanticEntry: { x: 43, y: 16 },
      }),
    ).toEqual({ x: 42, y: 16 });
    expect(
      effectiveTravelTarget({
        persistedTarget: { x: 42, y: 16 },
        semanticEntry: { x: 43, y: 16 },
      }),
    ).toEqual({ x: 42, y: 16 });
    expect(
      effectiveTravelTarget({
        semanticEntry: { x: 43, y: 16 },
      }),
    ).toEqual({ x: 43, y: 16 });
  });
});

describe('pickAvailableTravelStandpoint', () => {
  const map = {
    width: 4,
    height: 4,
    objectTiles: [
      Array.from({ length: 4 }, () =>
        Array.from({ length: 4 }, () => -1),
      ),
    ],
  };
  const location: LocationPoint = {
    locationId: 'market',
    entryPoints: [{ x: 3, y: 2 }],
    bounds: { x1: 1, y1: 1, x2: 3, y2: 3 },
  };

  test('keeps a free entry, otherwise deterministically reserves the nearest free zone cell', () => {
    expect(
      pickAvailableTravelStandpoint({
        location,
        actorPosition: { x: 0, y: 2 },
        otherPositions: [],
        map,
      }),
    ).toEqual({ x: 3, y: 2 });
    expect(
      pickAvailableTravelStandpoint({
        location,
        actorPosition: { x: 1, y: 2 },
        otherPositions: [{ x: 3, y: 2 }],
        map,
      }),
    ).toEqual({ x: 1, y: 2 });
  });

  test('never reserves a collision or blocked cell', () => {
    const blockedMap = {
      ...map,
      objectTiles: [
        map.objectTiles[0].map((column, x) =>
          column.map((value, y) =>
            x === 1 && y === 2 ? 0 : value,
          ),
        ),
      ],
    };
    expect(
      pickAvailableTravelStandpoint({
        location,
        actorPosition: { x: 1, y: 2 },
        otherPositions: [{ x: 3, y: 2 }],
        map: blockedMap,
      }),
    ).toEqual({ x: 2, y: 2 });
  });
});

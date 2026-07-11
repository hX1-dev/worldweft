// 太虚界「语义地图」单一真相源（World Foundation v1）。纯数据，无 Convex 依赖。
// 把地点从「一个坐标点」升成「一片真实区域」：bounds 是区域边界，entryPoints 是入口坐标。
// 坐标对齐真实 gentle 地图、且都落在可通行地块上（由 zones.test.ts 的可达性审计保证）。
//
// 这是改地图最该动的一处：增删地点、挪区域、调可做动作，都在此处改一行即可，
// seed.ts 从这里派生 locations 表，movement 据此判断「在哪个区/能否到达」。
// 后续 accessRule / portals / resourceNodes 等再按需扩展，本版（W1）只立「区域 + 可达性」。

export type Zone = {
  zoneId: string;
  name: string;
  kind: string;
  bounds: { x1: number; y1: number; x2: number; y2: number }; // 含入边界（格）
  entryPoints: { x: number; y: number }[]; // 必在 bounds 内、且可走
  allowedActions: string[];
  dangerLevel: number;
  spiritualEnergy: number;
  description: string;
};

// 五区分布在 64×48 地图的不同方位，彼此拉开，避免「最近点」归属塌缩。
export const ZONES: Zone[] = [
  {
    zoneId: 'mountain_gate',
    name: '山门',
    kind: 'mountain_gate',
    bounds: { x1: 7, y1: 13, x2: 12, y2: 17 },
    entryPoints: [{ x: 10, y: 15 }],
    allowedActions: ['cultivate', 'breakthrough', 'talk', 'request_teaching', 'spar', 'gift'],
    dangerLevel: 0,
    spiritualEnergy: 3,
    description: '青岚宗外门山门，灵气温和，可安心修炼、突破、求教、切磋。',
  },
  {
    zoneId: 'quiet_retreat',
    name: '静修处',
    kind: 'meditation',
    bounds: { x1: 27, y1: 19, x2: 32, y2: 23 },
    entryPoints: [{ x: 30, y: 21 }],
    allowedActions: ['cultivate', 'breakthrough', 'talk'],
    dangerLevel: 0,
    spiritualEnergy: 4,
    description: '外门弟子闭关吐纳的清静之地，灵气凝聚，最宜潜心修炼。',
  },
  {
    zoneId: 'market',
    name: '坊市',
    kind: 'market',
    bounds: { x1: 40, y1: 14, x2: 45, y2: 18 },
    entryPoints: [{ x: 43, y: 16 }],
    allowedActions: ['talk', 'trade', 'gift', 'steal'],
    dangerLevel: 1,
    spiritualEnergy: 2,
    description: '外门弟子交换灵石、丹药、符箓与传闻的地方，赵掌柜的灵药铺在此。',
  },
  {
    zoneId: 'alchemy_room',
    name: '丹房',
    kind: 'alchemy_room',
    bounds: { x1: 8, y1: 26, x2: 13, y2: 30 },
    entryPoints: [{ x: 11, y: 28 }],
    allowedActions: ['talk', 'steal'],
    dangerLevel: 2,
    spiritualEnergy: 3,
    description: '青岚宗炼丹重地，丹香浮动、守卫巡守。擅闯者为规矩所不容。',
  },
  {
    zoneId: 'secret_realm_gate',
    name: '秘境入口',
    kind: 'secret_realm_gate',
    bounds: { x1: 38, y1: 28, x2: 43, y2: 32 },
    entryPoints: [{ x: 41, y: 30 }],
    allowedActions: ['explore', 'steal'],
    dangerLevel: 3,
    spiritualEnergy: 5,
    description: '秘境洞口，机缘与凶险并存。低境界弟子探索，风险自担。',
  },
];

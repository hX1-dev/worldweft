export type QinglanTestAgent = {
  id: string;
  name: string;
  character: string;
  role: string;
  tile: { x: number; y: number };
  orientation: 0 | 90 | 180 | 270;
  isMoving?: boolean;
  isThinking?: boolean;
  isSpeaking?: boolean;
  emoji?: string;
};

export const QINGLAN_TEST_AGENTS: QinglanTestAgent[] = [
  {
    id: 'qinglan-guard-west',
    name: '坊市巡守',
    character: 'f2',
    role: 'guard',
    tile: { x: 14, y: 34 },
    orientation: 90,
    isThinking: true,
    emoji: '👁️',
  },
  {
    id: 'qinglan-medicine-keeper',
    name: '药铺掌柜',
    character: 'f8',
    role: 'merchant',
    tile: { x: 35, y: 30 },
    orientation: 90,
    emoji: '🌿',
  },
  {
    id: 'qinglan-liu-qiaoer',
    name: '柳巧儿',
    character: 'f6',
    role: 'merchant',
    tile: { x: 43, y: 36 },
    orientation: 180,
    isSpeaking: true,
    emoji: '💬',
  },
  {
    id: 'qinglan-lin-xiaoman',
    name: '林小满',
    character: 'f5',
    role: 'outer_disciple',
    tile: { x: 56, y: 53 },
    orientation: 0,
    isMoving: true,
    emoji: '🍵',
  },
  {
    id: 'qinglan-elder-mu',
    name: '穆前辈',
    character: 'f9',
    role: 'elder',
    tile: { x: 60, y: 54 },
    orientation: 270,
    isThinking: true,
    emoji: '🧘',
  },
  {
    id: 'qinglan-inn-guest',
    name: '山下散修',
    character: 'f4',
    role: 'wandering_cultivator',
    tile: { x: 58, y: 28 },
    orientation: 90,
    emoji: '🧳',
  },
  {
    id: 'qinglan-dock-trader',
    name: '码头商贩',
    character: 'f7',
    role: 'merchant',
    tile: { x: 76, y: 55 },
    orientation: 180,
    isThinking: true,
    emoji: '📦',
  },
  {
    id: 'qinglan-porter',
    name: '码头脚夫',
    character: 'f3',
    role: 'porter',
    tile: { x: 78, y: 51 },
    orientation: 0,
    isMoving: true,
  },
  {
    id: 'qinglan-east-traveler',
    name: '东路行商',
    character: 'f1',
    role: 'traveler',
    tile: { x: 94, y: 36 },
    orientation: 180,
    emoji: '🧭',
  },
];

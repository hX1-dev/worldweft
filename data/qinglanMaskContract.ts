export type QinglanMaskType = 'walkable' | 'grass' | 'collision' | 'occlusion' | 'water' | 'dock';

export type QinglanMaskClass = 'navigable' | 'blocking';

export const QINGLAN_MASK_TYPES = [
  'walkable',
  'grass',
  'collision',
  'occlusion',
  'water',
  'dock',
] as const satisfies readonly QinglanMaskType[];

export const QINGLAN_NAVIGABLE_MASK_TYPES = ['walkable', 'grass', 'dock'] as const;
export const QINGLAN_BLOCKING_MASK_TYPES = ['collision', 'occlusion', 'water'] as const;

export const QINGLAN_MASK_RULES: Record<
  QinglanMaskType,
  {
    label: string;
    debugLabel: string;
    color: string;
    class: QinglanMaskClass;
    walkable: boolean;
    sourceRule: string;
  }
> = {
  walkable: {
    label: '道路可走',
    debugLabel: '可走',
    color: '#f4d58d',
    class: 'navigable',
    walkable: true,
    sourceRule: '浅黄道路、广场、楼梯、桥面入口等脚底可站立区域。',
  },
  grass: {
    label: '浅绿草地可走',
    debugLabel: '草地可走',
    color: '#9bcf66',
    class: 'navigable',
    walkable: true,
    sourceRule: '浅绿色草地、院落边缘、路边空地；它是可走地面，不是树木。',
  },
  collision: {
    label: '红色地基碰撞',
    debugLabel: '地基阻挡',
    color: '#ff4d5f',
    class: 'blocking',
    walkable: false,
    sourceRule: '红色建筑地基、实体墙体、不可进入的建筑底座。',
  },
  occlusion: {
    label: '深绿树竹遮挡',
    debugLabel: '树竹阻挡',
    color: '#1f8f4d',
    class: 'blocking',
    walkable: false,
    sourceRule: '深绿色树冠、竹林、浓密灌木；当前先按不可走遮挡处理。',
  },
  water: {
    label: '蓝色水域',
    debugLabel: '水域阻挡',
    color: '#4fc3ff',
    class: 'blocking',
    walkable: false,
    sourceRule: '蓝色河道、池塘、外侧水面；除非被桥/码头覆盖，否则不可走。',
  },
  dock: {
    label: '棕色桥码头可走',
    debugLabel: '桥码头可走',
    color: '#d28a4c',
    class: 'navigable',
    walkable: true,
    sourceRule: '棕色木桥、码头、船边可站立木板。',
  },
};

export function isQinglanMaskType(type: unknown): type is QinglanMaskType {
  return typeof type === 'string' && (QINGLAN_MASK_TYPES as readonly string[]).includes(type);
}

export function isQinglanNavigableMaskType(type: unknown): type is QinglanMaskType {
  return typeof type === 'string' && (QINGLAN_NAVIGABLE_MASK_TYPES as readonly string[]).includes(type);
}

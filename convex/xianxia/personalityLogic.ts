// 性格双轴的「纯逻辑层」（鬼谷仿造 · D）。不依赖 Convex，可被 Jest 直接单测。
//
// 鬼谷八荒最扎实、最值得抄的一层：内在 7 种（对善恶/阵营的态度）× 外在 12 种
// （社交行为优先级），每个标签都有确定性的「性格 → 行为 / 好感修正」。
// 本模块只产纯函数，供别处查表：
//   - 关系/好感护栏 affinityGainMult / grudgeDecayMult ——喂 E（衰减）
//   - 仇恨链该替谁出头 avengeKinds ——喂 F（涌现追杀）
//   - 修炼驱动力 cultivationDriveMult ——喂 G（自主成长）
//   - 注入 LLM 的性格叙事片段 personaFragment ——喂 agent prompt
// 数值是规则（代码定天命），叙事片段是种子（Agent 演众生）。

export const INNER_TRAITS = ['无私', '正直', '仁善', '中庸', '利己', '狂邪', '邪恶'] as const;
export const OUTER_TRAITS = [
  '天伦', '义气', '护短', '孤僻', '爱家', '名声', '权力', '睚眦', '任我', '情种', '传承', '忠贞',
] as const;
export type InnerTrait = (typeof INNER_TRAITS)[number];
export type OuterTrait = (typeof OUTER_TRAITS)[number];

// —— 内在性格 → 阵营轴（正 / 中 / 魔），喂 F 的正魔判定与阵营匹配 ——
export type Alignment = 'righteous' | 'neutral' | 'demonic';

const ALIGNMENT: Record<InnerTrait, Alignment> = {
  无私: 'righteous',
  正直: 'righteous',
  仁善: 'righteous',
  中庸: 'neutral',
  利己: 'neutral',
  狂邪: 'demonic',
  邪恶: 'demonic',
};
export function alignmentOf(inner: string): Alignment {
  return ALIGNMENT[inner as InnerTrait] ?? 'neutral';
}

// —— 好感增量的性格调节（喂 E）。孤僻慢热，须送礼破冰；其余默认 1 ——
const AFFINITY_GAIN_MULT: Partial<Record<OuterTrait, number>> = {
  孤僻: 0.5,
};
export function affinityGainMult(outer: string): number {
  return AFFINITY_GAIN_MULT[outer as OuterTrait] ?? 1;
}

// —— 负面情绪（仇恨/怀疑/畏惧）的衰减倍率（喂 E 的 decayDims）——
// 1 = 正常随时间淡化；0 = 永不淡化（睚眦记仇）；>1 = 更快释怀（仁善宽厚）。
export function grudgeDecayMult(inner: string, outer: string): number {
  if (outer === '睚眦') return 0; // 睚眦必报，经年不忘
  if (inner === '仁善') return 1.5; // 仁善宽厚，易释前嫌
  return 1;
}

// —— 此性格会替哪一类关系出头报仇（喂 F 的 deriveGrudges）——
export type AvengeKind = 'kin' | 'spouse' | 'friend' | 'disciple';
const AVENGE: Partial<Record<OuterTrait, AvengeKind[]>> = {
  天伦: ['kin'],
  爱家: ['spouse', 'kin'],
  义气: ['friend'],
  护短: ['disciple'],
};
export function avengeKinds(outer: string): AvengeKind[] {
  return AVENGE[outer as OuterTrait] ?? [];
}

// —— 自主修炼驱动力倍率（喂 G）。逐权位 / 传薪火 / 守己道者更勤，多情者略分心 ——
export function cultivationDriveMult(inner: string, outer: string): number {
  let m = 1;
  if (outer === '权力') m += 0.3; // 逐境界以求地位
  if (outer === '传承') m += 0.15; // 精进以传后人
  if (outer === '任我') m += 0.15; // 专注己道
  if (outer === '孤僻') m += 0.1; // 独处精修
  if (inner === '狂邪') m += 0.2; // 狂者激进求进
  if (outer === '情种') m -= 0.1; // 多情分心
  return Math.max(0.5, m);
}

// —— 注入 LLM 的性格叙事片段（喂 agent prompt 的 persona）——
const INNER_DESC: Record<InnerTrait, string> = {
  无私: '心怀苍生、乐于成全他人',
  正直: '持身端方、最厌欺瞒',
  仁善: '宽厚慈悲、易宽宥他人',
  中庸: '随和守常、不偏不倚',
  利己: '凡事先计自身得失',
  狂邪: '张狂不羁、快意恩仇',
  邪恶: '冷漠寡恩、视人命如草芥',
};
const OUTER_DESC: Record<OuterTrait, string> = {
  天伦: '极重血亲，亲族受辱必报',
  义气: '重朋友同门情义，肯为友出头',
  护短: '回护门下晚辈，谁动其徒便与之相争',
  孤僻: '孤介寡合、慢热难近，须以诚意破冰',
  爱家: '顾恋家室，护道侣子女甚切',
  名声: '在意声名体面，好在正道露脸',
  权力: '热衷地位权柄，汲汲于宗门进身',
  睚眦: '睚眦必报，记仇极深、经年不忘',
  任我: '我行我素，不为人情所缚',
  情种: '多情重色，易为容色所动',
  传承: '念兹在兹于收徒传功、薪火相续',
  忠贞: '守一不二，未偶则觅良俦、既偶则不二色',
};
export function personaFragment(inner: string, outer: string): string {
  const i = INNER_DESC[inner as InnerTrait];
  const o = OUTER_DESC[outer as OuterTrait];
  return [i, o].filter(Boolean).join('；');
}

// 自主成长的「纯逻辑层」（鬼谷仿造 · G，命门）。不依赖 Convex，可被 Jest 直接单测。
//
// 鬼谷八荒被骂「假活木桩」的根因：NPC 大境界突破必须玩家投喂，多数 NPC 几十年停滞。
// 我们的立身之本：NPC 无玩家干预也能可见、合理地自我演化。本模块只产纯函数：
//   - autoCultivationGain：每个世界回合，全员都得的「背景修为涓流」（保证性、无 LLM、覆盖守职者）。
//   - proposeBonds：双向好感深厚者，按性格在运行时缔结新关系（道侣/师徒/结义）——补鬼谷「关系出生即定」。
// 平衡阀门（吸取鬼谷「必须投喂」反面）：境界越高涓流越慢、缔结门槛高，世界不会通胀式全员化神。
// 风险性的跨境大关仍由既有动作循环（手动 breakthrough）裁决，本涓流不静默触发天劫。

import { realmRank } from './rules';
import { cultivationDriveMult } from './personalityLogic';

// 灵根与修炼的契合度：杂灵根驳杂稍慢，正灵根顺畅。
function spiritRootFit(spiritRoot?: string): number {
  if (spiritRoot === 'mixed') return 0.85;
  if (!spiritRoot) return 0.9;
  return 1;
}

// 一个世界回合的「背景修为涓流」。以地灵气为主，性格驱动、灵根契合、昼夜为辅，境界越高越慢。
// 刻意小于「专注修炼」(resolveCultivate)：被动 < 主动；最低也得 1，保证人人有进益、无人停滞。
export function autoCultivationGain(args: {
  spiritualEnergy: number;
  spiritRoot?: string;
  realm: string;
  innerTrait: string;
  outerTrait: string;
  phaseBonus: number; // 昼夜修炼加成（清晨 +2，余 0）
}): number {
  const base = 1 + args.spiritualEnergy * 0.5;
  const drive = cultivationDriveMult(args.innerTrait, args.outerTrait);
  const fit = spiritRootFit(args.spiritRoot);
  const phase = 1 + Math.max(0, args.phaseBonus) * 0.1;
  const realmSlow = 1 / (1 + realmRank(args.realm) * 0.4); // 境界越高，被动精进越慢（平衡阀门）
  return Math.max(1, Math.round(base * drive * fit * phase * realmSlow));
}

// —— 关系网运行时生长（proposeBonds）——
export type BondKind = '道侣' | '师徒' | '结义';
export type BondPair = {
  a: string;
  b: string;
  affinityAB: number; // a→b 好感
  affinityBA: number; // b→a 好感
  aInner: string;
  aOuter: string;
  bInner: string;
  bOuter: string;
  existingTags: string[]; // 该对已有关系标签（避免重复缔结、禁血亲结道侣）
};
export type BondProposal = { a: string; b: string; kind: BondKind; reason: string };

export const BOND_THRESHOLD = 70; // 双向好感都极高方缔结：缘分难得，宁缺毋滥
const BOND_KINDS: BondKind[] = ['道侣', '师徒', '结义'];

const REASON: Record<BondKind, string> = {
  道侣: '情投意合，结为道侣',
  师徒: '倾心传授，结为师徒',
  结义: '志同道合，义结金兰',
};

// 据双方性格择定缔结何种关系；不合则返回 null。
function chooseBondKind(p: BondPair): BondKind | null {
  const outers = [p.aOuter, p.bOuter];
  const hasBlood = p.existingTags.includes('血亲') || p.existingTags.includes('亲族');
  // 道侣：一方多情/忠贞且非血亲。
  if (!hasBlood && (outers.includes('情种') || outers.includes('忠贞'))) return '道侣';
  // 师徒：一方有传承之心。
  if (outers.includes('传承')) return '师徒';
  // 结义：一方重义气。
  if (outers.includes('义气')) return '结义';
  return null;
}

// 双向好感都达门槛、尚无缔结关系者，按性格缔结新关系。门槛高、宁缺毋滥。
export function proposeBonds(pairs: BondPair[]): BondProposal[] {
  const out: BondProposal[] = [];
  for (const p of pairs) {
    if (BOND_KINDS.some((k) => p.existingTags.includes(k))) continue; // 已有缔结，不再重复
    if (p.affinityAB < BOND_THRESHOLD || p.affinityBA < BOND_THRESHOLD) continue;
    const kind = chooseBondKind(p);
    if (kind) out.push({ a: p.a, b: p.b, kind, reason: REASON[kind] });
  }
  return out;
}

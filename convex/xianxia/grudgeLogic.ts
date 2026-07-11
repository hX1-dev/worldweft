// 仇恨链的「纯逻辑层」（鬼谷仿造 · F）。不依赖 Convex，可被 Jest 直接单测。
//
// 鬼谷八荒最像「活世界」的机制：结仇不是固定脚本，而是关系图推导——加害一人，
// 在乎他的亲友会替他记恨加害者（经典涌现：刚双修完的道侣突来「为夫报仇」）。
// 本模块只产纯函数：
//   - deriveGrudges：受害者被加害 → 其亲友对加害者生出二次仇恨（按性格决定谁出头）。
//   - shouldSeekRevenge：关系坠入仇敌之境 + 性格 → 是否萌生主动复仇之念（喂行为层，暂不接入）。
// 「替谁出头」查 personalityLogic.avengeKinds（义气护友 / 护短护徒 / 天伦护亲 / 爱家护配偶）。
// 与传闻系统互补：传闻散播「知道」，仇恨链改变「关系」；两者各司其职、不重复。

import { avengeKinds, type AvengeKind } from './personalityLogic';
import type { DimDelta } from './relationshipLogic';

// 与受害者有关系的一个人（接线层据 tags/好感把关系归类后传入）。
export type AllyRelation = {
  actorId: string; // 可能替受害者出头的人
  kind: AvengeKind | 'other'; // 该人相对受害者的关系类别（亲/配偶/友/徒/其他）
  innerTrait: string;
  outerTrait: string;
};

// 一颗「二次仇恨」种子：某人因在乎受害者而对加害者起的关系变化。
export type GrudgeSeed = {
  actorId: string; // 记恨者
  delta: DimDelta; // 他对加害者的关系变化（好感↓ / 怀疑↑）
  reason: string;
};

const KIND_LABEL: Record<AvengeKind, string> = {
  kin: '血亲',
  spouse: '道侣',
  friend: '挚友',
  disciple: '门徒',
};

// 受害者被加害后，关系网里在乎他的人对加害者生出二次仇恨。
// severity ∈ (0,1]：事件严重度（偷窃轻、伤人重、杀人最重），线性放大仇恨幅度。
// 是否出头：该人的「外在性格会替这一类关系出头」(avengeKinds(outer) 含其与受害者的关系类别)。
export function deriveGrudges(
  perpetratorActorId: string,
  allies: AllyRelation[],
  severity: number,
): GrudgeSeed[] {
  const s = Math.max(0, Math.min(1, severity));
  const seeds: GrudgeSeed[] = [];
  for (const ally of allies) {
    if (ally.actorId === perpetratorActorId) continue; // 不会替受害者记恨自己
    if (ally.kind === 'other') continue; // 泛泛之交不出头
    if (!avengeKinds(ally.outerTrait).includes(ally.kind)) continue; // 性格不为此类出头
    const mag = Math.max(1, Math.round(s * 20));
    seeds.push({
      actorId: ally.actorId,
      delta: { affinity: -mag, suspicion: Math.round(mag / 2) },
      reason: `因${KIND_LABEL[ally.kind]}受害而记恨`,
    });
  }
  return seeds;
}

// 关系是否已坠入「仇敌」之境（喂行为层判定是否寻仇 / 化解）。
export function isEnemyView(view: { affinity: number; suspicion: number }): boolean {
  return view.affinity <= -60 || view.suspicion >= 70;
}

// 是否萌生「主动复仇」之念。仇敌之境为前提，再由性格定夺：
// 睚眦必报、狂邪/邪恶好斗者主动寻仇；仁善/无私倾向化解而非寻仇；常人积怨极深方动手。
// 注：本函数已就绪供行为层使用，但「主动寻仇」属行为连锁，暂不接入 routine（需谨慎调优后再启用）。
export function shouldSeekRevenge(
  view: { affinity: number; suspicion: number },
  innerTrait: string,
  outerTrait: string,
): boolean {
  if (!isEnemyView(view)) return false;
  if (outerTrait === '睚眦') return true;
  if (innerTrait === '狂邪' || innerTrait === '邪恶') return true;
  if (innerTrait === '仁善' || innerTrait === '无私') return false;
  return view.affinity <= -80; // 常人须积怨极深才主动寻仇
}

import { deriveGrudges, type GrudgeSeed } from './grudgeLogic';
import { grudgeDecayMult } from './personalityLogic';

// 拟人生活 v1 · 人与人之间：争执与记仇、流言、名声。全部是纯函数，由宿主在
// humanLifeV1 下调用；不读写任何存储，也不碰原有的关系、流言、社会后果合同。
//   争执：话不投机会吵起来；被冒犯的人记着、躲着，怨气按性格慢慢消；肯认错的人会去赔不是。
//   流言：事情先由当事人和在场的人知道，之后跟着谈话一个传一个；转述会走样，碰到知情人会被纠正。
//   名声：每个人对别人的印象（热心、惹事）来自亲历和传闻，并改变他找不找这个人、吵不吵得起来。

export type HumanTraits = { innerTrait?: string; outerTrait?: string };

// —— 争执与记仇 ——

// 被冒犯的人：好感降 10、心里的怨气（suspicion）到 30；冒犯的人好感也降 4，
// 心里也存了芥蒂（20）：吵过架的两个人一段时间里都不会主动凑上去。
export const QUARREL_AFFINITY_LOSS = 10;
export const QUARREL_SUSPICION = 30;
export const QUARREL_OFFENDER_AFFINITY_LOSS = 4;
export const QUARREL_OFFENDER_SUSPICION = 20;
// 怨气在 15 以上：不主动去找对方。10 以上：同处一地也不会自然变熟。
export const HUMAN_AVOID_SUSPICION = 15;
export const HUMAN_WARMING_BLOCK_SUSPICION = 10;
// 赔不是：怨气减 15，好感回 3。
export const APOLOGY_SUSPICION_RELIEF = 15;
export const APOLOGY_AFFINITY = 3;
// 每天：怨气消 1.5，丢掉的好感找回 2%（都按性格倍率；睚眦必报的人一点不消）。
export const DAILY_SUSPICION_RELIEF = 1.5;
export const DAILY_AFFINITY_RECOVERY_SHARE = 0.02;
// 吵过一架总会留个疙瘩：丢掉的好感有四成要过几个月才慢慢消（每天 0.05）。
// 疙瘩没消之前，好感最多回到吵架前减去这道疙瘩；两人就算天天碰面，也只能熟到
// "点头之交"减去这道疙瘩。赔过不是，疙瘩减半。
export const QUARREL_SCAR_SHARE = 0.4;
export const DAILY_SCAR_FADE = 0.05;
export const APOLOGY_SCAR_SHARE = 0.5;
// 听说朋友被人冒犯时，替朋友出头的严重度（grudgeLogic.deriveGrudges：0.3 → 好感 −6、怀疑 +3）。
export const QUARREL_ALLY_SEVERITY = 0.3;

// 脾气：越大越容易和人吵起来。
export function humanTemper(traits: HumanTraits) {
  let temper = 1;
  switch (traits.innerTrait) {
    case '狂邪':
    case '邪恶':
      temper *= 2;
      break;
    case '利己':
      temper *= 1.5;
      break;
    case '中庸':
      temper *= 0.7;
      break;
    case '仁善':
    case '无私':
      temper *= 0.4;
      break;
  }
  switch (traits.outerTrait) {
    case '睚眦':
      temper *= 1.5;
      break;
    case '任我':
      temper *= 1.3;
      break;
    case '孤僻':
      temper *= 1.2;
      break;
  }
  return temper;
}

// 一次聊天吵起来的几率：不投缘（缘分 ≤ 0）的人最容易；开口的人脾气算满，对方算一半；
// 心境差更容易、心境好更难；两人之间本就有怨、或觉得对方爱惹事，更容易。最高 50%。
export function humanQuarrelChance(input: {
  chemistry: number;
  speaker: HumanTraits;
  listener: HumanTraits;
  speakerMood: number;
  tension: number;
  troubleImpression: number;
}) {
  const base =
    input.chemistry <= -1 ? 0.2 : input.chemistry === 0 ? 0.06 : input.chemistry === 1 ? 0.015 : 0.005;
  const listenerTemper = 1 + (humanTemper(input.listener) - 1) / 2;
  const mood = input.speakerMood <= 3 ? 1.5 : input.speakerMood >= 7 ? 0.6 : 1;
  const tension = 1 + 2 * Math.min(1, Math.max(0, input.tension) / 100);
  const wary = 1 + 0.5 * Math.max(0, input.troubleImpression);
  return Math.min(0.5, base * humanTemper(input.speaker) * listenerTemper * mood * tension * wary);
}

// 谁先说了伤人的话：脾气大的那个；一样大，就是开口的人。
export function humanQuarrelOffender(
  speaker: HumanTraits & { actorId: string },
  listener: HumanTraits & { actorId: string },
) {
  return humanTemper(listener) > humanTemper(speaker) ? listener.actorId : speaker.actorId;
}

// 吵完会不会去赔不是：心正、宽厚、随和的人会；张狂、记仇、我行我素、凡事先计自身的人不会。
export function humanWillApologize(traits: HumanTraits) {
  if (traits.outerTrait === '睚眦' || traits.outerTrait === '任我') return false;
  return ['正直', '仁善', '无私', '中庸'].includes(traits.innerTrait ?? '');
}

// 一天里怨气消多少、丢掉的好感找回几成：倍率来自 personalityLogic.grudgeDecayMult
// （睚眦 0：经年不忘；仁善 1.5：易释前嫌；其余 1）。
export function humanDailyGrudgeRelief(traits: HumanTraits) {
  const mult = grudgeDecayMult(traits.innerTrait ?? '', traits.outerTrait ?? '');
  return {
    suspicion: DAILY_SUSPICION_RELIEF * mult,
    recoveryShare: DAILY_AFFINITY_RECOVERY_SHARE * mult,
  };
}

// 听说好友被人冒犯：会替朋友出头的人（义气护友）对冒犯者起嫌隙。
// 只有好感 ≥ 40 的才算"挚友"；用的是原有的 grudgeLogic.deriveGrudges。
export function humanAllyGrudge(input: {
  offenderId: string;
  hearer: HumanTraits & { actorId: string };
  closenessToVictim: number;
  severity?: number;
}): GrudgeSeed | undefined {
  return deriveGrudges(
    input.offenderId,
    [{
      actorId: input.hearer.actorId,
      kind: input.closenessToVictim >= 40 ? 'friend' : 'other',
      innerTrait: input.hearer.innerTrait ?? '',
      outerTrait: input.hearer.outerTrait ?? '',
    }],
    input.severity ?? QUARREL_ALLY_SEVERITY,
  )[0];
}

// —— 流言 ——

export type HumanNewsKind = 'quarrel' | 'apology' | 'gift' | 'commission' | 'injury' | 'sighting';

// 一件事的一个版本：谁（subject）对谁（object）做了什么；exaggerated 表示被说重了。
export type HumanNewsVersion = {
  kind: HumanNewsKind;
  subjectId: string;
  objectId?: string;
  exaggerated?: boolean;
};

export type HumanNewsSource = 'direct' | 'witness' | 'told';

// 值不值得说：受伤、吵架、见到奇事最值得说，送礼、认错其次，交了委托最平常。
export const HUMAN_NEWS_SALIENCE: Record<HumanNewsKind, number> = {
  injury: 0.9,
  quarrel: 0.8,
  sighting: 0.8,
  apology: 0.4,
  gift: 0.4,
  commission: 0.3,
};
// 一件事过了 30 天就没人再提，也不再影响对人的印象。
export const HUMAN_NEWS_MEMORY_HOURS = 30 * 24;
// 转述听来的事，三成会走样；亲历、亲见的人照实说。
export const HUMAN_NEWS_DISTORTION_CHANCE = 0.3;

export function sameHumanNewsVersion(left: HumanNewsVersion, right: HumanNewsVersion) {
  return (
    left.kind === right.kind &&
    left.subjectId === right.subjectId &&
    (left.objectId ?? '') === (right.objectId ?? '') &&
    Boolean(left.exaggerated) === Boolean(right.exaggerated)
  );
}

// 碰面聊天时，说不说一件对方不知道的事：好名声、多情的人爱说，孤僻、正直、忠贞的人少说；
// 对挚友更愿意说；越稀奇的事越忍不住要说（乘 0.5 + 值得说的程度）。
export function humanGossipChance(traits: HumanTraits, closeness: number, salience = 0.5) {
  let chance = 0.55;
  if (traits.outerTrait === '名声' || traits.outerTrait === '情种') chance += 0.2;
  if (traits.innerTrait === '利己' || traits.innerTrait === '狂邪') chance += 0.1;
  if (traits.outerTrait === '孤僻') chance -= 0.3;
  if (traits.innerTrait === '正直' || traits.outerTrait === '忠贞') chance -= 0.15;
  if (closeness >= 40) chance += 0.15;
  return Math.max(0.05, Math.min(0.95, chance * (0.5 + salience)));
}

// 转述时怎么走样（由一次掷点决定）：有两个当事人的事，先说反"谁对谁"；
// 否则说重了；已经说重了的，就认错了人（换成在场之外的另一个人）。
export function humanDistortNews(
  version: HumanNewsVersion,
  roll: number,
  otherActorIds: readonly string[],
): { version: HumanNewsVersion; distortion: 'swapped' | 'exaggerated' | 'wrong_person' } {
  if (version.objectId && roll < 0.45) {
    return {
      version: { ...version, subjectId: version.objectId, objectId: version.subjectId },
      distortion: 'swapped',
    };
  }
  const candidates = otherActorIds.filter(
    (actorId) => actorId !== version.subjectId && actorId !== version.objectId,
  );
  if (!version.exaggerated || candidates.length === 0) {
    return { version: { ...version, exaggerated: true }, distortion: 'exaggerated' };
  }
  const index = Math.min(candidates.length - 1, Math.floor((roll * 997) % candidates.length));
  return { version: { ...version, subjectId: candidates[index] }, distortion: 'wrong_person' };
}

// 挑起争吵的人讲这件事时，会不会说成是对方的错：心正、宽厚、无私的人照实说，其余的人
// 各说各的理。
export function humanTellsSelfServing(traits: HumanTraits) {
  return !['正直', '仁善', '无私'].includes(traits.innerTrait ?? '');
}

// 是不是一件"说某人不好"的事（会让听的人对此人起意见）。
export function isNegativeHumanNews(kind: HumanNewsKind) {
  return kind === 'quarrel';
}

// —— 名声 ——

export type HumanImpression = { warmth: number; trouble: number };

// 一条自己知道的事（按自己知道的那个版本）让人怎么看其中的 subject：
// 挑起争吵的"惹事"（说重了的版本加倍），送礼"热心"，认错、守诺"热心"半分。
// 亲历或亲见算 1，听说的算 0.6。
export function humanImpressionFromNews(
  version: HumanNewsVersion,
  source: HumanNewsSource,
  subjectId: string,
): HumanImpression {
  if (version.subjectId !== subjectId) return { warmth: 0, trouble: 0 };
  const weight = source === 'told' ? 0.6 : 1;
  switch (version.kind) {
    case 'quarrel':
      return { warmth: 0, trouble: weight * (version.exaggerated ? 2 : 1) };
    case 'gift':
      return { warmth: weight, trouble: 0 };
    case 'apology':
    case 'commission':
      return { warmth: weight * 0.5, trouble: 0 };
    case 'injury':
    case 'sighting':
      return { warmth: 0, trouble: 0 };
  }
}

export function humanImpressionOf(
  known: ReadonlyArray<{ version: HumanNewsVersion; source: HumanNewsSource }>,
  subjectId: string,
): HumanImpression {
  let warmth = 0;
  let trouble = 0;
  for (const entry of known) {
    const impression = humanImpressionFromNews(entry.version, entry.source, subjectId);
    warmth += impression.warmth;
    trouble += impression.trouble;
  }
  return { warmth: round2(warmth), trouble: round2(trouble) };
}

// 众人眼里的名声：三成以上的人觉得他爱惹事，就是"惹事的"；三成以上觉得他热心，
// 就是"热心肠"（两样都有时，坏名声传得更响）。
export function humanReputationLabel(impressions: readonly HumanImpression[]) {
  if (impressions.length === 0) return undefined;
  const share = (test: (impression: HumanImpression) => boolean) =>
    impressions.filter(test).length / impressions.length;
  if (share((impression) => impression.trouble >= 1) >= 0.3) return '惹事' as const;
  if (share((impression) => impression.warmth >= 1) >= 0.3) return '热心肠' as const;
  return undefined;
}

// 印象怎样改变找不找这个人：热心的人更想亲近（每点 +3，最多 +9），惹事的人避开
// （每点 −6，最多 −18）。亲眼见过他挑事、或听两个人说过（≥ 1），除非是挚友，就不去找他。
export const HUMAN_AVOID_TROUBLE = 1;
export function humanImpressionAdjustment(impression: HumanImpression | undefined) {
  if (!impression) return 0;
  return Math.min(9, 3 * impression.warmth) - Math.min(18, 6 * impression.trouble);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

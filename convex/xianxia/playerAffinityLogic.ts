import { APOLOGY_AFFINITY, HUMAN_NEWS_SALIENCE, QUARREL_AFFINITY_LOSS, humanGossipChance, type HumanTraits } from './humanSocietyLogic';
import { grudgeDecayMult } from './personalityLogic';
import type { DialogueVoice } from './playerDialoguePersonas';
import { seededRoll } from './rules';

// 好感度 v1：NPC 对玩家的好感度由规则算，跟着玩家说的话变（AI 不改数，只拿到一个词）。全是纯函数。
//   口气：骂人、威胁、粗话、硬编往事会降；关心、夸人、道谢会升，但每段对话、每天都有上限（照星露谷"每天聊天只算一次"）。
//   火气：骂到他能忍的分数（按性子定）就翻脸走开。
//   冷淡：好感度低于 0、或几天内骂过他：不主动开口、问好是冷的、聊得短、不送东西；低于 −20 就不理你。
//   记仇：随天数淡下去，快慢按性格（睚眦必报的人记得久，仁善的人忘得快）。
//   流言："道友骂了某某"先由被骂的人和离得近的一两个人知道（同一处的人不是个个都听得见），再跟着日志里
//   人和人真实的来往一个传一个；转了一手的人再传，劲减半；过了七天就是旧事，没人再传。
//   听说的人对道友的好感度降，亲眼看见的比听人说的降得多，和被骂的人是好友的降得更多。
//   道歉（v1.4）：得罪过他、还没赔过不是的才有用（好感最多 +3，不超过得罪他时降掉的；骂人那一回的冷淡期减半），
//   每人每天只算一次；同一回得罪只认一次（赔过了再赔，只回"说过了"）；他记得的不消失。
//   "得罪"含骂人、威胁，也含粗话、硬编往事和 AI 判的无礼。
// 依据：docs/玩家对话过关标准.md 第四节；数值沿用 humanSocietyLogic（吵一架好感降 10、赔不是好感回 3、替朋友出头再降 6）。

export const PLAYER_ACTOR_ID = 'player';

export type PlayerTone =
  | 'insult'
  | 'threat'
  | 'crude'
  | 'false_claim'
  | 'ai_rude'
  | 'kind'
  | 'care'
  | 'ai_friendly'
  | 'backchannel'
  | 'neutral';

// 每种口气：好感度加减多少、火气加多少。
export const TONE_EFFECT: Record<PlayerTone, { affinity: number; temper: number }> = {
  insult: { affinity: -QUARREL_AFFINITY_LOSS, temper: 2 },
  threat: { affinity: -6, temper: 2 },
  crude: { affinity: -2, temper: 1 },
  false_claim: { affinity: -3, temper: 1 },
  ai_rude: { affinity: -4, temper: 1 },
  kind: { affinity: 1, temper: 0 },
  care: { affinity: 2, temper: 0 },
  ai_friendly: { affinity: 1, temper: 0 },
  backchannel: { affinity: 0, temper: 0 },
  neutral: { affinity: 0, temper: 0 },
};

// 说好话加的好感：一段对话最多 3，一天最多 5。
export const KIND_CAP_PER_CONVERSATION = 3;
export const KIND_CAP_PER_DAY = 5;

// 能忍几分火气，到了就翻脸走开（骂人、威胁一句 2 分；粗话、硬编往事、AI 判的无礼 1 分）。
// 话少的、守规矩的、戒心重的，骂一句就走；直爽的、热心的、做买卖的，能忍两句。
export const VOICE_TOLERANCE: Record<DialogueVoice, number> = {
  curt: 2,
  formal: 2,
  wary: 2,
  shrewd: 3,
  gentle: 3,
  steady: 3,
  upright: 4,
  warm: 4,
  merchant: 4,
};

// 听说道友骂了人，当面问一句的几率（看不惯欺负人的、爱说闲话的、心热的更会问）。
export const VOICE_ACCUSE_CHANCE: Record<DialogueVoice, number> = {
  upright: 0.8,
  shrewd: 0.6,
  warm: 0.6,
  gentle: 0.5,
  wary: 0.5,
  steady: 0.4,
  merchant: 0.3,
  formal: 0.3,
  curt: 0.2,
};

export const HOSTILE_AT_OR_BELOW = -20;
export const FRIENDLY_AT = 15;
export const CLOSE_AT = 40;
// 骂过之后几天里是冷的（再乘性格倍率）。
export const GRUDGE_COLD_DAYS = 3;
// 好感度低于 0 时，每天往回涨多少（再乘性格倍率）。
export const DAILY_FORGIVENESS = 1;

export type DialogueAttitude = 'hostile' | 'cold' | 'neutral' | 'friendly' | 'close';

// 给 AI 的一个词（处境里"你对他"那一栏）。
export const ATTITUDE_WORD: Record<DialogueAttitude, string> = {
  hostile: '恨他，不想理他',
  cold: '有点烦他',
  neutral: '没什么看法',
  friendly: '挺喜欢他',
  close: '把他当朋友',
};

// 规则层记着的、他对这位玩家的好感度和恩怨。
export type AffinityRecord = {
  relationship: number;
  insults?: number;
  lastInsultTick?: number;
  lastMetTick?: number;
  lastDriftTick?: number;
  kindDay?: number;
  kindToday?: number;
  lastVisitBonusDay?: number;
  // 哪一天赔过不是、赔的是哪一回骂（那一回的冷淡期减半；再骂就是新的一回）。
  lastApologyDay?: number;
  apologyForInsultTick?: number;
  // 得罪他（骂人、威胁、粗话、硬编往事、AI 判的无礼）降掉的好感，还没赔过不是的部分。赔过不是就清零。
  apologyOwed?: number;
};

// 赔不是：冷淡期剩一半。
export const APOLOGY_COLD_SHARE = 0.5;

// 会让他记一笔、可以赔不是的口气。
const OFFENDING_TONES: ReadonlySet<PlayerTone> = new Set(['insult', 'threat', 'crude', 'false_claim', 'ai_rude']);

// 道友眼下欠不欠他一句赔不是：owed 欠着；today 欠着，但今天已经赔过一回了；done 以前得罪过、都赔过了；
// none 从没得罪过他。
export type ApologyStanding = 'owed' | 'today' | 'done' | 'none';
export function apologyStanding(record: AffinityRecord, day: number): ApologyStanding {
  if ((record.apologyOwed ?? 0) > 0) return record.lastApologyDay === day ? 'today' : 'owed';
  return record.lastApologyDay !== undefined || (record.insults ?? 0) > 0 ? 'done' : 'none';
}

// 道歉：得罪过他、还没赔过的才有用——好感 +3（同社会层赔不是），但不超过得罪时降掉的；这一回骂人的冷淡期减半；
// 每人每天只算一次，同一回得罪只认一次。他记得"你骂过我"不变（由宿主另记"你跟我赔过不是"）。
export function applyApology(record: AffinityRecord, day: number) {
  const standing = apologyStanding(record, day);
  if (standing === 'today') return { accepted: false as const, reason: 'again_today' as const, affinityDelta: 0 };
  if (standing !== 'owed') return { accepted: false as const, reason: standing === 'done' ? ('already' as const) : ('no_grievance' as const), affinityDelta: 0 };
  return {
    accepted: true as const,
    reason: 'accepted' as const,
    affinityDelta: Math.min(APOLOGY_AFFINITY, record.apologyOwed ?? 0),
    lastApologyDay: day,
    apologyForInsultTick: record.lastInsultTick,
    apologyOwed: 0,
  };
}

// 记仇多久：睚眦必报（倍率 0）记两倍久，仁善（1.5）短一些。
function grudgeHoldMult(traits: HumanTraits) {
  return 1 / Math.max(0.5, grudgeDecayMult(traits.innerTrait ?? '', traits.outerTrait ?? ''));
}

// 这一句话的口气算下来：好感度加减多少（好话按上限截过）、火气到了多少、要不要翻脸。
export function applyPlayerTone(input: {
  record: AffinityRecord;
  tone: PlayerTone;
  voice: DialogueVoice;
  temper: number;
  kindThisConversation: number;
  day: number;
}) {
  const effect = TONE_EFFECT[input.tone];
  let affinityDelta = effect.affinity;
  let kindThisConversation = input.kindThisConversation;
  let kindToday = input.record.kindDay === input.day ? (input.record.kindToday ?? 0) : 0;
  if (affinityDelta > 0) {
    affinityDelta = Math.max(0, Math.min(affinityDelta, KIND_CAP_PER_CONVERSATION - kindThisConversation, KIND_CAP_PER_DAY - kindToday));
    kindThisConversation += affinityDelta;
    kindToday += affinityDelta;
  }
  const temper = input.temper + effect.temper;
  return {
    affinityDelta,
    temper,
    stormOff: effect.temper > 0 && temper >= VOICE_TOLERANCE[input.voice],
    kindThisConversation,
    kindToday,
    offended: input.tone === 'insult' || input.tone === 'threat',
    // 得罪了他：降掉的好感记进"欠着的赔不是"。
    apologyOwed: (input.record.apologyOwed ?? 0) + (OFFENDING_TONES.has(input.tone) ? Math.max(0, -affinityDelta) : 0),
  };
}

// 他眼下对道友是什么态度。
export function attitudeOf(record: AffinityRecord, nowTick: number, traits: HumanTraits, hoursPerTick = 0.25): DialogueAttitude {
  if (record.relationship <= HOSTILE_AT_OR_BELOW) return 'hostile';
  const apologized = record.apologyForInsultTick !== undefined && record.apologyForInsultTick === record.lastInsultTick;
  const coldHours = GRUDGE_COLD_DAYS * 24 * grudgeHoldMult(traits) * (apologized ? APOLOGY_COLD_SHARE : 1);
  const recentInsult = record.lastInsultTick !== undefined && (nowTick - record.lastInsultTick) * hoursPerTick < coldHours;
  if (record.relationship < 0 || recentInsult) return 'cold';
  if (record.relationship >= CLOSE_AT) return 'close';
  if (record.relationship >= FRIENDLY_AT) return 'friendly';
  return 'neutral';
}

// 记仇随天数淡：好感度低于 0 时，从上回算起每过一天往回涨一点（不涨过 0）。
export function forgiveDrift(record: AffinityRecord, nowTick: number, traits: HumanTraits, hoursPerTick = 0.25) {
  const since = record.lastDriftTick ?? record.lastMetTick;
  if (record.relationship >= 0 || since === undefined || nowTick <= since) return { relationship: record.relationship, lastDriftTick: nowTick };
  const days = ((nowTick - since) * hoursPerTick) / 24;
  const mult = grudgeDecayMult(traits.innerTrait ?? '', traits.outerTrait ?? '');
  return { relationship: Math.min(0, record.relationship + days * DAILY_FORGIVENESS * mult), lastDriftTick: nowTick };
}

// "见过一回"的好感：每天只算一次；这一回骂过人、或他翻脸走了，不算。
export function visitBonus(input: { record: AffinityRecord; day: number; closedBy: string; offended: boolean }) {
  if (input.offended || input.closedBy === 'npc_angry' || input.record.lastVisitBonusDay === input.day) return 0;
  return ['npc_rule', 'player_walked_off'].includes(input.closedBy) ? 1 : 2;
}

// 知道道友骂了人：亲眼看见的好感度降 3，听人说的降 2；和被骂的人是好友（好感 ≥ 40）的，降三倍（替朋友出头）。
export function hearerPenalty(closenessToVictim: number, source: 'direct' | 'witness' | 'told' = 'witness') {
  const base = source === 'told' ? -2 : -3;
  return closenessToVictim >= CLOSE_AT ? base * 3 : base;
}

// —— 谁当场听见 ——

// 同一处的人不是个个都听得见：最多两个离得近的。在院里闲着、歇口气的容易听见，当值、守铺子的会留意，
// 屋里打坐修炼的、手上正忙的不太会。
export const MAX_WITNESSES = 2;
export function witnessChance(activity: string) {
  if (/修炼间歇|歇口气|歇着|歇脚/u.test(activity)) return 0.35;
  if (/当值|守铺子/u.test(activity)) return 0.3;
  if (/修炼|打坐/u.test(activity)) return 0.1;
  return 0.2;
}

// 从同一处的人里挑出当场听见的（每人按 witnessChance 掷一次，最多 MAX_WITNESSES 个，掷得越低越先算）。
export function pickWitnesses(input: {
  candidates: ReadonlyArray<{ actorId: string; activity: string }>;
  seedKey: string;
}) {
  return input.candidates
    .map((candidate) => ({ actorId: candidate.actorId, roll: seededRoll(`${input.seedKey}:${candidate.actorId}`), chance: witnessChance(candidate.activity) }))
    .filter((entry) => entry.roll < entry.chance)
    .sort((left, right) => left.roll - right.roll || left.actorId.localeCompare(right.actorId))
    .slice(0, MAX_WITNESSES)
    .map((entry) => entry.actorId);
}

// —— 流言 ——

export type PlayerRumor = {
  newsId: string;
  victimId: string;
  tick: number;
  tone: 'insult' | 'threat';
  // 谁知道、什么时候知道的、怎么知道的。
  knowers: Record<string, { tick: number; source: 'direct' | 'witness' | 'told' }>;
};

export type DialogueInteraction = { tick: number; a: string; b: string };

// 转了一手的人再往外传，劲减半；过了这么多天，就是旧事，没人再传。
export const SECONDHAND_GOSSIP_SHARE = 0.5;
export const RUMOR_FRESH_DAYS = 7;

// 流言跟着人和人的来往传：知情的人跟不知情的人说过话、送过东西，就按他爱不爱传闲话、两人多熟、
// 这件事多值得说（吵架 0.8）的几率告诉对方；听人说来的再传，几率减半。只往后传，七天后不再传。
export function spreadPlayerRumor(input: {
  rumor: PlayerRumor;
  interactions: ReadonlyArray<DialogueInteraction>;
  traitsOf: (actorId: string) => HumanTraits;
  closeness: (fromId: string, toId: string, tick: number) => number;
  seedKey: string;
  hoursPerTick?: number;
}) {
  const knowers = { ...input.rumor.knowers };
  const salience = HUMAN_NEWS_SALIENCE.quarrel;
  const freshUntil = input.rumor.tick + (RUMOR_FRESH_DAYS * 24) / (input.hoursPerTick ?? 0.25);
  const ordered = [...input.interactions].sort((left, right) => left.tick - right.tick);
  for (const { tick, a, b } of ordered) {
    if (tick <= input.rumor.tick || tick > freshUntil) continue;
    for (const [teller, hearer] of [
      [a, b],
      [b, a],
    ]) {
      const known = knowers[teller];
      if (!known || known.tick > tick || knowers[hearer] || hearer === PLAYER_ACTOR_ID) continue;
      const secondhand = known.source === 'told' ? SECONDHAND_GOSSIP_SHARE : 1;
      const chance = humanGossipChance(input.traitsOf(teller), input.closeness(teller, hearer, tick), salience) * secondhand;
      if (seededRoll(`${input.seedKey}:${input.rumor.newsId}:${teller}:${hearer}:${tick}`) < chance) {
        knowers[hearer] = { tick, source: 'told' };
      }
    }
  }
  return knowers;
}

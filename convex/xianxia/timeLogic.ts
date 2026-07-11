// 世界时钟的「纯逻辑层」（World Foundation · W3a）。不依赖 Convex，可被 Jest 直接单测。
//
// 游戏时间由「真实流逝」推导：存一个锚点 clockStartedAt（真实 ms = 第 1 日 0 时），
// 之后任意时刻的游戏时间都从 (now − startedAt) 算出。不需要每 tick 写库，时间自然流动。
// W3a 只立时钟 + 最小规则修正草案；记忆/委托过期迁移到游戏日留待 W3b。
// 依据：用户 W3a 范围（day/hour/phase + dawn/night 修正）。

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type GameTime = { day: number; hour: number; phase: Phase; totalHours: number };

// 30 秒真实 = 1 游戏时辰 → 1 游戏日 = 12 分钟（dev 可观察，单一常量、易调）。
export const MS_PER_GAME_HOUR = 30_000;
const HOURS_PER_DAY = 24;

// 真实时刻 → 游戏时间。day 从第 1 日起；startedAt 之前按第 1 日 0 时处理。
export function gameTimeAt(nowMs: number, startedAtMs: number): GameTime {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const totalHours = Math.floor(elapsed / MS_PER_GAME_HOUR);
  const day = Math.floor(totalHours / HOURS_PER_DAY) + 1;
  const hour = totalHours % HOURS_PER_DAY;
  return { day, hour, phase: phaseOf(hour), totalHours };
}

// 时辰 → 昼夜阶段。晨 5–8、昼 8–17、暮 17–20、夜 20–次日 5。
export function phaseOf(hour: number): Phase {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

const PHASE_LABEL: Record<Phase, string> = {
  dawn: '清晨',
  day: '白天',
  dusk: '黄昏',
  night: '夜晚',
};
export function phaseLabel(phase: Phase): string {
  return PHASE_LABEL[phase];
}

// 昼夜对动作的最小修正（草案）。中性阶段全为 0/1，互不影响。
export type PhaseMods = {
  cultivationXpBonus: number; // 加到修炼收益
  stealStealthBonus: number; // 加到偷窃成功率 [0..1]
  stealPenaltyMult: number; // 偷窃被抓时负面后果的倍数
  exploreRiskBonus: number; // 加到探索风险 [0..1]
};

export const NEUTRAL_PHASE_MODS: PhaseMods = {
  cultivationXpBonus: 0,
  stealStealthBonus: 0,
  stealPenaltyMult: 1,
  exploreRiskBonus: 0,
};
const NEUTRAL = NEUTRAL_PHASE_MODS;

export function phaseModifiers(phase: Phase): PhaseMods {
  switch (phase) {
    case 'dawn':
      // 清晨灵气清明，修炼小幅加成。
      return { ...NEUTRAL, cultivationXpBonus: 2 };
    case 'night':
      // 夜色掩护：偷窃更易得手，但一旦被抓后果更重；夜探秘境更凶险。
      return { ...NEUTRAL, stealStealthBonus: 0.15, stealPenaltyMult: 1.5, exploreRiskBonus: 0.1 };
    default:
      return { ...NEUTRAL };
  }
}

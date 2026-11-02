export const MAX_FATIGUE = 100;
export const HEAVY_ACTION_FATIGUE_THRESHOLD = 80;
export const AGENT_REST_FATIGUE_THRESHOLD = 60;
export const REST_FATIGUE_RECOVERY = 40;

const FATIGUE_COSTS: Record<string, number> = {
  gather: 25,
  cultivate: 10,
};

const HEAVY_ACTIONS = new Set([
  'gather',
  'cultivate',
  'explore',
  'spar',
  'steal',
  'breakthrough',
]);

export function normalizeFatigue(value: number | undefined) {
  return Math.max(0, Math.min(MAX_FATIGUE, Math.floor(value ?? 0)));
}

export function fatigueDeltaForCompletedAction(actionType: string) {
  return actionType === 'rest' ? -REST_FATIGUE_RECOVERY : (FATIGUE_COSTS[actionType] ?? 0);
}

export function fatigueAfterCompletedAction(current: number | undefined, actionType: string) {
  return normalizeFatigue(normalizeFatigue(current) + fatigueDeltaForCompletedAction(actionType));
}

export function isFatigueHeavyAction(actionType: string) {
  return HEAVY_ACTIONS.has(actionType);
}

export function evaluateFatigueActionGate(fatigue: number | undefined, actionType: string) {
  const current = normalizeFatigue(fatigue);
  if (actionType === 'rest' && current === 0) {
    return {
      ok: false as const,
      resultCode: 'fatigue_already_rested',
      reason: '当前精力充足，无需继续休息。',
    };
  }
  if (isFatigueHeavyAction(actionType) && current >= HEAVY_ACTION_FATIGUE_THRESHOLD) {
    return {
      ok: false as const,
      resultCode: 'fatigue_too_high',
      reason: '疲劳已达高负荷行动门槛，需先前往休息地点稍作恢复。',
    };
  }
  return { ok: true as const, fatigue: current };
}

export function fatigueBand(fatigue: number | undefined) {
  const value = normalizeFatigue(fatigue);
  if (value >= 80) return 'exhausted' as const;
  if (value >= 60) return 'tired' as const;
  if (value >= 30) return 'weary' as const;
  return 'rested' as const;
}

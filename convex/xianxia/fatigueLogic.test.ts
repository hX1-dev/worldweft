import {
  AGENT_REST_FATIGUE_THRESHOLD,
  HEAVY_ACTION_FATIGUE_THRESHOLD,
  evaluateFatigueActionGate,
  fatigueAfterCompletedAction,
  fatigueBand,
  fatigueDeltaForCompletedAction,
  normalizeFatigue,
} from './fatigueLogic';

describe('fatigue rules', () => {
  test('normalizes legacy and out-of-range values to 0-100', () => {
    expect(normalizeFatigue(undefined)).toBe(0);
    expect(normalizeFatigue(-3)).toBe(0);
    expect(normalizeFatigue(104)).toBe(100);
  });

  test('only completed sustained actions have bounded fatigue deltas', () => {
    expect(fatigueDeltaForCompletedAction('gather')).toBe(25);
    expect(fatigueDeltaForCompletedAction('cultivate')).toBe(10);
    expect(fatigueAfterCompletedAction(90, 'gather')).toBe(100);
    expect(fatigueAfterCompletedAction(20, 'rest')).toBe(0);
    expect(fatigueDeltaForCompletedAction('talk')).toBe(0);
  });

  test('blocks heavy actions at 80 while leaving travel and social escape paths open', () => {
    expect(HEAVY_ACTION_FATIGUE_THRESHOLD).toBe(80);
    for (const actionType of ['gather', 'cultivate', 'explore', 'spar', 'steal', 'breakthrough']) {
      expect(evaluateFatigueActionGate(80, actionType)).toMatchObject({
        ok: false,
        resultCode: 'fatigue_too_high',
      });
    }
    for (const actionType of ['travel', 'arrive', 'talk', 'trade', 'gift', 'use_item', 'rest']) {
      expect(evaluateFatigueActionGate(80, actionType)).toMatchObject({ ok: true });
    }
  });

  test('rejects pointless rest and exposes deterministic bands', () => {
    expect(AGENT_REST_FATIGUE_THRESHOLD).toBe(60);
    expect(evaluateFatigueActionGate(0, 'rest')).toMatchObject({
      ok: false,
      resultCode: 'fatigue_already_rested',
    });
    expect(fatigueBand(0)).toBe('rested');
    expect(fatigueBand(30)).toBe('weary');
    expect(fatigueBand(60)).toBe('tired');
    expect(fatigueBand(80)).toBe('exhausted');
  });
});

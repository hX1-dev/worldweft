import { planGroupScene, type SceneActor } from './groupSceneLogic';
import { isGroupSceneActorEligible } from './groupScene';

// World Foundation · W4b-F 群体场景纯逻辑单测。

const elder: SceneActor = { actorId: 'mo', name: '墨长老', role: 'elder' };
const merchant: SceneActor = { actorId: 'liu', name: '柳巧儿', role: 'merchant' };
const d1: SceneActor = { actorId: 'han', name: '韩立', role: 'outer_disciple' };
const d2: SceneActor = { actorId: 'li', name: '厉飞羽', role: 'sword_disciple' };
const d3: SceneActor = { actorId: 'nan', name: '南宫婉', role: 'inner_disciple' };

describe('群体场景生命状态门禁', () => {
  test('受伤仍可参与，气血归零者不可加入新场景', () => {
    expect(isGroupSceneActorEligible({ health: 4 })).toBe(true);
    expect(isGroupSceneActorEligible({ health: 0 })).toBe(false);
  });
});

describe('planGroupScene', () => {
  test('少于 3 人 → 不成场景', () => {
    expect(planGroupScene('mountain_gate', 'dawn', [elder, d1])).toBeNull();
  });

  test('清晨山门 长老+≥2弟子 → 晨课', () => {
    const s = planGroupScene('mountain_gate', 'dawn', [elder, d1, d2]);
    expect(s).toMatchObject({ purpose: 'morning_teaching' });
    expect(s!.targetActorIds).toContain('mo');
    expect(s!.lines.length).toBeGreaterThan(0);
    expect(s!.lines.length).toBeLessThanOrEqual(3);
  });

  test('白天坊市 商贩+≥2弟子 → 议价', () => {
    expect(planGroupScene('market', 'day', [merchant, d1, d3])?.purpose).toBe('market_haggle');
  });

  test('秘境入口 ≥3 修士 → 组队', () => {
    expect(planGroupScene('secret_realm_gate', 'day', [d1, d2, d3])?.purpose).toBe('realm_party');
  });

  test('阶段/地点不符 → 不成场景', () => {
    // 晨课需清晨，白天不成
    expect(planGroupScene('mountain_gate', 'day', [elder, d1, d2])).toBeNull();
    // 山门白天但无商贩，不是议价场景
    expect(planGroupScene('mountain_gate', 'night', [d1, d2, d3])).toBeNull();
  });
});

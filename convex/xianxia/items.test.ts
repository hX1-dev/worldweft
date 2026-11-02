import {
  ITEM_CATALOG,
  healingAmount,
  itemDef,
  itemName,
  itemBaseValue,
  isSensitive,
} from './items';

// 物品目录单测：覆盖通货/丹药/武器/小法器 + 未知物回退。
// 依据：xianxia-world-concept-pack/docs/taixu-world-setting.md §8、stage-2 §9。

describe('ITEM_CATALOG', () => {
  test('灵石是通货，自身价值为 1', () => {
    expect(ITEM_CATALOG.spirit_stone.kind).toBe('currency');
    expect(itemBaseValue('spirit_stone')).toBe(1);
  });

  test('沿用现有 itemId，挂上中文名', () => {
    expect(itemName('healing_pill')).toBe('疗伤丹');
    expect(itemName('spirit_herb')).toBe('灵草');
    expect(itemName('talisman')).toBe('符箓');
  });

  test('只有目录中的治疗类丹药提供可信恢复量', () => {
    expect(healingAmount('healing_pill')).toBe(3);
    expect(healingAmount('qi_pill')).toBeNull();
    expect(healingAmount('calm_pill')).toBeNull();
    expect(healingAmount('mystery_pill')).toBeNull();
  });

  test('武器带 combatBonus / exploreSafetyBonus', () => {
    const sword = itemDef('azure_sword');
    expect(sword?.kind).toBe('weapon');
    expect(sword?.combatBonus).toBeGreaterThan(0);
    expect(sword?.exploreSafetyBonus).toBeGreaterThanOrEqual(0);
  });

  test('小法器只有单一 effect + value', () => {
    const charm = itemDef('light_charm');
    expect(charm?.kind).toBe('minor_artifact');
    expect(charm?.effect).toBe('move_speed_bonus');
    expect(typeof charm?.value).toBe('number');
  });

  test('护身符是敏感物品（Stage 2 限购）', () => {
    expect(isSensitive('protective_charm')).toBe(true);
    expect(isSensitive('healing_pill')).toBe(false);
  });

  test('未知物不抛错：名回退到 id，价值回退 0', () => {
    expect(itemName('mystery_thing')).toBe('mystery_thing');
    expect(itemBaseValue('mystery_thing')).toBe(0);
    expect(isSensitive('mystery_thing')).toBe(false);
  });
});

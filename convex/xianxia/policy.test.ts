import { roleAllows, allowedActionsForRole } from './policy';

// Stage 2 · M1 §2.3：NPC 行为白名单。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §2.3。

describe('角色行为白名单', () => {
  test('掌柜只做交易类，不会探索/偷取/切磋', () => {
    expect(roleAllows('merchant', 'trade')).toBe(true);
    expect(roleAllows('merchant', 'talk')).toBe(true);
    expect(roleAllows('merchant', 'explore')).toBe(false);
    expect(roleAllows('merchant', 'steal')).toBe(false);
    expect(roleAllows('merchant', 'spar')).toBe(false);
  });

  test('守卫不会交易/探索，长老不会偷取', () => {
    expect(roleAllows('guard', 'trade')).toBe(false);
    expect(roleAllows('guard', 'explore')).toBe(false);
    expect(roleAllows('elder', 'steal')).toBe(false);
    expect(roleAllows('guard', 'use_item')).toBe(true);
    expect(roleAllows('merchant', 'use_item')).toBe(true);
  });

  test('弟子拥有全套动作', () => {
    for (const a of [
      'cultivate',
      'gather',
      'trade',
      'explore',
      'steal',
      'spar',
      'request_teaching',
    ]) {
      expect(roleAllows('outer_disciple', a)).toBe(true);
    }
  });

  test('未知 role 保守回退到弟子全套（不卡死世界）', () => {
    expect(allowedActionsForRole('mystery_role')).toEqual(allowedActionsForRole('outer_disciple'));
    expect(roleAllows('mystery_role', 'explore')).toBe(true);
  });
});

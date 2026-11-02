import { SECT_IDENTITY, sectBackdrop } from './world';

// 世界身份对齐概念包（青岚宗 / 青岚山外门 / 6 条外门规矩）。
// 依据：xianxia-world-concept-pack/docs/taixu-world-setting.md §1、taixu-world-rules.md §5。

describe('SECT_IDENTITY', () => {
  test('世界/区域/宗门名与概念包一致', () => {
    expect(SECT_IDENTITY.world).toBe('太虚界');
    expect(SECT_IDENTITY.region).toBe('青岚山外门');
    expect(SECT_IDENTITY.sect).toBe('青岚宗');
  });

  test('恰好 6 条外门规矩', () => {
    expect(SECT_IDENTITY.rules).toHaveLength(6);
  });
});

describe('sectBackdrop', () => {
  test('白描含宗门名与规矩，可直接喂 prompt', () => {
    const text = sectBackdrop();
    expect(text).toContain('青岚宗');
    expect(text).toContain('青岚山外门');
    expect(text).toContain('丹房'); // 规矩里点名了丹房重地
  });
});

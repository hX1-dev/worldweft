import {
  buildGmMessages,
  clampGmVerdict,
  parseGmVerdict,
  shouldInvokeWeakGmProvider,
  type GmContext,
} from './gmLogic';

const ctx: GmContext = {
  actorName: '韩立',
  targetName: '柳巧儿',
  itemId: 'talisman',
  locationName: '坊市',
  dangerLevel: 1,
  actorSpirit: 7,
  targetSpirit: 6,
  relationship: 0,
  witnessNames: ['南宫婉'],
};

describe('buildGmMessages', () => {
  it('强调裁决辅助器身份 + 要求 JSON + 含情境事实', () => {
    const { system, user } = buildGmMessages(ctx);
    expect(system).toContain('不是故事作者');
    expect(system).toContain('JSON');
    expect(user).toContain('韩立');
    expect(user).toContain('talisman');
    expect(user).toContain('南宫婉');
  });
});

describe('clampGmVerdict', () => {
  it('合法裁决直接通过', () => {
    const v = clampGmVerdict({ outcome: 'failed_detected', reasonText: '守卫眼尖', reputationDelta: -5, relationshipDelta: -20 });
    expect(v).toEqual({ outcome: 'failed_detected', reasonText: '守卫眼尖', reputationDelta: -5, relationshipDelta: -20 });
  });

  it('限幅：超界数值被钳到范围内', () => {
    const v = clampGmVerdict({ outcome: 'success_suspected', reputationDelta: -999, relationshipDelta: -999 });
    expect(v?.reputationDelta).toBe(-10);
    expect(v?.relationshipDelta).toBe(-30);
  });

  it('正向 delta（偷窃不该加分）也被钳到 0 上限', () => {
    const v = clampGmVerdict({ outcome: 'success_undetected', reputationDelta: 50, relationshipDelta: 50 });
    expect(v?.reputationDelta).toBe(0);
    expect(v?.relationshipDelta).toBe(0);
  });

  it('非法 outcome → null（退回确定性）', () => {
    expect(clampGmVerdict({ outcome: 'teleport' })).toBeNull();
    expect(clampGmVerdict({})).toBeNull();
    expect(clampGmVerdict(null)).toBeNull();
  });

  it('缺/坏 delta 视为 0；缺 reasonText 有兜底', () => {
    const v = clampGmVerdict({ outcome: 'failed_undetected', reputationDelta: 'x' });
    expect(v?.reputationDelta).toBe(0);
    expect(v?.relationshipDelta).toBe(0);
    expect(v?.reasonText).toBeTruthy();
  });
});

describe('parseGmVerdict', () => {
  it('带 ```json 围栏可解析', () => {
    const v = parseGmVerdict('```json\n{"outcome":"success_undetected","reasonText":"夜深人静"}\n```');
    expect(v?.outcome).toBe('success_undetected');
  });
  it('非 JSON / 空 → null', () => {
    expect(parseGmVerdict('守卫发现了他')).toBeNull();
    expect(parseGmVerdict('')).toBeNull();
  });
});

describe('Pi NPC provider=0 weak-GM boundary', () => {
  const steal = {
    actionType: 'steal',
    targetActorId: 'target',
    locationId: 'market',
    itemId: 'spirit_herb',
  };

  it('forbids the model while preserving deterministic steal adjudication', () => {
    expect(
      shouldInvokeWeakGmProvider({
        ...steal,
        providerPolicy: 'disabled',
      }),
    ).toBe(false);
    expect(shouldInvokeWeakGmProvider(steal)).toBe(true);
  });
});

import {
  BREAKTHROUGH_MATERIAL_ITEM_ID,
  breakthroughMaterialQuantity,
  breakthroughMinimumDwellMs,
  evaluateBreakthroughProgress,
} from './breakthroughProgressLogic';

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 2_000_000_000_000;

describe('breakthroughProgressLogic', () => {
  test('uses the frozen realm dwell curve and escalating stone cost', () => {
    expect([
      breakthroughMinimumDwellMs('qi_refining'),
      breakthroughMinimumDwellMs('foundation_building'),
      breakthroughMinimumDwellMs('golden_core'),
      breakthroughMinimumDwellMs('nascent_soul'),
    ]).toEqual([12 * DAY, 20 * DAY, 36 * DAY, 68 * DAY]);
    expect([
      breakthroughMaterialQuantity('qi_refining'),
      breakthroughMaterialQuantity('foundation_building'),
      breakthroughMaterialQuantity('golden_core'),
      breakthroughMaterialQuantity('nascent_soul'),
    ]).toEqual([4, 8, 16, 32]);
  });

  test('rejects one millisecond before the time wall and accepts at the boundary', () => {
    const common = {
      realm: 'qi_refining',
      profileCreatedAt: NOW - 20 * DAY,
      inventory: [{ itemId: BREAKTHROUGH_MATERIAL_ITEM_ID, qty: 4 }],
      now: NOW,
    };
    expect(
      evaluateBreakthroughProgress({ ...common, realmEnteredAt: NOW - 12 * DAY + 1 }),
    ).toMatchObject({ ok: false, resultCode: 'breakthrough_time_unmet' });
    expect(
      evaluateBreakthroughProgress({ ...common, realmEnteredAt: NOW - 12 * DAY }),
    ).toMatchObject({ ok: true, elapsedMs: 12 * DAY, materialQuantity: 4 });
  });

  test('falls back to document creation time for legacy profiles', () => {
    expect(
      evaluateBreakthroughProgress({
        realm: 'qi_refining',
        profileCreatedAt: NOW - 12 * DAY,
        inventory: [{ itemId: 'spirit_stone', qty: 4 }],
        now: NOW,
      }),
    ).toMatchObject({ ok: true, realmEnteredAt: NOW - 12 * DAY });
  });

  test('recovery and active reservations both close the gate', () => {
    const common = {
      realm: 'qi_refining',
      realmEnteredAt: NOW - 20 * DAY,
      profileCreatedAt: NOW - 20 * DAY,
      inventory: [{ itemId: 'spirit_stone', qty: 7 }],
      now: NOW,
    };
    expect(
      evaluateBreakthroughProgress({ ...common, breakthroughRecoveryUntil: NOW + 1 }),
    ).toMatchObject({ ok: false, resultCode: 'breakthrough_recovery_active' });
    expect(
      evaluateBreakthroughProgress({ ...common, materialReserved: 4 }),
    ).toMatchObject({
      ok: false,
      resultCode: 'breakthrough_material_unavailable',
      materialAvailable: 3,
    });
  });
});

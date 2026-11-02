import {
  AUTONOMY_HEALING_ITEM_RESERVE,
  AUTONOMY_SPIRIT_STONE_RESERVE,
  evaluateAutonomousReserveGate,
  evaluateSurvivalEnvelope,
  type SurvivalEnvelopeInput,
} from './survivalEnvelopeLogic';

function input(
  overrides: Partial<SurvivalEnvelopeInput> = {},
): SurvivalEnvelopeInput {
  return {
    health: 10,
    maxHealth: 10,
    fatigue: 0,
    currentLocationId: 'square',
    inventory: [],
    availableActions: ['attack', 'flee', 'use_item', 'rest', 'trade'],
    knownLocations: [
      { locationId: 'square', name: '广场', allowedActions: ['talk'] },
      { locationId: 'rest_hut', name: '歇脚棚', allowedActions: ['rest'] },
      { locationId: 'market', name: '坊市', allowedActions: ['trade'] },
    ],
    ...overrides,
  };
}

describe('C017b survival and recovery envelope', () => {
  test('high-risk combat flees while a healthy advantaged actor can defend', () => {
    const encounter = {
      activeEncounterId: 'encounter_1',
      opponentActorId: 'enemy',
      opponentName: '强敌',
      opponentHealth: 8,
    };
    expect(
      evaluateSurvivalEnvelope(input({ health: 5, combat: encounter })).decision,
    ).toMatchObject({ kind: 'flee' });
    expect(
      evaluateSurvivalEnvelope(
        input({ health: 8, combat: { ...encounter, opponentHealth: 3 } }),
      ).decision,
    ).toMatchObject({ kind: 'attack', opponentActorId: 'enemy' });
  });

  test('exhaustion makes an otherwise healthy combatant flee', () => {
    const combat = {
      activeEncounterId: 'encounter_1',
      opponentActorId: 'enemy',
      opponentHealth: 3,
    };
    expect(
      evaluateSurvivalEnvelope(input({ fatigue: 80, combat })).decision.kind,
    ).toBe('flee');
    expect(
      evaluateSurvivalEnvelope(input({ fatigue: 59, combat })).decision.kind,
    ).toBe('attack');
  });

  test('when escape is unavailable, serious injury heals before defensive attack', () => {
    const combat = {
      activeEncounterId: 'encounter_1',
      opponentActorId: 'enemy',
      opponentHealth: 8,
    };
    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 4,
          combat,
          inventory: [{ itemId: 'healing_pill', qty: 1 }],
          availableActions: ['use_item', 'attack'],
        }),
      ).decision,
    ).toEqual({ kind: 'use_item', itemId: 'healing_pill' });
    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 4,
          combat,
          inventory: [],
          availableActions: ['attack'],
        }),
      ).decision.kind,
    ).toBe('attack');
  });

  test('serious injury uses owned medicine, buys locally, then seeks a known market', () => {
    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 5,
          inventory: [{ itemId: 'healing_pill', qty: 1 }],
        }),
      ).decision.kind,
    ).toBe('use_item');

    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 5,
          inventory: [{ itemId: 'spirit_stone', qty: 6 }],
          shopOffers: [
            {
              shopId: 'medicine_shop',
              shopName: '药铺',
              targetActorId: 'merchant',
              direction: 'buy',
              itemId: 'healing_pill',
              qty: 1,
              totalPrice: 6,
            },
          ],
        }),
      ).decision,
    ).toMatchObject({
      kind: 'buy_healing',
      itemId: 'healing_pill',
      totalPrice: 6,
    });

    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 5,
          inventory: [{ itemId: 'spirit_stone', qty: 1 }],
          shopOffers: [],
        }),
      ).decision,
    ).toMatchObject({ kind: 'travel_healing', locationId: 'market' });
  });

  test('fatigue threshold preempts only at 60 and a stable body explicitly passes', () => {
    expect(
      evaluateSurvivalEnvelope(input({ fatigue: 60 })).decision,
    ).toMatchObject({ kind: 'travel_rest', locationId: 'rest_hut' });
    expect(evaluateSurvivalEnvelope(input({ fatigue: 59 }))).toMatchObject({
      state: 'stable',
      urgency: 0,
      decision: { kind: 'pass' },
    });
  });

  test('missing recovery routes wait with stable reason codes', () => {
    expect(
      evaluateSurvivalEnvelope(
        input({
          health: 5,
          inventory: [],
          knownLocations: [],
          shopOffers: [],
        }),
      ).decision,
    ).toEqual({ kind: 'wait', reasonCode: 'survival_healing_unavailable' });
    expect(
      evaluateSurvivalEnvelope(input({ fatigue: 80, knownLocations: [] }))
        .decision,
    ).toEqual({ kind: 'wait', reasonCode: 'survival_rest_unavailable' });
  });

  test('protects autonomous medicine and stone reserves but permits emergency healing', () => {
    expect(AUTONOMY_HEALING_ITEM_RESERVE).toBe(1);
    expect(AUTONOMY_SPIRIT_STONE_RESERVE).toBe(10);
    const healthy = input({
      inventory: [
        { itemId: 'healing_pill', qty: 1 },
        { itemId: 'spirit_stone', qty: 10 },
      ],
    });
    expect(
      evaluateAutonomousReserveGate(healthy, {
        type: 'gift',
        params: { itemId: 'healing_pill' },
      }),
    ).toEqual({
      ok: false,
      reasonCode: 'survival_healing_reserve_protected',
    });
    expect(
      evaluateAutonomousReserveGate(healthy, {
        type: 'cultivate',
        params: { cultivationMode: 'spirit_stone' },
      }),
    ).toEqual({
      ok: false,
      reasonCode: 'survival_spirit_stone_reserve_protected',
    });
    expect(
      evaluateAutonomousReserveGate(
        { ...healthy, health: 5 },
        { type: 'use_item', params: { itemId: 'healing_pill' } },
      ),
    ).toEqual({ ok: true });
    expect(
      evaluateAutonomousReserveGate(
        {
          ...healthy,
          health: 5,
          inventory: [{ itemId: 'spirit_stone', qty: 6 }],
        },
        {
          type: 'trade',
          params: {
            offeredItemId: 'spirit_stone',
            offeredQty: 6,
            requestedItemId: 'healing_pill',
            requestedQty: 1,
          },
        },
      ),
    ).toEqual({ ok: true });
  });
});

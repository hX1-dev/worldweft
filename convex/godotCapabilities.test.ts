import type { Doc } from './_generated/dataModel';
import { buildGodotCapabilityActions, defaultGodotRelationshipDims } from './godotCapabilities';
import { breakthroughThreshold } from './xianxia/rules';

function capability(actions: ReturnType<typeof buildGodotCapabilityActions>, type: string) {
  const result = actions.find((action) => action.type === type);
  if (!result) throw new Error(`Missing capability ${type}`);
  return result;
}

function profile(overrides: Partial<Doc<'xianxiaProfiles'>> = {}) {
  return {
    realm: 'qi_refining',
    realmStage: 1,
    cultivationXp: 20,
    health: 10,
    maxHealth: 10,
    reputation: 0,
    inventory: [{ itemId: 'spirit_stone', qty: 24 }],
    mapId: 'qinglan',
    currentLocationId: 'market_tea_stall',
    ...overrides,
  } as Doc<'xianxiaProfiles'>;
}

const location = {
  locationId: 'market_tea_stall',
  mapId: 'qinglan',
  name: 'Tea Stall',
  allowedActions: [
    'talk',
    'trade',
    'gift',
    'request_teaching',
    'spar',
    'arrive',
    'explore',
    'cultivate',
    'breakthrough',
  ],
  bounds: { x1: 10, y1: 10, x2: 20, y2: 20 },
  entryPoints: [{ x: 10, y: 15 }],
  spiritualEnergy: 5,
} as Doc<'locations'>;

const resident = {
  actorId: 'qinglan:elder',
  role: 'elder',
  currentLocationId: location.locationId,
  displayTile: { x: 12, y: 12 },
} as Doc<'qinglanResidents'>;

describe('Godot capability policy', () => {
  test('exposes hostile attack, active flee, and traceable one-item loot without bypassing rules', () => {
    const combatLocation = {
      ...location,
      allowedActions: [...location.allowedActions, 'attack'],
    } as Doc<'locations'>;
    const attackActions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: combatLocation,
      actorProfile: profile(),
      targetProfile: profile({ actorId: resident.actorId }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      combat: { activeEncounterId: 'combat-1', opponentActorId: resident.actorId, lootOptions: [] },
    });
    expect(capability(attackActions, 'attack')).toMatchObject({ enabled: true, durationMs: 4000 });
    expect(capability(attackActions, 'flee')).toMatchObject({
      enabled: true,
      durationMs: 3000,
      encounterId: 'combat-1',
    });
    expect(capability(attackActions, 'loot')).toMatchObject({ enabled: false });

    const lootActions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: combatLocation,
      actorProfile: profile(),
      targetProfile: profile({ actorId: resident.actorId, health: 0, inventory: [{ itemId: 'spirit_herb', qty: 1 }] }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      combat: {
        lootEncounterId: 'combat-1',
        lootPriorityAllowed: true,
        lootOptions: [{ itemId: 'spirit_herb', qty: 1 }],
      },
    });
    expect(capability(lootActions, 'attack')).toMatchObject({ enabled: false });
    expect(capability(lootActions, 'loot')).toMatchObject({
      enabled: true,
      params: { itemId: 'spirit_herb' },
      options: [expect.objectContaining({ itemId: 'spirit_herb', qty: 1 })],
    });
  });

  test('enables same-location teaching and exchange with rule-authored previews', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({
        realm: 'foundation_building',
        realmStage: 2,
        inventory: [{ itemId: 'spirit_herb', qty: 3 }],
      }),
      targetView: { affinity: 0, trust: 0, suspicion: 0, tags: [] },
      actorViewOfTarget: { affinity: 1, trust: 0, suspicion: 0, tags: [] },
    });

    expect(capability(actions, 'talk')).toMatchObject({ enabled: true });
    expect(capability(actions, 'gift')).toMatchObject({ enabled: true });
    expect(capability(actions, 'trade')).toMatchObject({ enabled: true });
    expect(capability(actions, 'request_teaching')).toMatchObject({
      enabled: true,
      durationMs: 6000,
      teachingTopic: 'cultivation_fundamentals',
      teacherBusy: false,
      riskPreview: { presentationSource: 'rule_template' },
    });
  });

  test('disables teaching on the authoritative cooldown and teacher capacity gates', () => {
    const base = {
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({ realm: 'foundation_building', realmStage: 2 }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    };
    const cooled = capability(buildGodotCapabilityActions({
      ...base,
      teachingCooldown: {
        resultCode: 'teaching_daily_cooldown',
        reason: '今日已经完成过一次求教。',
      },
    }), 'request_teaching');
    expect(cooled).toMatchObject({
      enabled: false,
      cooldownResultCode: 'teaching_daily_cooldown',
      durationMs: 6000,
    });

    const busy = capability(buildGodotCapabilityActions({
      ...base,
      teacherBusy: true,
    }), 'request_teaching');
    expect(busy).toMatchObject({ enabled: false, teacherBusy: true, durationMs: 6000 });
  });

  test('shows explicit request decision and turn-in capabilities from server status', () => {
    const offered = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({ actorId: resident.actorId }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      request: {
        requestId: 'req-1',
        revision: 3,
        status: 'offered',
        type: 'collect_item',
        summary: '采一株灵草',
      },
    });
    expect(capability(offered, 'accept_request')).toMatchObject({
      enabled: true,
      params: { requestId: 'req-1', expectedRevision: 3 },
      requestStatus: 'offered',
    });
    expect(capability(offered, 'decline_request')).toMatchObject({
      enabled: true,
      durationMs: 1000,
      requestRevision: 3,
    });
    expect(capability(offered, 'turn_in_request')).toMatchObject({ enabled: false });

    const ready = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({ actorId: resident.actorId }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      request: {
        requestId: 'req-1',
        revision: 4,
        status: 'ready_to_turn_in',
        type: 'collect_item',
        summary: '采一株灵草',
      },
    });
    expect(capability(ready, 'turn_in_request')).toMatchObject({
      enabled: true,
      params: { requestId: 'req-1', expectedRevision: 4 },
    });
    expect(capability(ready, 'accept_request')).toMatchObject({ enabled: false });
  });

  test('uses durable shop stock, wallet, restock source, scarcity quote, and sell offer', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile({
        inventory: [
          { itemId: 'spirit_stone', qty: 30 },
          { itemId: 'spirit_herb', qty: 1 },
        ],
      }),
      targetProfile: profile({ realm: 'foundation_building', role: 'merchant', inventory: [] }),
      shop: {
        shopId: 'lab_shop',
        name: '灰盒补给铺',
        merchantActorId: resident.actorId,
        mapId: 'qinglan',
        locationId: location.locationId,
        restockSourceId: 'sect_caravan',
        restockIntervalMs: 30_000,
        nextRestockAt: Date.now() + 30_000,
        walletSpiritStones: 20,
        walletCapacity: 40,
        walletRestockAmount: 4,
        stock: [
          { itemId: 'spirit_herb', qty: 1, capacity: 4, restockAmount: 1 },
          { itemId: 'qi_pill', qty: 1, capacity: 2, restockAmount: 1 },
        ],
        updatedAt: Date.now(),
      },
      targetView: { affinity: 0, trust: 0, suspicion: 0, tags: [] },
      actorViewOfTarget: { affinity: 1, trust: 0, suspicion: 0, tags: [] },
    });
    const trade = capability(actions, 'trade');
    expect(trade).toMatchObject({ enabled: true });
    expect('options' in trade ? trade.options : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'sell',
          itemId: 'spirit_herb',
          shop: expect.objectContaining({
            shopId: 'lab_shop',
            walletSpiritStones: 20,
            restockSourceId: 'sect_caravan',
            stock: 1,
            capacity: 4,
          }),
        }),
        expect.objectContaining({
          direction: 'buy',
          itemId: 'qi_pill',
          quote: expect.objectContaining({ scarcityMultiplier: 1.25 }),
        }),
      ]),
    );
  });

  test('cultivation capability exposes only owned modes, server energy, cost, and duration', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: null,
      currentLocation: location,
      actorProfile: profile({
        inventory: [
          { itemId: 'spirit_stone', qty: 12 },
          { itemId: 'qi_pendant', qty: 3 },
        ],
      }),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });
    expect(capability(actions, 'cultivate')).toMatchObject({
      enabled: true,
      params: { cultivationMode: 'ambient' },
      spiritualEnergy: 5,
      durationMs: 8000,
      pendantBonus: 0.1,
      options: [
        {
          cultivationMode: 'ambient',
          itemCost: null,
          durationMs: 8000,
          estimatedXp: { min: 11, max: 14 },
        },
        {
          cultivationMode: 'spirit_stone',
          itemCost: { itemId: 'spirit_stone', qty: 1 },
          estimatedXp: { min: 14, max: 17 },
        },
      ],
    });
  });

  test('gift capability exposes its dwell and disables on action cooldown', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile({ inventory: [{ itemId: 'spirit_stone', qty: 1 }] }),
      targetProfile: profile({ actorId: resident.actorId, inventory: [] }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      giftCooldown: {
        resultCode: 'gift_daily_cooldown',
        reason: '今日已经向对方完成过一次赠礼尝试，请改日再表达心意。',
      },
    });
    expect(capability(actions, 'gift')).toMatchObject({
      enabled: false,
      durationMs: 2000,
      cooldownResultCode: 'gift_daily_cooldown',
      reason: '今日已经向对方完成过一次赠礼尝试，请改日再表达心意。',
    });
  });

  test('gift options exclude inventory reserved by another active execution', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile({ inventory: [{ itemId: 'spirit_stone', qty: 1 }] }),
      targetProfile: profile({ actorId: resident.actorId, inventory: [] }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      reservedActorItems: { spirit_stone: 1 },
    });
    expect(capability(actions, 'gift')).toMatchObject({
      enabled: false,
      reason: 'No item is available to gift.',
      options: [],
    });
  });

  test('exposes self-use healing only from durable inventory and previews the capped delta', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: null,
      currentLocation: null,
      actorProfile: profile({
        health: 9,
        inventory: [{ itemId: 'healing_pill', qty: 2 }],
      }),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });
    expect(capability(actions, 'use_item')).toMatchObject({
      enabled: true,
      category: 'self',
      params: { itemId: 'healing_pill' },
      currentHealth: 9,
      maxHealth: 10,
      effectiveHeal: 1,
      options: [
        {
          itemId: 'healing_pill',
          qtyAvailable: 2,
          healValue: 3,
          effectiveHeal: 1,
          inventoryDeltaPreview: {
            deltas: [{ owner: 'actor', before: 2, after: 1, delta: -1 }],
          },
        },
      ],
    });
  });

  test.each([
    [profile({ health: 10, inventory: [{ itemId: 'healing_pill', qty: 1 }] }), 'Actor is at full health.'],
    [profile({ health: 5, inventory: [] }), 'Actor has no healing item.'],
    [profile({ health: 5, inventory: [{ itemId: 'qi_pill', qty: 1 }] }), 'Actor has no healing item.'],
    [profile({ health: 0, inventory: [{ itemId: 'healing_pill', qty: 1 }] }), 'Actor is incapacitated.'],
  ])('disables self-use healing when its durable gate fails', (actorProfile, reason) => {
    const actions = buildGodotCapabilityActions({
      actorTile: undefined,
      range: 5,
      targetResident: null,
      currentLocation: null,
      actorProfile,
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });
    expect(capability(actions, 'use_item')).toMatchObject({ enabled: false, reason });
  });

  test('disables target actions when the resident is not at the semantic location', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: {
        ...resident,
        currentLocationId: 'market_medicine_shop',
      } as Doc<'qinglanResidents'>,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({ realm: 'foundation_building' }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    expect(capability(actions, 'request_teaching')).toMatchObject({
      enabled: false,
      reason: 'Target is not at the current location.',
    });
  });

  test('disables target and non-arrival location actions until the actor formally arrives', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile({ currentLocationId: 'market_medicine_shop' }),
      targetProfile: profile({ realm: 'foundation_building' }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    expect(capability(actions, 'talk')).toMatchObject({
      enabled: false,
      reason: 'Actor must formally arrive at the current location.',
    });
    expect(capability(actions, 'cultivate')).toMatchObject({
      enabled: false,
      reason: 'Actor must formally arrive at the current location.',
    });
    expect(capability(actions, 'arrive')).toMatchObject({ enabled: true });
  });

  test('enables realm-gate breakthrough with a high rule-template risk preview', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 15, y: 15 },
      range: 5,
      targetResident: null,
      currentLocation: location,
      actorProfile: profile({
        realmStage: 9,
        cultivationXp: breakthroughThreshold('qi_refining', 9),
        realmEnteredAt: Date.now() - 13 * 24 * 60 * 60 * 1_000,
      }),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    expect(capability(actions, 'breakthrough')).toMatchObject({
      enabled: true,
      realmGate: true,
      riskPreview: { level: 'high', presentationSource: 'rule_template' },
    });
  });

  test('disables breakthrough at the highest realm cap', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 15, y: 15 },
      range: 5,
      targetResident: null,
      currentLocation: location,
      actorProfile: profile({
        realm: 'deity_transformation',
        realmStage: 3,
        cultivationXp: 9999,
      }),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    expect(capability(actions, 'breakthrough')).toMatchObject({
      enabled: false,
      realmCap: true,
      reason: 'Actor has reached the cultivation cap.',
      riskPreview: {
        possibleResultCodes: ['realm_cap_reached'],
        presentationSource: 'rule_template',
      },
    });
  });

  test('exposes only real in-range resource nodes with remaining unreserved stock', () => {
    const gatherLocation = {
      ...location,
      allowedActions: [...location.allowedActions, 'gather'],
    } as Doc<'locations'>;
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: null,
      currentLocation: gatherLocation,
      actorProfile: profile(),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      resourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: 'Dew Herb Patch',
          itemId: 'spirit_herb',
          tile: { x: 12, y: 12 },
          stock: 2,
          available: 1,
          accessible: true,
        },
        {
          resourceNodeId: 'reserved_patch',
          name: 'Reserved Patch',
          itemId: 'spirit_herb',
          tile: { x: 11, y: 13 },
          stock: 1,
          available: 0,
          accessible: true,
        },
      ],
    });

    expect(capability(actions, 'gather')).toMatchObject({
      enabled: true,
      params: { resourceNodeId: 'dew_patch' },
      durationMs: 6000,
      rangeTiles: 2,
      options: [
        { resourceNodeId: 'dew_patch', enabled: true, available: 1 },
        { resourceNodeId: 'reserved_patch', enabled: false, available: 0 },
      ],
    });
  });

  test('enables inspect only after the matching exact interactable arrival', () => {
    const inspectLocation = {
      ...location,
      allowedActions: [...location.allowedActions, 'inspect'],
    } as Doc<'locations'>;
    const base = {
      actorTile: { x: 24, y: 18 },
      range: 5,
      targetResident: null,
      currentLocation: inspectLocation,
      actorProfile: profile({
        mapId: inspectLocation.mapId,
        currentLocationId: inspectLocation.locationId,
      }),
      targetProfile: null,
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      inspectTargets: [
        {
          interactionId: 'bridge_inscription',
          name: '桥栏刻字',
          tile: { x: 24, y: 18 },
          observationId: 'valley_bridge_inscription_v1',
          observationRevision: 1,
        },
      ],
    };
    expect(capability(buildGodotCapabilityActions(base), 'inspect')).toMatchObject({
      enabled: false,
      reason: 'Arrive at an inspectable interaction first.',
    });
    expect(
      capability(
        buildGodotCapabilityActions({
          ...base,
          arrivedInteractionId: 'bridge_inscription',
        }),
        'inspect',
      ),
    ).toMatchObject({
      enabled: true,
      params: { interactionId: 'bridge_inscription' },
      options: [
        expect.objectContaining({
          interactionId: 'bridge_inscription',
          observationRevision: 1,
          enabled: true,
        }),
      ],
    });
  });

  test('exposes rest at a legal rest area and blocks heavy actions at high fatigue', () => {
    const restLocation = {
      ...location,
      allowedActions: [...location.allowedActions, 'rest', 'gather'],
    } as Doc<'locations'>;
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: restLocation,
      actorProfile: profile({ fatigue: 80 }),
      targetProfile: profile({ realm: 'foundation_building' }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
      resourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: 'Dew Herb Patch',
          itemId: 'spirit_herb',
          tile: { x: 12, y: 12 },
          stock: 1,
          available: 1,
          accessible: true,
        },
      ],
    });

    expect(capability(actions, 'rest')).toMatchObject({ enabled: true });
    expect(capability(actions, 'cultivate')).toMatchObject({ enabled: false });
    expect(capability(actions, 'gather')).toMatchObject({
      enabled: false,
      reason: 'Fatigue is too high for gathering.',
    });
    expect(capability(actions, 'talk')).toMatchObject({ enabled: true });
  });

  test('disables every ordinary capability while the actor is incapacitated', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile({ health: 0 }),
      targetProfile: profile({ realm: 'foundation_building' }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    expect(actions).toHaveLength(16);
    for (const action of actions) {
      expect(action).toMatchObject({ enabled: false, reason: 'Actor is incapacitated.' });
    }
  });

  test('disables every target interaction when the selected resident is incapacitated', () => {
    const actions = buildGodotCapabilityActions({
      actorTile: { x: 11, y: 12 },
      range: 5,
      targetResident: resident,
      currentLocation: location,
      actorProfile: profile(),
      targetProfile: profile({ realm: 'foundation_building', health: 0 }),
      targetView: defaultGodotRelationshipDims(),
      actorViewOfTarget: defaultGodotRelationshipDims(),
    });

    for (const type of ['talk', 'trade', 'gift', 'request_teaching', 'spar']) {
      expect(capability(actions, type)).toMatchObject({
        enabled: false,
        reason: 'Target is incapacitated.',
      });
    }
    expect(capability(actions, 'cultivate')).toMatchObject({ enabled: true });
  });
});

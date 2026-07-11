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
} as Doc<'locations'>;

const resident = {
  actorId: 'qinglan:elder',
  role: 'elder',
  currentLocationId: location.locationId,
  displayTile: { x: 12, y: 12 },
} as Doc<'qinglanResidents'>;

describe('Godot capability policy', () => {
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
      riskPreview: { presentationSource: 'rule_template' },
    });
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
});

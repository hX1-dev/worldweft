import type { Doc } from '../_generated/dataModel';
import {
  godotPlayerProfileSeed,
  qinglanResidentProfilePatch,
  qinglanResidentProfileSeed,
} from './qinglanProfiles';

const elderResident = {
  actorId: 'qinglan:elder',
  name: 'Elder Mu',
  role: 'elder',
  mapId: 'qinglan',
  currentLocationId: 'market_tea_stall',
  currentIntent: 'Teach at the tea stall.',
};

describe('qinglanProfiles', () => {
  test('seeds Convex-owned resident profiles with role floors and spatial state', () => {
    const profile = qinglanResidentProfileSeed(elderResident);

    expect(profile.realm).toBe('foundation_building');
    expect(profile.realmStage).toBe(2);
    expect(profile.mapId).toBe('qinglan');
    expect(profile.currentLocationId).toBe('market_tea_stall');
    expect(profile.currentIntent).toBe(elderResident.currentIntent);
    expect(profile.inventory.length).toBeGreaterThan(0);
  });

  test('synchronizes resident location without regressing advanced durable progress', () => {
    const existing = {
      actorId: elderResident.actorId,
      name: elderResident.name,
      role: elderResident.role,
      realm: 'golden_core',
      realmStage: 3,
      cultivationXp: 420,
      mood: 2,
      health: 10,
      spirit: 10,
      reputation: 50,
      inventory: [{ itemId: 'rare_manual', qty: 1 }],
      mapId: 'qinglan',
      currentLocationId: 'market_inn',
      currentIntent: 'Old intent.',
      persona: 'Existing persona.',
    } as unknown as Doc<'xianxiaProfiles'>;

    const patch = qinglanResidentProfilePatch(existing, elderResident);

    expect(patch.realm).toBe('golden_core');
    expect(patch.realmStage).toBe(3);
    expect(patch.cultivationXp).toBe(420);
    expect(patch.inventory).toEqual(existing.inventory);
    expect(patch.currentLocationId).toBe('market_tea_stall');
    expect(patch.currentIntent).toBe(elderResident.currentIntent);
  });

  test('seeds the Godot player at a fixed Convex-owned starting location', () => {
    const profile = godotPlayerProfileSeed('qinglan', 'market_medicine_shop');

    expect(profile.actorId).toBe('godot_player');
    expect(profile.mapId).toBe('qinglan');
    expect(profile.currentLocationId).toBe('market_medicine_shop');
    expect(profile.inventory).toEqual([{ itemId: 'spirit_stone', qty: 24 }]);
  });
});

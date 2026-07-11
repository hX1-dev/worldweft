import type { Doc } from '../_generated/dataModel';
import { realmRank } from './rules';

type QinglanResidentProfileSource = Pick<
  Doc<'qinglanResidents'>,
  'actorId' | 'name' | 'role' | 'mapId' | 'currentLocationId' | 'currentIntent'
>;

export function profileStatsForResidentRole(role: string) {
  if (role === 'elder') {
    return {
      realm: 'foundation_building',
      realmStage: 2,
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 180,
      health: 9,
      spirit: 9,
      reputation: 25,
    };
  }
  if (role === 'guard') {
    return {
      realm: 'qi_refining',
      realmStage: 5,
      innerTrait: '正直',
      outerTrait: '睚眦',
      cultivationXp: 100,
      health: 8,
      spirit: 6,
      reputation: 10,
    };
  }
  if (role === 'merchant') {
    return {
      realm: 'qi_refining',
      realmStage: 3,
      innerTrait: '利己',
      outerTrait: '义气',
      cultivationXp: 30,
      health: 8,
      spirit: 6,
      reputation: 3,
    };
  }
  return {
    realm: 'qi_refining',
    realmStage: 2,
    innerTrait: '中庸',
    outerTrait: '任我',
    cultivationXp: 30,
    health: 8,
    spirit: 6,
    reputation: 3,
  };
}

export function starterInventoryForResident(role: string) {
  if (role === 'elder') {
    return [
      { itemId: 'spirit_stone', qty: 24 },
      { itemId: 'calm_pill', qty: 1 },
    ];
  }
  if (role === 'merchant') {
    return [
      { itemId: 'spirit_stone', qty: 40 },
      { itemId: 'spirit_herb', qty: 2 },
    ];
  }
  if (role === 'guard') {
    return [
      { itemId: 'iron_sword', qty: 1 },
      { itemId: 'talisman', qty: 1 },
    ];
  }
  return [{ itemId: 'spirit_stone', qty: 6 }];
}

export function qinglanResidentProfileSeed(resident: QinglanResidentProfileSource) {
  const stats = profileStatsForResidentRole(resident.role);
  return {
    actorId: resident.actorId,
    name: resident.name,
    role: resident.role,
    realm: stats.realm,
    realmStage: stats.realmStage,
    spiritRoot: 'mixed',
    innerTrait: stats.innerTrait,
    outerTrait: stats.outerTrait,
    cultivationXp: stats.cultivationXp,
    mood: 1,
    health: stats.health,
    spirit: stats.spirit,
    reputation: stats.reputation,
    inventory: starterInventoryForResident(resident.role),
    mapId: resident.mapId,
    currentLocationId: resident.currentLocationId,
    currentIntent: resident.currentIntent,
    persona: `青岚坊市居民：${resident.name}，身份为${resident.role}。`,
  };
}

export function qinglanResidentProfilePatch(
  profile: Doc<'xianxiaProfiles'>,
  resident: QinglanResidentProfileSource,
) {
  const stats = profileStatsForResidentRole(resident.role);
  const progressCompare =
    realmRank(profile.realm) === realmRank(stats.realm)
      ? profile.realmStage - stats.realmStage
      : realmRank(profile.realm) - realmRank(stats.realm);
  const belowFloor = progressCompare < 0;
  const atFloor = progressCompare === 0;
  return {
    name: resident.name,
    role: resident.role,
    realm: belowFloor ? stats.realm : profile.realm,
    realmStage: belowFloor ? stats.realmStage : profile.realmStage,
    spiritRoot: profile.spiritRoot ?? 'mixed',
    innerTrait: profile.innerTrait ?? stats.innerTrait,
    outerTrait: profile.outerTrait ?? stats.outerTrait,
    cultivationXp:
      belowFloor || atFloor
        ? Math.max(profile.cultivationXp ?? 0, stats.cultivationXp)
        : profile.cultivationXp,
    health: Math.max(profile.health ?? 0, stats.health),
    spirit: Math.max(profile.spirit ?? 0, stats.spirit),
    reputation: Math.max(profile.reputation ?? 0, stats.reputation),
    inventory: profile.inventory ?? starterInventoryForResident(resident.role),
    mapId: resident.mapId,
    currentLocationId: resident.currentLocationId,
    currentIntent: resident.currentIntent,
    persona: profile.persona ?? `青岚坊市居民：${resident.name}，身份为${resident.role}。`,
  };
}

export function godotPlayerProfileSeed(mapId: string, locationId: string) {
  return {
    actorId: 'godot_player',
    name: '入世者',
    role: 'outer_disciple',
    realm: 'qi_refining',
    realmStage: 1,
    spiritRoot: 'mixed',
    innerTrait: '中庸',
    outerTrait: '任我',
    cultivationXp: 0,
    mood: 1,
    health: 8,
    spirit: 7,
    reputation: 0,
    inventory: [{ itemId: 'spirit_stone', qty: 24 }],
    mapId,
    currentLocationId: locationId,
    currentIntent: '通过 Godot 客户端在场景中行动。',
    persona: '由 Godot 玩家控制，行动通过 Convex 规则裁决。',
  };
}

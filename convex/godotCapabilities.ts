import type { Doc } from './_generated/dataModel';
import {
  buildGiftOptions,
  buildTradeOptions,
  optionParams,
  type InventoryItem,
} from './godotExchange';
import { godotTileDistance, godotTileTouchesLocation, roundGodotDistance } from './godotSpatial';
import { breakthroughThreshold, realmMaxStage, realmRank } from './xianxia/rules';
import {
  profileStatsForResidentRole,
  starterInventoryForResident,
} from './xianxia/qinglanProfiles';

const targetActionMenu: Array<{
  type: string;
  label: string;
  intent: string;
  params: Record<string, unknown>;
}> = [
  {
    type: 'talk',
    label: 'Talk',
    intent: '打个招呼，询问今日坊市见闻',
    params: {},
  },
  {
    type: 'trade',
    label: 'Trade',
    intent: '以一枚灵石试探交换一株灵草',
    params: { offeredItemId: 'spirit_stone', requestedItemId: 'spirit_herb' },
  },
  {
    type: 'gift',
    label: 'Gift',
    intent: '赠一枚灵石，表达善意',
    params: { itemId: 'spirit_stone' },
  },
  {
    type: 'request_teaching',
    label: 'Ask Teach',
    intent: '请教一两句修行经验',
    params: {},
  },
  {
    type: 'spar',
    label: 'Spar',
    intent: '请对方点到为止地切磋一招',
    params: {},
  },
];

const locationActionMenu: Array<{
  type: string;
  label: string;
  intent: string;
  params: Record<string, unknown>;
  visible: boolean;
}> = [
  {
    type: 'arrive',
    label: 'Arrive',
    intent: '抵达当前地点',
    params: {},
    visible: false,
  },
  {
    type: 'explore',
    label: 'Explore',
    intent: '探查当前地点周遭',
    params: {},
    visible: true,
  },
  {
    type: 'cultivate',
    label: 'Cultivate',
    intent: '在当前地点吐纳修行',
    params: {},
    visible: true,
  },
  {
    type: 'breakthrough',
    label: 'Breakthrough',
    intent: '尝试冲击下一层小境界',
    params: {},
    visible: true,
  },
];

export type GodotRelationshipView = {
  affinity: number;
  trust: number;
  suspicion: number;
  tags?: string[];
};

export function buildGodotCapabilityActions(args: {
  actorTile?: { x: number; y: number };
  range: number;
  targetResident: Doc<'qinglanResidents'> | null;
  currentLocation: Doc<'locations'> | null;
  actorProfile: Doc<'xianxiaProfiles'> | null;
  targetProfile: Doc<'xianxiaProfiles'> | null;
  targetView: GodotRelationshipView;
  actorViewOfTarget: GodotRelationshipView;
}) {
  const actorInventory = args.actorProfile?.inventory ?? defaultGodotActorInventory();
  const targetInventory = args.targetResident
    ? (args.targetProfile?.inventory ?? starterInventoryForResident(args.targetResident.role))
    : [];
  const giftOptions = buildGiftOptions(actorInventory, targetInventory);
  const tradeOptions = buildTradeOptions(actorInventory, targetInventory, args.targetView);
  const teaching = args.targetResident
    ? targetTeachingAvailability({
        actorProfile: args.actorProfile,
        targetProfile: args.targetProfile,
        targetRole: args.targetResident.role,
        actorRelationship: args.actorViewOfTarget.affinity,
      })
    : { allowed: false, reason: 'Select a resident.', metadata: {} };
  const breakthrough = actorBreakthroughAvailability(args.actorProfile);
  const actorAtCurrentLocation =
    !!args.actorProfile &&
    !!args.currentLocation &&
    (args.actorProfile.mapId ?? 'world') === (args.currentLocation.mapId ?? 'world') &&
    args.actorProfile.currentLocationId === args.currentLocation.locationId;
  const targetPresent =
    !!args.targetResident &&
    !!args.currentLocation &&
    args.targetResident.currentLocationId === args.currentLocation.locationId;

  const targetActions = targetActionMenu.map((action) =>
    args.targetResident
      ? targetCapability(
          {
            type: action.type,
            label: action.label,
            actorTile: args.actorTile,
            targetResident: args.targetResident,
            range: args.range,
            allowed:
              actorAtCurrentLocation &&
              targetPresent &&
              locationAllows(args.currentLocation, action.type) &&
              (action.type !== 'gift' || giftOptions.length > 0) &&
              (action.type !== 'trade' || tradeOptions.length > 0) &&
              (action.type !== 'request_teaching' || teaching.allowed),
            unavailableReason: targetActionUnavailableReason({
              type: action.type,
              currentLocation: args.currentLocation,
              actorAtCurrentLocation,
              targetPresent,
              giftOptions,
              tradeOptions,
              teachingReason: teaching.reason,
            }),
            intent: action.intent,
            params:
              action.type === 'gift'
                ? (optionParams(giftOptions[0]) ?? action.params)
                : action.type === 'trade'
                  ? (optionParams(tradeOptions[0]) ?? action.params)
                  : action.params,
          },
          {
            options:
              action.type === 'gift' ? giftOptions : action.type === 'trade' ? tradeOptions : [],
            ...(action.type === 'request_teaching' ? teaching.metadata : {}),
            ...(action.type === 'request_teaching'
              ? {
                  riskPreview: teachingRiskPreview(
                    teaching.metadata,
                    teaching.allowed,
                    teaching.reason,
                  ),
                }
              : {}),
            ...(action.type === 'spar'
              ? {
                  riskPreview: sparRiskPreview({
                    actorProfile: args.actorProfile,
                    targetProfile: args.targetProfile,
                    targetRole: args.targetResident.role,
                  }),
                }
              : {}),
          },
        )
      : disabledCapability(action.type, action.label, 'Select a resident.', {
          category: 'target',
          intent: action.intent,
          params: action.params,
          options: [],
          requiresTarget: true,
          visible: true,
        }),
  );
  const locationActions = locationActionMenu.map((action) =>
    args.currentLocation
      ? locationCapability({
          type: action.type,
          label: action.label,
          actorTile: args.actorTile,
          location: args.currentLocation,
          range: args.range,
          allowed:
            action.type === 'arrive' ||
            (actorAtCurrentLocation &&
              locationAllows(args.currentLocation, action.type) &&
              (action.type !== 'breakthrough' || breakthrough.allowed)),
          unavailableReason: locationActionUnavailableReason({
            type: action.type,
            location: args.currentLocation,
            actorAtCurrentLocation,
            breakthroughReason: breakthrough.reason,
          }),
          intent: action.intent,
          params: action.params,
          visible: action.visible,
          metadata:
            action.type === 'breakthrough'
              ? {
                  ...breakthrough.metadata,
                  riskPreview: breakthroughRiskPreview(
                    breakthrough.metadata,
                    breakthrough.allowed,
                    breakthrough.reason,
                  ),
                }
              : undefined,
        })
      : disabledCapability(action.type, action.label, 'No nearby location.', {
          category: 'location',
          intent: action.intent,
          params: action.params,
          requiresLocation: true,
          visible: action.visible,
        }),
  );

  return [...targetActions, ...locationActions];
}

function disabledCapability(
  type: string,
  label: string,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  return { type, label, enabled: false, reason, ...metadata };
}

function targetCapability(
  args: {
    type: string;
    label: string;
    actorTile?: { x: number; y: number };
    targetResident: Doc<'qinglanResidents'>;
    range: number;
    allowed: boolean;
    unavailableReason?: string;
    intent?: string;
    params?: Record<string, unknown>;
  },
  extraMetadata: Record<string, unknown> = {},
) {
  const metadata = {
    category: 'target',
    intent: args.intent,
    params: args.params ?? {},
    requiresTarget: true,
    visible: true,
    ...extraMetadata,
  };
  if (!args.actorTile) {
    return disabledCapability(args.type, args.label, 'Actor tile is required.', metadata);
  }
  if (!args.allowed) {
    return disabledCapability(
      args.type,
      args.label,
      args.unavailableReason ?? `Current location does not allow ${args.type}.`,
      metadata,
    );
  }
  const distance = godotTileDistance(args.actorTile, args.targetResident.displayTile);
  if (distance > args.range) {
    return {
      ...disabledCapability(
        args.type,
        args.label,
        `Target is ${roundGodotDistance(distance)} tiles away; range is ${args.range}.`,
        metadata,
      ),
      targetActorId: args.targetResident.actorId,
      distanceTiles: roundGodotDistance(distance),
      rangeTiles: args.range,
    };
  }
  return {
    type: args.type,
    label: args.label,
    enabled: true,
    reason: null,
    ...metadata,
    targetActorId: args.targetResident.actorId,
    distanceTiles: roundGodotDistance(distance),
    rangeTiles: args.range,
  };
}

function locationCapability(args: {
  type: string;
  label: string;
  actorTile?: { x: number; y: number };
  location: Doc<'locations'>;
  range: number;
  allowed: boolean;
  unavailableReason?: string;
  intent?: string;
  params?: Record<string, unknown>;
  visible?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const metadata = {
    category: 'location',
    intent: args.intent,
    params: args.params ?? {},
    requiresLocation: true,
    visible: args.visible ?? true,
    ...(args.metadata ?? {}),
  };
  if (!args.actorTile) {
    return disabledCapability(args.type, args.label, 'Actor tile is required.', metadata);
  }
  if (!args.allowed) {
    return disabledCapability(
      args.type,
      args.label,
      args.unavailableReason ?? `Location does not allow ${args.type}.`,
      metadata,
    );
  }
  const maxDistance = Math.max(args.range, 4);
  if (!godotTileTouchesLocation(args.actorTile, args.location, maxDistance)) {
    return {
      ...disabledCapability(
        args.type,
        args.label,
        `Actor is not near ${args.location.name}.`,
        metadata,
      ),
      locationId: args.location.locationId,
      rangeTiles: maxDistance,
    };
  }
  return {
    type: args.type,
    label: args.label,
    enabled: true,
    reason: null,
    ...metadata,
    locationId: args.location.locationId,
    rangeTiles: maxDistance,
  };
}

function locationAllows(location: Doc<'locations'> | null, action: string) {
  return !!location && location.allowedActions.includes(action);
}

function defaultGodotActorInventory(): InventoryItem[] {
  return [{ itemId: 'spirit_stone', qty: 24 }];
}

export function defaultGodotRelationshipDims() {
  return { affinity: 0, trust: 0, suspicion: 0, tags: [] as string[] };
}

function riskPreview(args: {
  level: 'low' | 'medium' | 'high';
  summary: string;
  details: string[];
  possibleResultCodes: string[];
  ruleGates: string[];
  durableEffects: string[];
}) {
  return {
    level: args.level,
    summary: args.summary,
    details: args.details.filter(Boolean),
    possibleResultCodes: args.possibleResultCodes.filter(Boolean),
    ruleGates: args.ruleGates.filter(Boolean),
    durableEffects: args.durableEffects.filter(Boolean),
    presentationSource: 'rule_template',
  };
}

function teachingRiskPreview(metadata: Record<string, unknown>, allowed: boolean, reason?: string) {
  const actorRealm = realmText(metadata.actorRealm, metadata.actorRealmStage);
  const targetRealm = realmText(metadata.targetRealm, metadata.targetRealmStage);
  const relationship = Number(metadata.actorRelationship ?? 0);
  const requiredRelationship = Number(metadata.requiredRelationship ?? 0);
  const reputation = Number(metadata.actorReputation ?? 0);
  const minimumReputation = Number(metadata.minimumReputation ?? -50);
  return riskPreview({
    level: allowed ? 'low' : 'medium',
    summary: allowed
      ? 'The teacher may grant guidance or politely refuse during rule resolution.'
      : (reason ?? 'Teaching request is blocked by current rule gates.'),
    details: [
      `Actor realm ${actorRealm}; teacher realm ${targetRealm}.`,
      `Relationship ${relationship}/${requiredRelationship}; reputation ${reputation}/${minimumReputation}.`,
      'A granted lesson can improve cultivation and social memory; a refusal still records the action.',
    ],
    possibleResultCodes: allowed
      ? ['teaching_granted', 'teaching_refused']
      : ['master_not_qualified', 'relationship_insufficient', 'reputation_too_low'],
    ruleGates: [
      'Teacher realm must be higher than actor realm.',
      'Relationship must be non-negative.',
      'Actor reputation must stay above the minimum teaching threshold.',
    ],
    durableEffects: [
      'actionRecords row',
      'worldEvents row',
      'possible cultivation XP or mood change',
      'possible relationship and memory updates',
    ],
  });
}

function sparRiskPreview(args: {
  actorProfile: Doc<'xianxiaProfiles'> | null;
  targetProfile: Doc<'xianxiaProfiles'> | null;
  targetRole: string;
}) {
  const actorRealm = realmText(
    args.actorProfile?.realm ?? 'qi_refining',
    args.actorProfile?.realmStage ?? 1,
  );
  const targetRealm = realmText(
    effectiveResidentRealm(args.targetProfile, args.targetRole),
    effectiveResidentRealmStage(args.targetProfile, args.targetRole),
  );
  return riskPreview({
    level: 'medium',
    summary:
      'Sparring is resolved by combat score and may affect health, mood, reputation, and relationships.',
    details: [
      `Actor realm ${actorRealm}; target realm ${targetRealm}.`,
      'Large realm gaps can still be rejected by the formal action rule.',
    ],
    possibleResultCodes: ['spar_draw', 'spar_actor_win', 'spar_actor_lose', 'realm_gap_too_large'],
    ruleGates: [
      'Target must be present at the current semantic location.',
      'Current location must allow spar.',
      'Rule resolution checks realm gap before applying spar outcome.',
    ],
    durableEffects: [
      'actionRecords row',
      'public worldEvents row when resolved',
      'possible health, mood, reputation, relationship, and memory updates',
    ],
  });
}

function breakthroughRiskPreview(
  metadata: Record<string, unknown>,
  allowed: boolean,
  reason?: string,
) {
  const realm = realmText(metadata.realm, metadata.realmStage);
  const cultivationXp = Number(metadata.cultivationXp ?? 0);
  const threshold = Number(metadata.breakthroughThreshold ?? 0);
  const realmGate = metadata.realmGate === true;
  return riskPreview({
    level: realmGate ? 'high' : 'medium',
    summary: allowed
      ? 'Realm-gate breakthrough can succeed, fail, or backfire under Convex rules.'
      : (reason ?? 'Breakthrough is blocked by current cultivation gates.'),
    details: [
      `Actor realm ${realm}; cultivation ${cultivationXp}/${threshold}.`,
      realmGate
        ? 'This is a realm gate and can carry failure or deviation risk.'
        : 'Minor layer progress is handled by cultivation rules instead of this manual action.',
    ],
    possibleResultCodes: allowed
      ? ['breakthrough_success', 'breakthrough_failed', 'breakthrough_deviation']
      : realmGate
        ? ['insufficient_cultivation']
        : ['breakthrough_success'],
    ruleGates: [
      'Actor must be at a realm gate for the manual action to enable.',
      'Cultivation XP must meet the breakthrough threshold.',
      'Current location must allow breakthrough.',
    ],
    durableEffects: [
      'actionRecords row when submitted',
      'worldEvents row',
      'possible realm, cultivation XP, health, and mood changes',
      'possible public presentation when a realm gate resolves',
    ],
  });
}

function realmText(realm: unknown, stage: unknown) {
  return `${typeof realm === 'string' ? realm : '?'} ${typeof stage === 'number' ? stage : '?'}`;
}

function targetTeachingAvailability(args: {
  actorProfile: Doc<'xianxiaProfiles'> | null;
  targetProfile: Doc<'xianxiaProfiles'> | null;
  targetRole: string;
  actorRelationship: number;
}) {
  const actorRealm = args.actorProfile?.realm ?? 'qi_refining';
  const actorRealmStage = args.actorProfile?.realmStage ?? 1;
  const targetRealm = effectiveResidentRealm(args.targetProfile, args.targetRole);
  const targetRealmStage = effectiveResidentRealmStage(args.targetProfile, args.targetRole);
  const actorReputation = args.actorProfile?.reputation ?? 0;
  const metadata = {
    actorRealm,
    actorRealmStage,
    targetRealm,
    targetRealmStage,
    targetRole: args.targetRole,
    actorRelationship: args.actorRelationship,
    requiredRelationship: 0,
    actorReputation,
    minimumReputation: -50,
  };
  if (realmRank(targetRealm) <= realmRank(actorRealm)) {
    return { allowed: false, reason: 'Target realm is not high enough to teach.', metadata };
  }
  if (args.actorRelationship < 0) {
    return { allowed: false, reason: 'Relationship is too low for teaching.', metadata };
  }
  if (actorReputation < -50) {
    return { allowed: false, reason: 'Actor reputation is too low for teaching.', metadata };
  }
  return { allowed: true, reason: undefined, metadata };
}

function actorBreakthroughAvailability(profile: Doc<'xianxiaProfiles'> | null) {
  if (!profile) {
    return {
      allowed: false,
      reason: 'Actor cultivation profile is not initialized yet.',
      metadata: {
        realm: 'qi_refining',
        realmStage: 1,
        cultivationXp: 0,
        breakthroughThreshold: breakthroughThreshold('qi_refining', 1),
        realmGate: false,
      },
    };
  }

  const threshold = breakthroughThreshold(profile.realm, profile.realmStage);
  const realmGate = profile.realmStage >= realmMaxStage(profile.realm);
  const metadata = {
    realm: profile.realm,
    realmStage: profile.realmStage,
    cultivationXp: profile.cultivationXp,
    breakthroughThreshold: threshold,
    realmGate,
  };
  if (!realmGate) {
    return {
      allowed: false,
      reason:
        'Minor layer advancement is automatic; manual breakthrough is only needed at a realm gate.',
      metadata,
    };
  }
  if (profile.cultivationXp < threshold) {
    return {
      allowed: false,
      reason: `Cultivation is ${profile.cultivationXp}/${threshold}; not ready for breakthrough.`,
      metadata,
    };
  }
  return { allowed: true, reason: undefined, metadata };
}

function effectiveResidentRealm(profile: Doc<'xianxiaProfiles'> | null, role: string) {
  const roleRealm = profileStatsForResidentRole(role).realm;
  if (!profile) return roleRealm;
  return realmRank(profile.realm) >= realmRank(roleRealm) ? profile.realm : roleRealm;
}

function effectiveResidentRealmStage(profile: Doc<'xianxiaProfiles'> | null, role: string) {
  const stats = profileStatsForResidentRole(role);
  if (!profile) return stats.realmStage;
  if (realmRank(profile.realm) > realmRank(stats.realm)) return profile.realmStage;
  if (realmRank(profile.realm) < realmRank(stats.realm)) return stats.realmStage;
  return Math.max(profile.realmStage, stats.realmStage);
}

function targetActionUnavailableReason(args: {
  type: string;
  currentLocation: Doc<'locations'> | null;
  actorAtCurrentLocation: boolean;
  targetPresent?: boolean;
  giftOptions: unknown[];
  tradeOptions: unknown[];
  teachingReason?: string;
}) {
  if (!args.actorAtCurrentLocation) {
    return 'Actor must formally arrive at the current location.';
  }
  if (args.targetPresent === false) {
    return 'Target is not at the current location.';
  }
  if (!locationAllows(args.currentLocation, args.type)) {
    return `Current location does not allow ${args.type}.`;
  }
  if (args.type === 'gift' && args.giftOptions.length === 0) {
    return 'No item is available to gift.';
  }
  if (args.type === 'trade' && args.tradeOptions.length === 0) {
    return 'No affordable trade option is available.';
  }
  if (args.type === 'request_teaching' && args.teachingReason) {
    return args.teachingReason;
  }
  return undefined;
}

function locationActionUnavailableReason(args: {
  type: string;
  location: Doc<'locations'> | null;
  actorAtCurrentLocation: boolean;
  breakthroughReason?: string;
}) {
  if (args.type !== 'arrive' && !args.actorAtCurrentLocation) {
    return 'Actor must formally arrive at the current location.';
  }
  if (!locationAllows(args.location, args.type)) {
    return `Location does not allow ${args.type}.`;
  }
  if (args.type === 'breakthrough' && args.breakthroughReason) {
    return args.breakthroughReason;
  }
  return undefined;
}

import type { Doc } from './_generated/dataModel';
import {
  buildHealingItemOptions,
  buildGiftOptions,
  buildShopTradeOptions,
  buildTradeOptions,
  optionParams,
  type InventoryItem,
} from './godotExchange';
import { godotTileDistance, godotTileTouchesLocation, roundGodotDistance } from './godotSpatial';
import { breakthroughThreshold, isCultivationCap, realmMaxStage, realmRank } from './xianxia/rules';
import {
  profileStatsForResidentRole,
  starterInventoryForResident,
} from './xianxia/qinglanProfiles';
import { isActorIncapacitated } from './xianxia/lifeStateLogic';
import { evaluateFatigueActionGate, normalizeFatigue } from './xianxia/fatigueLogic';
import {
  applyCultivationEnhancements,
  availableCultivationModes,
  clampCultivationEnergy,
  cultivationResourceForMode,
  hasCultivationPendant,
} from './xianxia/cultivationResourceLogic';
import {
  BREAKTHROUGH_EXECUTION_DURATION_MS,
  REQUEST_DECLINE_EXECUTION_DURATION_MS,
  TEACHING_EXECUTION_DURATION_MS,
} from './xianxia/actionExecutionContracts';
import { evaluateBreakthroughProgress } from './xianxia/breakthroughProgressLogic';
import type { ShopState } from './xianxia/shopLogic';

const ACTOR_INCAPACITATED_REASON = 'Actor is incapacitated.';
const TARGET_INCAPACITATED_REASON = 'Target is incapacitated.';

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
  {
    type: 'attack',
    label: 'Attack',
    intent: '向目标发起敌对攻击',
    params: {},
  },
  {
    type: 'loot',
    label: 'Loot',
    intent: '从已被击倒的目标处取走一件战利品',
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
    type: 'rest',
    label: 'Rest',
    intent: '在当前安稳地点休息以缓解疲劳',
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
  shop?: ShopState | null;
  targetView: GodotRelationshipView;
  actorViewOfTarget: GodotRelationshipView;
  resourceNodes?: {
    resourceNodeId: string;
    name: string;
    itemId: string;
    tile: { x: number; y: number };
    stock: number;
    available: number;
    accessible: boolean;
  }[];
  inspectTargets?: {
    interactionId: string;
    name: string;
    tile: { x: number; y: number };
    observationId: string;
    observationRevision: number;
  }[];
  arrivedInteractionId?: string;
  combat?: {
    activeEncounterId?: string;
    opponentActorId?: string;
    lootEncounterId?: string;
    lootOwnerActorId?: string;
    lootProtectedUntil?: number;
    lootPriorityAllowed?: boolean;
    lootOptions: { itemId: string; qty: number }[];
  };
  request?: {
    requestId: string;
    revision: number;
    status: string;
    type: string;
    summary: string;
  } | null;
  giftCooldown?: { resultCode: string; reason: string } | null;
  teachingCooldown?: { resultCode: string; reason: string } | null;
  teacherBusy?: boolean;
  reservedActorItems?: Record<string, number>;
}) {
  const actorIncapacitated =
    typeof args.actorProfile?.health === 'number' && isActorIncapacitated(args.actorProfile.health);
  const targetIncapacitated =
    typeof args.targetProfile?.health === 'number' &&
    isActorIncapacitated(args.targetProfile.health);
  const actorInventory = args.actorProfile?.inventory ?? defaultGodotActorInventory();
  const giftInventory = actorInventory
    .map((item) => ({
      ...item,
      qty: Math.max(0, item.qty - (args.reservedActorItems?.[item.itemId] ?? 0)),
    }))
    .filter((item) => item.qty > 0);
  const actorMaxHealth = Math.max(1, args.actorProfile?.maxHealth ?? 10);
  const actorHealth = args.actorProfile?.health ?? 0;
  const actorFatigue = normalizeFatigue(args.actorProfile?.fatigue);
  const cultivationEnergy = clampCultivationEnergy(args.currentLocation?.spiritualEnergy ?? 0);
  const pendant = hasCultivationPendant(actorInventory);
  const cultivationOptions = availableCultivationModes(actorInventory).map((mode) => {
    const resource = cultivationResourceForMode(mode);
    return {
      label:
        mode === 'ambient'
          ? 'Ambient Qi · free'
          : mode === 'spirit_stone'
            ? 'Spirit Stone · consume 1'
            : 'Qi Pill · consume 1',
      params: { cultivationMode: mode },
      cultivationMode: mode,
      itemCost: resource ? { itemId: resource.itemId, qty: resource.quantity } : null,
      spiritualEnergy: cultivationEnergy,
      estimatedXp: {
        min: applyCultivationEnhancements(5 + cultivationEnergy, mode, pendant),
        max: applyCultivationEnhancements(8 + cultivationEnergy, mode, pendant),
      },
      durationMs: 8000,
      enabled: true,
      reason: null,
    };
  });
  const healingOptions = buildHealingItemOptions(
    args.actorProfile?.inventory ?? [],
    actorHealth,
    actorMaxHealth,
  );
  const targetInventory = args.targetResident
    ? (args.targetProfile?.inventory ?? starterInventoryForResident(args.targetResident.role))
    : [];
  const giftOptions = buildGiftOptions(giftInventory, targetInventory);
  const tradeOptions = args.shop
    ? buildShopTradeOptions(actorInventory, args.shop, args.targetView)
    : buildTradeOptions(actorInventory, targetInventory, args.targetView);
  const teaching = args.targetResident
    ? targetTeachingAvailability({
        actorProfile: args.actorProfile,
        targetProfile: args.targetProfile,
        targetRole: args.targetResident.role,
        actorRelationship: args.actorViewOfTarget.affinity,
        teachingCooldown: args.teachingCooldown,
        teacherBusy: args.teacherBusy,
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
  const combat = args.combat ?? { lootOptions: [] };
  const lootOptions = combat.lootOptions.map((item) => ({
    label: `${item.itemId} · ${item.qty} available`,
    params: { itemId: item.itemId },
    itemId: item.itemId,
    qty: item.qty,
    enabled: item.qty > 0,
    reason: item.qty > 0 ? null : 'Item is already reserved.',
  }));

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
              !actorIncapacitated &&
              actorAtCurrentLocation &&
              targetPresent &&
              (action.type === 'loot'
                ? targetIncapacitated &&
                  !!combat.lootEncounterId &&
                  combat.lootPriorityAllowed === true &&
                  lootOptions.some((option) => option.enabled)
                : !targetIncapacitated &&
                  locationAllows(args.currentLocation, action.type) &&
                  (action.type !== 'attack' ||
                    !combat.activeEncounterId ||
                    combat.opponentActorId === args.targetResident.actorId)) &&
              (action.type !== 'gift' || giftOptions.length > 0) &&
              (action.type !== 'gift' || !args.giftCooldown) &&
              (action.type !== 'trade' || tradeOptions.length > 0) &&
              (action.type !== 'request_teaching' || teaching.allowed),
            unavailableReason: targetActionUnavailableReason({
              type: action.type,
              currentLocation: args.currentLocation,
              actorIncapacitated,
              targetIncapacitated,
              actorAtCurrentLocation,
              targetPresent,
              giftOptions,
              giftCooldown: args.giftCooldown,
              tradeOptions,
              teachingReason: teaching.reason,
              activeEncounterId: combat.activeEncounterId,
              combatOpponentActorId: combat.opponentActorId,
              lootEncounterId: combat.lootEncounterId,
              lootPriorityAllowed: combat.lootPriorityAllowed,
              lootOptions,
            }),
            intent: action.intent,
            params:
              action.type === 'gift'
                ? (optionParams(giftOptions[0]) ?? action.params)
                : action.type === 'trade'
                  ? (optionParams(tradeOptions[0]) ?? action.params)
                  : action.type === 'loot'
                    ? (optionParams(lootOptions[0]) ?? action.params)
                    : action.params,
          },
          {
            options:
              action.type === 'gift'
                ? giftOptions
                : action.type === 'trade'
                  ? tradeOptions
                  : action.type === 'loot'
                    ? lootOptions
                    : [],
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
            ...(action.type === 'attack' ? { durationMs: 4000 } : {}),
            ...(action.type === 'loot' ? { durationMs: 3000 } : {}),
            ...(action.type === 'gift'
              ? {
                  durationMs: 2000,
                  cooldownResultCode: args.giftCooldown?.resultCode,
                }
              : {}),
            ...(action.type === 'request_teaching'
              ? {
                  durationMs: TEACHING_EXECUTION_DURATION_MS,
                  teachingTopic: 'cultivation_fundamentals',
                  cooldownResultCode: args.teachingCooldown?.resultCode,
                  teacherBusy: args.teacherBusy === true,
                }
              : {}),
          },
        )
      : disabledCapability(
          action.type,
          action.label,
          actorIncapacitated ? ACTOR_INCAPACITATED_REASON : 'Select a resident.',
          {
            category: 'target',
            intent: action.intent,
            params: action.params,
            options: [],
            requiresTarget: true,
            visible: true,
          },
        ),
  );
  const requestActions = (args.request ? [
    {
      type: 'accept_request',
      label: 'Accept Request',
      intent: '当面接受这桩委托',
      requiredStatus: 'offered',
    },
    {
      type: 'decline_request',
      label: 'Decline Request',
      intent: '当面婉拒这桩委托',
      requiredStatus: 'offered',
    },
    {
      type: 'turn_in_request',
      label: 'Turn In Request',
      intent: '当面交付已经完成的委托',
      requiredStatus: 'ready_to_turn_in',
    },
  ] : []).map((action) => {
    const request = args.request;
    const allowed =
      !!args.targetResident &&
      !!request &&
      request.status === action.requiredStatus &&
      !actorIncapacitated &&
      !targetIncapacitated &&
      actorAtCurrentLocation &&
      targetPresent;
    const reason = !args.targetResident
      ? 'Select the request issuer.'
      : !request
        ? 'No active request from this resident.'
        : request.status !== action.requiredStatus
          ? `Request is ${request.status}; ${action.type} requires ${action.requiredStatus}.`
          : actorIncapacitated
            ? ACTOR_INCAPACITATED_REASON
            : targetIncapacitated
              ? TARGET_INCAPACITATED_REASON
              : !actorAtCurrentLocation || !targetPresent
                ? 'Actor and issuer must share the current location.'
                : undefined;
    return args.targetResident
      ? targetCapability(
          {
            type: action.type,
            label: action.label,
            actorTile: args.actorTile,
            targetResident: args.targetResident,
            range: args.range,
            allowed,
            unavailableReason: reason,
            intent: action.intent,
            params: request
              ? { requestId: request.requestId, expectedRevision: request.revision }
              : {},
          },
          {
            requestId: request?.requestId,
            requestRevision: request?.revision,
            requestStatus: request?.status,
            requestType: request?.type,
            requestSummary: request?.summary,
            ...(action.type === 'decline_request'
              ? { durationMs: REQUEST_DECLINE_EXECUTION_DURATION_MS }
              : {}),
          },
        )
      : disabledCapability(action.type, action.label, reason ?? 'Select the request issuer.', {
          category: 'target',
          intent: action.intent,
          params: request
            ? { requestId: request.requestId, expectedRevision: request.revision }
            : {},
          requiresTarget: true,
          visible: !!request,
        });
  });
  const selfActionMetadata = {
    category: 'self',
    intent: '服用疗伤丹，稳定自身伤势',
    params: optionParams(healingOptions[0]) ?? {},
    options: healingOptions,
    requiresTarget: false,
    requiresLocation: false,
    visible: true,
    currentHealth: actorHealth,
    maxHealth: actorMaxHealth,
    effectiveHeal: healingOptions[0]?.effectiveHeal ?? 0,
  };
  const selfActionReason = !args.actorProfile
    ? 'Actor profile is unavailable.'
    : actorIncapacitated
      ? ACTOR_INCAPACITATED_REASON
      : actorHealth >= actorMaxHealth
        ? 'Actor is at full health.'
        : healingOptions.length === 0
          ? 'Actor has no healing item.'
          : null;
  const selfAction = selfActionReason
    ? disabledCapability('use_item', 'Use Healing Pill', selfActionReason, selfActionMetadata)
    : {
        type: 'use_item',
        label: 'Use Healing Pill',
        enabled: true,
        reason: null,
        ...selfActionMetadata,
      };
  const fleeReason = !args.actorProfile
    ? 'Actor profile is unavailable.'
    : actorIncapacitated
      ? ACTOR_INCAPACITATED_REASON
      : !combat.activeEncounterId
        ? 'Actor is not in an active hostile encounter.'
        : null;
  const fleeAction = fleeReason
    ? disabledCapability('flee', 'Flee', fleeReason, {
        category: 'self',
        intent: '尝试脱离当前敌对冲突',
        params: {},
        requiresTarget: false,
        requiresLocation: false,
        visible: true,
        durationMs: 3000,
      })
    : {
        type: 'flee',
        label: 'Flee',
        enabled: true,
        reason: null,
        category: 'self',
        intent: '尝试脱离当前敌对冲突',
        params: {},
        requiresTarget: false,
        requiresLocation: false,
        visible: true,
        durationMs: 3000,
        encounterId: combat.activeEncounterId,
        opponentActorId: combat.opponentActorId,
      };
  const gatherOptions = (args.resourceNodes ?? []).map((node) => {
    const distance = args.actorTile ? godotTileDistance(args.actorTile, node.tile) : null;
    const enabled =
      node.accessible && node.available > 0 && distance !== null && distance <= 2;
    return {
      label: `${node.name} · ${node.itemId} · ${node.available}/${node.stock}`,
      params: { resourceNodeId: node.resourceNodeId },
      resourceNodeId: node.resourceNodeId,
      itemId: node.itemId,
      tile: node.tile,
      stock: node.stock,
      available: node.available,
      distanceTiles: distance === null ? null : roundGodotDistance(distance),
      enabled,
      reason: !node.accessible
        ? 'Resource node access is forbidden.'
        : node.available <= 0
          ? 'Resource node is depleted or fully reserved.'
          : distance === null
            ? 'Actor tile is required.'
            : distance > 2
              ? `Resource node is ${roundGodotDistance(distance)} tiles away; range is 2.`
              : null,
    };
  });
  const firstGatherOption = gatherOptions.find((option) => option.enabled);
  const gatherReason = !args.actorProfile
    ? 'Actor profile is unavailable.'
    : actorIncapacitated
      ? ACTOR_INCAPACITATED_REASON
      : !evaluateFatigueActionGate(actorFatigue, 'gather').ok
        ? 'Fatigue is too high for gathering.'
      : !args.currentLocation
        ? 'No nearby location.'
        : !actorAtCurrentLocation
          ? 'Actor must formally arrive at the current location.'
          : !locationAllows(args.currentLocation, 'gather')
            ? 'Location does not allow gather.'
            : gatherOptions.length === 0
              ? 'No resource node exists at the current location.'
              : !firstGatherOption
                ? 'No accessible resource node is in range with available stock.'
                : null;
  const gatherAction = {
    type: 'gather',
    label: 'Gather',
    enabled: gatherReason === null,
    reason: gatherReason,
    category: 'location',
    intent: '从当前真实资源点采集一份资源',
    params: firstGatherOption?.params ?? {},
    options: gatherOptions,
    requiresLocation: true,
    visible: true,
    durationMs: 6000,
    rangeTiles: 2,
  };
  const inspectOptions = (args.inspectTargets ?? []).map((target) => {
    const distance = args.actorTile ? godotTileDistance(args.actorTile, target.tile) : null;
    const enabled =
      actorAtCurrentLocation &&
      args.arrivedInteractionId === target.interactionId &&
      distance !== null &&
      distance <= 0.25;
    return {
      label: target.name,
      params: { interactionId: target.interactionId },
      interactionId: target.interactionId,
      observationId: target.observationId,
      observationRevision: target.observationRevision,
      tile: target.tile,
      distanceTiles: distance === null ? null : roundGodotDistance(distance),
      enabled,
      reason: !actorAtCurrentLocation
        ? 'Actor must formally arrive at the current location.'
        : args.arrivedInteractionId !== target.interactionId
          ? 'Actor must arrive through the matching interactable movement command.'
          : distance === null
            ? 'Actor tile is required.'
            : distance > 0.25
              ? `Interaction is ${roundGodotDistance(distance)} tiles away; exact arrival is required.`
              : null,
    };
  });
  const firstInspectOption = inspectOptions.find((option) => option.enabled);
  const inspectReason = !args.actorProfile
    ? 'Actor profile is unavailable.'
    : actorIncapacitated
      ? ACTOR_INCAPACITATED_REASON
      : !args.currentLocation
        ? 'No nearby location.'
        : !actorAtCurrentLocation
          ? 'Actor must formally arrive at the current location.'
          : !locationAllows(args.currentLocation, 'inspect')
            ? 'Location does not allow inspect.'
            : inspectOptions.length === 0
              ? 'No inspectable interaction exists at the current location.'
              : !firstInspectOption
                ? 'Arrive at an inspectable interaction first.'
                : null;
  const inspectAction = {
    type: 'inspect',
    label: 'Inspect',
    enabled: inspectReason === null,
    reason: inspectReason,
    category: 'location',
    intent: '查看已经精确抵达的交互物',
    params: firstInspectOption?.params ?? {},
    options: inspectOptions,
    requiresLocation: true,
    visible: inspectOptions.length > 0,
    rangeTiles: 0.25,
  };
  const locationActions = locationActionMenu.map((action) =>
    args.currentLocation
      ? locationCapability({
          type: action.type,
          label: action.label,
          actorTile: args.actorTile,
          location: args.currentLocation,
          range: args.range,
          allowed:
            !actorIncapacitated &&
            evaluateFatigueActionGate(actorFatigue, action.type).ok &&
            (action.type === 'arrive' ||
              (actorAtCurrentLocation &&
                locationAllows(args.currentLocation, action.type) &&
                (action.type !== 'breakthrough' || breakthrough.allowed))),
          unavailableReason: locationActionUnavailableReason({
            type: action.type,
            location: args.currentLocation,
            actorIncapacitated,
            actorAtCurrentLocation,
            fatigueReason: !evaluateFatigueActionGate(actorFatigue, action.type).ok
              ? evaluateFatigueActionGate(actorFatigue, action.type).reason
              : undefined,
            breakthroughReason: breakthrough.reason,
          }),
          intent: action.intent,
          params:
            action.type === 'cultivate'
              ? (cultivationOptions[0]?.params ?? { cultivationMode: 'ambient' })
              : action.params,
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
              : action.type === 'cultivate'
                ? {
                    options: cultivationOptions,
                    spiritualEnergy: cultivationEnergy,
                    durationMs: 8000,
                    pendantBonus: pendant ? 0.1 : 0,
                  }
                : undefined,
        })
      : disabledCapability(
          action.type,
          action.label,
          actorIncapacitated ? ACTOR_INCAPACITATED_REASON : 'No nearby location.',
          {
            category: 'location',
            intent: action.intent,
            params: action.params,
            requiresLocation: true,
            visible: action.visible,
          },
        ),
  );

  return [
    selfAction,
    fleeAction,
    ...targetActions,
    ...requestActions,
    gatherAction,
    inspectAction,
    ...locationActions,
  ];
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
      `The lesson requires ${TEACHING_EXECUTION_DURATION_MS / 1000} seconds of uninterrupted, in-range body execution.`,
      'A granted lesson can improve cultivation and social memory; a refusal still consumes the bounded attempt.',
    ],
    possibleResultCodes: allowed
      ? ['teaching_granted', 'teaching_refused']
      : ['master_not_qualified', 'relationship_insufficient', 'reputation_too_low'],
    ruleGates: [
      'Teacher realm must be higher than actor realm.',
      'Relationship must be non-negative.',
      'Actor reputation must stay above the minimum teaching threshold.',
      'The student and directed teacher cooldowns must be clear.',
      'The teacher must not be executing another action or teaching someone else.',
    ],
    durableEffects: [
      'actionRecords row',
      'ActionExecution reservation and terminal row',
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
  const realmCap = metadata.realmCap === true;
  const materialQuantity = Number(metadata.breakthroughMaterialQuantity ?? 0);
  const materialOwned = Number(metadata.breakthroughMaterialOwned ?? 0);
  const elapsedMs = Number(metadata.breakthroughElapsedMs ?? 0);
  const requiredDwellMs = Number(metadata.breakthroughRequiredDwellMs ?? 0);
  const durationMs = Number(metadata.durationMs ?? BREAKTHROUGH_EXECUTION_DURATION_MS);
  return riskPreview({
    level: realmGate ? 'high' : 'medium',
    summary: allowed
      ? 'Realm-gate breakthrough can succeed, fail, or backfire under Convex rules.'
      : (reason ?? 'Breakthrough is blocked by current cultivation gates.'),
    details: [
      `Actor realm ${realm}; cultivation ${cultivationXp}/${threshold}.`,
      `Realm time ${Math.floor(elapsedMs / 86_400_000)}/${Math.ceil(requiredDwellMs / 86_400_000)} days; material spirit_stone ${materialOwned}/${materialQuantity}.`,
      `Godot body execution lasts ${Math.round(durationMs / 1_000)} seconds; settlement happens only on completion.`,
      realmGate
        ? 'This is a realm gate and can carry failure or deviation risk.'
        : 'Minor layer progress is handled by cultivation rules instead of this manual action.',
    ],
    possibleResultCodes: allowed
      ? ['breakthrough_success', 'breakthrough_failed', 'breakthrough_deviation']
      : realmCap
        ? ['realm_cap_reached']
        : realmGate
          ? ['insufficient_cultivation']
          : ['breakthrough_success'],
    ruleGates: [
      'Actor must be at a realm gate for the manual action to enable.',
      'Cultivation XP must meet the breakthrough threshold.',
      'The current realm minimum time wall must be complete.',
      'The required spirit stones must be owned and unreserved.',
      'A failed attempt must finish its recovery window.',
      'The highest realm and stage cannot break through again.',
      'Current location must allow breakthrough.',
    ],
    durableEffects: [
      'actionRecords row when submitted',
      'ActionExecution reservation and terminal row',
      'worldEvents row with elapsed time and material cost',
      'spirit-stone consumption on completed success or failure',
      'possible realm, cultivation XP, health, mood, and recovery changes',
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
  teachingCooldown?: { resultCode: string; reason: string } | null;
  teacherBusy?: boolean;
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
    teachingTopic: 'cultivation_fundamentals',
    durationMs: TEACHING_EXECUTION_DURATION_MS,
  };
  if (realmRank(targetRealm) <= realmRank(actorRealm)) {
    return { allowed: false, reason: 'Target realm is not high enough to teach.', metadata };
  }
  if (args.actorRelationship < 0) {
    return { allowed: false, reason: 'Relationship is too low for teaching.', metadata };
  }
  if (actorReputation <= -50) {
    return { allowed: false, reason: 'Actor reputation is too low for teaching.', metadata };
  }
  if (args.teachingCooldown) {
    return { allowed: false, reason: args.teachingCooldown.reason, metadata };
  }
  if (args.teacherBusy) {
    return { allowed: false, reason: 'Teacher is currently occupied.', metadata };
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
  const realmCap = isCultivationCap(profile.realm, profile.realmStage);
  const now = Date.now();
  const progress = evaluateBreakthroughProgress({
    realm: profile.realm,
    realmEnteredAt: profile.realmEnteredAt,
    profileCreatedAt: profile._creationTime ?? now,
    breakthroughRecoveryUntil: profile.breakthroughRecoveryUntil,
    inventory: profile.inventory,
    now,
  });
  const metadata = {
    realm: profile.realm,
    realmStage: profile.realmStage,
    cultivationXp: profile.cultivationXp,
    breakthroughThreshold: threshold,
    realmGate,
    realmCap,
    realmEnteredAt: progress.realmEnteredAt,
    breakthroughReadyAt: progress.readyAt,
    breakthroughElapsedMs: progress.elapsedMs,
    breakthroughRequiredDwellMs: progress.requiredDwellMs,
    breakthroughRecoveryUntil: progress.recoveryUntil,
    breakthroughMaterialItemId: progress.materialItemId,
    breakthroughMaterialQuantity: progress.materialQuantity,
    breakthroughMaterialOwned: progress.materialOwned,
    breakthroughMaterialAvailable: progress.materialAvailable,
    durationMs: BREAKTHROUGH_EXECUTION_DURATION_MS,
  };
  if (realmCap) {
    return {
      allowed: false,
      reason: 'Actor has reached the cultivation cap.',
      metadata,
    };
  }
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
  if (!progress.ok) {
    return {
      allowed: false,
      reason: progress.reason,
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
  actorIncapacitated: boolean;
  targetIncapacitated: boolean;
  actorAtCurrentLocation: boolean;
  targetPresent?: boolean;
  giftOptions: unknown[];
  giftCooldown?: { resultCode: string; reason: string } | null;
  tradeOptions: unknown[];
  teachingReason?: string;
  activeEncounterId?: string;
  combatOpponentActorId?: string;
  lootEncounterId?: string;
  lootPriorityAllowed?: boolean;
  lootOptions?: { enabled: boolean }[];
}) {
  if (args.actorIncapacitated) return ACTOR_INCAPACITATED_REASON;
  if (args.type === 'loot') {
    if (!args.targetIncapacitated) return 'Loot target must be incapacitated.';
    if (!args.lootEncounterId) return 'Target was not defeated in a traceable encounter.';
    if (args.lootPriorityAllowed !== true) return 'Loot is protected for the encounter winner.';
    if (!(args.lootOptions ?? []).some((option) => option.enabled)) {
      return 'Target has no unreserved loot item.';
    }
  } else if (args.targetIncapacitated) return TARGET_INCAPACITATED_REASON;
  if (!args.actorAtCurrentLocation) {
    return 'Actor must formally arrive at the current location.';
  }
  if (args.targetPresent === false) {
    return 'Target is not at the current location.';
  }
  if (args.type !== 'loot' && !locationAllows(args.currentLocation, args.type)) {
    return `Current location does not allow ${args.type}.`;
  }
  if (
    args.type === 'attack' &&
    args.activeEncounterId &&
    args.combatOpponentActorId !== undefined
  ) {
    return 'Actor is already fighting another opponent.';
  }
  if (args.type === 'gift' && args.giftOptions.length === 0) {
    return 'No item is available to gift.';
  }
  if (args.type === 'gift' && args.giftCooldown) {
    return args.giftCooldown.reason;
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
  actorIncapacitated: boolean;
  actorAtCurrentLocation: boolean;
  fatigueReason?: string;
  breakthroughReason?: string;
}) {
  if (args.actorIncapacitated) return ACTOR_INCAPACITATED_REASON;
  if (args.type !== 'arrive' && !args.actorAtCurrentLocation) {
    return 'Actor must formally arrive at the current location.';
  }
  if (!locationAllows(args.location, args.type)) {
    return `Location does not allow ${args.type}.`;
  }
  if (args.fatigueReason) return args.fatigueReason;
  if (args.type === 'breakthrough' && args.breakthroughReason) {
    return args.breakthroughReason;
  }
  return undefined;
}

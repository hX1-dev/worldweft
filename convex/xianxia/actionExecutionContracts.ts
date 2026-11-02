import { type Infer, v } from 'convex/values';

export const ACTION_EXECUTION_PROTOCOL_VERSION = 1;
export const ACTION_EXECUTION_LEASE_MS = 60_000;
export const ACTION_EXECUTION_MAX_RUNTIME_MS = 120_000;
export const CULTIVATE_EXECUTION_DURATION_MS = 8_000;
export const GATHER_EXECUTION_DURATION_MS = 6_000;
export const REST_EXECUTION_DURATION_MS = 8_000;
export const BREAKTHROUGH_EXECUTION_DURATION_MS = 10_000;
export const ATTACK_EXECUTION_DURATION_MS = 4_000;
export const FLEE_EXECUTION_DURATION_MS = 3_000;
export const LOOT_EXECUTION_DURATION_MS = 3_000;
export const GIFT_EXECUTION_DURATION_MS = 2_000;
export const TRADE_EXECUTION_DURATION_MS = 3_000;
export const TEACHING_EXECUTION_DURATION_MS = 6_000;
export const REQUEST_DECLINE_EXECUTION_DURATION_MS = 1_000;

export const actionExecutionStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('acting'),
  v.literal('completed'),
  v.literal('interrupted'),
  v.literal('blocked'),
);

export const actionExecutionReportStatusValidator = v.union(
  v.literal('accepted'),
  v.literal('acting'),
  v.literal('completed'),
  v.literal('interrupted'),
  v.literal('blocked'),
);

export type ActionExecutionStatus = Infer<typeof actionExecutionStatusValidator>;
export type ActionExecutionReportStatus = Infer<typeof actionExecutionReportStatusValidator>;

export type ActionExecutionGoal = {
  protocolVersion: typeof ACTION_EXECUTION_PROTOCOL_VERSION;
  executionId: string;
  actionRecordId: string;
  revision: number;
  actorId: string;
  personalGoalId?: string;
  personalGoalRevision?: number;
  purposeIntentDigest?: string;
  actionType: string;
  status: ActionExecutionStatus;
  leaseOwner?: string;
  mapId?: string;
  locationId?: string;
  targetTile?: { x: number; y: number };
  targetActorId?: string;
  encounterId?: string;
  resourceNodeId?: string;
  reservedQuantity?: number;
  cultivationMode?: 'ambient' | 'spirit_stone' | 'qi_pill';
  reservedItemId?: string;
  reservedItemQuantity?: number;
  reservedTargetItemId?: string;
  reservedTargetItemQuantity?: number;
  tradeMode?: 'direct' | 'shop_buy' | 'shop_sell';
  shopId?: string;
  tradeItemId?: string;
  tradeItemQuantity?: number;
  tradeUnitPrice?: number;
  tradeTotalPrice?: number;
  reservedShopItemId?: string;
  reservedShopItemQuantity?: number;
  reservedShopWalletSpiritStones?: number;
  reservedShopCapacityItemId?: string;
  reservedShopCapacityQuantity?: number;
  teachingTopic?: 'cultivation_fundamentals';
  requestId?: string;
  requestRevision?: number;
  intent: string;
  durationMs: number;
  hardDeadlineAt: number;
  issuedAt: number;
  expiresAt: number;
};

export type ActionExecutionReport = {
  executionId: string;
  revision: number;
  actorId: string;
  executorId: string;
  status: ActionExecutionReportStatus;
  mapId?: string;
  positionTiles?: { x: number; y: number };
  reasonCode?: string;
  reportedAt: number;
};

export const ACTIVE_ACTION_EXECUTION_STATUSES = new Set<ActionExecutionStatus>([
  'pending',
  'accepted',
  'acting',
]);

export const TERMINAL_ACTION_EXECUTION_STATUSES = new Set<ActionExecutionStatus>([
  'completed',
  'interrupted',
  'blocked',
]);

export type ActionExecutionProtocolErrorCode =
  | 'execution_not_found'
  | 'execution_world_mismatch'
  | 'stale_revision'
  | 'execution_actor_mismatch'
  | 'lease_owner_mismatch'
  | 'invalid_execution_transition'
  | 'execution_terminal'
  | 'execution_not_ready'
  | 'execution_lease_expired'
  | 'execution_deadline_exceeded';

export type ActionExecutionProtocolFailure = {
  ok: false;
  code: ActionExecutionProtocolErrorCode;
  reason: string;
};

import { type Infer, v } from 'convex/values';

export const QINGLAN_VALLEY_GATE_MAP_ID = 'qinglan_valley_gate' as const;
export const MOVEMENT_LEASE_MS = 60_000;
// A cancellation only needs to outlive the longest client-side lease. A client
// that has been disconnected longer than this must already have stopped its
// local body because the original goal lease has expired.
export const MOVEMENT_CANCELLATION_RETENTION_MS = MOVEMENT_LEASE_MS;
export const MAX_POINT_TARGET_DISTANCE_TILES = 12;
export const POINT_TARGET_SNAP_RADIUS_TILES = 2;
export const MAX_REPORTED_SPEED_TILES_PER_SECOND = 10;
export const MAX_MOVEMENT_REPORT_CLOCK_SKEW_MS = 5_000;
export const ARRIVAL_TOLERANCE_TILES = 0.25;

export const tilePointValidator = v.object({ x: v.number(), y: v.number() });

export const movementTargetValidator = v.union(
  v.object({ kind: v.literal('location'), locationId: v.string() }),
  v.object({ kind: v.literal('zone'), zoneId: v.string() }),
  v.object({
    kind: v.literal('actor'),
    actorId: v.string(),
    preferredDistanceTiles: v.optional(v.number()),
  }),
  v.object({ kind: v.literal('interactable'), interactionId: v.string() }),
  v.object({ kind: v.literal('point'), tile: tilePointValidator }),
);

export const movementDecisionSourceValidator = v.union(
  v.literal('llm'),
  v.literal('event'),
  v.literal('utility'),
  v.literal('test'),
);

export const movementCommandStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('moving'),
  v.literal('arrived'),
  v.literal('blocked'),
  v.literal('cancelled'),
  v.literal('expired'),
);

export const movementReportStatusValidator = v.union(
  v.literal('accepted'),
  v.literal('moving'),
  v.literal('arrived'),
  v.literal('blocked'),
  v.literal('cancelled'),
);

export type TilePoint = Infer<typeof tilePointValidator>;
export type MovementTarget = Infer<typeof movementTargetValidator>;
export type MovementDecisionSource = Infer<typeof movementDecisionSourceValidator>;
export type MovementCommandStatus = Infer<typeof movementCommandStatusValidator>;
export type MovementReportStatus = Infer<typeof movementReportStatusValidator>;

export type MovementGoal = {
  commandId: string;
  actionRecordId: string;
  revision: number;
  actorId: string;
  personalGoalId?: string;
  personalGoalRevision?: number;
  purposeIntentDigest?: string;
  mapId: typeof QINGLAN_VALLEY_GATE_MAP_ID;
  intent: string;
  decisionSource: MovementDecisionSource;
  requestedTarget: MovementTarget;
  acceptedTile: TilePoint;
  issuedAt: number;
  expiresAt: number;
};

export type MovementReport = {
  commandId: string;
  revision: number;
  actorId: string;
  status: MovementReportStatus;
  positionTiles: TilePoint;
  reasonCode?: string;
  reportedAt: number;
};

/**
 * Explicit server-to-Godot terminal directive. Goals disappearing from a poll
 * is not sufficient: the body may already be following the last accepted
 * route, so the matching command/revision must be halted deliberately.
 */
export type MovementCancellation = {
  commandId: string;
  revision: number;
  actorId: string;
  mapId: typeof QINGLAN_VALLEY_GATE_MAP_ID;
  reasonCode: string;
  cancelledAt: number;
};

export type MovementProtocolErrorCode =
  | 'command_not_found'
  | 'command_expired'
  | 'command_terminal'
  | 'stale_revision'
  | 'actor_mismatch'
  | 'invalid_transition'
  | 'invalid_position'
  | 'invalid_segment'
  | 'invalid_report_time'
  | 'speed_exceeded'
  | 'not_at_destination'
  | 'resident_not_found'
  | 'actor_profile_not_found'
  | 'actor_deceased'
  | 'actor_incapacitated';

export type MovementProtocolFailure = {
  ok: false;
  code: MovementProtocolErrorCode;
  reason: string;
};

export const ACTIVE_MOVEMENT_STATUSES = new Set<MovementCommandStatus>([
  'pending',
  'accepted',
  'moving',
]);

export const TERMINAL_MOVEMENT_STATUSES = new Set<MovementCommandStatus>([
  'arrived',
  'blocked',
  'cancelled',
  'expired',
]);

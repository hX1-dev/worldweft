import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';
import {
  socialOpportunityCandidateDigest,
  socialWarrantDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';

export const SOCIAL_INVITATION_VERSION = 'taixu.social-invitation.v1' as const;
export const SOCIAL_INVITATION_CAPACITY = 2 as const;
export const SOCIAL_INVITATION_TTL_MS = 5 * 60_000;
export const SOCIAL_INVITATION_COOLDOWN_MS = 30 * 60_000;

export const socialInvitationStatusValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('declined'),
  v.literal('expired'),
  v.literal('cancelled'),
);

export const socialInvitationActivityValidator = v.union(
  v.literal('talk'),
  v.literal('gift'),
  v.literal('trade'),
  v.literal('teach'),
  v.literal('negotiate'),
);

export const socialInvitationReceiptValidator = v.object({
  contractVersion: v.literal(SOCIAL_INVITATION_VERSION),
  invitationId: v.string(),
  revision: v.number(),
  actorId: v.string(),
  targetActorId: v.string(),
  warrantId: v.string(),
  warrantDigest: v.string(),
  sourceRef: v.string(),
  sourceRevision: v.string(),
  candidateId: v.string(),
  candidateDigest: v.string(),
  intendedActivity: socialInvitationActivityValidator,
  meetingMapId: v.string(),
  meetingLocationId: v.string(),
  reservedCapacity: v.literal(SOCIAL_INVITATION_CAPACITY),
  status: socialInvitationStatusValidator,
  createdAt: v.number(),
  respondedAt: v.optional(v.number()),
  expiresAt: v.number(),
  terminalAt: v.optional(v.number()),
  terminalReasonCode: v.optional(v.string()),
  personalGoalId: v.optional(v.string()),
  conversationId: v.optional(v.string()),
});

export type SocialInvitationStatus = Infer<typeof socialInvitationStatusValidator>;
export type SocialInvitationActivity = Infer<typeof socialInvitationActivityValidator>;
export type SocialInvitationReceipt = Infer<typeof socialInvitationReceiptValidator>;

export type SocialInvitationReasonCode =
  | 'social_invitation_not_found'
  | 'social_invitation_stale_revision'
  | 'social_invitation_not_pending'
  | 'social_invitation_expired'
  | 'social_invitation_declined'
  | 'social_invitation_cancelled'
  | 'social_invitation_cooldown_active'
  | 'social_invitation_source_stale'
  | 'social_invitation_target_moved'
  | 'social_invitation_target_busy'
  | 'social_invitation_target_unavailable'
  | 'social_invitation_meeting_unavailable'
  | 'social_invitation_capacity_full'
  | 'social_invitation_lease_expired'
  | 'social_invitation_movement_blocked'
  | 'social_invitation_movement_cancelled'
  | 'social_invitation_session_failed'
  | 'social_invitation_terminal_replay';

export type SocialMeetingLocation = {
  locationId: string;
  mapId: string;
  dangerLevel: number;
  allowedActions: string[];
  capacity: number;
  occupiedCapacity: number;
};

export type SocialInvitationValidation =
  | { ok: true; receipt: SocialInvitationReceipt; digest: string }
  | { ok: false; reasonCode: string };

const RECEIPT_KEYS = new Set([
  'contractVersion',
  'invitationId',
  'revision',
  'actorId',
  'targetActorId',
  'warrantId',
  'warrantDigest',
  'sourceRef',
  'sourceRevision',
  'candidateId',
  'candidateDigest',
  'intendedActivity',
  'meetingMapId',
  'meetingLocationId',
  'reservedCapacity',
  'status',
  'createdAt',
  'respondedAt',
  'expiresAt',
  'terminalAt',
  'terminalReasonCode',
  'personalGoalId',
  'conversationId',
]);

const STATUSES = new Set<SocialInvitationStatus>([
  'pending',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);
const ACTIVITIES = new Set<SocialInvitationActivity>([
  'talk',
  'gift',
  'trade',
  'teach',
  'negotiate',
]);

export function validateSocialInvitationReceipt(input: unknown): SocialInvitationValidation {
  if (!record(input)) return failure('social_invitation_not_object');
  if (input.contractVersion !== SOCIAL_INVITATION_VERSION) {
    return failure('social_invitation_unsupported_version');
  }
  if (Object.keys(input).some((key) => !RECEIPT_KEYS.has(key))) {
    return failure('social_invitation_unknown_field');
  }
  for (const key of [
    'invitationId',
    'actorId',
    'targetActorId',
    'warrantId',
    'warrantDigest',
    'sourceRef',
    'sourceRevision',
    'candidateId',
    'candidateDigest',
    'meetingMapId',
    'meetingLocationId',
  ] as const) {
    if (!identifier(input[key], key.includes('Digest') ? 96 : 256)) {
      return failure('social_invitation_identifier_invalid');
    }
  }
  if (input.actorId === input.targetActorId) return failure('social_invitation_self_target');
  if (!positiveInteger(input.revision)) return failure('social_invitation_revision_invalid');
  if (!STATUSES.has(input.status as SocialInvitationStatus)) {
    return failure('social_invitation_status_invalid');
  }
  if (!ACTIVITIES.has(input.intendedActivity as SocialInvitationActivity)) {
    return failure('social_invitation_activity_invalid');
  }
  if (input.reservedCapacity !== SOCIAL_INVITATION_CAPACITY) {
    return failure('social_invitation_capacity_invalid');
  }
  if (
    !nonnegativeInteger(input.createdAt) ||
    !nonnegativeInteger(input.expiresAt) ||
    input.expiresAt <= input.createdAt ||
    !optionalNonnegativeInteger(input.respondedAt) ||
    !optionalNonnegativeInteger(input.terminalAt)
  ) {
    return failure('social_invitation_time_invalid');
  }
  const terminal = ['declined', 'expired', 'cancelled'].includes(input.status as string);
  if (
    (terminal && (!nonnegativeInteger(input.terminalAt) || !boundedString(input.terminalReasonCode, 240))) ||
    (!terminal && (input.terminalAt !== undefined || input.terminalReasonCode !== undefined)) ||
    (input.status === 'accepted' && !nonnegativeInteger(input.respondedAt)) ||
    (input.status === 'pending' && input.respondedAt !== undefined)
  ) {
    return failure('social_invitation_terminal_shape_invalid');
  }
  if (!optionalIdentifier(input.personalGoalId, 256) || !optionalIdentifier(input.conversationId, 256)) {
    return failure('social_invitation_link_invalid');
  }
  const receipt = clone(input as SocialInvitationReceipt);
  return { ok: true, receipt, digest: socialInvitationDigest(receipt) };
}

export function createSocialInvitationReceipt(input: {
  invitationId: string;
  actorId: string;
  targetActorId: string;
  warrant: SocialWarrant;
  candidate: SocialOpportunityCandidate;
  meetingMapId: string;
  meetingLocationId: string;
  now: number;
  expiresAt?: number;
}): SocialInvitationReceipt {
  const warrant = validateSocialWarrant(input.warrant);
  const candidate = validateSocialOpportunityCandidate(input.candidate, input.warrant);
  if (!warrant.ok || !candidate.ok) throw new Error('social_invitation_warrant_candidate_invalid');
  if (
    warrant.warrant.actorId !== input.actorId ||
    candidate.candidate.mode !== 'invite_then_travel' ||
    candidate.candidate.targetActorIds.length !== 1 ||
    candidate.candidate.targetActorIds[0] !== input.targetActorId ||
    candidate.candidate.meetingLocationId !== input.meetingLocationId ||
    !ACTIVITIES.has(candidate.candidate.intendedActivity as SocialInvitationActivity)
  ) {
    throw new Error('social_invitation_warrant_candidate_mismatch');
  }
  const receipt: SocialInvitationReceipt = {
    contractVersion: SOCIAL_INVITATION_VERSION,
    invitationId: input.invitationId,
    revision: 1,
    actorId: input.actorId,
    targetActorId: input.targetActorId,
    warrantId: warrant.warrant.warrantId,
    warrantDigest: socialWarrantDigest(warrant.warrant),
    sourceRef: warrant.warrant.sourceRef,
    sourceRevision: warrant.warrant.sourceRevision,
    candidateId: candidate.candidate.candidateId,
    candidateDigest: socialOpportunityCandidateDigest(candidate.candidate),
    intendedActivity: candidate.candidate.intendedActivity as SocialInvitationActivity,
    meetingMapId: input.meetingMapId,
    meetingLocationId: input.meetingLocationId,
    reservedCapacity: SOCIAL_INVITATION_CAPACITY,
    status: 'pending',
    createdAt: input.now,
    expiresAt: input.expiresAt ?? input.now + SOCIAL_INVITATION_TTL_MS,
  };
  const validation = validateSocialInvitationReceipt(receipt);
  if (!validation.ok) throw new Error(validation.reasonCode);
  return validation.receipt;
}

export function transitionSocialInvitation(input: {
  receipt: SocialInvitationReceipt;
  expectedRevision: number;
  operation: 'accept' | 'decline' | 'cancel' | 'expire';
  now: number;
  capacityAvailable?: boolean;
  reasonCode?: SocialInvitationReasonCode;
}):
  | { ok: true; receipt: SocialInvitationReceipt; replay: boolean }
  | { ok: false; reasonCode: SocialInvitationReasonCode } {
  const validation = validateSocialInvitationReceipt(input.receipt);
  if (!validation.ok) throw new Error(validation.reasonCode);
  const current = validation.receipt;
  if (current.revision !== input.expectedRevision) {
    return { ok: false, reasonCode: 'social_invitation_stale_revision' };
  }
  const requestedStatus = operationStatus(input.operation);
  if (current.status === requestedStatus) return { ok: true, receipt: current, replay: true };
  const acceptedCancellation = current.status === 'accepted' && input.operation === 'cancel';
  if (current.status !== 'pending' && !acceptedCancellation) {
    return { ok: false, reasonCode: terminalReason(current.status) };
  }
  if (input.now >= current.expiresAt && input.operation !== 'expire' && !acceptedCancellation) {
    return { ok: false, reasonCode: 'social_invitation_expired' };
  }
  if (input.operation === 'accept' && input.capacityAvailable !== true) {
    return { ok: false, reasonCode: 'social_invitation_capacity_full' };
  }
  const terminal = requestedStatus !== 'accepted';
  const nextTerminalReason = requestedStatus === 'declined'
    ? 'social_invitation_declined'
    : requestedStatus === 'expired'
      ? 'social_invitation_expired'
      : 'social_invitation_cancelled';
  const next: SocialInvitationReceipt = {
    ...current,
    revision: current.revision + 1,
    status: requestedStatus,
    respondedAt:
      input.operation === 'accept' || input.operation === 'decline'
        ? input.now
        : current.respondedAt,
    terminalAt: terminal ? input.now : undefined,
    terminalReasonCode: terminal
      ? (input.reasonCode ?? nextTerminalReason)
      : undefined,
  };
  return { ok: true, receipt: next, replay: false };
}

export function selectSocialMeetingLocation(input: {
  mapId: string;
  actorLocationId?: string;
  targetLocationId?: string;
  intendedActivity: SocialInvitationActivity;
  locations: readonly SocialMeetingLocation[];
}): SocialMeetingLocation | undefined {
  const requiredAction = input.intendedActivity === 'teach'
    ? 'request_teaching'
    : input.intendedActivity;
  return [...input.locations]
    .filter(
      (location) =>
        location.mapId === input.mapId &&
        Number.isFinite(location.dangerLevel) &&
        location.dangerLevel <= 1 &&
        location.allowedActions.includes(requiredAction) &&
        Number.isSafeInteger(location.capacity) &&
        Number.isSafeInteger(location.occupiedCapacity) &&
        location.capacity - location.occupiedCapacity >= SOCIAL_INVITATION_CAPACITY,
    )
    .sort(
      (left, right) =>
        Number(right.locationId === input.targetLocationId) -
          Number(left.locationId === input.targetLocationId) ||
        Number(right.locationId === input.actorLocationId) -
          Number(left.locationId === input.actorLocationId) ||
        left.dangerLevel - right.dangerLevel ||
        compare(left.locationId, right.locationId),
    )[0];
}

export function socialMeetingCapacity(input: {
  entryPointCount: number;
  bounds?: { x1: number; y1: number; x2: number; y2: number };
}) {
  const boundedArea = input.bounds
    ? Math.max(0, Math.floor(input.bounds.x2 - input.bounds.x1 + 1)) *
      Math.max(0, Math.floor(input.bounds.y2 - input.bounds.y1 + 1))
    : 0;
  return Math.max(0, Math.min(64, Math.max(Math.floor(input.entryPointCount), boundedArea)));
}

export function socialInvitationDigest(receipt: SocialInvitationReceipt) {
  return stableObservationDigest(receipt);
}

export function socialInvitationKey(input: {
  actorId: string;
  targetActorId: string;
  warrantId: string;
}) {
  return `${input.actorId}|${input.targetActorId}|${input.warrantId}`;
}

function operationStatus(operation: 'accept' | 'decline' | 'cancel' | 'expire'): SocialInvitationStatus {
  if (operation === 'accept') return 'accepted';
  if (operation === 'decline') return 'declined';
  if (operation === 'expire') return 'expired';
  return 'cancelled';
}

function terminalReason(status: SocialInvitationStatus): SocialInvitationReasonCode {
  if (status === 'declined') return 'social_invitation_declined';
  if (status === 'expired') return 'social_invitation_expired';
  if (status === 'cancelled') return 'social_invitation_cancelled';
  return 'social_invitation_not_pending';
}

function failure(reasonCode: string): SocialInvitationValidation {
  return { ok: false, reasonCode };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function identifier(value: unknown, max: number): value is string {
  return boundedString(value, max) && !/\s/u.test(value);
}

function optionalIdentifier(value: unknown, max: number) {
  return value === undefined || identifier(value, max);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}

function optionalNonnegativeInteger(value: unknown) {
  return value === undefined || nonnegativeInteger(value);
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

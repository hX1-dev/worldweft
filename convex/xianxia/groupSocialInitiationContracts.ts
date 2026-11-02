import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';
import {
  socialOpportunityCandidateDigest,
  socialWarrantDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
} from './socialWarrantContracts';
import type {
  GroupSocialOpportunity,
  GroupSocialParticipantRole,
  GroupSocialSourceKind,
} from './groupSocialOpportunityLogic';

export const GROUP_SOCIAL_INITIATION_VERSION = 'taixu.group-social-initiation.v1' as const;
export const GROUP_SOCIAL_INITIATION_TTL_MS = 5 * 60_000;
export const GROUP_SOCIAL_INITIATION_COOLDOWN_MS = 30 * 60_000;

export const groupSocialSourceKindValidator = v.union(
  v.literal('shared_request'),
  v.literal('shared_event'),
  v.literal('resource_dispute'),
  v.literal('duty_meeting'),
);

export const groupSocialParticipantRoleValidator = v.union(
  v.literal('decision_owner'),
  v.literal('affected_party'),
  v.literal('witness'),
  v.literal('expert'),
  v.literal('mediator'),
);

export const groupSocialInitiationStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('started'),
  v.literal('declined'),
  v.literal('expired'),
  v.literal('cancelled'),
);

export const groupSocialResponseValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('declined'),
);

export const groupSocialParticipantRoleEntryValidator = v.object({
  actorId: v.string(),
  role: groupSocialParticipantRoleValidator,
});

export const groupSocialInitiationReceiptValidator = v.object({
  contractVersion: v.literal(GROUP_SOCIAL_INITIATION_VERSION),
  initiationId: v.string(),
  revision: v.number(),
  hostActorId: v.string(),
  sourceKind: groupSocialSourceKindValidator,
  sourceRef: v.string(),
  sourceRevision: v.string(),
  warrantId: v.string(),
  warrantDigest: v.string(),
  candidateId: v.string(),
  candidateDigest: v.string(),
  topicRefs: v.array(v.string()),
  audience: v.union(v.literal('participants'), v.literal('local_public')),
  meetingMapId: v.string(),
  meetingLocationId: v.string(),
  participantActorIds: v.array(v.string()),
  participantRoles: v.array(groupSocialParticipantRoleEntryValidator),
  observerActorIds: v.array(v.string()),
  status: groupSocialInitiationStatusValidator,
  createdAt: v.number(),
  expiresAt: v.number(),
  terminalAt: v.optional(v.number()),
  terminalReasonCode: v.optional(v.string()),
  groupConversationId: v.optional(v.string()),
});

export type GroupSocialInitiationStatus = Infer<typeof groupSocialInitiationStatusValidator>;
export type GroupSocialResponse = Infer<typeof groupSocialResponseValidator>;
export type GroupSocialInitiationReceipt = Infer<typeof groupSocialInitiationReceiptValidator>;
export type GroupSocialInitiationMember = {
  actorId: string;
  role: GroupSocialParticipantRole;
  response: GroupSocialResponse;
  respondedAt?: number;
};

export function groupSocialWarrantCandidateBindingDigest(input: {
  warrantDigest: string;
  candidateDigest: string;
}) {
  return stableObservationDigest({
    warrantDigest: input.warrantDigest,
    candidateDigest: input.candidateDigest,
  });
}

export type GroupSocialInitiationReasonCode =
  | 'group_social_source_missing'
  | 'group_social_source_stale'
  | 'group_social_actor_unavailable'
  | 'group_social_participant_count_invalid'
  | 'group_social_participant_irrelevant'
  | 'group_social_role_invalid'
  | 'group_social_topic_not_shared'
  | 'group_social_privacy_forbidden'
  | 'group_social_location_invalid'
  | 'group_social_capacity_full'
  | 'group_social_participant_busy'
  | 'group_social_participant_moved'
  | 'group_social_invitation_not_found'
  | 'group_social_stale_revision'
  | 'group_social_invitation_expired'
  | 'group_social_invitation_declined'
  | 'group_social_not_ready'
  | 'group_social_terminal_replay'
  | 'group_social_session_conflict';

const RECEIPT_KEYS = new Set([
  'contractVersion', 'initiationId', 'revision', 'hostActorId', 'sourceKind',
  'sourceRef', 'sourceRevision', 'warrantId', 'warrantDigest', 'candidateId',
  'candidateDigest', 'topicRefs', 'audience', 'meetingMapId', 'meetingLocationId',
  'participantActorIds', 'participantRoles', 'observerActorIds', 'status',
  'createdAt', 'expiresAt', 'terminalAt', 'terminalReasonCode', 'groupConversationId',
]);
const SOURCE_KINDS = new Set<GroupSocialSourceKind>([
  'shared_request', 'shared_event', 'resource_dispute', 'duty_meeting',
]);
const ROLES = new Set<GroupSocialParticipantRole>([
  'decision_owner', 'affected_party', 'witness', 'expert', 'mediator',
]);
const STATUSES = new Set<GroupSocialInitiationStatus>([
  'pending', 'ready', 'started', 'declined', 'expired', 'cancelled',
]);

export function validateGroupSocialInitiationReceipt(input: unknown):
  | { ok: true; receipt: GroupSocialInitiationReceipt; digest: string }
  | { ok: false; reasonCode: string } {
  if (!record(input)) return failure('group_social_receipt_not_object');
  if (input.contractVersion !== GROUP_SOCIAL_INITIATION_VERSION) {
    return failure('group_social_receipt_unsupported_version');
  }
  if (Object.keys(input).some((key) => !RECEIPT_KEYS.has(key))) {
    return failure('group_social_receipt_unknown_field');
  }
  for (const key of [
    'initiationId', 'hostActorId', 'sourceRef', 'sourceRevision', 'warrantId',
    'warrantDigest', 'candidateId', 'candidateDigest', 'meetingMapId', 'meetingLocationId',
  ] as const) {
    if (!identifier(input[key], key.includes('Digest') ? 96 : 256)) {
      return failure('group_social_receipt_identifier_invalid');
    }
  }
  if (!positiveInteger(input.revision)) return failure('group_social_receipt_revision_invalid');
  if (!SOURCE_KINDS.has(input.sourceKind as GroupSocialSourceKind)) {
    return failure('group_social_source_kind_invalid');
  }
  if (!STATUSES.has(input.status as GroupSocialInitiationStatus)) {
    return failure('group_social_receipt_status_invalid');
  }
  if (!['participants', 'local_public'].includes(input.audience as string)) {
    return failure('group_social_receipt_audience_invalid');
  }
  const participants = stringSet(input.participantActorIds, 3, 5);
  const topics = stringSet(input.topicRefs, 1, 12, true);
  const observers = stringSet(input.observerActorIds, 0, 8);
  if (!participants || !topics || !observers || !participants.includes(input.hostActorId as string)) {
    return failure('group_social_participant_count_invalid');
  }
  if (input.audience === 'participants' && observers.length > 0) {
    return failure('group_social_privacy_forbidden');
  }
  if (observers.some((actorId) => participants.includes(actorId))) {
    return failure('group_social_role_invalid');
  }
  if (!Array.isArray(input.participantRoles) || input.participantRoles.length !== participants.length) {
    return failure('group_social_role_invalid');
  }
  const roles = input.participantRoles as Array<Record<string, unknown>>;
  if (roles.some((entry) =>
    !record(entry) ||
    Object.keys(entry).some((key) => !['actorId', 'role'].includes(key)) ||
    !identifier(entry.actorId, 192) ||
    !ROLES.has(entry.role as GroupSocialParticipantRole)
  )) return failure('group_social_role_invalid');
  const normalizedRoles = roles
    .map((entry) => ({ actorId: entry.actorId as string, role: entry.role as GroupSocialParticipantRole }))
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (
    new Set(normalizedRoles.map((entry) => entry.actorId)).size !== participants.length ||
    normalizedRoles.some((entry, index) => entry.actorId !== participants[index]) ||
    !normalizedRoles.some((entry) => entry.role === 'decision_owner') ||
    !normalizedRoles.some((entry) => entry.role === 'affected_party')
  ) return failure('group_social_role_invalid');
  if (
    !nonnegativeInteger(input.createdAt) || !nonnegativeInteger(input.expiresAt) ||
    (input.expiresAt as number) <= (input.createdAt as number) ||
    !optionalNonnegativeInteger(input.terminalAt) ||
    !optionalIdentifier(input.groupConversationId, 256)
  ) return failure('group_social_receipt_time_invalid');
  const status = input.status as GroupSocialInitiationStatus;
  const terminal = ['started', 'declined', 'expired', 'cancelled'].includes(status);
  if (
    (terminal && (!nonnegativeInteger(input.terminalAt) || !boundedString(input.terminalReasonCode, 240))) ||
    (!terminal && (input.terminalAt !== undefined || input.terminalReasonCode !== undefined)) ||
    (status === 'started' && !identifier(input.groupConversationId, 256)) ||
    (status !== 'started' && input.groupConversationId !== undefined)
  ) return failure('group_social_receipt_terminal_shape_invalid');
  const receipt = clone({
    ...(input as GroupSocialInitiationReceipt),
    participantActorIds: participants,
    participantRoles: normalizedRoles,
    observerActorIds: observers,
    topicRefs: topics,
  });
  return { ok: true, receipt, digest: groupSocialInitiationDigest(receipt) };
}

export function createGroupSocialInitiationReceipt(input: {
  opportunity: GroupSocialOpportunity;
  meetingMapId: string;
  now: number;
  expiresAt?: number;
}): { receipt: GroupSocialInitiationReceipt; members: GroupSocialInitiationMember[] } {
  const warrant = validateSocialWarrant(input.opportunity.warrant);
  const candidate = validateSocialOpportunityCandidate(
    input.opportunity.candidate,
    input.opportunity.warrant,
  );
  if (!warrant.ok || !candidate.ok) throw new Error('group_social_warrant_candidate_invalid');
  const participantActorIds = [warrant.warrant.actorId, ...candidate.candidate.targetActorIds].sort();
  const identity = stableObservationDigest({
    warrantDigest: socialWarrantDigest(warrant.warrant),
    candidateDigest: socialOpportunityCandidateDigest(candidate.candidate),
    participantActorIds,
  }).slice('stable64:'.length);
  const receipt: GroupSocialInitiationReceipt = {
    contractVersion: GROUP_SOCIAL_INITIATION_VERSION,
    initiationId: `group_social_initiation:${identity}`,
    revision: 1,
    hostActorId: warrant.warrant.actorId,
    sourceKind: input.opportunity.sourceKind,
    sourceRef: warrant.warrant.sourceRef,
    sourceRevision: warrant.warrant.sourceRevision,
    warrantId: warrant.warrant.warrantId,
    warrantDigest: socialWarrantDigest(warrant.warrant),
    candidateId: candidate.candidate.candidateId,
    candidateDigest: socialOpportunityCandidateDigest(candidate.candidate),
    topicRefs: [...warrant.warrant.topicRefs],
    audience: warrant.warrant.audience as 'participants' | 'local_public',
    meetingMapId: input.meetingMapId,
    meetingLocationId: candidate.candidate.meetingLocationId!,
    participantActorIds,
    participantRoles: [...input.opportunity.participantRoles],
    observerActorIds: [...input.opportunity.observerActorIds],
    status: 'pending',
    createdAt: input.now,
    expiresAt: input.expiresAt ?? input.now + GROUP_SOCIAL_INITIATION_TTL_MS,
  };
  const validation = validateGroupSocialInitiationReceipt(receipt);
  if (!validation.ok) throw new Error(validation.reasonCode);
  return {
    receipt: validation.receipt,
    members: validation.receipt.participantRoles.map((entry) => ({
      ...entry,
      response: entry.actorId === validation.receipt.hostActorId ? 'accepted' : 'pending',
      respondedAt: entry.actorId === validation.receipt.hostActorId ? input.now : undefined,
    })),
  };
}

export function transitionGroupSocialResponse(input: {
  receipt: GroupSocialInitiationReceipt;
  members: GroupSocialInitiationMember[];
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  now: number;
}):
  | { ok: true; receipt: GroupSocialInitiationReceipt; members: GroupSocialInitiationMember[]; replay: boolean }
  | { ok: false; reasonCode: GroupSocialInitiationReasonCode } {
  const validated = validateGroupSocialInitiationReceipt(input.receipt);
  if (!validated.ok) throw new Error(validated.reasonCode);
  const receipt = validated.receipt;
  if (receipt.revision !== input.expectedRevision) return fail('group_social_stale_revision');
  if (input.now >= receipt.expiresAt) return fail('group_social_invitation_expired');
  if (receipt.status === 'declined') return fail('group_social_invitation_declined');
  if (['started', 'expired', 'cancelled'].includes(receipt.status)) {
    return fail('group_social_terminal_replay');
  }
  const current = input.members.find((entry) => entry.actorId === input.actorId);
  if (!current || input.actorId === receipt.hostActorId) return fail('group_social_participant_irrelevant');
  const requested: GroupSocialResponse = input.response === 'accept' ? 'accepted' : 'declined';
  if (current.response === requested) {
    return { ok: true, receipt, members: clone(input.members), replay: true };
  }
  if (current.response !== 'pending') return fail('group_social_terminal_replay');
  const members = input.members.map((entry) =>
    entry.actorId === input.actorId
      ? { ...entry, response: requested, respondedAt: input.now }
      : { ...entry },
  );
  const declined = requested === 'declined';
  const ready = !declined && members.every((entry) => entry.response === 'accepted');
  const next: GroupSocialInitiationReceipt = {
    ...receipt,
    revision: receipt.revision + 1,
    status: declined ? 'declined' : ready ? 'ready' : 'pending',
    terminalAt: declined ? input.now : undefined,
    terminalReasonCode: declined ? 'group_social_invitation_declined' : undefined,
  };
  return { ok: true, receipt: next, members, replay: false };
}

export function startGroupSocialInitiation(input: {
  receipt: GroupSocialInitiationReceipt;
  members: GroupSocialInitiationMember[];
  actorId: string;
  expectedRevision: number;
  groupConversationId: string;
  now: number;
}):
  | { ok: true; receipt: GroupSocialInitiationReceipt; replay: boolean }
  | { ok: false; reasonCode: GroupSocialInitiationReasonCode } {
  const validated = validateGroupSocialInitiationReceipt(input.receipt);
  if (!validated.ok) throw new Error(validated.reasonCode);
  const receipt = validated.receipt;
  if (receipt.revision !== input.expectedRevision) return fail('group_social_stale_revision');
  if (receipt.status === 'started') {
    return receipt.groupConversationId === input.groupConversationId
      ? { ok: true, receipt, replay: true }
      : fail('group_social_terminal_replay');
  }
  if (input.now >= receipt.expiresAt) return fail('group_social_invitation_expired');
  if (receipt.status === 'declined') return fail('group_social_invitation_declined');
  if (receipt.status !== 'ready' || input.actorId !== receipt.hostActorId ||
    !input.members.every((entry) => entry.response === 'accepted')) {
    return fail('group_social_not_ready');
  }
  return {
    ok: true,
    replay: false,
    receipt: {
      ...receipt,
      revision: receipt.revision + 1,
      status: 'started',
      terminalAt: input.now,
      terminalReasonCode: 'group_social_session_started',
      groupConversationId: input.groupConversationId,
    },
  };
}

export function terminalizeGroupSocialInitiation(input: {
  receipt: GroupSocialInitiationReceipt;
  expectedRevision: number;
  status: 'expired' | 'cancelled';
  reasonCode: GroupSocialInitiationReasonCode;
  now: number;
}) {
  const validated = validateGroupSocialInitiationReceipt(input.receipt);
  if (!validated.ok) throw new Error(validated.reasonCode);
  if (validated.receipt.revision !== input.expectedRevision) return fail('group_social_stale_revision');
  if (['started', 'declined', 'expired', 'cancelled'].includes(validated.receipt.status)) {
    return { ok: true as const, receipt: validated.receipt, replay: true };
  }
  return {
    ok: true as const,
    replay: false,
    receipt: {
      ...validated.receipt,
      revision: validated.receipt.revision + 1,
      status: input.status,
      terminalAt: input.now,
      terminalReasonCode: input.reasonCode,
    } satisfies GroupSocialInitiationReceipt,
  };
}

export function groupSocialInitiationDigest(receipt: GroupSocialInitiationReceipt) {
  return stableObservationDigest({
    ...receipt,
    participantActorIds: [...receipt.participantActorIds].sort(),
    participantRoles: [...receipt.participantRoles].sort((a, b) => a.actorId.localeCompare(b.actorId)),
    observerActorIds: [...receipt.observerActorIds].sort(),
    topicRefs: [...receipt.topicRefs].sort(),
  });
}

function stringSet(value: unknown, minimum: number, maximum: number, reference = false) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum ||
    value.some((entry) => !identifier(entry, 256) || (reference && !String(entry).includes(':'))) ||
    new Set(value).size !== value.length) return undefined;
  return value.map((entry) => String(entry)).sort();
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function identifier(value: unknown, maximum: number): value is string {
  return boundedString(value, maximum) && !/\s/u.test(value);
}

function optionalIdentifier(value: unknown, maximum: number) {
  return value === undefined || identifier(value, maximum);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonnegativeInteger(value: unknown) {
  return value === undefined || nonnegativeInteger(value);
}

function failure(reasonCode: string) {
  return { ok: false as const, reasonCode };
}

function fail(reasonCode: GroupSocialInitiationReasonCode) {
  return { ok: false as const, reasonCode };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

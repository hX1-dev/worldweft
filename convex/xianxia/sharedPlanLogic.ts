import { stableObservationDigest } from './lifeObservation';
import {
  isValidLifeSocialReview,
  type LifeSocialReviewReceipt,
  type LifeSocialReviewSource,
} from './lifeSocialReviewLogic';
import {
  PURPOSE_BOUND_LIFE_INTENT_VERSION,
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';
import {
  SHARED_PLAN_VERSION,
  type SharedPlanParticipant,
  type SharedPlanStatus,
} from './sharedPlanContracts';
import {
  GUARD_HANDOFF_VERSION,
  guardHandoffFactsDigest,
  withGuardHandoffPlanDigest,
  type GuardHandoffFacts,
  type GuardHandoffPlan,
} from './guardHandoffContracts';
import {
  buildGuardHandoffProposal,
  scheduleGuardHandoffPlan,
  type GuardHandoffProposalInput,
} from './guardHandoffLogic';
import { TEACHING_EXECUTION_TOPIC, type TeachingTopic } from './teachingLogic';

export const MAX_SHARED_PLAN_PARTICIPANTS = 2 as const;
export const MAX_SHARED_PLANS_PER_TICK = 2 as const;
export const MAX_SHARED_PLAN_RECONCILE = 8 as const;
export const SHARED_PLAN_TTL_GAME_HOURS = 24 as const;

export type SharedPlanAgentProposal = {
  type: 'travel' | 'gather' | 'request_teaching' | 'rest';
  targetId?: string;
  locationId?: string;
  params: Record<string, unknown>;
  intent: string;
  source: 'agent';
};

export type SharedGatherPlanReceipt = {
  contractVersion: typeof SHARED_PLAN_VERSION;
  planId: string;
  planKey: string;
  revision: number;
  kind: 'shared_gather';
  status: SharedPlanStatus;
  proposerActorId: string;
  inviteeActorId: string;
  sourceReviewId: string;
  sourceReviewDigest: string;
  sourceWindowId: string;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  sourceCommitmentId: string;
  resourceNodeId: string;
  resourceNodeRevision: string;
  mapId: string;
  locationId: string;
  itemId: string;
  participants: SharedPlanParticipant[];
  scheduleRevision?: number;
  scheduleDigest?: string;
  expiresGameHour: number;
  terminalGameHour?: number;
  terminalReasonCode?: string;
  providerCalls: 0;
  createdWorldActions: 0;
  createdAt: number;
  updatedAt: number;
  planDigest: string;
};

export type SharedGuardHandoffPlanReceipt = {
  contractVersion: typeof SHARED_PLAN_VERSION;
  planId: string;
  planKey: string;
  revision: number;
  kind: 'guard_handoff';
  status: SharedPlanStatus;
  proposerActorId: string;
  inviteeActorId: string;
  sourceReviewId: string;
  sourceReviewDigest: string;
  sourceWindowId: string;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  sourceCommitmentId: string;
  mapId: string;
  locationId: string;
  handoffFacts: GuardHandoffFacts;
  handoffFactsDigest: string;
  participants: SharedPlanParticipant[];
  scheduleRevision?: number;
  scheduleDigest?: string;
  expiresGameHour: number;
  terminalGameHour?: number;
  terminalReasonCode?: string;
  providerCalls: 0;
  createdWorldActions: 0;
  createdAt: number;
  updatedAt: number;
  planDigest: string;
};

type SharedCoordinatedActivityPlanBase = {
  contractVersion: typeof SHARED_PLAN_VERSION;
  planId: string;
  planKey: string;
  revision: number;
  status: SharedPlanStatus;
  proposerActorId: string;
  inviteeActorId: string;
  sourceReviewId: string;
  sourceReviewDigest: string;
  sourceWindowId: string;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  sourceCommitmentId: string;
  mapId: string;
  locationId: string;
  participants: SharedPlanParticipant[];
  scheduleRevision?: number;
  scheduleDigest?: string;
  expiresGameHour: number;
  terminalGameHour?: number;
  terminalReasonCode?: string;
  providerCalls: 0;
  createdWorldActions: 0;
  createdAt: number;
  updatedAt: number;
  planDigest: string;
};

export type SharedStudyPlanReceipt = SharedCoordinatedActivityPlanBase & {
  kind: 'shared_study';
  teachingTopic: TeachingTopic;
  learnerActorId: string;
  teacherActorId: string;
};

export type SharedRestPlanReceipt = SharedCoordinatedActivityPlanBase & {
  kind: 'shared_rest';
};

export type SharedStudyRestPlanReceipt = SharedStudyPlanReceipt | SharedRestPlanReceipt;
export type SharedPlanReceipt = SharedGatherPlanReceipt | SharedGuardHandoffPlanReceipt | SharedStudyRestPlanReceipt;
export type SharedPlanTransition<TPlan extends SharedPlanReceipt> =
  | { ok: true; plan: TPlan }
  | { ok: false; reasonCode: string };

export type SharedGatherPlanProposalInput = {
  review: LifeSocialReviewReceipt;
  reviewSource: LifeSocialReviewSource;
  latestOwnerSource: LifeSocialReviewSource;
  commitment: {
    commitmentId: string;
    status: string;
    donorActorId: string;
    recipientActorId: string;
  };
  proposer: SharedGatherActorFacts;
  invitee: SharedGatherActorFacts;
  resource: SharedGatherResourceFacts;
  nowGameHour: number;
  now: number;
};

export type SharedGatherActorFacts = {
  actorId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  mapId: string;
  currentLocationId?: string;
  gatherAllowed: boolean;
  itemQuantity: number;
};

export type SharedGatherResourceFacts = {
  resourceNodeId: string;
  sourceRevision: string;
  mapId: string;
  locationId: string;
  itemId: string;
  available: number;
  gatherAllowed: boolean;
  proposerAccess: boolean;
  inviteeAccess: boolean;
};

export type SharedGuardHandoffProposalInput = GuardHandoffProposalInput & {
  nowGameHour: number;
};

export type SharedStudyRestActorFacts = {
  actorId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  mapId: string;
  currentLocationId?: string;
  fatigue: number;
  actionAllowed: boolean;
};

export type SharedStudyRestPlanProposalInput = {
  kind: 'shared_study' | 'shared_rest';
  review: LifeSocialReviewReceipt;
  reviewSource: LifeSocialReviewSource;
  latestOwnerSource: LifeSocialReviewSource;
  commitment: {
    commitmentId: string;
    status: string;
    donorActorId: string;
    recipientActorId: string;
  };
  proposer: SharedStudyRestActorFacts;
  invitee: SharedStudyRestActorFacts;
  location: {
    mapId: string;
    locationId: string;
    actionAllowed: boolean;
  };
  nowGameHour: number;
  now: number;
};

export type SharedPlanParticipantRuntimeSource = {
  plan: SharedGatherPlanReceipt | SharedStudyRestPlanReceipt;
  sourceCurrent: boolean;
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  resourceAvailable?: number;
  resourceAccess?: boolean;
  actionAllowed?: boolean;
  actorFatigue?: number;
  counterpartAliveAndCapable?: boolean;
  counterpartBusy?: boolean;
  counterpartAtLocation?: boolean;
};

export type SharedPlanParticipantGoalFacts = {
  actorId: string;
  status: 'missing' | 'active' | 'completed' | 'failed' | 'cancelled';
  sourceRef?: string;
  sourceRevision?: string;
  intentDigest?: string;
  personalGoalId?: string;
  personalGoalRevision?: number;
  actionType?: string;
  actionRecordId?: string;
  actionExecutionId?: string;
  terminalEventId?: string;
  resourceNodeId?: string;
  itemId?: string;
  inventoryQuantity?: number;
  fatigue?: number;
  targetActorId?: string;
  teachingTopic?: TeachingTopic;
  terminalReasonCode?: string;
};

export function buildSharedGatherPlanProposal(
  input: SharedGatherPlanProposalInput,
): { ok: true; plan: SharedGatherPlanReceipt } | { ok: false; reasonCode: string } {
  const { review, reviewSource, latestOwnerSource, commitment, proposer, invitee, resource } = input;
  if (!isValidLifeSocialReview(review)) return failure('shared_plan_review_invalid');
  if (
    review.cadence !== 'weekly' || review.status !== 'factual' ||
    review.sourcesTruncated || review.actorId !== proposer.actorId
  ) return failure('shared_plan_review_ineligible');
  if (
    reviewSource.kind !== 'group_duty_open' || reviewSource.visibility !== 'participants' ||
    !review.sourceRefs.some((source) => sameSource(source, reviewSource)) ||
    !sameSource(reviewSource, latestOwnerSource)
  ) return failure('shared_plan_source_stale');
  if (
    commitment.status !== 'pending' ||
    reviewSource.sourceRef !== `group-commitment:${commitment.commitmentId}` ||
    proposer.actorId !== commitment.donorActorId ||
    invitee.actorId !== commitment.recipientActorId ||
    proposer.actorId === invitee.actorId ||
    stableObservationDigest(reviewSource.subjectActorIds) !==
      stableObservationDigest([proposer.actorId, invitee.actorId].sort())
  ) return failure('shared_plan_source_subject_mismatch');
  if (!actorEligible(proposer) || !actorEligible(invitee) || proposer.busy || invitee.busy) {
    return failure('shared_plan_actor_unavailable');
  }
  if (
    proposer.mapId !== invitee.mapId || proposer.mapId !== resource.mapId ||
    !resource.gatherAllowed || !resource.proposerAccess || !resource.inviteeAccess ||
    resource.available < MAX_SHARED_PLAN_PARTICIPANTS
  ) return failure('shared_plan_resource_unavailable');
  if (!Number.isSafeInteger(input.nowGameHour) || input.nowGameHour < 0) {
    return failure('shared_plan_time_invalid');
  }
  const planKey = `shared-gather:${reviewSource.sourceRef}:${resource.resourceNodeId}`;
  const planId = `shared-plan:${stableObservationDigest({
    planKey,
    reviewId: review.reviewId,
    reviewDigest: review.reviewDigest,
    participants: [proposer.actorId, invitee.actorId],
  }).slice('stable64:'.length)}`;
  const semantic = {
    contractVersion: SHARED_PLAN_VERSION,
    planId,
    planKey,
    revision: 1,
    kind: 'shared_gather' as const,
    status: 'proposed' as const,
    proposerActorId: proposer.actorId,
    inviteeActorId: invitee.actorId,
    sourceReviewId: review.reviewId,
    sourceReviewDigest: review.reviewDigest,
    sourceWindowId: review.windowId,
    sourceRef: reviewSource.sourceRef,
    sourceRevision: reviewSource.sourceRevision,
    sourceDigest: reviewSource.sourceDigest,
    sourceCommitmentId: commitment.commitmentId,
    resourceNodeId: resource.resourceNodeId,
    resourceNodeRevision: resource.sourceRevision,
    mapId: resource.mapId,
    locationId: resource.locationId,
    itemId: resource.itemId,
    participants: [
      participant(proposer, 'proposer', 'accepted'),
      participant(invitee, 'invitee', 'invited'),
    ],
    expiresGameHour: input.nowGameHour + SHARED_PLAN_TTL_GAME_HOURS,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return { ok: true, plan: withPlanDigest(semantic) };
}

export function buildSharedGuardHandoffPlanProposal(
  input: SharedGuardHandoffProposalInput,
): { ok: true; plan: SharedGuardHandoffPlanReceipt } | { ok: false; reasonCode: string } {
  if (!Number.isSafeInteger(input.nowGameHour) || input.nowGameHour < 0) {
    return failure('guard_handoff_time_invalid');
  }
  const built = buildGuardHandoffProposal(input);
  if (!built.ok) return built;
  const snapshot = built.plan;
  const facts = snapshot.handoffFacts;
  const semantic: Omit<SharedGuardHandoffPlanReceipt, 'planDigest'> = {
    contractVersion: SHARED_PLAN_VERSION,
    planId: snapshot.planId,
    planKey: snapshot.planKey,
    revision: snapshot.revision,
    kind: 'guard_handoff',
    status: 'proposed',
    proposerActorId: facts.outgoingActorId,
    inviteeActorId: facts.incomingActorId,
    sourceReviewId: snapshot.sourceReviewId,
    sourceReviewDigest: snapshot.sourceReviewDigest,
    sourceWindowId: snapshot.sourceWindowId,
    sourceRef: facts.sourceRef,
    sourceRevision: facts.sourceRevision,
    sourceDigest: facts.sourceDigest,
    sourceCommitmentId: snapshot.sourceCommitmentId,
    mapId: facts.handoffMapId,
    locationId: facts.handoffLocationId,
    handoffFacts: facts,
    handoffFactsDigest: snapshot.handoffFactsDigest,
    participants: [
      { actorId: facts.outgoingActorId, role: 'outgoing', status: 'accepted', baselineItemQuantity: 0 },
      { actorId: facts.incomingActorId, role: 'incoming', status: 'invited', baselineItemQuantity: 0 },
    ],
    expiresGameHour: input.nowGameHour + SHARED_PLAN_TTL_GAME_HOURS,
    providerCalls: 0,
    createdWorldActions: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return { ok: true, plan: withSharedGuardHandoffPlanDigest(semantic) };
}

export function buildSharedStudyRestPlanProposal(
  input: SharedStudyRestPlanProposalInput,
): { ok: true; plan: SharedStudyRestPlanReceipt } | { ok: false; reasonCode: string } {
  const { review, reviewSource, latestOwnerSource, commitment, proposer, invitee, location } = input;
  if (!isValidLifeSocialReview(review)) return failure('shared_plan_review_invalid');
  if (review.cadence !== 'weekly' || review.status !== 'factual' || review.sourcesTruncated ||
    review.actorId !== proposer.actorId) return failure('shared_plan_review_ineligible');
  if (reviewSource.kind !== 'group_duty_open' || reviewSource.visibility !== 'participants' ||
    !review.sourceRefs.some((source) => sameSource(source, reviewSource)) ||
    !sameSource(reviewSource, latestOwnerSource)) return failure('shared_plan_source_stale');
  if (commitment.status !== 'pending' || reviewSource.sourceRef !== `group-commitment:${commitment.commitmentId}` ||
    proposer.actorId !== commitment.donorActorId || invitee.actorId !== commitment.recipientActorId ||
    proposer.actorId === invitee.actorId || stableObservationDigest(reviewSource.subjectActorIds) !==
      stableObservationDigest([proposer.actorId, invitee.actorId].sort())) {
    return failure('shared_plan_source_subject_mismatch');
  }
  if (!actorAvailableForCoordinatedActivity(proposer) || !actorAvailableForCoordinatedActivity(invitee)) {
    return failure('shared_plan_actor_unavailable');
  }
  if (!location.actionAllowed || proposer.mapId !== invitee.mapId || proposer.mapId !== location.mapId) {
    return failure('shared_plan_permission_unavailable');
  }
  if (input.kind === 'shared_rest' && (proposer.fatigue <= 0 || invitee.fatigue <= 0)) {
    return failure('shared_plan_rest_not_needed');
  }
  if (!Number.isSafeInteger(input.nowGameHour) || input.nowGameHour < 0) {
    return failure('shared_plan_time_invalid');
  }
  const planKey = `${input.kind.replace('_', '-')}:${reviewSource.sourceRef}:${location.locationId}`;
  const planId = `shared-plan:${stableObservationDigest({
    planKey, reviewId: review.reviewId, reviewDigest: review.reviewDigest,
    participants: [proposer.actorId, invitee.actorId],
  }).slice('stable64:'.length)}`;
  const common = {
    contractVersion: SHARED_PLAN_VERSION,
    planId,
    planKey,
    revision: 1,
    status: 'proposed' as const,
    proposerActorId: proposer.actorId,
    inviteeActorId: invitee.actorId,
    sourceReviewId: review.reviewId,
    sourceReviewDigest: review.reviewDigest,
    sourceWindowId: review.windowId,
    sourceRef: reviewSource.sourceRef,
    sourceRevision: reviewSource.sourceRevision,
    sourceDigest: reviewSource.sourceDigest,
    sourceCommitmentId: commitment.commitmentId,
    mapId: location.mapId,
    locationId: location.locationId,
    participants: [
      { actorId: proposer.actorId, role: 'proposer' as const, status: 'accepted' as const, baselineItemQuantity: 0, baselineFatigue: proposer.fatigue },
      { actorId: invitee.actorId, role: 'invitee' as const, status: 'invited' as const, baselineItemQuantity: 0, baselineFatigue: invitee.fatigue },
    ],
    expiresGameHour: input.nowGameHour + SHARED_PLAN_TTL_GAME_HOURS,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const semantic = input.kind === 'shared_study'
    ? {
        ...common,
        kind: 'shared_study' as const,
        teachingTopic: TEACHING_EXECUTION_TOPIC,
        learnerActorId: proposer.actorId,
        teacherActorId: invitee.actorId,
      }
    : { ...common, kind: 'shared_rest' as const };
  return { ok: true, plan: withSharedStudyRestPlanDigest(semantic) };
}

export function respondToSharedPlan(input: {
  plan: SharedGatherPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedGatherPlanReceipt>;
export function respondToSharedPlan(input: {
  plan: SharedGuardHandoffPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedGuardHandoffPlanReceipt>;
export function respondToSharedPlan(input: {
  plan: SharedStudyRestPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedStudyRestPlanReceipt>;
export function respondToSharedPlan(input: {
  plan: SharedPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedPlanReceipt>;
export function respondToSharedPlan(input: {
  plan: SharedPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedPlanReceipt> {
  if (input.plan.kind === 'guard_handoff') {
    return respondToSharedGuardHandoffPlan({ ...input, plan: input.plan });
  }
  if (input.plan.kind === 'shared_study' || input.plan.kind === 'shared_rest') {
    return respondToSharedStudyRestPlan({ ...input, plan: input.plan });
  }
  return respondToSharedGatherPlan({ ...input, plan: input.plan });
}

function respondToSharedGatherPlan(input: {
  plan: SharedGatherPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}) {
  if (!isValidSharedGatherPlan(input.plan)) return failure('shared_plan_invalid');
  if (input.plan.revision !== input.expectedRevision) return failure('shared_plan_revision_stale');
  if (input.plan.status !== 'proposed') return failure('shared_plan_not_pending');
  if (input.plan.inviteeActorId !== input.actorId) return failure('shared_plan_response_forbidden');
  if (input.nowGameHour >= input.plan.expiresGameHour) {
    return { ok: true as const, plan: terminalize(input.plan, 'expired', 'shared_plan_expired', input.nowGameHour, input.now) };
  }
  if (input.response === 'decline') {
    const participants = input.plan.participants.map((entry) =>
      entry.actorId === input.actorId
        ? { ...entry, status: 'cancelled' as const, terminalReasonCode: 'shared_plan_declined' }
        : entry);
    return {
      ok: true as const,
      plan: terminalize(
        input.plan,
        'declined',
        'shared_plan_declined',
        input.nowGameHour,
        input.now,
        participants,
      ),
    };
  }
  const revision = input.plan.revision + 1;
  const participants = input.plan.participants.map((entry) =>
    entry.actorId === input.actorId ? { ...entry, status: 'accepted' as const } : entry);
  const scheduleDigest = stableObservationDigest({
    planId: input.plan.planId,
    sourceReviewDigest: input.plan.sourceReviewDigest,
    sourceRef: input.plan.sourceRef,
    sourceRevision: input.plan.sourceRevision,
    sourceDigest: input.plan.sourceDigest,
    resourceNodeId: input.plan.resourceNodeId,
    resourceNodeRevision: input.plan.resourceNodeRevision,
    mapId: input.plan.mapId,
    locationId: input.plan.locationId,
    itemId: input.plan.itemId,
    participants: participants.map((entry) => ({
      actorId: entry.actorId,
      baselineItemQuantity: entry.baselineItemQuantity,
    })),
  });
  return {
    ok: true as const,
    plan: withPlanDigest({
      ...withoutDigest(input.plan),
      revision,
      status: 'scheduled' as const,
      participants,
      scheduleRevision: revision,
      scheduleDigest,
      updatedAt: input.now,
    }),
  };
}

function respondToSharedGuardHandoffPlan(input: {
  plan: SharedGuardHandoffPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}) {
  const plan = input.plan;
  if (!isValidSharedGuardHandoffPlan(plan)) return failure('guard_handoff_affordance_missing');
  if (plan.revision !== input.expectedRevision) return failure('shared_plan_revision_stale');
  if (plan.status !== 'proposed') return failure('shared_plan_not_pending');
  if (plan.inviteeActorId !== input.actorId) return failure('shared_plan_response_forbidden');
  if (input.nowGameHour >= plan.expiresGameHour) return failure('shared_plan_expired');
  if (input.response === 'decline') {
    const participants = plan.participants.map((entry) => entry.actorId === input.actorId
      ? { ...entry, status: 'cancelled' as const, terminalReasonCode: 'shared_plan_declined' }
      : entry);
    return {
      ok: true as const,
      plan: withSharedGuardHandoffPlanDigest({
        ...withoutSharedGuardHandoffPlanDigest(plan),
        revision: plan.revision + 1,
        status: 'declined',
        participants,
        terminalReasonCode: 'shared_plan_declined',
        updatedAt: input.now,
      }),
    };
  }
  const scheduled = scheduleGuardHandoffPlan({ plan: guardPlanFromShared(plan), now: input.now });
  if (!scheduled.ok) return scheduled;
  const participants = plan.participants.map((entry) => entry.actorId === input.actorId
    ? { ...entry, status: 'accepted' as const } : entry);
  return {
    ok: true as const,
    plan: withSharedGuardHandoffPlanDigest({
      ...withoutSharedGuardHandoffPlanDigest(plan),
      revision: scheduled.plan.revision,
      status: 'scheduled',
      participants,
      scheduleRevision: scheduled.plan.scheduleRevision,
      scheduleDigest: scheduled.plan.scheduleDigest,
      updatedAt: input.now,
    }),
  };
}

function respondToSharedStudyRestPlan(input: {
  plan: SharedStudyRestPlanReceipt;
  actorId: string;
  expectedRevision: number;
  response: 'accept' | 'decline';
  nowGameHour: number;
  now: number;
}): SharedPlanTransition<SharedStudyRestPlanReceipt> {
  const plan = input.plan;
  if (!isValidSharedStudyRestPlan(plan)) return failure('shared_plan_invalid');
  if (plan.revision !== input.expectedRevision) return failure('shared_plan_revision_stale');
  if (plan.status !== 'proposed') return failure('shared_plan_not_pending');
  if (plan.inviteeActorId !== input.actorId) return failure('shared_plan_response_forbidden');
  if (input.nowGameHour >= plan.expiresGameHour) {
    return { ok: true, plan: terminalizeStudyRest(plan, 'expired', 'shared_plan_expired', input.nowGameHour, input.now) };
  }
  if (input.response === 'decline') {
    const participants = plan.participants.map((entry) => entry.actorId === input.actorId
      ? { ...entry, status: 'cancelled' as const, terminalReasonCode: 'shared_plan_declined' }
      : entry);
    return { ok: true, plan: terminalizeStudyRest(plan, 'declined', 'shared_plan_declined', input.nowGameHour, input.now, participants) };
  }
  const revision = plan.revision + 1;
  const participants = plan.participants.map((entry) => entry.actorId === input.actorId
    ? { ...entry, status: 'accepted' as const }
    : entry);
  const scheduleDigest = stableObservationDigest({
    planId: plan.planId,
    kind: plan.kind,
    sourceReviewDigest: plan.sourceReviewDigest,
    sourceRef: plan.sourceRef,
    sourceRevision: plan.sourceRevision,
    sourceDigest: plan.sourceDigest,
    mapId: plan.mapId,
    locationId: plan.locationId,
    teachingTopic: plan.kind === 'shared_study' ? plan.teachingTopic : undefined,
    participants: participants.map((entry) => ({
      actorId: entry.actorId,
      baselineFatigue: entry.baselineFatigue,
    })),
  });
  return {
    ok: true,
    plan: withSharedStudyRestPlanDigest({
      ...withoutSharedStudyRestPlanDigest(plan),
      revision,
      status: 'scheduled',
      participants,
      scheduleRevision: revision,
      scheduleDigest,
      updatedAt: input.now,
    } as Omit<SharedStudyRestPlanReceipt, 'planDigest'>),
  };
}

export function projectSharedPlanParticipantIntent(input: {
  plan: SharedGatherPlanReceipt | SharedStudyRestPlanReceipt;
  actorId: string;
  sourceCurrent: boolean;
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  resourceAvailable?: number;
  resourceAccess?: boolean;
  actionAllowed?: boolean;
  actorFatigue?: number;
  counterpartAliveAndCapable?: boolean;
  counterpartBusy?: boolean;
  counterpartAtLocation?: boolean;
}):
  | { ok: true; intent: PurposeBoundLifeIntentV2; intentDigest: string; proposalParams: Record<string, unknown> }
  | { ok: false; reasonCode: string } {
  const plan = input.plan;
  if (plan.kind === 'shared_gather' ? !isValidSharedGatherPlan(plan) : !isValidSharedStudyRestPlan(plan)) {
    return failure('shared_plan_invalid');
  }
  if (!['scheduled', 'active'].includes(plan.status) || !plan.scheduleDigest || !plan.scheduleRevision) {
    return failure('shared_plan_not_scheduled');
  }
  const participant = plan.participants.find((entry) => entry.actorId === input.actorId);
  if (!participant || !['accepted', 'goal_active'].includes(participant.status)) {
    return failure('shared_plan_participant_ineligible');
  }
  if (!input.sourceCurrent) return failure('shared_plan_source_stale');
  if (!input.actorAliveAndCapable || input.actorBusy) return failure('shared_plan_actor_unavailable');
  const sourceRef = `shared_plan:${plan.planId}`;
  const sourceRevision = sharedPlanSourceRevision(plan);
  const common = {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'obligation',
    sourceRef,
    sourceRevision,
    targetLocationId: plan.locationId,
    interruptionPolicy: 'survival_or_invalidated',
  } as const;
  let intent: PurposeBoundLifeIntentV2;
  let activityParams: Record<string, unknown> = {};
  if (plan.kind === 'shared_gather') {
    if (!input.resourceAccess || (input.resourceAvailable ?? 0) < 1) {
      return failure('shared_plan_resource_unavailable');
    }
    intent = {
      ...common,
      intendedActivity: 'gather',
      completionCondition: {
        kind: 'inventory_quantity_at_or_above',
        subjectRef: `inventory:${input.actorId}:${plan.itemId}`,
        itemId: plan.itemId,
        baselineQuantity: participant.baselineItemQuantity,
        quantity: participant.baselineItemQuantity + 1,
      },
    };
    activityParams = { resourceNodeId: plan.resourceNodeId };
  } else if (plan.kind === 'shared_study') {
    if (input.actorId !== plan.learnerActorId) return failure('shared_plan_participant_observer_only');
    if (!input.actionAllowed || !input.counterpartAliveAndCapable || input.counterpartBusy || !input.counterpartAtLocation) {
      return failure('shared_plan_teacher_unavailable');
    }
    intent = {
      ...common,
      intendedActivity: 'request_teaching',
      completionCondition: {
        kind: 'interaction_event_recorded',
        subjectRef: `actor:${input.actorId}`,
        afterEventRevision: sourceRevision,
        interactionType: 'request_teaching',
      },
    };
    activityParams = { topic: plan.teachingTopic, targetActorId: plan.teacherActorId };
  } else {
    const baselineFatigue = participant.baselineFatigue;
    if (!input.actionAllowed || baselineFatigue === undefined || (input.actorFatigue ?? 0) <= 0) {
      return failure('shared_plan_rest_unavailable');
    }
    intent = {
      ...common,
      intendedActivity: 'rest',
      completionCondition: {
        kind: 'body_metric_at_or_below',
        subjectRef: `body:${input.actorId}`,
        metric: 'fatigue',
        threshold: Math.max(0, baselineFatigue - 40),
      },
    };
  }
  const validation = validatePurposeBoundLifeIntentV2(intent);
  if (!validation.ok) return failure(validation.reasonCode);
  return {
    ok: true,
    intent: validation.intent,
    intentDigest: purposeBoundLifeIntentDigest(validation.intent),
    proposalParams: {
      sharedPlanId: plan.planId,
      sharedPlanScheduleRevision: plan.scheduleRevision,
      sharedPlanScheduleDigest: plan.scheduleDigest,
      sharedPlanParticipantActorId: input.actorId,
      ...activityParams,
    },
  };
}

export function sharedPlanParticipantProposal(input: {
  plan: SharedGatherPlanReceipt | SharedStudyRestPlanReceipt;
  actorId: string;
  currentLocationId?: string;
  projection: Extract<ReturnType<typeof projectSharedPlanParticipantIntent>, { ok: true }>;
}): SharedPlanAgentProposal {
  const remote = input.currentLocationId !== input.plan.locationId;
  const params = {
    ...input.projection.proposalParams,
    purposeBoundIntent: input.projection.intent,
    purposeBoundIntentDigest: input.projection.intentDigest,
  };
  if (remote) return {
    type: 'travel',
    targetId: input.plan.locationId,
    locationId: input.currentLocationId,
    params,
    intent: `与同伴前往${input.plan.locationId}履行共同计划`,
    source: 'agent',
  };
  if (input.plan.kind === 'shared_study') return {
    type: 'request_teaching',
    targetId: input.plan.teacherActorId,
    locationId: input.currentLocationId,
    params,
    intent: `按共同计划向${input.plan.teacherActorId}请教修行基础`,
    source: 'agent',
  };
  if (input.plan.kind === 'shared_rest') return {
    type: 'rest',
    locationId: input.currentLocationId,
    params,
    intent: `按共同计划在${input.plan.locationId}休息`,
    source: 'agent',
  };
  return {
        type: 'gather',
        locationId: input.currentLocationId,
        params,
        intent: `按共同计划在${input.plan.locationId}采集一份${input.plan.itemId}`,
        source: 'agent',
      };
}

export function reconcileSharedGatherPlan(input: {
  plan: SharedGatherPlanReceipt;
  sourceCurrent: boolean;
  resourceFailureReasonCode?: string;
  nowGameHour: number;
  now: number;
  participantGoals: SharedPlanParticipantGoalFacts[];
}): { changed: boolean; plan: SharedGatherPlanReceipt } {
  const plan = input.plan;
  if (!isValidSharedGatherPlan(plan)) throw new Error('shared_plan_invalid');
  if (isTerminal(plan.status)) return { changed: false, plan };
  if (!input.sourceCurrent) {
    return changedTerminal(plan, 'failed', 'shared_plan_source_stale', input);
  }
  if (input.nowGameHour >= plan.expiresGameHour && plan.status === 'proposed') {
    return changedTerminal(plan, 'expired', 'shared_plan_expired', input);
  }
  if (input.resourceFailureReasonCode) {
    const participants = plan.participants.map((participant) =>
      participant.status === 'completed'
        ? participant
        : {
            ...participant,
            status: 'failed' as const,
            terminalReasonCode: input.resourceFailureReasonCode,
          });
    return changedTerminal(
      plan,
      'failed',
      input.resourceFailureReasonCode,
      input,
      participants,
    );
  }
  if (plan.status === 'proposed') return { changed: false, plan };
  const byActor = new Map(input.participantGoals.map((entry) => [entry.actorId, entry]));
  let failureReason: string | undefined;
  const participants = plan.participants.map((participant) => {
    const facts = byActor.get(participant.actorId);
    if (!facts || facts.status === 'missing') return participant;
    if (!participantGoalMatchesPlan(plan, participant, facts)) {
      failureReason = 'shared_plan_goal_evidence_mismatch';
      return { ...participant, status: 'failed' as const, terminalReasonCode: failureReason };
    }
    if (facts.status === 'failed' || facts.status === 'cancelled') {
      failureReason = facts.terminalReasonCode ?? `shared_plan_goal_${facts.status}`;
      return {
        ...participant,
        status: facts.status,
        personalGoalId: facts.personalGoalId,
        personalGoalRevision: facts.personalGoalRevision,
        terminalReasonCode: failureReason,
      };
    }
    if (facts.status === 'active') {
      return {
        ...participant,
        status: 'goal_active' as const,
        personalGoalId: facts.personalGoalId,
        personalGoalRevision: facts.personalGoalRevision,
      };
    }
    if (!participantTerminalMatchesPlan(plan, participant, facts)) {
      failureReason = 'shared_plan_terminal_evidence_mismatch';
      return { ...participant, status: 'failed' as const, terminalReasonCode: failureReason };
    }
    return {
      ...participant,
      status: 'completed' as const,
      personalGoalId: facts.personalGoalId,
      personalGoalRevision: facts.personalGoalRevision,
      actionRecordId: facts.actionRecordId,
      actionExecutionId: facts.actionExecutionId,
      terminalEventId: facts.terminalEventId,
      terminalReasonCode: undefined,
    };
  });
  if (failureReason) {
    return changedTerminal(plan, 'failed', failureReason, input, participants);
  }
  const status: SharedPlanStatus = participants.every((entry) => entry.status === 'completed')
    ? 'completed'
    : participants.some((entry) => ['goal_active', 'completed'].includes(entry.status))
      ? 'active'
      : 'scheduled';
  if (status === plan.status && stableObservationDigest(participants) === stableObservationDigest(plan.participants)) {
    return { changed: false, plan };
  }
  const next = withPlanDigest({
    ...withoutDigest(plan),
    revision: plan.revision + 1,
    status,
    participants,
    terminalGameHour: status === 'completed' ? input.nowGameHour : undefined,
    terminalReasonCode: status === 'completed' ? 'shared_plan_completed' : undefined,
    updatedAt: input.now,
  });
  return { changed: true, plan: next };
}

export function reconcileSharedStudyRestPlan(input: {
  plan: SharedStudyRestPlanReceipt;
  sourceCurrent: boolean;
  permissionFailureReasonCode?: string;
  nowGameHour: number;
  now: number;
  participantGoals: SharedPlanParticipantGoalFacts[];
}): { changed: boolean; plan: SharedStudyRestPlanReceipt } {
  const plan = input.plan;
  if (!isValidSharedStudyRestPlan(plan)) throw new Error('shared_plan_invalid');
  if (isTerminal(plan.status)) return { changed: false, plan };
  if (!input.sourceCurrent) {
    return changedStudyRestTerminal(plan, 'failed', 'shared_plan_source_stale', input);
  }
  if (input.nowGameHour >= plan.expiresGameHour && plan.status === 'proposed') {
    return changedStudyRestTerminal(plan, 'expired', 'shared_plan_expired', input);
  }
  if (input.permissionFailureReasonCode) {
    return changedStudyRestTerminal(plan, 'failed', input.permissionFailureReasonCode, input);
  }
  if (plan.status === 'proposed') return { changed: false, plan };
  const byActor = new Map(input.participantGoals.map((entry) => [entry.actorId, entry]));
  let failureReason: string | undefined;
  const participants = plan.participants.map((participant) => {
    if (plan.kind === 'shared_study' && participant.actorId === plan.teacherActorId) return participant;
    const facts = byActor.get(participant.actorId);
    if (!facts || facts.status === 'missing') return participant;
    if (!participantGoalMatchesCoordinatedPlan(plan, participant, facts)) {
      failureReason = 'shared_plan_goal_evidence_mismatch';
      return { ...participant, status: 'failed' as const, terminalReasonCode: failureReason };
    }
    if (facts.status === 'failed' || facts.status === 'cancelled') {
      failureReason = facts.terminalReasonCode ?? `shared_plan_goal_${facts.status}`;
      return { ...participant, status: facts.status, terminalReasonCode: failureReason };
    }
    if (facts.status === 'active') {
      return { ...participant, status: 'goal_active' as const, personalGoalId: facts.personalGoalId, personalGoalRevision: facts.personalGoalRevision };
    }
    if (!participantTerminalMatchesCoordinatedPlan(plan, participant, facts)) {
      failureReason = 'shared_plan_terminal_evidence_mismatch';
      return { ...participant, status: 'failed' as const, terminalReasonCode: failureReason };
    }
    return {
      ...participant,
      status: 'completed' as const,
      personalGoalId: facts.personalGoalId,
      personalGoalRevision: facts.personalGoalRevision,
      actionRecordId: facts.actionRecordId,
      actionExecutionId: facts.actionExecutionId,
      terminalEventId: facts.terminalEventId,
      terminalReasonCode: undefined,
    };
  });
  if (failureReason) return changedStudyRestTerminal(plan, 'failed', failureReason, input, participants);
  const completed = plan.kind === 'shared_study'
    ? participants.some((entry) => entry.actorId === plan.learnerActorId && entry.status === 'completed')
    : participants.every((entry) => entry.status === 'completed');
  const status: SharedPlanStatus = completed
    ? 'completed'
    : participants.some((entry) => ['goal_active', 'completed'].includes(entry.status)) ? 'active' : 'scheduled';
  if (status === plan.status && stableObservationDigest(participants) === stableObservationDigest(plan.participants)) {
    return { changed: false, plan };
  }
  const next = withSharedStudyRestPlanDigest({
    ...withoutSharedStudyRestPlanDigest(plan),
    revision: plan.revision + 1,
    status,
    participants,
    terminalGameHour: status === 'completed' ? input.nowGameHour : undefined,
    terminalReasonCode: status === 'completed' ? 'shared_plan_completed' : undefined,
    updatedAt: input.now,
  } as Omit<SharedStudyRestPlanReceipt, 'planDigest'>);
  return { changed: true, plan: next };
}

export function sharedPlanSourceRevision(plan: SharedGatherPlanReceipt | SharedStudyRestPlanReceipt) {
  if (!plan.scheduleRevision || !plan.scheduleDigest) throw new Error('shared_plan_not_scheduled');
  return `shared-plan:${plan.scheduleRevision}:${plan.scheduleDigest}`;
}

export function isValidSharedGatherPlan(plan: SharedGatherPlanReceipt) {
  const { planDigest, ...semantic } = plan;
  return plan.contractVersion === SHARED_PLAN_VERSION &&
    plan.kind === 'shared_gather' && plan.revision >= 1 &&
    plan.participants.length === MAX_SHARED_PLAN_PARTICIPANTS &&
    new Set(plan.participants.map((entry) => entry.actorId)).size === MAX_SHARED_PLAN_PARTICIPANTS &&
    plan.participants.some((entry) => entry.actorId === plan.proposerActorId && entry.role === 'proposer') &&
    plan.participants.some((entry) => entry.actorId === plan.inviteeActorId && entry.role === 'invitee') &&
    plan.providerCalls === 0 && plan.createdWorldActions === 0 &&
    planDigest === stableObservationDigest(semantic);
}

export function isValidSharedPlan(plan: SharedPlanReceipt) {
  return plan.kind === 'shared_gather'
    ? isValidSharedGatherPlan(plan)
    : plan.kind === 'guard_handoff'
      ? isValidSharedGuardHandoffPlan(plan)
      : isValidSharedStudyRestPlan(plan);
}

export function isValidSharedStudyRestPlan(plan: SharedStudyRestPlanReceipt) {
  const semantic = withoutSharedStudyRestPlanDigest(plan);
  const proposer = plan.participants.find((entry) => entry.actorId === plan.proposerActorId);
  const invitee = plan.participants.find((entry) => entry.actorId === plan.inviteeActorId);
  const studyFieldsValid = plan.kind === 'shared_study'
    ? plan.teachingTopic === TEACHING_EXECUTION_TOPIC && plan.learnerActorId === plan.proposerActorId &&
      plan.teacherActorId === plan.inviteeActorId
    : true;
  return plan.contractVersion === SHARED_PLAN_VERSION &&
    ['shared_study', 'shared_rest'].includes(plan.kind) && plan.revision >= 1 &&
    plan.participants.length === MAX_SHARED_PLAN_PARTICIPANTS &&
    new Set(plan.participants.map((entry) => entry.actorId)).size === MAX_SHARED_PLAN_PARTICIPANTS &&
    proposer?.role === 'proposer' && invitee?.role === 'invitee' &&
    plan.participants.every((entry) => Number.isFinite(entry.baselineFatigue) && (entry.baselineFatigue ?? -1) >= 0) &&
    studyFieldsValid && plan.providerCalls === 0 && plan.createdWorldActions === 0 &&
    plan.planDigest === stableObservationDigest(semantic);
}

export function withSharedStudyRestPlanDigest(
  semantic: Omit<SharedStudyRestPlanReceipt, 'planDigest'>,
): SharedStudyRestPlanReceipt {
  return { ...semantic, planDigest: stableObservationDigest(semantic) } as SharedStudyRestPlanReceipt;
}

export function withoutSharedStudyRestPlanDigest(plan: SharedStudyRestPlanReceipt) {
  const { planDigest: _planDigest, ...semantic } = plan;
  return semantic;
}

export function isValidSharedGuardHandoffPlan(plan: SharedGuardHandoffPlanReceipt) {
  const semantic = withoutSharedGuardHandoffPlanDigest(plan);
  const incoming = plan.participants.find((entry) => entry.actorId === plan.inviteeActorId);
  const outgoing = plan.participants.find((entry) => entry.actorId === plan.proposerActorId);
  const sourceMatches = plan.sourceRef === plan.handoffFacts.sourceRef &&
    plan.sourceRevision === plan.handoffFacts.sourceRevision &&
    plan.sourceDigest === plan.handoffFacts.sourceDigest;
  const statusAllowed = ['proposed', 'scheduled', 'declined'].includes(plan.status);
  const p7Plan = plan.status === 'declined' ? undefined : guardPlanFromShared(plan);
  return plan.contractVersion === SHARED_PLAN_VERSION && plan.kind === 'guard_handoff' &&
    plan.planDigest === stableObservationDigest(semantic) && plan.revision >= 1 &&
    guardHandoffFactsDigest(plan.handoffFacts) === plan.handoffFactsDigest && sourceMatches &&
    plan.mapId === plan.handoffFacts.handoffMapId && plan.locationId === plan.handoffFacts.handoffLocationId &&
    plan.proposerActorId === plan.handoffFacts.outgoingActorId &&
    plan.inviteeActorId === plan.handoffFacts.incomingActorId &&
    plan.participants.length === MAX_SHARED_PLAN_PARTICIPANTS &&
    outgoing?.role === 'outgoing' && outgoing.status === 'accepted' &&
    incoming?.role === 'incoming' && ['invited', 'accepted', 'cancelled'].includes(incoming.status) &&
    plan.providerCalls === 0 && plan.createdWorldActions === 0 && statusAllowed &&
    (p7Plan === undefined || p7Plan.planDigest === guardHandoffPlanDigestForShared(p7Plan));
}

export function withSharedGuardHandoffPlanDigest(
  semantic: Omit<SharedGuardHandoffPlanReceipt, 'planDigest'>,
): SharedGuardHandoffPlanReceipt {
  return { ...semantic, planDigest: stableObservationDigest(semantic) };
}

export function withoutSharedGuardHandoffPlanDigest(plan: SharedGuardHandoffPlanReceipt) {
  const { planDigest: _planDigest, ...semantic } = plan;
  return semantic;
}

export function guardPlanFromShared(plan: SharedGuardHandoffPlanReceipt): GuardHandoffPlan {
  return withGuardHandoffPlanDigest({
    contractVersion: GUARD_HANDOFF_VERSION,
    planId: plan.planId,
    planKey: plan.planKey,
    revision: plan.revision,
    status: plan.status === 'scheduled' ? 'scheduled' : 'proposed',
    sourceReviewId: plan.sourceReviewId,
    sourceReviewDigest: plan.sourceReviewDigest,
    sourceWindowId: plan.sourceWindowId,
    sourceCommitmentId: plan.sourceCommitmentId,
    handoffFacts: plan.handoffFacts,
    handoffFactsDigest: plan.handoffFactsDigest,
    participants: [
      { actorId: plan.proposerActorId, role: 'outgoing' },
      { actorId: plan.inviteeActorId, role: 'incoming' },
    ],
    scheduleRevision: plan.scheduleRevision,
    scheduleDigest: plan.scheduleDigest,
    providerCalls: 0,
    createdWorldActions: 0,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  });
}

function guardHandoffPlanDigestForShared(plan: GuardHandoffPlan) {
  const { planDigest: _planDigest, ...semantic } = plan;
  return stableObservationDigest(semantic);
}

export function withPlanDigest<T extends Omit<SharedGatherPlanReceipt, 'planDigest'>>(
  semantic: T,
): SharedGatherPlanReceipt {
  return { ...semantic, planDigest: stableObservationDigest(semantic) };
}

export function withoutDigest(plan: SharedGatherPlanReceipt) {
  const { planDigest: _planDigest, ...semantic } = plan;
  return semantic;
}

function participant(
  actor: SharedGatherActorFacts,
  role: SharedPlanParticipant['role'],
  status: SharedPlanParticipant['status'],
): SharedPlanParticipant {
  return {
    actorId: actor.actorId,
    role,
    status,
    baselineItemQuantity: actor.itemQuantity,
  };
}

function actorEligible(actor: SharedGatherActorFacts) {
  return actor.aliveAndCapable && actor.gatherAllowed && Number.isSafeInteger(actor.itemQuantity) && actor.itemQuantity >= 0;
}

function actorAvailableForCoordinatedActivity(actor: SharedStudyRestActorFacts) {
  return actor.aliveAndCapable && !actor.busy && actor.actionAllowed &&
    Number.isFinite(actor.fatigue) && actor.fatigue >= 0 && actor.fatigue <= 100;
}

function sameSource(left: LifeSocialReviewSource, right: LifeSocialReviewSource) {
  return stableObservationDigest(left) === stableObservationDigest(right);
}

function participantGoalMatchesPlan(
  plan: SharedGatherPlanReceipt,
  participant: SharedPlanParticipant,
  facts: SharedPlanParticipantGoalFacts,
) {
  return facts.actorId === participant.actorId &&
    facts.sourceRef === `shared_plan:${plan.planId}` &&
    facts.sourceRevision === sharedPlanSourceRevision(plan) &&
    !!facts.personalGoalId && Number.isSafeInteger(facts.personalGoalRevision);
}

function participantTerminalMatchesPlan(
  plan: SharedGatherPlanReceipt,
  participant: SharedPlanParticipant,
  facts: SharedPlanParticipantGoalFacts,
) {
  return facts.status === 'completed' && facts.actionType === 'gather' &&
    facts.resourceNodeId === plan.resourceNodeId && facts.itemId === plan.itemId &&
    facts.inventoryQuantity === participant.baselineItemQuantity + 1 &&
    !!facts.actionRecordId && !!facts.actionExecutionId && !!facts.terminalEventId;
}

function participantGoalMatchesCoordinatedPlan(
  plan: SharedStudyRestPlanReceipt,
  participant: SharedPlanParticipant,
  facts: SharedPlanParticipantGoalFacts,
) {
  return facts.actorId === participant.actorId && facts.sourceRef === `shared_plan:${plan.planId}` &&
    facts.sourceRevision === sharedPlanSourceRevision(plan) && !!facts.personalGoalId &&
    Number.isSafeInteger(facts.personalGoalRevision);
}

function participantTerminalMatchesCoordinatedPlan(
  plan: SharedStudyRestPlanReceipt,
  participant: SharedPlanParticipant,
  facts: SharedPlanParticipantGoalFacts,
) {
  if (facts.status !== 'completed' || !facts.actionRecordId || !facts.actionExecutionId || !facts.terminalEventId) {
    return false;
  }
  if (plan.kind === 'shared_study') {
    return participant.actorId === plan.learnerActorId && facts.actionType === 'request_teaching' &&
      facts.targetActorId === plan.teacherActorId && facts.teachingTopic === plan.teachingTopic;
  }
  const threshold = Math.max(0, (participant.baselineFatigue ?? 0) - 40);
  return facts.actionType === 'rest' && Number.isFinite(facts.fatigue) &&
    (facts.fatigue ?? Number.POSITIVE_INFINITY) <= threshold;
}

function terminalize(
  plan: SharedGatherPlanReceipt,
  status: Extract<SharedPlanStatus, 'declined' | 'cancelled' | 'failed' | 'expired'>,
  reasonCode: string,
  nowGameHour: number,
  now: number,
  participants = plan.participants,
) {
  return withPlanDigest({
    ...withoutDigest(plan),
    revision: plan.revision + 1,
    status,
    participants,
    terminalGameHour: nowGameHour,
    terminalReasonCode: reasonCode,
    updatedAt: now,
  });
}

function changedTerminal(
  plan: SharedGatherPlanReceipt,
  status: Extract<SharedPlanStatus, 'failed' | 'expired'>,
  reasonCode: string,
  input: { nowGameHour: number; now: number },
  participants = plan.participants,
) {
  return {
    changed: true,
    plan: terminalize(plan, status, reasonCode, input.nowGameHour, input.now, participants),
  };
}

function terminalizeStudyRest(
  plan: SharedStudyRestPlanReceipt,
  status: Extract<SharedPlanStatus, 'declined' | 'cancelled' | 'failed' | 'expired'>,
  reasonCode: string,
  nowGameHour: number,
  now: number,
  participants = plan.participants,
) {
  return withSharedStudyRestPlanDigest({
    ...withoutSharedStudyRestPlanDigest(plan),
    revision: plan.revision + 1,
    status,
    participants,
    terminalGameHour: nowGameHour,
    terminalReasonCode: reasonCode,
    updatedAt: now,
  } as Omit<SharedStudyRestPlanReceipt, 'planDigest'>);
}

function changedStudyRestTerminal(
  plan: SharedStudyRestPlanReceipt,
  status: Extract<SharedPlanStatus, 'failed' | 'expired'>,
  reasonCode: string,
  input: { nowGameHour: number; now: number },
  participants = plan.participants,
) {
  return {
    changed: true,
    plan: terminalizeStudyRest(plan, status, reasonCode, input.nowGameHour, input.now, participants),
  };
}

function isTerminal(status: SharedPlanStatus) {
  return ['completed', 'declined', 'cancelled', 'failed', 'expired'].includes(status);
}

function failure(reasonCode: string) {
  return { ok: false as const, reasonCode };
}

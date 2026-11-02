import { stableObservationDigest } from './lifeObservation';
import type {
  LifeSocialReviewReceipt,
  LifeSocialReviewSource,
} from './lifeSocialReviewLogic';
import {
  GUARD_HANDOFF_VERSION,
  guardHandoffFactsDigest,
  guardHandoffPlanDigest,
  isGuardHandoffTerminal,
  sharedPlanGoalSourceRef,
  withoutGuardHandoffPlanDigest,
  withGuardHandoffPlanDigest,
  type GuardHandoffActorFacts,
  type GuardHandoffFacts,
  type GuardHandoffLocationFacts,
  type GuardHandoffPlan,
  type GuardHandoffReadinessReceipt,
} from './guardHandoffContracts';

const GUARD_HANDOFF_PARTICIPANT_COUNT = 2 as const;

type GroupCommitmentFacts = {
  commitmentId: string;
  status: string;
  donorActorId: string;
  recipientActorId: string;
};

type BodyArrivalEvidence = {
  kind: 'body_arrived';
  actionType: 'travel';
  destinationLocationId: string;
  sourceRef: string;
  planId: string;
  planRevision: number;
  handoffFactsDigest: string;
  actionRecordId?: string;
  actionExecutionId?: string;
  terminalEventId?: string;
};

type AlreadyAtHandoffEvidence = {
  kind: 'already_at_handoff';
  sourceRef: string;
  planId: string;
  planRevision: number;
  handoffFactsDigest: string;
};

export type GuardHandoffProposalInput = {
  review: LifeSocialReviewReceipt;
  reviewSource: LifeSocialReviewSource;
  latestOwnerSource: LifeSocialReviewSource;
  commitment: GroupCommitmentFacts;
  outgoing: GuardHandoffActorFacts;
  incoming: GuardHandoffActorFacts;
  handoffLocation: GuardHandoffLocationFacts;
  now: number;
};

export type GuardHandoffReadinessInput = {
  plan: GuardHandoffPlan;
  actor: GuardHandoffActorFacts;
  evidence: BodyArrivalEvidence | AlreadyAtHandoffEvidence;
};

export function buildGuardHandoffProposal(
  input: GuardHandoffProposalInput,
): { ok: true; plan: GuardHandoffPlan } | { ok: false; reasonCode: string } {
  const { review, reviewSource, latestOwnerSource, commitment, outgoing, incoming } = input;
  if (
    review.cadence !== 'weekly' || review.status !== 'factual' ||
    review.sourcesTruncated || review.actorId !== outgoing.actorId
  ) return failure('guard_handoff_affordance_missing');
  if (
    reviewSource.kind !== 'group_duty_open' ||
    reviewSource.visibility !== 'participants' ||
    !review.sourceRefs.some((source) => sameSource(source, reviewSource)) ||
    !sameSource(reviewSource, latestOwnerSource)
  ) return failure('guard_handoff_source_stale');
  if (
    commitment.status !== 'pending' ||
    reviewSource.sourceRef !== `group-commitment:${commitment.commitmentId}` ||
    outgoing.actorId !== commitment.donorActorId ||
    incoming.actorId !== commitment.recipientActorId ||
    outgoing.actorId === incoming.actorId ||
    stableObservationDigest([...reviewSource.subjectActorIds].sort()) !==
      stableObservationDigest([outgoing.actorId, incoming.actorId].sort())
  ) return failure('guard_handoff_source_stale');
  if (!eligibleGuard(outgoing) || !eligibleGuard(incoming)) {
    return failure('guard_handoff_role_or_location_stale');
  }
  if (
    outgoing.homeZoneId !== incoming.homeZoneId ||
    outgoing.homeZoneId !== input.handoffLocation.locationId ||
    !input.handoffLocation.exists ||
    !input.handoffLocation.reachableByExistingTravelBody ||
    !nonEmpty(input.handoffLocation.mapId) ||
    !nonEmpty(input.handoffLocation.locationId) ||
    !Number.isSafeInteger(input.now) || input.now < 0
  ) return failure('guard_handoff_role_or_location_stale');
  const handoffFacts: GuardHandoffFacts = {
    handoffRevision: 1,
    sourceRef: reviewSource.sourceRef,
    sourceRevision: reviewSource.sourceRevision,
    sourceDigest: reviewSource.sourceDigest,
    outgoingActorId: outgoing.actorId,
    incomingActorId: incoming.actorId,
    outgoingRole: 'guard',
    incomingRole: 'guard',
    outgoingDutyState: 'on_watch',
    incomingDutyState: 'on_watch',
    handoffMapId: input.handoffLocation.mapId,
    handoffLocationId: input.handoffLocation.locationId,
  };
  const handoffFactsDigest = guardHandoffFactsDigest(handoffFacts);
  const planKey = `guard-handoff:${handoffFacts.sourceRef}:${handoffFacts.handoffLocationId}`;
  const planId = `shared-plan:${stableObservationDigest({
    planKey,
    reviewId: review.reviewId,
    reviewDigest: review.reviewDigest,
    handoffFactsDigest,
  }).slice('stable64:'.length)}`;
  return {
    ok: true,
    plan: withGuardHandoffPlanDigest({
      contractVersion: GUARD_HANDOFF_VERSION,
      planId,
      planKey,
      revision: 1,
      status: 'proposed',
      sourceReviewId: review.reviewId,
      sourceReviewDigest: review.reviewDigest,
      sourceWindowId: review.windowId,
      sourceCommitmentId: commitment.commitmentId,
      handoffFacts,
      handoffFactsDigest,
      participants: [
        { actorId: outgoing.actorId, role: 'outgoing' },
        { actorId: incoming.actorId, role: 'incoming' },
      ],
      providerCalls: 0,
      createdWorldActions: 0,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  };
}

export function scheduleGuardHandoffPlan(input: {
  plan: GuardHandoffPlan;
  now: number;
}): { ok: true; plan: GuardHandoffPlan } | { ok: false; reasonCode: string } {
  if (!isValidGuardHandoffPlan(input.plan)) return failure('guard_handoff_affordance_missing');
  if (input.plan.status !== 'proposed') return failure('guard_handoff_terminal_replay');
  if (!Number.isSafeInteger(input.now) || input.now < input.plan.updatedAt) {
    return failure('guard_handoff_role_or_location_stale');
  }
  const revision = input.plan.revision + 1;
  const scheduleDigest = stableObservationDigest({
    planId: input.plan.planId,
    revision,
    handoffFactsDigest: input.plan.handoffFactsDigest,
    participants: input.plan.participants,
  });
  return {
    ok: true,
    plan: withGuardHandoffPlanDigest({
      ...withoutGuardHandoffPlanDigest(input.plan),
      revision,
      status: 'scheduled',
      scheduleRevision: revision,
      scheduleDigest,
      updatedAt: input.now,
    }),
  };
}

export function evaluateGuardHandoffReadiness(
  input: GuardHandoffReadinessInput,
): { ok: true; receipt: GuardHandoffReadinessReceipt } | { ok: false; reasonCode: string } {
  const { plan, actor, evidence } = input;
  if (!isValidGuardHandoffPlan(plan)) return failure('guard_handoff_affordance_missing');
  if (!['scheduled', 'active'].includes(plan.status) || !plan.scheduleRevision) {
    return failure('guard_handoff_affordance_missing');
  }
  if (!participantMatchesCurrentFacts(plan, actor)) {
    return failure('guard_handoff_role_or_location_stale');
  }
  const sourceRef = sharedPlanGoalSourceRef(plan.planId);
  if (
    evidence.sourceRef !== sourceRef || evidence.planId !== plan.planId ||
    evidence.planRevision !== plan.revision ||
    evidence.handoffFactsDigest !== plan.handoffFactsDigest
  ) return failure('guard_handoff_source_stale');
  if (evidence.kind === 'body_arrived') {
    if (
      evidence.actionType !== 'travel' ||
      evidence.destinationLocationId !== plan.handoffFacts.handoffLocationId ||
      !nonEmpty(evidence.actionRecordId) || !nonEmpty(evidence.actionExecutionId) ||
      !nonEmpty(evidence.terminalEventId)
    ) return failure('guard_handoff_receipt_missing');
    return {
      ok: true,
      receipt: {
        receiptKind: 'body_arrived', actorId: actor.actorId, planId: plan.planId,
        planRevision: plan.revision, handoffFactsDigest: plan.handoffFactsDigest,
        sourceRef, locationId: plan.handoffFacts.handoffLocationId,
        actionRecordId: evidence.actionRecordId, actionExecutionId: evidence.actionExecutionId,
        terminalEventId: evidence.terminalEventId,
      },
    };
  }
  if (actor.currentLocationId !== plan.handoffFacts.handoffLocationId) {
    return failure('guard_handoff_role_or_location_stale');
  }
  return {
    ok: true,
    receipt: {
      receiptKind: 'already_at_handoff', actorId: actor.actorId, planId: plan.planId,
      planRevision: plan.revision, handoffFactsDigest: plan.handoffFactsDigest,
      sourceRef, locationId: plan.handoffFacts.handoffLocationId,
    },
  };
}

export function reconcileGuardHandoffTerminal(input: {
  plan: GuardHandoffPlan;
  sourceCurrent: boolean;
  outgoing: GuardHandoffActorFacts;
  incoming: GuardHandoffActorFacts;
  receipts: GuardHandoffReadinessReceipt[];
  finalizeWhenIncomplete?: boolean;
  now: number;
}): { changed: boolean; plan: GuardHandoffPlan; reasonCode?: string } {
  const plan = input.plan;
  if (!isValidGuardHandoffPlan(plan)) throw new Error('guard_handoff_affordance_missing');
  if (isGuardHandoffTerminal(plan.status)) {
    return { changed: false, plan, reasonCode: 'guard_handoff_terminal_replay' };
  }
  if (!input.sourceCurrent) return terminalize(plan, 'failed', 'guard_handoff_source_stale', input.now);
  if (!participantMatchesCurrentFacts(plan, input.outgoing) || !participantMatchesCurrentFacts(plan, input.incoming)) {
    return terminalize(plan, 'failed', 'guard_handoff_role_or_location_stale', input.now);
  }
  const byActor = new Map(input.receipts.map((receipt) => [receipt.actorId, receipt]));
  const expected = plan.participants.map((participant) => byActor.get(participant.actorId));
  if (input.receipts.length !== GUARD_HANDOFF_PARTICIPANT_COUNT || expected.some((receipt) => !receipt)) {
    return input.finalizeWhenIncomplete
      ? terminalize(plan, 'failed', 'guard_handoff_receipt_missing', input.now)
      : { changed: false, plan };
  }
  if (expected.some((receipt) => !receiptMatchesPlan(plan, receipt!))) {
    return terminalize(plan, 'failed', 'guard_handoff_receipt_missing', input.now);
  }
  return terminalize(plan, 'completed', 'guard_handoff_completed', input.now);
}

export function isValidGuardHandoffPlan(plan: GuardHandoffPlan) {
  const semantic = withoutGuardHandoffPlanDigest(plan);
  const participants = plan.participants;
  const facts = plan.handoffFacts;
  return plan.contractVersion === GUARD_HANDOFF_VERSION &&
    plan.planDigest === guardHandoffPlanDigest(semantic) &&
    plan.handoffFactsDigest === guardHandoffFactsDigest(facts) &&
    facts.handoffRevision === 1 &&
    plan.revision >= 1 &&
    participants.length === GUARD_HANDOFF_PARTICIPANT_COUNT &&
    new Set(participants.map((participant) => participant.actorId)).size === GUARD_HANDOFF_PARTICIPANT_COUNT &&
    participants.some((participant) => participant.actorId === facts.outgoingActorId && participant.role === 'outgoing') &&
    participants.some((participant) => participant.actorId === facts.incomingActorId && participant.role === 'incoming') &&
    facts.outgoingActorId !== facts.incomingActorId &&
    facts.outgoingRole === 'guard' && facts.incomingRole === 'guard' &&
    facts.outgoingDutyState === 'on_watch' && facts.incomingDutyState === 'on_watch' &&
    nonEmpty(facts.sourceRef) && nonEmpty(facts.sourceRevision) && nonEmpty(facts.sourceDigest) &&
    nonEmpty(facts.handoffMapId) && nonEmpty(facts.handoffLocationId) &&
    plan.providerCalls === 0 && plan.createdWorldActions === 0;
}

function participantMatchesCurrentFacts(plan: GuardHandoffPlan, actor: GuardHandoffActorFacts) {
  const isOutgoing = actor.actorId === plan.handoffFacts.outgoingActorId;
  const isIncoming = actor.actorId === plan.handoffFacts.incomingActorId;
  return (isOutgoing || isIncoming) && actor.role === 'guard' && actor.dutyState === 'on_watch' &&
    actor.aliveAndCapable && !actor.busy && actor.homeZoneId === plan.handoffFacts.handoffLocationId &&
    actor.currentLocationId === plan.handoffFacts.handoffLocationId;
}

function receiptMatchesPlan(plan: GuardHandoffPlan, receipt: GuardHandoffReadinessReceipt) {
  const participant = plan.participants.find((entry) => entry.actorId === receipt.actorId);
  if (!participant) return false;
  const bodyEvidenceComplete = receipt.receiptKind !== 'body_arrived' ||
    (nonEmpty(receipt.actionRecordId) && nonEmpty(receipt.actionExecutionId) && nonEmpty(receipt.terminalEventId));
  return receipt.planId === plan.planId && receipt.planRevision === plan.revision &&
    receipt.handoffFactsDigest === plan.handoffFactsDigest &&
    receipt.sourceRef === sharedPlanGoalSourceRef(plan.planId) &&
    receipt.locationId === plan.handoffFacts.handoffLocationId && bodyEvidenceComplete;
}

function terminalize(
  plan: GuardHandoffPlan,
  status: Extract<GuardHandoffPlan['status'], 'completed' | 'failed'>,
  reasonCode: string,
  now: number,
) {
  if (!Number.isSafeInteger(now) || now < plan.updatedAt) {
    throw new Error('guard_handoff_role_or_location_stale');
  }
  const next = withGuardHandoffPlanDigest({
    ...withoutGuardHandoffPlanDigest(plan),
    revision: plan.revision + 1,
    status,
    terminalReasonCode: reasonCode,
    updatedAt: now,
  });
  return { changed: true, plan: next, reasonCode };
}

function eligibleGuard(actor: GuardHandoffActorFacts) {
  return actor.role === 'guard' && actor.dutyState === 'on_watch' &&
    actor.aliveAndCapable && !actor.busy && nonEmpty(actor.homeZoneId);
}

function sameSource(left: LifeSocialReviewSource, right: LifeSocialReviewSource) {
  return stableObservationDigest(left) === stableObservationDigest(right);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function failure(reasonCode: string) {
  return { ok: false as const, reasonCode };
}

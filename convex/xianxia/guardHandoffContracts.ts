import { stableObservationDigest } from './lifeObservation';

export const GUARD_HANDOFF_VERSION = 'taixu.guard-handoff.v1' as const;

export type GuardDutyState = 'on_watch';
export type GuardHandoffStatus =
  | 'proposed'
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type GuardHandoffParticipant = {
  actorId: string;
  role: 'outgoing' | 'incoming';
};

export type GuardHandoffFacts = {
  handoffRevision: number;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  outgoingActorId: string;
  incomingActorId: string;
  outgoingRole: 'guard';
  incomingRole: 'guard';
  outgoingDutyState: GuardDutyState;
  incomingDutyState: GuardDutyState;
  handoffMapId: string;
  handoffLocationId: string;
};

export type GuardHandoffPlan = {
  contractVersion: typeof GUARD_HANDOFF_VERSION;
  planId: string;
  planKey: string;
  revision: number;
  status: GuardHandoffStatus;
  sourceReviewId: string;
  sourceReviewDigest: string;
  sourceWindowId: string;
  sourceCommitmentId: string;
  handoffFacts: GuardHandoffFacts;
  handoffFactsDigest: string;
  participants: GuardHandoffParticipant[];
  scheduleRevision?: number;
  scheduleDigest?: string;
  terminalReasonCode?: string;
  providerCalls: 0;
  createdWorldActions: 0;
  createdAt: number;
  updatedAt: number;
  planDigest: string;
};

export type GuardHandoffActorFacts = {
  actorId: string;
  role: string;
  dutyState?: string;
  aliveAndCapable: boolean;
  busy: boolean;
  homeZoneId?: string;
  currentLocationId?: string;
};

export type GuardHandoffLocationFacts = {
  mapId: string;
  locationId: string;
  exists: boolean;
  reachableByExistingTravelBody: boolean;
};

export type GuardHandoffReadinessReceipt = {
  receiptKind: 'body_arrived' | 'already_at_handoff';
  actorId: string;
  planId: string;
  planRevision: number;
  handoffFactsDigest: string;
  sourceRef: string;
  locationId: string;
  actionRecordId?: string;
  actionExecutionId?: string;
  terminalEventId?: string;
};

export function guardHandoffFactsDigest(facts: GuardHandoffFacts) {
  return stableObservationDigest(facts);
}

export function sharedPlanGoalSourceRef(planId: string) {
  return `shared_plan:${planId}`;
}

export function guardHandoffPlanDigest(plan: Omit<GuardHandoffPlan, 'planDigest'>) {
  return stableObservationDigest(plan);
}

export function withGuardHandoffPlanDigest(
  plan: Omit<GuardHandoffPlan, 'planDigest'>,
): GuardHandoffPlan {
  return { ...plan, planDigest: guardHandoffPlanDigest(plan) };
}

export function withoutGuardHandoffPlanDigest(plan: GuardHandoffPlan) {
  const { planDigest: _planDigest, ...semantic } = plan;
  return semantic;
}

export function isGuardHandoffTerminal(status: GuardHandoffStatus) {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
}

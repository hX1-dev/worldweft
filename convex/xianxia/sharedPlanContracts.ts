import { type Infer, v } from 'convex/values';

export const SHARED_PLAN_VERSION = 'taixu.shared-plan.v1' as const;

export const sharedPlanKindValidator = v.union(
  v.literal('shared_gather'),
  v.literal('guard_handoff'),
  v.literal('shared_study'),
  v.literal('shared_rest'),
);
export type SharedPlanKind = Infer<typeof sharedPlanKindValidator>;

export const sharedPlanStatusValidator = v.union(
  v.literal('proposed'),
  v.literal('scheduled'),
  v.literal('active'),
  v.literal('completed'),
  v.literal('declined'),
  v.literal('cancelled'),
  v.literal('failed'),
  v.literal('expired'),
);
export type SharedPlanStatus = Infer<typeof sharedPlanStatusValidator>;

export const sharedPlanParticipantStatusValidator = v.union(
  v.literal('invited'),
  v.literal('accepted'),
  v.literal('goal_active'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);
export type SharedPlanParticipantStatus = Infer<
  typeof sharedPlanParticipantStatusValidator
>;

export const sharedPlanParticipantValidator = v.object({
  actorId: v.string(),
  role: v.union(
    v.literal('proposer'),
    v.literal('invitee'),
    v.literal('outgoing'),
    v.literal('incoming'),
  ),
  status: sharedPlanParticipantStatusValidator,
  baselineItemQuantity: v.number(),
  baselineFatigue: v.optional(v.number()),
  personalGoalId: v.optional(v.string()),
  personalGoalRevision: v.optional(v.number()),
  actionRecordId: v.optional(v.string()),
  actionExecutionId: v.optional(v.string()),
  terminalEventId: v.optional(v.string()),
  terminalReasonCode: v.optional(v.string()),
});
export type SharedPlanParticipant = Infer<typeof sharedPlanParticipantValidator>;

// The P8 owner persists the P7-derived handoff snapshot, rather than deriving
// a mutable duty/location fact at response time.
export const guardHandoffFactsValidator = v.object({
  handoffRevision: v.number(),
  sourceRef: v.string(),
  sourceRevision: v.string(),
  sourceDigest: v.string(),
  outgoingActorId: v.string(),
  incomingActorId: v.string(),
  outgoingRole: v.literal('guard'),
  incomingRole: v.literal('guard'),
  outgoingDutyState: v.literal('on_watch'),
  incomingDutyState: v.literal('on_watch'),
  handoffMapId: v.string(),
  handoffLocationId: v.string(),
});
export type GuardHandoffFactsRecord = Infer<typeof guardHandoffFactsValidator>;

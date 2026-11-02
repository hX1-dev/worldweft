import { type Infer, v } from 'convex/values';
import {
  purposeBoundLifeIntentV2Validator,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';
export { PERSONAL_GOAL_BACKLOG_LIMIT } from './personalGoalConstants';

export const PERSONAL_GOAL_CONTRACT_VERSION = 'taixu.personal-goal.v1' as const;
export const PERSONAL_GOAL_SOFT_DEADLINE_HOURS = 24 as const;
export const PERSONAL_GOAL_HARD_DEADLINE_HOURS = 72 as const;

export const personalGoalKindValidator = v.union(
  v.literal('recovery'),
  v.literal('livelihood'),
  v.literal('commitment'),
  v.literal('relationship'),
  v.literal('cultivation'),
  v.literal('avoid_threat'),
);

export const personalGoalStatusValidator = v.union(
  v.literal('active'),
  v.literal('completed'),
  v.literal('cancelled'),
  v.literal('failed'),
  v.literal('expired'),
  v.literal('idle'),
);

export const purposeGoalStageValidator = v.union(
  v.literal('travel_pending'),
  v.literal('activity_ready'),
  v.literal('activity_pending'),
  v.literal('session_pending'),
);

export const purposeGoalFenceValidator = v.object({
  goalId: v.string(),
  revision: v.number(),
  intentDigest: v.string(),
});

export const personalGoalCandidateValidator = v.object({
  candidateId: v.string(),
  goalKey: v.string(),
  kind: personalGoalKindValidator,
  sourceRef: v.string(),
  targetRef: v.optional(v.string()),
  intent: v.string(),
  progressScore: v.number(),
  progressKey: v.string(),
  purposeIntent: v.optional(purposeBoundLifeIntentV2Validator),
  purposeIntentDigest: v.optional(v.string()),
  purposeCadenceKey: v.optional(v.string()),
});

export const personalGoalBacklogEntryValidator = v.object({
  candidateId: v.string(),
  goalKey: v.string(),
  kind: personalGoalKindValidator,
  sourceRef: v.string(),
  targetRef: v.optional(v.string()),
  intent: v.string(),
  purposeIntent: v.optional(purposeBoundLifeIntentV2Validator),
  purposeIntentDigest: v.optional(v.string()),
  purposeCadenceKey: v.optional(v.string()),
});

export type PersonalGoalKind = Infer<typeof personalGoalKindValidator>;
export type PersonalGoalStatus = Infer<typeof personalGoalStatusValidator>;
export type PurposeGoalStage = Infer<typeof purposeGoalStageValidator>;
export type PurposeGoalFence = Infer<typeof purposeGoalFenceValidator>;
export type PersonalGoalCandidate = Infer<typeof personalGoalCandidateValidator>;
export type PersonalGoalBacklogEntry = Infer<typeof personalGoalBacklogEntryValidator>;

export type ActivePersonalGoal = {
  contractVersion: typeof PERSONAL_GOAL_CONTRACT_VERSION;
  goalId: string;
  actorId: string;
  revision: number;
  status: 'active';
  goalKey: string;
  kind: PersonalGoalKind;
  sourceRef: string;
  targetRef?: string;
  candidateId: string;
  intent: string;
  progressScore: number;
  progressKey: string;
  progressRevision: number;
  backlog: PersonalGoalBacklogEntry[];
  observationRevision: string;
  startedGameHour: number;
  lastProgressGameHour: number;
  deadlineGameHour: number;
  hardDeadlineGameHour: number;
  attemptCount: number;
  lastActionRecordId?: string;
  lastActionType?: string;
  purposeIntent?: PurposeBoundLifeIntentV2;
  purposeIntentDigest?: string;
  purposeCadenceKey?: string;
  purposeStage?: PurposeGoalStage;
  purposeArrivalActionRecordId?: string;
  purposeArrivalEventId?: string;
  purposeActivityActionRecordId?: string;
  purposeActivityExecutionId?: string;
  purposeActivityTerminalEventId?: string;
  socialInvitationId?: string;
  socialInvitationRevision?: number;
  socialConversationId?: string;
};

export type PurposeGoalCadenceWindow = {
  goalId: string;
  cadenceKey: string;
  sourceRef: string;
  sourceRevision: string;
  purposeKind: PurposeBoundLifeIntentV2['purposeKind'];
  intendedActivity: PurposeBoundLifeIntentV2['intendedActivity'];
  terminalStatus: Exclude<PersonalGoalStatus, 'active' | 'idle'>;
  terminalReasonCode: string;
  terminalGameHour: number;
  nextEligibleGameHour: number;
};

export type PersonalGoalPlan = {
  selected?: PersonalGoalCandidate;
  backlog: PersonalGoalBacklogEntry[];
};

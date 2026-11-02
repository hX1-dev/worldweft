import { type Infer, v } from 'convex/values';

export const conversationStatusValidator = v.union(
  v.literal('proposed'),
  v.literal('accepted'),
  v.literal('active'),
  v.literal('resolved'),
  v.literal('declined'),
  v.literal('cancelled'),
  v.literal('expired'),
);
export type ConversationStatus = Infer<typeof conversationStatusValidator>;

export const groupConversationStatusValidator = v.union(
  v.literal('active'),
  v.literal('resolved'),
  v.literal('cancelled'),
  v.literal('expired'),
);
export type GroupConversationStatus = Infer<typeof groupConversationStatusValidator>;

export const groupConversationMembershipRoleValidator = v.union(
  v.literal('participant'),
  v.literal('observer'),
);
export type GroupConversationMembershipRole = Infer<
  typeof groupConversationMembershipRoleValidator
>;

export const speechActValidator = v.union(
  v.literal('greet'),
  v.literal('ask'),
  v.literal('inform'),
  v.literal('request'),
  v.literal('respond'),
  v.literal('refuse'),
  v.literal('clarify'),
  v.literal('end_topic'),
);
export type SpeechAct = Infer<typeof speechActValidator>;

export const beliefKindValidator = v.union(
  v.literal('claim'),
  v.literal('belief'),
  v.literal('rumor'),
);
export type BeliefKind = Infer<typeof beliefKindValidator>;

export const claimTruthStatusValidator = v.union(
  v.literal('unknown'),
  v.literal('supported'),
  v.literal('contradicted'),
);
export type ClaimTruthStatus = Infer<typeof claimTruthStatusValidator>;

export const beliefValidityValidator = v.union(
  v.literal('active'),
  v.literal('superseded'),
  v.literal('invalidated'),
);
export type BeliefValidity = Infer<typeof beliefValidityValidator>;

export const beliefEvidenceVerdictValidator = v.union(
  v.literal('confirm'),
  v.literal('refute'),
  v.literal('uncertain'),
);
export type BeliefEvidenceVerdict = Infer<typeof beliefEvidenceVerdictValidator>;

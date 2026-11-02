import { v } from 'convex/values';

export {
  actionSource,
  actionStatus,
  eventVisibility,
} from '../actionSchema';
export {
  durableActionMetadataValidator,
  durableActionResultValidator,
  durableEffectsValidator,
  durableEventFactsValidator,
} from '../durableContracts';
export {
  movementCommandStatusValidator,
  movementDecisionSourceValidator,
  movementTargetValidator,
  tilePointValidator,
} from '../valleyMovementContracts';
export {
  actionExecutionStatusValidator,
} from '../actionExecutionContracts';
export {
  beliefEvidenceVerdictValidator,
  beliefKindValidator,
  beliefValidityValidator,
  claimTruthStatusValidator,
  conversationStatusValidator,
  groupConversationMembershipRoleValidator,
  groupConversationStatusValidator,
  speechActValidator,
} from '../conversationContracts';
export {
  socialModelCallStatusValidator,
} from '../socialModelContracts';
export {
  negotiationKindValidator,
  negotiationProposalStatusValidator,
  negotiationStatusValidator,
} from '../negotiationContracts';
export {
  groupCommitmentStatusValidator,
  groupProposalStatusValidator,
  groupVoteChoiceValidator,
} from '../groupDecisionContracts';
export {
  autonomyCandidateValidator,
  autonomyDecisionBoundsValidator,
  autonomyDecisionOutcomeValidator,
  autonomyPersonaPolicyValidator,
  autonomyDecisionSourceValidator,
} from '../autonomyDecisionContracts';
export {
  personalGoalBacklogEntryValidator,
  personalGoalKindValidator,
  personalGoalStatusValidator,
  purposeGoalStageValidator,
} from '../personalGoalContracts';
export {
  socialInvitationActivityValidator,
  socialInvitationStatusValidator,
} from '../socialInvitationContracts';
export {
  socialOpportunityCandidateValidator,
  socialOpportunityActivityValidator,
  socialWarrantAudienceValidator,
  socialWarrantOutcomeValidator,
  socialWarrantValidator,
} from '../socialWarrantContracts';
export {
  socialOutcomeStatusValidator,
} from '../socialOutcomeContracts';
export {
  reliabilityEvidenceDirectionValidator,
  socialConsequenceKindValidator,
  socialConsequenceSourceKindValidator,
  socialConsequenceStatusValidator,
} from '../socialConsequenceContracts';
export {
  groupSocialInitiationStatusValidator,
  groupSocialParticipantRoleEntryValidator,
  groupSocialParticipantRoleValidator,
  groupSocialResponseValidator,
  groupSocialSourceKindValidator,
} from '../groupSocialInitiationContracts';
export {
  purposeBoundLifeIntentV2Validator,
} from '../purposeBoundLifeIntentContracts';
export {
  guardHandoffFactsValidator,
  sharedPlanKindValidator,
  sharedPlanParticipantValidator,
  sharedPlanStatusValidator,
} from '../sharedPlanContracts';

export const relationshipDeltaValidator = v.object({
  affinity: v.optional(v.number()),
  trust: v.optional(v.number()),
  suspicion: v.optional(v.number()),
  debt: v.optional(v.number()),
  fear: v.optional(v.number()),
});

export const relationshipDimsValidator = v.object({
  affinity: v.number(),
  trust: v.number(),
  suspicion: v.number(),
  debt: v.number(),
  fear: v.number(),
});

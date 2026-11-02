#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const requireTracked = process.argv.includes('--require-tracked');
const listSource = process.argv.includes('--list');
const jsonOutput = process.argv.includes('--json');

const rootReleaseFiles = [
  '.gitignore',
  'LICENSE',
  'convex/agent/conversation.ts',
  'convex/agent/embeddingsCache.ts',
  'convex/agent/memory.ts',
  'convex/agent/schema.ts',
  'convex/aiTown/agent.ts',
  'convex/aiTown/agentDescription.ts',
  'convex/aiTown/agentInputs.ts',
  'convex/aiTown/agentOperations.ts',
  'convex/aiTown/conversation.ts',
  'convex/aiTown/conversationMembership.ts',
  'convex/aiTown/game.ts',
  'convex/aiTown/ids.ts',
  'convex/aiTown/inputHandler.ts',
  'convex/aiTown/inputs.ts',
  'convex/aiTown/insertInput.ts',
  'convex/aiTown/location.ts',
  'convex/aiTown/main.ts',
  'convex/aiTown/movement.ts',
  'convex/aiTown/player.ts',
  'convex/aiTown/playerDescription.ts',
  'convex/aiTown/schema.ts',
  'convex/aiTown/world.ts',
  'convex/aiTown/worldMap.ts',
  'convex/constants.ts',
  'convex/crons.ts',
  'convex/engine/abstractGame.ts',
  'convex/engine/historicalObject.test.ts',
  'convex/engine/historicalObject.ts',
  'convex/engine/schema.ts',
  'convex/godot.ts',
  'convex/godotBridgeAuth.test.ts',
  'convex/godotBridgeAuth.ts',
  'convex/godotBridgeContract.test.ts',
  'convex/godotBridgeContract.ts',
  'convex/godotCapabilities.test.ts',
  'convex/godotCapabilities.ts',
  'convex/godotExchange.test.ts',
  'convex/godotExchange.ts',
  'convex/godotMapBoundary.test.ts',
  'convex/godotMapBoundary.ts',
  'convex/godotMapPages.ts',
  'convex/godotPresentation.test.ts',
  'convex/godotPresentation.ts',
  'convex/godotReadModel.ts',
  'convex/godotSpatial.test.ts',
  'convex/godotSpatial.ts',
  'convex/godotTesting.ts',
  'convex/godotTestingPolicy.test.ts',
  'convex/godotTestingPolicy.ts',
  'convex/godotViewerPolicy.test.ts',
  'convex/godotViewerPolicy.ts',
  'convex/http.ts',
  'convex/init.ts',
  'convex/messages.ts',
  'convex/music.ts',
  'convex/schema.ts',
  'convex/schemaFragments.ts',
  'convex/testing.ts',
  'convex/tsconfig.json',
  'convex/util/FastIntegerCompression.ts',
  'convex/util/assertNever.ts',
  'convex/util/asyncMap.test.ts',
  'convex/util/asyncMap.ts',
  'convex/util/compression.test.ts',
  'convex/util/compression.ts',
  'convex/util/geometry.test.ts',
  'convex/util/geometry.ts',
  'convex/util/isSimpleObject.ts',
  'convex/util/llm.test.ts',
  'convex/util/llm.ts',
  'convex/util/minheap.test.ts',
  'convex/util/minheap.ts',
  'convex/util/object.ts',
  'convex/util/sleep.ts',
  'convex/util/types.test.ts',
  'convex/util/types.ts',
  'convex/util/xxhash.ts',
  'convex/vendor/piNpcCoreLite/loop.test.ts',
  'convex/vendor/piNpcCoreLite/loop.ts',
  'convex/vendor/piNpcCoreLite/types.ts',
  'convex/world.ts',
  'convex/worldMaintenanceLogic.test.ts',
  'convex/worldMaintenanceLogic.ts',
  'convex/xianxia/access.test.ts',
  'convex/xianxia/access.ts',
  'convex/xianxia/actionExecutionContracts.ts',
  'convex/xianxia/actionExecutionLogic.test.ts',
  'convex/xianxia/actionExecutionLogic.ts',
  'convex/xianxia/actionIdempotency.test.ts',
  'convex/xianxia/actionIdempotency.ts',
  'convex/xianxia/actionSchema.ts',
  'convex/xianxia/actions.ts',
  'convex/xianxia/adapters/aiTownTravelPort.ts',
  'convex/xianxia/adapters/valleyTravelPort.ts',
  'convex/xianxia/agent.ts',
  'convex/xianxia/agentLogic.test.ts',
  'convex/xianxia/agentLogic.ts',
  'convex/xianxia/agentTickLease.ts',
  'convex/xianxia/agentTickLeasePolicy.test.ts',
  'convex/xianxia/agentTickLeasePolicy.ts',
  'convex/xianxia/agentTickScheduler.test.ts',
  'convex/xianxia/agentTickScheduler.ts',
  'convex/xianxia/agentTickSchedulerPolicy.ts',
  'convex/xianxia/autonomyDecisionContracts.ts',
  'convex/xianxia/autonomyDecisionTrace.ts',
  'convex/xianxia/autonomyDecisionTraceLogic.test.ts',
  'convex/xianxia/autonomyDecisionTraceLogic.ts',
  'convex/xianxia/beliefRevisionLogic.test.ts',
  'convex/xianxia/beliefRevisionLogic.ts',
  'convex/xianxia/beliefs.ts',
  'convex/xianxia/breakthroughProgressLogic.test.ts',
  'convex/xianxia/breakthroughProgressLogic.ts',
  'convex/xianxia/config.ts',
  'convex/xianxia/conflictLogic.test.ts',
  'convex/xianxia/conflictLogic.ts',
  'convex/xianxia/conversationContracts.ts',
  'convex/xianxia/conversationCooldownLogic.test.ts',
  'convex/xianxia/conversationCooldownLogic.ts',
  'convex/xianxia/conversationLogic.test.ts',
  'convex/xianxia/conversationLogic.ts',
  'convex/xianxia/conversationModel.ts',
  'convex/xianxia/conversations.ts',
  'convex/xianxia/cultivationLogic.test.ts',
  'convex/xianxia/cultivationLogic.ts',
  'convex/xianxia/cultivationResourceLogic.test.ts',
  'convex/xianxia/cultivationResourceLogic.ts',
  'convex/xianxia/decisionPriorityContracts.ts',
  'convex/xianxia/decisionPriorityProjectionLogic.test.ts',
  'convex/xianxia/decisionPriorityProjectionLogic.ts',
  'convex/xianxia/domains/actionRouter.ts',
  'convex/xianxia/domains/conflict/encounters.ts',
  'convex/xianxia/domains/cultivation/progression.ts',
  'convex/xianxia/domains/inventory/repository.ts',
  'convex/xianxia/domains/life/profile.ts',
  'convex/xianxia/domains/resources/repository.ts',
  'convex/xianxia/domains/social/parsers.ts',
  'convex/xianxia/durableContracts.test.ts',
  'convex/xianxia/durableContracts.ts',
  'convex/xianxia/evaluation/soak/purposeBoundLifeSoakLogic.ts',
  'convex/xianxia/events.ts',
  'convex/xianxia/fatigueLogic.test.ts',
  'convex/xianxia/fatigueLogic.ts',
  'convex/xianxia/giftLogic.test.ts',
  'convex/xianxia/giftLogic.ts',
  'convex/xianxia/gm.ts',
  'convex/xianxia/gmLogic.test.ts',
  'convex/xianxia/gmLogic.ts',
  'convex/xianxia/groupConversationLogic.test.ts',
  'convex/xianxia/groupConversationLogic.ts',
  'convex/xianxia/groupConversations.ts',
  'convex/xianxia/groupDecisionContracts.ts',
  'convex/xianxia/groupDecisionLogic.test.ts',
  'convex/xianxia/groupDecisionLogic.ts',
  'convex/xianxia/groupDecisions.ts',
  'convex/xianxia/groupScene.ts',
  'convex/xianxia/groupSceneLogic.test.ts',
  'convex/xianxia/groupSceneLogic.ts',
  'convex/xianxia/groupSocialCoordinationLogic.test.ts',
  'convex/xianxia/groupSocialCoordinationLogic.ts',
  'convex/xianxia/groupSocialInitiationContracts.test.ts',
  'convex/xianxia/groupSocialInitiationContracts.ts',
  'convex/xianxia/groupSocialInitiations.test.ts',
  'convex/xianxia/groupSocialInitiations.ts',
  'convex/xianxia/groupSocialOpportunityLogic.test.ts',
  'convex/xianxia/groupSocialOpportunityLogic.ts',
  'convex/xianxia/growth.ts',
  'convex/xianxia/grudgeLogic.test.ts',
  'convex/xianxia/grudgeLogic.ts',
  'convex/xianxia/guardDutyAssignmentContracts.ts',
  'convex/xianxia/guardDutyAssignmentLogic.test.ts',
  'convex/xianxia/guardDutyAssignmentLogic.ts',
  'convex/xianxia/guardDutyAssignmentProjectionLogic.test.ts',
  'convex/xianxia/guardDutyAssignmentProjectionLogic.ts',
  'convex/xianxia/guardDutyAuthorityReceiptContracts.ts',
  'convex/xianxia/guardDutyAuthorityReceiptLogic.test.ts',
  'convex/xianxia/guardDutyAuthorityReceiptLogic.ts',
  'convex/xianxia/guardHandoffContracts.ts',
  'convex/xianxia/guardHandoffExecutionAdmissionLogic.test.ts',
  'convex/xianxia/guardHandoffExecutionAdmissionLogic.ts',
  'convex/xianxia/guardHandoffLogic.test.ts',
  'convex/xianxia/guardHandoffLogic.ts',
  'convex/xianxia/guardHandoffOwnerAdmissionLogic.test.ts',
  'convex/xianxia/guardHandoffOwnerAdmissionLogic.ts',
  'convex/xianxia/guardHandoffParticipantAdmissionContracts.ts',
  'convex/xianxia/guardHandoffParticipantAdmissionLogic.test.ts',
  'convex/xianxia/guardHandoffParticipantAdmissionLogic.ts',
  'convex/xianxia/guardHandoffTwoPartyDispatchLogic.test.ts',
  'convex/xianxia/guardHandoffTwoPartyDispatchLogic.ts',
  'convex/xianxia/humanLifeLogic.test.ts',
  'convex/xianxia/humanLifeLogic.ts',
  'convex/xianxia/humanSocietyLogic.test.ts',
  'convex/xianxia/humanSocietyLogic.ts',
  'convex/xianxia/items.test.ts',
  'convex/xianxia/items.ts',
  'convex/xianxia/lifeCalendar.ts',
  'convex/xianxia/lifeCalendarLogic.test.ts',
  'convex/xianxia/lifeCalendarLogic.ts',
  'convex/xianxia/lifeDeaths.ts',
  'convex/xianxia/lifeObservation.test.ts',
  'convex/xianxia/lifeObservation.ts',
  'convex/xianxia/lifeProfileLogic.test.ts',
  'convex/xianxia/lifeProfileLogic.ts',
  'convex/xianxia/lifeProfiles.ts',
  'convex/xianxia/lifeRhythmWindowLogic.test.ts',
  'convex/xianxia/lifeRhythmWindowLogic.ts',
  'convex/xianxia/lifeRhythmWindows.ts',
  'convex/xianxia/lifeSocialReviewLogic.test.ts',
  'convex/xianxia/lifeSocialReviewLogic.ts',
  'convex/xianxia/lifeSocialReviews.ts',
  'convex/xianxia/lifeStateLogic.test.ts',
  'convex/xianxia/lifeStateLogic.ts',
  'convex/xianxia/locations.ts',
  'convex/xianxia/memory.ts',
  'convex/xianxia/memoryFanout.test.ts',
  'convex/xianxia/memoryLogic.test.ts',
  'convex/xianxia/memoryLogic.ts',
  'convex/xianxia/movement.ts',
  'convex/xianxia/movementLogic.test.ts',
  'convex/xianxia/movementLogic.ts',
  'convex/xianxia/negotiationAgentLogic.test.ts',
  'convex/xianxia/negotiationAgentLogic.ts',
  'convex/xianxia/negotiationContracts.ts',
  'convex/xianxia/negotiationLogic.test.ts',
  'convex/xianxia/negotiationLogic.ts',
  'convex/xianxia/negotiations.ts',
  'convex/xianxia/personaPolicyLogic.test.ts',
  'convex/xianxia/personaPolicyLogic.ts',
  'convex/xianxia/personalGoalConstants.ts',
  'convex/xianxia/personalGoalContracts.ts',
  'convex/xianxia/personalGoalLogic.test.ts',
  'convex/xianxia/personalGoalLogic.ts',
  'convex/xianxia/personalGoals.ts',
  'convex/xianxia/personalityLogic.test.ts',
  'convex/xianxia/personalityLogic.ts',
  'convex/xianxia/piNpcDeepSeekTransport.test.ts',
  'convex/xianxia/piNpcDeepSeekTransport.ts',
  'convex/xianxia/playerAffinityLogic.test.ts',
  'convex/xianxia/playerAffinityLogic.ts',
  'convex/xianxia/playerDialogueLogic.test.ts',
  'convex/xianxia/playerDialogueLogic.ts',
  'convex/xianxia/playerDialoguePersonas.ts',
  'convex/xianxia/policy.test.ts',
  'convex/xianxia/policy.ts',
  'convex/xianxia/populationMigrationLogic.test.ts',
  'convex/xianxia/populationMigrationLogic.ts',
  'convex/xianxia/populationMigrations.ts',
  'convex/xianxia/priceLogic.test.ts',
  'convex/xianxia/priceLogic.ts',
  'convex/xianxia/profiles.ts',
  'convex/xianxia/purposeBehaviorReleaseAuditLogic.test.ts',
  'convex/xianxia/purposeBehaviorReleaseAuditLogic.ts',
  'convex/xianxia/purposeBoundLifeCandidateLogic.test.ts',
  'convex/xianxia/purposeBoundLifeCandidateLogic.ts',
  'convex/xianxia/purposeBoundLifeGoalLogic.test.ts',
  'convex/xianxia/purposeBoundLifeGoalLogic.ts',
  'convex/xianxia/purposeBoundLifeIntentContracts.test.ts',
  'convex/xianxia/purposeBoundLifeIntentContracts.ts',
  'convex/xianxia/purposeBoundLifeSoakLogic.test.ts',
  'convex/xianxia/purposeBoundLifeSoakLogic.ts',
  'convex/xianxia/purposeBoundLifeSocialProjectionLogic.test.ts',
  'convex/xianxia/purposeBoundLifeSocialProjectionLogic.ts',
  'convex/xianxia/purposeBoundPersonalGoalLogic.ts',
  'convex/xianxia/purposeGoalCadenceLogic.test.ts',
  'convex/xianxia/purposeGoalCadenceLogic.ts',
  'convex/xianxia/purposeGoalReplacementLogic.ts',
  'convex/xianxia/purposeResourceOutlookLogic.test.ts',
  'convex/xianxia/purposeResourceOutlookLogic.ts',
  'convex/xianxia/qinglan.ts',
  'convex/xianxia/qinglanFangshiZones.test.ts',
  'convex/xianxia/qinglanFangshiZones.ts',
  'convex/xianxia/qinglanNavigation.test.ts',
  'convex/xianxia/qinglanNavigation.ts',
  'convex/xianxia/qinglanProfiles.test.ts',
  'convex/xianxia/qinglanProfiles.ts',
  'convex/xianxia/questLogic.test.ts',
  'convex/xianxia/questLogic.ts',
  'convex/xianxia/quests.ts',
  'convex/xianxia/refusalLogic.test.ts',
  'convex/xianxia/refusalLogic.ts',
  'convex/xianxia/relationshipLogic.test.ts',
  'convex/xianxia/relationshipLogic.ts',
  'convex/xianxia/relationshipMemoryOutcomeAdmissionLogic.test.ts',
  'convex/xianxia/relationshipMemoryOutcomeAdmissionLogic.ts',
  'convex/xianxia/relationships.ts',
  'convex/xianxia/remoteSocialInvitationOpportunityLogic.test.ts',
  'convex/xianxia/remoteSocialInvitationOpportunityLogic.ts',
  'convex/xianxia/requestTransitions.ts',
  'convex/xianxia/resourceNodeLogic.test.ts',
  'convex/xianxia/resourceNodeLogic.ts',
  'convex/xianxia/routineLogic.test.ts',
  'convex/xianxia/routineLogic.ts',
  'convex/xianxia/rules.test.ts',
  'convex/xianxia/rules.ts',
  'convex/xianxia/rumorLogic.test.ts',
  'convex/xianxia/rumorLogic.ts',
  'convex/xianxia/runtime/admission/runtimeAgentAdmission.ts',
  'convex/xianxia/runtime/agentContracts.ts',
  'convex/xianxia/runtime/agentHelpers.ts',
  'convex/xianxia/runtime/agentWakeOrchestrator.ts',
  'convex/xianxia/runtime/candidates/runtimeAgentCandidateSourcePort.ts',
  'convex/xianxia/runtime/decision/proposeAndAct.ts',
  'convex/xianxia/runtime/observation/runtimeAgentObservationPort.ts',
  'convex/xianxia/runtime/result/runtimeAgentTickResultPort.ts',
  'convex/xianxia/runtime/scheduler/agentTick.ts',
  'convex/xianxia/runtime/snapshot/agentContext.ts',
  'convex/xianxia/runtimeAgentBeliefProjectionPort.test.ts',
  'convex/xianxia/runtimeAgentBeliefProjectionPort.ts',
  'convex/xianxia/runtimeAgentCandidateSourcePort.test.ts',
  'convex/xianxia/runtimeAgentCandidateSourcePort.ts',
  'convex/xianxia/runtimeAgentContextReadPort.ts',
  'convex/xianxia/runtimeAgentDecisionRoutingPort.test.ts',
  'convex/xianxia/runtimeAgentDecisionRoutingPort.ts',
  'convex/xianxia/runtimeAgentModelSelectionPort.test.ts',
  'convex/xianxia/runtimeAgentModelSelectionPort.ts',
  'convex/xianxia/runtimeAgentObservationPort.test.ts',
  'convex/xianxia/runtimeAgentObservationPort.ts',
  'convex/xianxia/runtimeAgentTickResultPort.test.ts',
  'convex/xianxia/runtimeAgentTickResultPort.ts',
  'convex/xianxia/runtimeConversationSessionPort.test.ts',
  'convex/xianxia/runtimeConversationSessionPort.ts',
  'convex/xianxia/runtimeDecisionSnapshot.test.ts',
  'convex/xianxia/runtimeDecisionSnapshot.ts',
  'convex/xianxia/runtimeDomainOutcomeEvidencePort.test.ts',
  'convex/xianxia/runtimeDomainOutcomeEvidencePort.ts',
  'convex/xianxia/runtimeTimedActionPort.test.ts',
  'convex/xianxia/runtimeTimedActionPort.ts',
  'convex/xianxia/runtimeTravelPort.test.ts',
  'convex/xianxia/runtimeTravelPort.ts',
  'convex/xianxia/runtimeValleyTravelPort.test.ts',
  'convex/xianxia/runtimeValleyTravelPort.ts',
  'convex/xianxia/sameLocationSocialOpportunityLogic.test.ts',
  'convex/xianxia/sameLocationSocialOpportunityLogic.ts',
  'convex/xianxia/schema.ts',
  'convex/xianxia/schema/coordination.ts',
  'convex/xianxia/schema/evaluation.ts',
  'convex/xianxia/schema/execution.ts',
  'convex/xianxia/schema/legacy.ts',
  'convex/xianxia/schema/projection.ts',
  'convex/xianxia/schema/runtimeFacts.ts',
  'convex/xianxia/schema/validators.ts',
  'convex/xianxia/seasonalResourceLogic.test.ts',
  'convex/xianxia/seasonalResourceLogic.ts',
  'convex/xianxia/seed.test.ts',
  'convex/xianxia/seed.ts',
  'convex/xianxia/seedLogic.ts',
  'convex/xianxia/sharedPlanContracts.ts',
  'convex/xianxia/sharedPlanLogic.test.ts',
  'convex/xianxia/sharedPlanLogic.ts',
  'convex/xianxia/sharedPlans.ts',
  'convex/xianxia/shopLogic.test.ts',
  'convex/xianxia/shopLogic.ts',
  'convex/xianxia/socialConsequenceContracts.test.ts',
  'convex/xianxia/socialConsequenceContracts.ts',
  'convex/xianxia/socialConsequenceLifecycle.ts',
  'convex/xianxia/socialConsequenceLifecycleLogic.test.ts',
  'convex/xianxia/socialConsequenceLifecycleLogic.ts',
  'convex/xianxia/socialConsequenceProjectionContracts.ts',
  'convex/xianxia/socialConsequenceProjectionLogic.test.ts',
  'convex/xianxia/socialConsequenceProjectionLogic.ts',
  'convex/xianxia/socialConsequenceProjections.ts',
  'convex/xianxia/socialInvitationContracts.test.ts',
  'convex/xianxia/socialInvitationContracts.ts',
  'convex/xianxia/socialInvitationCoordinationLogic.ts',
  'convex/xianxia/socialInvitationGoalLogic.test.ts',
  'convex/xianxia/socialInvitationGoalLogic.ts',
  'convex/xianxia/socialInvitations.test.ts',
  'convex/xianxia/socialInvitations.ts',
  'convex/xianxia/socialModelContracts.ts',
  'convex/xianxia/socialModelPolicy.test.ts',
  'convex/xianxia/socialModelPolicy.ts',
  'convex/xianxia/socialModelRuntime.ts',
  'convex/xianxia/socialModelTurnLogic.test.ts',
  'convex/xianxia/socialModelTurnLogic.ts',
  'convex/xianxia/socialOutcomeContracts.test.ts',
  'convex/xianxia/socialOutcomeContracts.ts',
  'convex/xianxia/socialOutcomeReceipts.test.ts',
  'convex/xianxia/socialOutcomeReceipts.ts',
  'convex/xianxia/socialWarrantContracts.test.ts',
  'convex/xianxia/socialWarrantContracts.ts',
  'convex/xianxia/survivalEnvelopeLogic.test.ts',
  'convex/xianxia/survivalEnvelopeLogic.ts',
  'convex/xianxia/taixuEmbodimentReceiptLogic.test.ts',
  'convex/xianxia/taixuEmbodimentReceiptLogic.ts',
  'convex/xianxia/taixuEvidenceContextLogic.test.ts',
  'convex/xianxia/taixuEvidenceContextLogic.ts',
  'convex/xianxia/taixuResultFactOwnerAdmission.ts',
  'convex/xianxia/taixuResultFactOwnerAdmissionLogic.test.ts',
  'convex/xianxia/taixuResultFactOwnerAdmissionLogic.ts',
  'convex/xianxia/taixuResultSelectiveMemoryAdoptionLogic.test.ts',
  'convex/xianxia/taixuResultSelectiveMemoryAdoptionLogic.ts',
  'convex/xianxia/taixuResultSelectiveMemoryLogic.test.ts',
  'convex/xianxia/taixuResultSelectiveMemoryLogic.ts',
  'convex/xianxia/taixuSelfCoreLogic.test.ts',
  'convex/xianxia/taixuSelfCoreLogic.ts',
  'convex/xianxia/teachingLogic.test.ts',
  'convex/xianxia/teachingLogic.ts',
  'convex/xianxia/timeLogic.test.ts',
  'convex/xianxia/timeLogic.ts',
  'convex/xianxia/tradeLogic.test.ts',
  'convex/xianxia/tradeLogic.ts',
  'convex/xianxia/unifiedLifeSocialCandidateLogic.test.ts',
  'convex/xianxia/unifiedLifeSocialCandidateLogic.ts',
  'convex/xianxia/valleyInspect.ts',
  'convex/xianxia/valleyInspectLogic.test.ts',
  'convex/xianxia/valleyInspectLogic.ts',
  'convex/xianxia/valleyMovement.test.ts',
  'convex/xianxia/valleyMovement.ts',
  'convex/xianxia/valleyMovementContracts.ts',
  'convex/xianxia/valleyMovementLogic.test.ts',
  'convex/xianxia/valleyMovementLogic.ts',
  'convex/xianxia/valleyPortal.ts',
  'convex/xianxia/valleyPortalLogic.test.ts',
  'convex/xianxia/valleyPortalLogic.ts',
  'convex/xianxia/world.test.ts',
  'convex/xianxia/world.ts',
  'convex/xianxia/worldDirector.ts',
  'convex/xianxia/worldPressureContracts.ts',
  'convex/xianxia/worldPressureLogic.test.ts',
  'convex/xianxia/worldPressureLogic.ts',
  'convex/xianxia/zones.test.ts',
  'convex/xianxia/zones.ts',
  'data/characters.ts',
  'data/gentle.js',
  'data/qinglanCollisionVolumes.ts',
  'data/qinglanMaskContract.ts',
  'data/qinglanRegions.ts',
  'data/qinglanTestAgents.ts',
  'data/qinglanValleyGate.generated.test.ts',
  'data/qinglanValleyGate.generated.ts',
  'data/spritesheets/f1.ts',
  'data/spritesheets/f2.ts',
  'data/spritesheets/f3.ts',
  'data/spritesheets/f4.ts',
  'data/spritesheets/f5.ts',
  'data/spritesheets/f6.ts',
  'data/spritesheets/f7.ts',
  'data/spritesheets/f8.ts',
  'data/spritesheets/types.ts',
  'data/xianxiaCharacters.ts',
  'jest.config.ts',
  'package-lock.json',
  'package.json',
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate/cellMask.json',
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate/interactions.json',
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate/locations.json',
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate/npcPoints.json',
  'scripts/buildQinglanValleyGatePrototype.mjs',
  'tsconfig.godot-bridge.json',
  'tsconfig.json',];

const ignoredRuntimePaths = [
  '.convex/local/default/convex_local_backend.sqlite3',
  '.env.local',
  '.logs/player-dialogue/example.json',
  'tmp/godot-download/Godot.app',
  'godot-taixu-client/.godot/imported/example.ctex',
  'godot-taixu-client/test-artifacts/example.log',];

const valleyReleaseEntrypoints = [
];

const valleyReleaseInputs = [
];

const textExtensions = new Set(['.cjs', '.gd', '.godot', '.json', '.md', '.mjs', '.ts', '.tscn']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args, input, allowNoMatch = false) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowNoMatch && error.status === 1) return error.stdout ?? '';
    throw error;
  }
}

function walk(directory) {
  const result = [];
  for (const name of readdirSync(resolve(root, directory))) {
    if (name === '.godot' || name === 'test-artifacts' || name === 'dist') continue;
    const absolute = resolve(root, directory, name);
    const path = relative(root, absolute);
    if (statSync(absolute).isDirectory()) result.push(...walk(path));
    else result.push(path.replaceAll('\\', '/'));
  }
  return result;
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

function normalizeDeclaredPath(path) {
  return String(path).replace(/^\.\//, '');
}

function scriptSourcePaths(script) {
  if (typeof script !== 'string') return [];
  return [
    ...script.matchAll(
      /(?:^|\s)((?:convex|data|godot-taixu-client)\/[^\s*]+\.(?:ts|mjs|gd))(?=\s|$)/g,
    ),
  ].map((match) => normalizeDeclaredPath(match[1]));
}

function rootScriptSourcePaths(script) {
  if (typeof script !== 'string') return [];
  return [...script.matchAll(/(?:^|\s)(scripts\/[^\s*]+\.mjs)(?=\s|$)/g)].map((match) =>
    normalizeDeclaredPath(match[1]),
  );
}

function relativeModulePaths(importerPath) {
  if (!['.ts', '.mjs'].includes(extension(importerPath))) return [];
  const source = readFileSync(resolve(root, importerPath), 'utf8');
  const specifiers = [...source.matchAll(/\b(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(
    (match) => match[1],
  );
  const resolvedPaths = [];
  for (const specifier of specifiers) {
    const base = resolve(root, dirname(importerPath), specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.mjs`,
      `${base}.js`,
      `${base}.json`,
      resolve(base, 'index.ts'),
      resolve(base, 'index.mjs'),
      resolve(base, 'index.js'),
    ];
    const target = candidates.find((candidate) => existsSync(candidate));
    if (target) resolvedPaths.push(relative(root, target).replaceAll('\\', '/'));
  }
  return [...new Set(resolvedPaths)];
}

const clientReleaseFiles = walk('godot-taixu-client');
const generatedReleaseFiles = walk('convex/_generated');
const humanlikeCoreReleaseFiles = walk('packages/humanlike-agent-core');
const stableXianxiaDirectoryFiles = [
  'convex/xianxia/runtime',
  'convex/xianxia/domains',
  'convex/xianxia/adapters',
  'convex/xianxia/evaluation',
  'convex/xianxia/legacy',
  'convex/xianxia/schema',
].flatMap((directory) =>
  existsSync(resolve(root, directory)) ? walk(directory) : [],
);
const releaseFiles = [
  ...new Set([
    ...rootReleaseFiles,
    ...generatedReleaseFiles,
    ...clientReleaseFiles,
    ...humanlikeCoreReleaseFiles,
    ...stableXianxiaDirectoryFiles,
  ]),
].sort();
const releaseFileSet = new Set(releaseFiles);

// Batch Git reads once. Per-file subprocesses made this check take minutes on
// Windows, and porcelain paths are relative to the owning Git worktree.
const gitPrefix = git(['rev-parse', '--show-prefix']).trim();
const projectPath = (path) => {
  assert(path.startsWith(gitPrefix), `Git path is outside the project: ${path}`);
  return path.slice(gitPrefix.length).replaceAll('\\', '/');
};
const changedPaths = new Set(
  git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', '--', '.'])
    .split('\0').filter(Boolean).map((entry) => projectPath(entry.slice(3))),
);
const trackedPaths = new Set(
  git(['ls-files', '-z', '--cached', '--full-name', '--', '.'])
    .split('\0').filter(Boolean).map(projectPath),
);
const ignoredPaths = new Set(
  git(['check-ignore', '--no-index', '-z', '--stdin'],
    [...releaseFiles, ...ignoredRuntimePaths].join('\0') + '\0', true)
    .split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/')),
);

const bridgeTypecheck = JSON.parse(
  readFileSync(resolve(root, 'tsconfig.godot-bridge.json'), 'utf8'),
);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const typecheckFiles = new Set((bridgeTypecheck.files ?? []).map(normalizeDeclaredPath));
const lintFiles = new Set(scriptSourcePaths(packageJson.scripts?.['godot:check-lint']));
const unitFiles = new Set(scriptSourcePaths(packageJson.scripts?.['godot:check-unit']));

for (const path of [...typecheckFiles, ...unitFiles]) {
  assert(
    releaseFileSet.has(path),
    `Declared typecheck/unit source is outside the release unit: ${path}`,
  );
}
for (const path of typecheckFiles) {
  assert(lintFiles.has(path), `Bridge TypeScript source is missing from scoped lint: ${path}`);
}
for (const scriptName of valleyReleaseEntrypoints) {
  const declaredPaths = rootScriptSourcePaths(packageJson.scripts?.[scriptName]);
  assert(declaredPaths.length > 0, `Valley release entry point has no root script: ${scriptName}`);
  for (const path of declaredPaths) {
    assert(
      releaseFileSet.has(path),
      `Valley release entry point ${scriptName} is outside the release unit: ${path}`,
    );
  }
}
for (const path of valleyReleaseInputs) {
  assert(releaseFileSet.has(path), `Valley release input is outside the release unit: ${path}`);
}
for (const importerPath of releaseFiles) {
  for (const importedPath of relativeModulePaths(importerPath)) {
    assert(
      !changedPaths.has(importedPath) || releaseFileSet.has(importedPath),
      `Changed relative dependency is outside the release unit: ${importerPath} -> ${importedPath}`,
    );
  }
}

for (const path of releaseFiles) {
  assert(existsSync(resolve(root, path)), `Required release source is missing: ${path}`);
  assert(!ignoredPaths.has(path), `Release source is ignored: ${path}`);
}

for (const path of ignoredRuntimePaths) {
  assert(
    ignoredPaths.has(path),
    `Runtime/local path is not ignored: ${path}`,
  );
}

const credentialPattern =
  /(?:authorization\s*:\s*bearer|godot_bridge_(?:debug_)?token\s*[:=])\s*["']?[a-z0-9_=-]{24,}/i;
for (const path of releaseFiles) {
  if (!textExtensions.has(extension(path))) continue;
  const text = readFileSync(resolve(root, path), 'utf8');
  assert(!credentialPattern.test(text), `Possible embedded bridge credential in ${path}`);
}

const untracked = releaseFiles.filter(
  (path) => !trackedPaths.has(path),
);
if (listSource) {
  const untrackedSet = new Set(untracked);
  console.log(
    releaseFiles
      .map((path) => `${untrackedSet.has(path) ? 'untracked' : 'tracked  '} ${path}`)
      .join('\n'),
  );
}
if (jsonOutput) {
  console.log(JSON.stringify({ releaseFiles, untracked }));
}
if (requireTracked) {
  const uncommitted = releaseFiles.filter(
    (path) => changedPaths.has(path),
  );
  assert(
    untracked.length === 0,
    `Release source is not tracked (${untracked.length} file(s)); first entries: ${untracked.slice(0, 8).join(', ')}`,
  );
  assert(
    uncommitted.length === 0,
    `Release source is not committed (${uncommitted.length} file(s)); first entries: ${uncommitted.slice(0, 8).join(', ')}`,
  );
}

if (!jsonOutput) {
  console.log(
    `Godot source boundary check passed (${releaseFiles.length} release files, ${untracked.length} currently untracked${requireTracked ? ', tracking enforced' : ''}).`,
  );
}

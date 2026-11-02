import type { Id } from '../../../_generated/dataModel';
import type { AgentProposal } from '../../agentLogic';
import type { ActivePersonalGoal } from '../../personalGoalContracts';
import { agentActionClientId } from '../../actionIdempotency';

/**
 * Builds the already-existing GM admission request without owning or applying
 * any effect. The caller still invokes the single authoritative gm.actInternal
 * action, so this seam cannot become a second writer or scheduler.
 */
export function buildRuntimeAgentAdmission(input: {
  worldId: Id<'worlds'>;
  actorId: string;
  proposal: AgentProposal;
  decisionId?: string;
  providerDisabled: boolean;
  selectedPersonalGoal?: ActivePersonalGoal;
}) {
  return {
    worldId: input.worldId,
    type: input.proposal.type,
    actorId: input.actorId,
    source: 'agent' as const,
    clientActionId: input.decisionId
      ? agentActionClientId(input.decisionId, input.actorId)
      : undefined,
    targetActorId: input.proposal.targetActorId,
    targetId: input.proposal.targetId,
    locationId: input.proposal.locationId,
    intent: input.proposal.intent,
    params: input.proposal.params,
    providerPolicy: input.providerDisabled ? ('disabled' as const) : undefined,
    purposeGoalFence:
      input.selectedPersonalGoal?.purposeIntentDigest
        ? {
            goalId: input.selectedPersonalGoal.goalId,
            revision: input.selectedPersonalGoal.revision,
            intentDigest: input.selectedPersonalGoal.purposeIntentDigest,
          }
        : undefined,
  };
}

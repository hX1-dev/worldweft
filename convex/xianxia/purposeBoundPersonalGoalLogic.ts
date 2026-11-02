import type { AutonomyCandidateV3 } from './autonomyDecisionContracts';
import type { AgentContext, AgentProposal } from './agentLogic';
import type { PersonalGoalCandidate, PersonalGoalKind } from './personalGoalContracts';
import { personalGoalProgress } from './personalGoalLogic';
import {
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundLifePurpose,
} from './purposeBoundLifeIntentContracts';
import { purposeGoalCadenceKey } from './purposeGoalCadenceLogic';

export function purposePersonalGoalCandidateForProposal(
  context: AgentContext,
  input: { candidate: AutonomyCandidateV3; proposal: AgentProposal },
): PersonalGoalCandidate | null {
  const params = input.proposal.params ?? {};
  const validation = validatePurposeBoundLifeIntentV2(params.purposeBoundIntent);
  const requestedDigest =
    typeof params.purposeBoundIntentDigest === 'string'
      ? params.purposeBoundIntentDigest
      : undefined;
  if (!validation.ok || !requestedDigest) return null;
  const digest = purposeBoundLifeIntentDigest(validation.intent);
  if (requestedDigest !== digest) return null;
  const kind = purposeGoalKind(validation.intent.purposeKind);
  const progress = personalGoalProgress(
    context,
    kind,
    validation.intent.sourceRef,
    input.proposal,
  );
  return {
    candidateId: input.candidate.candidateId,
    goalKey: `purpose_v2:${digest}`.slice(0, 240),
    kind,
    sourceRef: validation.intent.sourceRef,
    targetRef: validation.intent.targetLocationId,
    intent: input.proposal.intent.slice(0, 240),
    progressScore: progress.score,
    progressKey: progress.key.slice(0, 240),
    purposeIntent: validation.intent,
    purposeIntentDigest: digest,
    purposeCadenceKey: purposeGoalCadenceKey(validation.intent),
  };
}

function purposeGoalKind(purpose: PurposeBoundLifePurpose): PersonalGoalKind {
  switch (purpose) {
    case 'recovery':
      return 'recovery';
    case 'cultivation':
      return 'cultivation';
    case 'obligation':
    case 'duty_return':
      return 'commitment';
    case 'relationship':
      return 'relationship';
    case 'livelihood':
    case 'exploration':
      return 'livelihood';
  }
}

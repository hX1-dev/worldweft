import type { GroupSocialCoordinationCandidate } from '../../groupSocialCoordinationLogic';
import type { AgentContext } from '../../agentLogic';
import type { PurposeBoundLifeCandidateBundleV2 } from '../../purposeBoundLifeCandidateLogic';
import {
  buildSocialInvitationCoordinationCandidates,
  type SocialInvitationCoordinationCandidate,
} from '../../socialInvitationCoordinationLogic';
import { buildUnifiedLifeSocialCandidateBundle } from '../../unifiedLifeSocialCandidateLogic';

export function composeRuntimeAgentCandidateSource(input: {
  purposeBundle: PurposeBoundLifeCandidateBundleV2;
  invitationInput: Parameters<typeof buildSocialInvitationCoordinationCandidates>[0];
  groupCandidates: readonly GroupSocialCoordinationCandidate[];
}): {
  purposeFactsDigest: string;
  purposeBoundLifeCandidateBundle: NonNullable<AgentContext['purposeBoundLifeCandidateBundle']>;
  invitationCandidates: SocialInvitationCoordinationCandidate[];
} {
  const invitationCandidates = buildSocialInvitationCoordinationCandidates(input.invitationInput);
  const unifiedBundle = buildUnifiedLifeSocialCandidateBundle({
    purposeFactsDigest: input.purposeBundle.purposeFactsDigest,
    purposeCandidates: input.purposeBundle.candidates,
    invitationCandidates,
    groupCandidates: input.groupCandidates,
  });
  return {
    purposeFactsDigest: unifiedBundle.purposeFactsDigest,
    purposeBoundLifeCandidateBundle: {
      ...input.purposeBundle,
      purposeFactsDigest: unifiedBundle.purposeFactsDigest,
      candidateSetDigest: unifiedBundle.candidateSetDigest,
      candidates: unifiedBundle.candidates,
    },
    invitationCandidates,
  };
}

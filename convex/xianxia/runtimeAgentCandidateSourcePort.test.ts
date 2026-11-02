import { PURPOSE_BOUND_LIFE_CANDIDATE_VERSION, type PurposeBoundLifeCandidateBundleV2 } from './purposeBoundLifeCandidateLogic';
import { composeRuntimeAgentCandidateSource } from './runtimeAgentCandidateSourcePort';

describe('RuntimeAgentCandidateSourcePort', () => {
  const purposeBundle: PurposeBoundLifeCandidateBundleV2 = {
    contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
    purposeFactsDigest: 'purpose:fixed',
    candidateSetDigest: 'candidate:empty',
    candidates: [],
  };

  it('reuses the existing empty-source composition without manufacturing candidates', () => {
    const result = composeRuntimeAgentCandidateSource({
      purposeBundle,
      invitationInput: {
        actorId: 'han-li',
        personalGoalActive: false,
        inviteAllowed: false,
        respondAllowed: false,
        remoteOpportunities: [],
        pendingInvitations: [],
        priorityProjectionV1: true,
      },
      groupCandidates: [],
    });
    expect(result.invitationCandidates).toEqual([]);
    expect(result.purposeBoundLifeCandidateBundle.candidates).toEqual([]);
    expect(result.purposeBoundLifeCandidateBundle.candidateSetDigest).not.toBe(purposeBundle.candidateSetDigest);
  });

  it('is replay-stable for the same existing source inputs', () => {
    const input = {
      purposeBundle,
      invitationInput: {
        actorId: 'han-li', personalGoalActive: false, inviteAllowed: false, respondAllowed: false,
        remoteOpportunities: [], pendingInvitations: [], priorityProjectionV1: true,
      },
      groupCandidates: [] as const,
    };
    expect(composeRuntimeAgentCandidateSource(input)).toEqual(composeRuntimeAgentCandidateSource(input));
  });
});

import type { AgentProposal } from './agentLogic';
import type { PendingSocialInvitationSource } from './socialInvitations';
import type { RemoteSocialInvitationOpportunity } from './remoteSocialInvitationOpportunityLogic';

export type SocialInvitationCoordinationCandidate = {
  planner: 'social_coordination';
  candidateId: string;
  legacyOrder: number;
  proposal: AgentProposal;
};

/** Host-side projection. Pi NPC receives only these bounded proposals through
 * the existing purpose candidate bundle; the portable kernel does not import
 * invitation planning or database-domain code. */
export function buildSocialInvitationCoordinationCandidates(input: {
  actorId: string;
  currentLocationId?: string;
  personalGoalActive: boolean;
  inviteAllowed: boolean;
  respondAllowed: boolean;
  remoteOpportunities: readonly RemoteSocialInvitationOpportunity[];
  pendingInvitations: readonly PendingSocialInvitationSource[];
  priorityProjectionV1?: boolean;
}): SocialInvitationCoordinationCandidate[] {
  if (input.personalGoalActive) return [];
  const candidates: SocialInvitationCoordinationCandidate[] = [];
  if (input.respondAllowed) {
    for (const pending of input.pendingInvitations) {
      const receipt = pending.receipt;
      if (receipt.targetActorId !== input.actorId) continue;
      if (pending.canAccept) {
        candidates.push({
          planner: 'social_coordination',
          candidateId: `accept:${receipt.invitationId}:${receipt.revision}`,
          legacyOrder: 0,
          proposal: {
            type: 'respond_social_invitation',
            targetActorId: receipt.actorId,
            locationId: input.currentLocationId,
            params: {
              socialInvitationId: receipt.invitationId,
              expectedRevision: receipt.revision,
              response: 'accept',
              ...(input.priorityProjectionV1 ? { socialWarrant: pending.warrant } : {}),
            },
            intent: `接受${pending.inviterName}因${pending.warrant.sourceRef}提出的有界会面邀请`,
            source: 'agent',
          },
        });
      }
      candidates.push({
        planner: 'social_coordination',
        candidateId: `decline:${receipt.invitationId}:${receipt.revision}`,
        legacyOrder: 1,
        proposal: {
          type: 'respond_social_invitation',
          targetActorId: receipt.actorId,
          locationId: input.currentLocationId,
          params: {
            socialInvitationId: receipt.invitationId,
            expectedRevision: receipt.revision,
            response: 'decline',
            ...(input.priorityProjectionV1 ? { socialWarrant: pending.warrant } : {}),
          },
          intent: `拒绝${pending.inviterName}提出的这次会面邀请`,
          source: 'agent',
        },
      });
    }
  }
  if (input.inviteAllowed) {
    for (const opportunity of input.remoteOpportunities) {
      if (opportunity.warrant.actorId !== input.actorId) continue;
      candidates.push({
        planner: 'social_coordination',
        candidateId: `invite:${opportunity.candidateId}`,
        legacyOrder: 2,
        proposal: {
          type: 'invite_social',
          targetActorId: opportunity.targetActorId,
          locationId: input.currentLocationId,
          params: {
            socialWarrant: opportunity.warrant,
            socialCandidateId: opportunity.candidateId,
            intendedActivity: opportunity.intendedActivity,
            summary: opportunity.summary,
          },
          intent: opportunity.summary,
          source: 'agent',
        },
      });
    }
  }
  return candidates.slice(0, 12);
}

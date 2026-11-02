import type { AgentProposal } from './agentLogic';
import type { GroupSocialInitiationRuntimeSource } from './groupSocialInitiations';
import { groupSocialWarrantCandidateBindingDigest } from './groupSocialInitiationContracts';
import type { GroupSocialOpportunity } from './groupSocialOpportunityLogic';
import {
  socialOpportunityCandidateDigest,
  socialWarrantDigest,
} from './socialWarrantContracts';

export type GroupSocialCoordinationCandidate = {
  planner: 'group_coordination';
  candidateId: string;
  legacyOrder: number;
  proposal: AgentProposal;
};

export function buildGroupSocialCoordinationProposals(input: {
  actorId: string;
  currentLocationId?: string;
  allowed: boolean;
  opportunities: GroupSocialOpportunity[];
  active: GroupSocialInitiationRuntimeSource[];
  priorityProjectionV1?: boolean;
}): AgentProposal[] {
  return buildGroupSocialCoordinationCandidates(input).map((candidate) => candidate.proposal);
}

export function buildGroupSocialCoordinationCandidates(input: {
  actorId: string;
  currentLocationId?: string;
  allowed: boolean;
  opportunities: GroupSocialOpportunity[];
  active: GroupSocialInitiationRuntimeSource[];
  priorityProjectionV1?: boolean;
}): GroupSocialCoordinationCandidate[] {
  if (!input.allowed || !input.currentLocationId) return [];
  const candidates: GroupSocialCoordinationCandidate[] = [];
  const add = (candidateId: string, legacyOrder: number, proposal: AgentProposal) => {
    candidates.push({ planner: 'group_coordination', candidateId, legacyOrder, proposal });
  };
  for (const source of input.active) {
    const candidateProjection = {
      socialOpportunityCandidateId: source.receipt.candidateId,
      socialOpportunityCandidateDigest: source.receipt.candidateDigest,
      socialWarrantCandidateDigest: groupSocialWarrantCandidateBindingDigest({
        warrantDigest: source.receipt.warrantDigest,
        candidateDigest: source.receipt.candidateDigest,
      }),
    };
    const member = source.members.find((entry) => entry.actorId === input.actorId);
    if (member?.response === 'pending' && source.canRespond) {
      add(`group:accept:${source.receipt.initiationId}:${source.receipt.revision}`, 100, {
        type: 'group_talk',
        locationId: input.currentLocationId,
        intent: `接受基于 ${source.receipt.sourceRef} 的群体商议邀请`,
        params: {
          operation: 'respond_invitation',
          initiationId: source.receipt.initiationId,
          expectedRevision: source.receipt.revision,
          response: 'accept',
          ...candidateProjection,
          ...(input.priorityProjectionV1 ? {
            groupSourceKind: 'active_initiation',
            groupSourceRef: source.receipt.sourceRef,
            groupSourceRevision: source.receipt.sourceRevision,
          } : {}),
        },
        source: 'agent',
      });
      add(`group:decline:${source.receipt.initiationId}:${source.receipt.revision}`, 101, {
        type: 'group_talk',
        locationId: input.currentLocationId,
        intent: `拒绝基于 ${source.receipt.sourceRef} 的群体商议邀请`,
        params: {
          operation: 'respond_invitation',
          initiationId: source.receipt.initiationId,
          expectedRevision: source.receipt.revision,
          response: 'decline',
          ...candidateProjection,
          ...(input.priorityProjectionV1 ? {
            groupSourceKind: 'active_initiation',
            groupSourceRef: source.receipt.sourceRef,
            groupSourceRevision: source.receipt.sourceRevision,
          } : {}),
        },
        source: 'agent',
      });
    }
    if (source.canStart) {
      add(`group:start:${source.receipt.initiationId}:${source.receipt.revision}`, 100, {
        type: 'group_talk',
        locationId: input.currentLocationId,
        intent: `启动已全员同意的 ${source.receipt.sourceRef} 群体商议`,
        params: {
          operation: 'start',
          initiationId: source.receipt.initiationId,
          expectedRevision: source.receipt.revision,
          ...candidateProjection,
          ...(input.priorityProjectionV1 ? {
            groupSourceKind: 'active_initiation',
            groupSourceRef: source.receipt.sourceRef,
            groupSourceRevision: source.receipt.sourceRevision,
          } : {}),
        },
        source: 'agent',
      });
    }
  }
  const activeSources = new Set(input.active.map((entry) =>
    `${entry.receipt.sourceRef}|${entry.receipt.sourceRevision}`));
  for (const opportunity of input.opportunities) {
    if (activeSources.has(`${opportunity.warrant.sourceRef}|${opportunity.warrant.sourceRevision}`)) continue;
    add(`group:invite:${opportunity.candidate.candidateId}`, 150, {
      type: 'group_talk',
      locationId: input.currentLocationId,
      intent: opportunity.candidate.summary,
      params: {
        operation: 'invite',
        candidateId: opportunity.candidate.candidateId,
        warrantId: opportunity.warrant.warrantId,
        socialOpportunityCandidateId: opportunity.candidate.candidateId,
        socialOpportunityCandidateDigest: socialOpportunityCandidateDigest(
          opportunity.candidate,
        ),
        socialWarrantCandidateDigest: groupSocialWarrantCandidateBindingDigest({
          warrantDigest: socialWarrantDigest(opportunity.warrant),
          candidateDigest: socialOpportunityCandidateDigest(opportunity.candidate),
        }),
        ...(input.priorityProjectionV1 ? {
          groupSourceKind: opportunity.sourceKind,
          groupSourceRef: opportunity.warrant.sourceRef,
          groupSourceRevision: opportunity.warrant.sourceRevision,
          groupParticipantRole: opportunity.participantRoles.find(
            (entry) => entry.actorId === input.actorId,
          )?.role,
        } : {}),
      },
      source: 'agent',
    });
  }
  return candidates.slice(0, 8);
}

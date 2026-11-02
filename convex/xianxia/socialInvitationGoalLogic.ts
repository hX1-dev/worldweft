import {
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundLifeIntentV2,
  type PurposeBoundLifePurpose,
} from './purposeBoundLifeIntentContracts';
import {
  SOCIAL_INVITATION_VERSION,
  socialInvitationDigest,
  validateSocialInvitationReceipt,
  type SocialInvitationReceipt,
} from './socialInvitationContracts';
import {
  socialWarrantCandidateDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';

export const ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION =
  'taixu.accepted-social-invitation-source.v1' as const;

export type AcceptedSocialInvitationSource = {
  contractVersion: typeof ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION;
  receipt: SocialInvitationReceipt;
  receiptDigest: string;
  warrant: SocialWarrant;
  candidate: SocialOpportunityCandidate;
  targetLocationId: string;
  targetAliveAndCapable: boolean;
  targetBusy: boolean;
  targetStillAtMeeting: boolean;
  sourceCurrent: boolean;
  capacityAvailable: boolean;
};

export type SocialInvitationIntentProjection = {
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  activity: 'talk' | 'gift' | 'request_teaching';
  targetActorId: string;
  params: {
    socialInvitationId: string;
    socialInvitationRevision: number;
    socialInvitationReceiptDigest: string;
    socialWarrantDigest: string;
    socialOpportunityCandidateId: string;
    socialOpportunityCandidateDigest: string;
    socialWarrantCandidateDigest: string;
    socialTargetActorId: string;
  };
};

export function projectAcceptedSocialInvitationIntent(
  source: AcceptedSocialInvitationSource,
):
  | { ok: true; projection: SocialInvitationIntentProjection }
  | { ok: false; reasonCode: string } {
  if (source.contractVersion !== ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION) {
    return failure('social_invitation_source_version_invalid');
  }
  const receipt = validateSocialInvitationReceipt(source.receipt);
  const warrant = validateSocialWarrant(source.warrant);
  const candidate = validateSocialOpportunityCandidate(source.candidate, source.warrant);
  if (!receipt.ok || !warrant.ok || !candidate.ok) {
    return failure('social_invitation_source_contract_invalid');
  }
  if (
    receipt.receipt.contractVersion !== SOCIAL_INVITATION_VERSION ||
    receipt.receipt.status !== 'accepted' ||
    source.receiptDigest !== socialInvitationDigest(receipt.receipt) ||
    receipt.receipt.warrantId !== warrant.warrant.warrantId ||
    receipt.receipt.candidateId !== candidate.candidate.candidateId ||
    receipt.receipt.actorId !== warrant.warrant.actorId ||
    receipt.receipt.targetActorId !== candidate.candidate.targetActorIds[0] ||
    receipt.receipt.meetingLocationId !== source.targetLocationId
  ) {
    return failure('social_invitation_source_digest_mismatch');
  }
  if (!source.sourceCurrent) return failure('social_invitation_source_stale');
  if (!source.targetAliveAndCapable) return failure('social_invitation_target_unavailable');
  if (source.targetBusy) return failure('social_invitation_target_busy');
  if (!source.targetStillAtMeeting) return failure('social_invitation_target_moved');
  if (!source.capacityAvailable) return failure('social_invitation_capacity_full');
  const activity = purposeActivity(receipt.receipt.intendedActivity);
  if (!activity) return failure('social_invitation_activity_unavailable');
  const sourceRef = `invitation:${receipt.receipt.invitationId}`;
  const sourceRevision = invitationSourceRevision(receipt.receipt);
  const purposeKind = purposeKindForWarrant(warrant.warrant);
  const completionCondition: PurposeBoundLifeIntentV2['completionCondition'] =
    activity === 'talk'
      ? {
          kind: 'social_session_terminal',
          subjectRef: sourceRef,
          expectedRevision: sourceRevision,
          warrantDigest: receipt.receipt.warrantDigest,
          targetActorId: receipt.receipt.targetActorId,
          terminalStatus: 'resolved',
        }
      : {
          kind: 'interaction_event_recorded',
          subjectRef: sourceRef,
          afterEventRevision: sourceRevision,
          interactionType: activity,
        };
  const intent: PurposeBoundLifeIntentV2 = {
    contractVersion: 'taixu.purpose-bound-life-intent.v2',
    purposeKind,
    sourceRef,
    sourceRevision,
    targetLocationId: receipt.receipt.meetingLocationId,
    intendedActivity: activity,
    completionCondition,
    interruptionPolicy: 'survival_or_invalidated',
  };
  const validation = validatePurposeBoundLifeIntentV2(intent);
  if (!validation.ok) return failure(validation.reasonCode);
  return {
    ok: true,
    projection: {
      intent: validation.intent,
      intentDigest: purposeBoundLifeIntentDigest(validation.intent),
      activity,
      targetActorId: receipt.receipt.targetActorId,
      params: {
        socialInvitationId: receipt.receipt.invitationId,
        socialInvitationRevision: receipt.receipt.revision,
        socialInvitationReceiptDigest: source.receiptDigest,
        socialWarrantDigest: receipt.receipt.warrantDigest,
        socialOpportunityCandidateId: receipt.receipt.candidateId,
        socialOpportunityCandidateDigest: receipt.receipt.candidateDigest,
        socialWarrantCandidateDigest: socialWarrantCandidateDigest(
          warrant.warrant,
          candidate.candidate,
        ),
        socialTargetActorId: receipt.receipt.targetActorId,
      },
    },
  };
}

export function invitationSourceRevision(receipt: SocialInvitationReceipt) {
  return `invitation:rev:${receipt.revision}:${receipt.warrantDigest}`;
}

function purposeActivity(activity: SocialInvitationReceipt['intendedActivity']) {
  if (activity === 'talk' || activity === 'gift') return activity;
  if (activity === 'teach') return 'request_teaching' as const;
  return undefined;
}

function purposeKindForWarrant(warrant: SocialWarrant): PurposeBoundLifePurpose {
  if (warrant.kind === 'care_or_aid') return 'recovery';
  if (warrant.kind === 'active_obligation') return 'obligation';
  return 'relationship';
}

function failure(reasonCode: string) {
  return { ok: false as const, reasonCode };
}

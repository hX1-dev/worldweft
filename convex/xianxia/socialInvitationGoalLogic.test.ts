import {
  ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION,
  invitationSourceRevision,
  projectAcceptedSocialInvitationIntent,
  type AcceptedSocialInvitationSource,
} from './socialInvitationGoalLogic';
import {
  createSocialInvitationReceipt,
  socialInvitationDigest,
  transitionSocialInvitation,
} from './socialInvitationContracts';
import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  SOCIAL_WARRANT_VERSION,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';

const warrant: SocialWarrant = {
  contractVersion: SOCIAL_WARRANT_VERSION,
  warrantId: 'warrant:relationship:1',
  actorId: 'hanli',
  kind: 'relationship_maintenance',
  sourceRef: 'relationship:liu_qiaoer',
  sourceRevision: 'relationship:rev:1',
  intendedOutcome: 'maintain_bond',
  eligibleTargetActorIds: ['liu_qiaoer'],
  topicRefs: ['relationship:maintenance:liu_qiaoer'],
  audience: 'participants',
  urgencyBand: 'routine',
  createdAt: 1,
  expiresAt: 1_000,
};

const candidate: SocialOpportunityCandidate = {
  contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  candidateId: 'candidate:invite:1',
  warrantId: warrant.warrantId,
  mode: 'invite_then_travel',
  targetActorIds: ['liu_qiaoer'],
  meetingLocationId: 'alchemy_room',
  intendedActivity: 'talk',
  summary: '前往丹房叙旧',
};

function source(): AcceptedSocialInvitationSource {
  const pending = createSocialInvitationReceipt({
    invitationId: 'invitation:1',
    actorId: 'hanli',
    targetActorId: 'liu_qiaoer',
    warrant,
    candidate,
    meetingMapId: 'world',
    meetingLocationId: 'alchemy_room',
    now: 1,
    expiresAt: 1_000,
  });
  const accepted = transitionSocialInvitation({
    receipt: pending,
    expectedRevision: 1,
    operation: 'accept',
    now: 2,
    capacityAvailable: true,
  });
  if (!accepted.ok) throw new Error('expected accepted');
  return {
    contractVersion: ACCEPTED_SOCIAL_INVITATION_SOURCE_VERSION,
    receipt: accepted.receipt,
    receiptDigest: socialInvitationDigest(accepted.receipt),
    warrant,
    candidate,
    targetLocationId: 'alchemy_room',
    targetAliveAndCapable: true,
    targetBusy: false,
    targetStillAtMeeting: true,
    sourceCurrent: true,
    capacityAvailable: true,
  };
}

describe('C021b0c accepted invitation goal projection', () => {
  test('accepted invitation becomes a travel→talk→session terminal intent', () => {
    const result = projectAcceptedSocialInvitationIntent(source());
    expect(result).toMatchObject({
      ok: true,
      projection: {
        activity: 'talk',
        targetActorId: 'liu_qiaoer',
        intent: {
          purposeKind: 'relationship',
          sourceRef: 'invitation:invitation:1',
          targetLocationId: 'alchemy_room',
          intendedActivity: 'talk',
          completionCondition: {
            kind: 'social_session_terminal',
            targetActorId: 'liu_qiaoer',
            terminalStatus: 'resolved',
          },
        },
      },
    });
    if (!result.ok) throw new Error('expected projection');
    expect(result.projection.intent.sourceRevision).toBe(
      invitationSourceRevision(source().receipt),
    );
  });

  test.each([
    ['sourceCurrent', false, 'social_invitation_source_stale'],
    ['targetAliveAndCapable', false, 'social_invitation_target_unavailable'],
    ['targetBusy', true, 'social_invitation_target_busy'],
    ['targetStillAtMeeting', false, 'social_invitation_target_moved'],
    ['capacityAvailable', false, 'social_invitation_capacity_full'],
  ] as const)('%s counterfactual blocks the goal', (key, value, reasonCode) => {
    expect(projectAcceptedSocialInvitationIntent({ ...source(), [key]: value })).toEqual({
      ok: false,
      reasonCode,
    });
  });

  test('pending or digest-drifted invitation cannot create a travel goal', () => {
    const accepted = source();
    expect(projectAcceptedSocialInvitationIntent({
      ...accepted,
      receipt: { ...accepted.receipt, status: 'pending', respondedAt: undefined },
    })).toEqual({ ok: false, reasonCode: 'social_invitation_source_digest_mismatch' });
    expect(projectAcceptedSocialInvitationIntent({
      ...accepted,
      receiptDigest: 'stable64:stale',
    })).toEqual({ ok: false, reasonCode: 'social_invitation_source_digest_mismatch' });
  });
});

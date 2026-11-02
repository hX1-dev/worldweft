import {
  SOCIAL_INVITATION_CAPACITY,
  SOCIAL_INVITATION_VERSION,
  createSocialInvitationReceipt,
  selectSocialMeetingLocation,
  socialInvitationDigest,
  socialMeetingCapacity,
  transitionSocialInvitation,
  validateSocialInvitationReceipt,
  type SocialInvitationReceipt,
} from './socialInvitationContracts';
import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  SOCIAL_WARRANT_VERSION,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';

const warrant: SocialWarrant = {
  contractVersion: SOCIAL_WARRANT_VERSION,
  warrantId: 'warrant:aid:1',
  actorId: 'hanli',
  kind: 'care_or_aid',
  sourceRef: 'body:hanli',
  sourceRevision: 'body:rev:1',
  intendedOutcome: 'request_aid',
  eligibleTargetActorIds: ['liu_qiaoer'],
  topicRefs: ['body:health:hanli'],
  audience: 'private',
  urgencyBand: 'important',
  createdAt: 100,
  expiresAt: 1_000,
};

const candidate: SocialOpportunityCandidate = {
  contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  candidateId: 'candidate:aid:travel:1',
  warrantId: warrant.warrantId,
  mode: 'invite_then_travel',
  targetActorIds: ['liu_qiaoer'],
  meetingLocationId: 'alchemy_room',
  intendedActivity: 'talk',
  summary: '前往丹房当面求助',
};

function receipt(): SocialInvitationReceipt {
  return createSocialInvitationReceipt({
    invitationId: 'invitation:1',
    actorId: 'hanli',
    targetActorId: 'liu_qiaoer',
    warrant,
    candidate,
    meetingMapId: 'world',
    meetingLocationId: 'alchemy_room',
    now: 100,
    expiresAt: 1_000,
  });
}

describe('C021b0c social invitation contracts', () => {
  test('creates a bounded receipt tied to the exact warrant and candidate', () => {
    const value = receipt();
    expect(value).toMatchObject({
      contractVersion: SOCIAL_INVITATION_VERSION,
      revision: 1,
      status: 'pending',
      reservedCapacity: SOCIAL_INVITATION_CAPACITY,
      actorId: 'hanli',
      targetActorId: 'liu_qiaoer',
      meetingLocationId: 'alchemy_room',
    });
    expect(validateSocialInvitationReceipt(value)).toMatchObject({ ok: true });
  });

  test('unknown fields, self-targets and malformed terminal shapes fail closed', () => {
    expect(validateSocialInvitationReceipt({ ...receipt(), hidden: true })).toEqual({
      ok: false,
      reasonCode: 'social_invitation_unknown_field',
    });
    expect(validateSocialInvitationReceipt({ ...receipt(), targetActorId: 'hanli' })).toEqual({
      ok: false,
      reasonCode: 'social_invitation_self_target',
    });
    expect(validateSocialInvitationReceipt({ ...receipt(), status: 'declined' })).toEqual({
      ok: false,
      reasonCode: 'social_invitation_terminal_shape_invalid',
    });
  });

  test('accept is explicit, capacity-gated and idempotent', () => {
    expect(
      transitionSocialInvitation({
        receipt: receipt(),
        expectedRevision: 1,
        operation: 'accept',
        now: 200,
        capacityAvailable: false,
      }),
    ).toEqual({ ok: false, reasonCode: 'social_invitation_capacity_full' });
    const accepted = transitionSocialInvitation({
      receipt: receipt(),
      expectedRevision: 1,
      operation: 'accept',
      now: 200,
      capacityAvailable: true,
    });
    expect(accepted).toMatchObject({
      ok: true,
      replay: false,
      receipt: { revision: 2, status: 'accepted', respondedAt: 200 },
    });
    if (!accepted.ok) throw new Error('expected accepted');
    expect(
      transitionSocialInvitation({
        receipt: accepted.receipt,
        expectedRevision: 2,
        operation: 'accept',
        now: 201,
        capacityAvailable: true,
      }),
    ).toMatchObject({ ok: true, replay: true, receipt: { revision: 2 } });
  });

  test.each([
    ['decline', 'declined', 'social_invitation_declined'],
    ['cancel', 'cancelled', 'social_invitation_cancelled'],
    ['expire', 'expired', 'social_invitation_expired'],
  ] as const)('%s is an irreversible terminal', (operation, status, reasonCode) => {
    const terminal = transitionSocialInvitation({
      receipt: receipt(),
      expectedRevision: 1,
      operation,
      now: operation === 'expire' ? 1_000 : 200,
    });
    expect(terminal).toMatchObject({
      ok: true,
      replay: false,
      receipt: { revision: 2, status, terminalReasonCode: reasonCode },
    });
    if (!terminal.ok) throw new Error('expected terminal');
    expect(
      transitionSocialInvitation({
        receipt: terminal.receipt,
        expectedRevision: 2,
        operation: 'accept',
        now: 300,
        capacityAvailable: true,
      }),
    ).toEqual({ ok: false, reasonCode });
  });

  test('stale revisions and accept after expiry never advance state', () => {
    expect(
      transitionSocialInvitation({
        receipt: receipt(),
        expectedRevision: 2,
        operation: 'decline',
        now: 200,
      }),
    ).toEqual({ ok: false, reasonCode: 'social_invitation_stale_revision' });
    expect(
      transitionSocialInvitation({
        receipt: receipt(),
        expectedRevision: 1,
        operation: 'accept',
        now: 1_000,
        capacityAvailable: true,
      }),
    ).toEqual({ ok: false, reasonCode: 'social_invitation_expired' });
  });

  test('an accepted journey can be cancelled by movement or lease terminal', () => {
    const accepted = transitionSocialInvitation({
      receipt: receipt(),
      expectedRevision: 1,
      operation: 'accept',
      now: 200,
      capacityAvailable: true,
    });
    if (!accepted.ok) throw new Error('expected accepted');
    expect(transitionSocialInvitation({
      receipt: accepted.receipt,
      expectedRevision: 2,
      operation: 'cancel',
      now: 300,
      reasonCode: 'social_invitation_movement_blocked',
    })).toMatchObject({
      ok: true,
      replay: false,
      receipt: {
        revision: 3,
        status: 'cancelled',
        respondedAt: 200,
        terminalReasonCode: 'social_invitation_movement_blocked',
      },
    });
  });

  test('server meeting selection prefers target, then actor, danger and stable id', () => {
    const locations = [
      { locationId: 'quiet_retreat', mapId: 'world', dangerLevel: 0, allowedActions: ['talk'], capacity: 4, occupiedCapacity: 0 },
      { locationId: 'alchemy_room', mapId: 'world', dangerLevel: 1, allowedActions: ['talk'], capacity: 2, occupiedCapacity: 0 },
      { locationId: 'market', mapId: 'world', dangerLevel: 0, allowedActions: ['talk'], capacity: 2, occupiedCapacity: 1 },
      { locationId: 'danger', mapId: 'world', dangerLevel: 2, allowedActions: ['talk'], capacity: 10, occupiedCapacity: 0 },
    ];
    expect(selectSocialMeetingLocation({
      mapId: 'world',
      actorLocationId: 'quiet_retreat',
      targetLocationId: 'alchemy_room',
      intendedActivity: 'talk',
      locations,
    })?.locationId).toBe('alchemy_room');
    expect(selectSocialMeetingLocation({
      mapId: 'world',
      actorLocationId: 'quiet_retreat',
      targetLocationId: 'market',
      intendedActivity: 'talk',
      locations,
    })?.locationId).toBe('quiet_retreat');
  });

  test('teaching maps to request_teaching and capacity never overbooks', () => {
    expect(selectSocialMeetingLocation({
      mapId: 'world',
      intendedActivity: 'teach',
      locations: [{
        locationId: 'hall',
        mapId: 'world',
        dangerLevel: 0,
        allowedActions: ['request_teaching'],
        capacity: 3,
        occupiedCapacity: 1,
      }],
    })?.locationId).toBe('hall');
    expect(selectSocialMeetingLocation({
      mapId: 'world',
      intendedActivity: 'teach',
      locations: [{
        locationId: 'hall',
        mapId: 'world',
        dangerLevel: 0,
        allowedActions: ['request_teaching'],
        capacity: 3,
        occupiedCapacity: 2,
      }],
    })).toBeUndefined();
    expect(socialMeetingCapacity({ entryPointCount: 1, bounds: { x1: 0, y1: 0, x2: 2, y2: 1 } })).toBe(6);
  });

  test('digest is stable for exact replay and changes with revision or status', () => {
    const value = receipt();
    expect(socialInvitationDigest(value)).toBe(socialInvitationDigest({ ...value }));
    expect(socialInvitationDigest(value)).not.toBe(
      socialInvitationDigest({ ...value, revision: 2, status: 'accepted', respondedAt: 200 }),
    );
  });
});

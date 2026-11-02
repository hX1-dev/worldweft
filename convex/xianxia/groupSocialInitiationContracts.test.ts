import {
  createGroupSocialInitiationReceipt,
  groupSocialInitiationDigest,
  startGroupSocialInitiation,
  terminalizeGroupSocialInitiation,
  transitionGroupSocialResponse,
  validateGroupSocialInitiationReceipt,
} from './groupSocialInitiationContracts';
import { deriveGroupSocialOpportunities } from './groupSocialOpportunityLogic';

const NOW = 10_000;

function created() {
  const opportunity = deriveGroupSocialOpportunities({
    now: NOW,
    nowGameHour: 35,
    actorId: 'host',
    mapId: 'world',
    locationId: 'hall',
    location: { allowedActions: ['group_talk', 'group_decide'], dangerLevel: 0, capacity: 5, occupiedCapacity: 0 },
    actors: [
      { actorId: 'host', role: 'steward', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
      { actorId: 'assignee', role: 'outer_disciple', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
      { actorId: 'expert', role: 'merchant', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
    ],
    requests: [{
      requestId: 'r1', revision: 1, status: 'accepted', type: 'collect_item',
      issuerActorId: 'host', assigneeActorId: 'assignee', itemId: 'spirit_herb',
    }],
    events: [],
    resources: [],
  })[0];
  return createGroupSocialInitiationReceipt({ opportunity, meetingMapId: 'world', now: NOW });
}

describe('C021b0d group initiation contract', () => {
  test('creates a canonical 3-person receipt with host accepted', () => {
    const value = created();
    expect(value.receipt).toMatchObject({ status: 'pending', revision: 1, participantActorIds: ['assignee', 'expert', 'host'] });
    expect(value.members).toEqual(expect.arrayContaining([
      { actorId: 'host', role: 'decision_owner', response: 'accepted', respondedAt: NOW },
      { actorId: 'assignee', role: 'affected_party', response: 'pending' },
    ]));
    expect(validateGroupSocialInitiationReceipt(value.receipt).ok).toBe(true);
    expect(groupSocialInitiationDigest({
      ...value.receipt,
      participantActorIds: [...value.receipt.participantActorIds].reverse(),
      participantRoles: [...value.receipt.participantRoles].reverse(),
    })).toBe(groupSocialInitiationDigest(value.receipt));
  });

  test('strict validation rejects unknown fields, observer privacy and malformed roles', () => {
    const { receipt } = created();
    expect(validateGroupSocialInitiationReceipt({ ...receipt, surprise: true })).toEqual({ ok: false, reasonCode: 'group_social_receipt_unknown_field' });
    expect(validateGroupSocialInitiationReceipt({ ...receipt, observerActorIds: ['observer'] })).toEqual({ ok: false, reasonCode: 'group_social_privacy_forbidden' });
    expect(validateGroupSocialInitiationReceipt({ ...receipt, participantRoles: receipt.participantRoles.map((entry) => ({ ...entry, role: 'witness' })) })).toEqual({ ok: false, reasonCode: 'group_social_role_invalid' });
  });

  test('individual acceptance reaches ready and stale/replay is bounded', () => {
    const first = created();
    const acceptedA = transitionGroupSocialResponse({
      ...first, actorId: 'assignee', expectedRevision: 1, response: 'accept', now: NOW + 1,
    });
    expect(acceptedA).toMatchObject({ ok: true, replay: false, receipt: { status: 'pending', revision: 2 } });
    if (!acceptedA.ok) throw new Error('expected accepted A');
    expect(transitionGroupSocialResponse({
      receipt: acceptedA.receipt, members: acceptedA.members, actorId: 'expert',
      expectedRevision: 1, response: 'accept', now: NOW + 2,
    })).toEqual({ ok: false, reasonCode: 'group_social_stale_revision' });
    const acceptedB = transitionGroupSocialResponse({
      receipt: acceptedA.receipt, members: acceptedA.members, actorId: 'expert',
      expectedRevision: 2, response: 'accept', now: NOW + 2,
    });
    expect(acceptedB).toMatchObject({ ok: true, receipt: { status: 'ready', revision: 3 } });
    if (!acceptedB.ok) throw new Error('expected ready');
    expect(transitionGroupSocialResponse({
      receipt: acceptedB.receipt, members: acceptedB.members, actorId: 'expert',
      expectedRevision: 3, response: 'accept', now: NOW + 3,
    })).toMatchObject({ ok: true, replay: true });
  });

  test('one decline terminalizes the whole initiation and cannot be shrunk', () => {
    const first = created();
    const declined = transitionGroupSocialResponse({
      ...first, actorId: 'assignee', expectedRevision: 1, response: 'decline', now: NOW + 1,
    });
    expect(declined).toMatchObject({
      ok: true,
      receipt: { status: 'declined', terminalReasonCode: 'group_social_invitation_declined' },
    });
    if (!declined.ok) throw new Error('expected declined');
    expect(startGroupSocialInitiation({
      receipt: declined.receipt, members: declined.members, actorId: 'host',
      expectedRevision: 2, groupConversationId: 'group:forbidden', now: NOW + 2,
    })).toEqual({ ok: false, reasonCode: 'group_social_invitation_declined' });
  });

  test('only the host can start an all-accepted ready receipt exactly once', () => {
    const first = created();
    const a = transitionGroupSocialResponse({ ...first, actorId: 'assignee', expectedRevision: 1, response: 'accept', now: NOW + 1 });
    if (!a.ok) throw new Error('expected acceptance');
    const b = transitionGroupSocialResponse({ receipt: a.receipt, members: a.members, actorId: 'expert', expectedRevision: 2, response: 'accept', now: NOW + 2 });
    if (!b.ok) throw new Error('expected ready');
    expect(startGroupSocialInitiation({
      receipt: b.receipt, members: b.members, actorId: 'assignee', expectedRevision: 3,
      groupConversationId: 'group:1', now: NOW + 3,
    })).toEqual({ ok: false, reasonCode: 'group_social_not_ready' });
    const started = startGroupSocialInitiation({
      receipt: b.receipt, members: b.members, actorId: 'host', expectedRevision: 3,
      groupConversationId: 'group:1', now: NOW + 3,
    });
    expect(started).toMatchObject({ ok: true, replay: false, receipt: { status: 'started', revision: 4, groupConversationId: 'group:1' } });
    if (!started.ok) throw new Error('expected started');
    expect(startGroupSocialInitiation({
      receipt: started.receipt, members: b.members, actorId: 'host', expectedRevision: 4,
      groupConversationId: 'group:1', now: NOW + 4,
    })).toMatchObject({ ok: true, replay: true });
  });

  test('expiry and cancellation are irreversible, idempotent terminals', () => {
    const first = created();
    expect(transitionGroupSocialResponse({
      ...first, actorId: 'assignee', expectedRevision: 1, response: 'accept', now: first.receipt.expiresAt,
    })).toEqual({ ok: false, reasonCode: 'group_social_invitation_expired' });
    const cancelled = terminalizeGroupSocialInitiation({
      receipt: first.receipt, expectedRevision: 1, status: 'cancelled',
      reasonCode: 'group_social_participant_moved', now: NOW + 1,
    });
    expect(cancelled).toMatchObject({ ok: true, replay: false, receipt: { status: 'cancelled', revision: 2 } });
    if (!cancelled.ok) throw new Error('expected terminal');
    expect(terminalizeGroupSocialInitiation({
      receipt: cancelled.receipt, expectedRevision: 2, status: 'cancelled',
      reasonCode: 'group_social_participant_moved', now: NOW + 2,
    })).toMatchObject({ ok: true, replay: true });
  });
});

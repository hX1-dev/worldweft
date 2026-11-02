import { deriveRemoteSocialInvitationOpportunities } from './remoteSocialInvitationOpportunityLogic';

function input() {
  return {
    actorId: 'disciple:a',
    actorMapId: 'lab',
    actorLocationId: 'herb_slope',
    actorAliveAndCapable: true,
    actorBusy: false,
    nowGameHour: 120,
    requests: [
      {
        requestId: 'request-1',
        revision: 3,
        status: 'ready_to_turn_in' as const,
        issuerActorId: 'elder:b',
        issuerMapId: 'lab',
        issuerLocationId: 'quiet_retreat',
        issuerAliveAndCapable: true,
        issuerBusy: false,
        summary: '交付已采得的灵草',
      },
    ],
  };
}

describe('remote social invitation opportunities', () => {
  test('creates a deterministic request-bound cross-location invitation', () => {
    const first = deriveRemoteSocialInvitationOpportunities(input());
    const second = deriveRemoteSocialInvitationOpportunities(input());
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      targetActorId: 'elder:b',
      targetLocationId: 'quiet_retreat',
      intendedActivity: 'talk',
      warrant: {
        kind: 'active_obligation',
        sourceRef: 'request:request-1',
        sourceRevision: 'request:rev:3',
        intendedOutcome: 'respond_to_request',
      },
    });
  });

  test.each([
    ['no request', { requests: [] }],
    ['offered but not accepted', { requests: [{ ...input().requests[0], status: 'offered' as const }] }],
    ['same location', { requests: [{ ...input().requests[0], issuerLocationId: 'herb_slope' }] }],
    ['other map', { requests: [{ ...input().requests[0], issuerMapId: 'other' }] }],
    ['target busy', { requests: [{ ...input().requests[0], issuerBusy: true }] }],
    ['target unavailable', { requests: [{ ...input().requests[0], issuerAliveAndCapable: false }] }],
    ['actor busy', { actorBusy: true }],
  ])('removes the candidate when %s', (_label, patch) => {
    expect(deriveRemoteSocialInvitationOpportunities({ ...input(), ...patch })).toEqual([]);
  });

  test('does not emit a duplicate while the same warrant has an active receipt', () => {
    const [entry] = deriveRemoteSocialInvitationOpportunities(input());
    expect(
      deriveRemoteSocialInvitationOpportunities({
        ...input(),
        activeInvitationWarrantIds: [entry.warrant.warrantId],
      }),
    ).toEqual([]);
  });
});

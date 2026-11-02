import { deriveGroupSocialOpportunities, type GroupSocialOpportunityInput } from './groupSocialOpportunityLogic';
import { validateSocialOpportunityCandidate } from './socialWarrantContracts';

const NOW = 100_000;

function input(overrides: Partial<GroupSocialOpportunityInput> = {}): GroupSocialOpportunityInput {
  return {
    now: NOW,
    nowGameHour: 35,
    actorId: 'host',
    mapId: 'world',
    locationId: 'council_hall',
    location: {
      allowedActions: ['group_talk', 'group_decide'],
      dangerLevel: 0,
      capacity: 8,
      occupiedCapacity: 0,
    },
    actors: [
      actor('host', 'steward'),
      actor('issuer', 'elder'),
      actor('assignee', 'outer_disciple'),
      actor('expert', 'merchant'),
      actor('witness', 'guard'),
    ],
    requests: [],
    events: [],
    resources: [],
    ...overrides,
  };
}

function actor(actorId: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    actorId,
    role,
    mapId: 'world',
    locationId: 'council_hall',
    aliveAndCapable: true,
    busy: false,
    inventory: [],
    ...extra,
  };
}

describe('C021b0d causal group opportunity derivation', () => {
  test('shared request selects issuer, assignee and relevant experts with one warrant', () => {
    const request = {
      requestId: 'request-1',
      revision: 2,
      status: 'accepted' as const,
      type: 'collect_item' as const,
      issuerActorId: 'host',
      assigneeActorId: 'assignee',
      itemId: 'spirit_herb',
    };
    const opportunities = deriveGroupSocialOpportunities(input({ requests: [request] }));
    expect(opportunities[0]).toMatchObject({
      sourceKind: 'shared_request',
      warrant: { sourceRef: 'request:request-1', intendedOutcome: 'reach_group_decision' },
      candidate: { mode: 'start_group_conversation', intendedActivity: 'group_decide' },
    });
    expect(opportunities[0].participantRoles).toEqual(expect.arrayContaining([
      { actorId: 'host', role: 'decision_owner' },
      { actorId: 'assignee', role: 'affected_party' },
      { actorId: 'expert', role: 'expert' },
    ]));
    expect(opportunities[0].candidate.targetActorIds).not.toContain('host');
    expect(opportunities[0].candidate.targetActorIds).toHaveLength(3);
    expect(validateSocialOpportunityCandidate(opportunities[0].candidate, opportunities[0].warrant).ok).toBe(true);
  });

  test('removing or staling the shared request removes the opportunity', () => {
    const request = {
      requestId: 'request-1', revision: 2, status: 'accepted' as const,
      type: 'collect_item' as const, issuerActorId: 'host', assigneeActorId: 'assignee',
    };
    const first = deriveGroupSocialOpportunities(input({ requests: [request] }));
    expect(first).toHaveLength(1);
    expect(deriveGroupSocialOpportunities(input({ requests: [] }))).toHaveLength(0);
    expect(deriveGroupSocialOpportunities(input({
      requests: [request],
      activeSourceRevisions: [`${first[0].warrant.sourceRef}|${first[0].warrant.sourceRevision}`],
    }))).toHaveLength(0);
  });

  test('shared visible event derives only named actors/targets/witnesses', () => {
    const opportunities = deriveGroupSocialOpportunities(input({
      actorId: 'issuer',
      events: [{
        eventId: 'event-1', eventType: 'resource_loss', createdAt: NOW - 1,
        visibility: 'witnessed', actorIds: ['issuer'], targetActorIds: ['assignee'],
        witnessActorIds: ['witness'], mapId: 'world', locationId: 'council_hall',
      }],
    }));
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ sourceKind: 'shared_event', observerActorIds: [] });
    expect(opportunities[0].participantRoles.map((entry) => entry.actorId).sort()).toEqual([
      'assignee', 'issuer', 'witness',
    ]);
    expect(opportunities[0].participantRoles.some((entry) => entry.actorId === 'expert')).toBe(false);
  });

  test('private event and unrelated proximity never become group opportunities', () => {
    const event = {
      eventId: 'event-1', eventType: 'private_loss', createdAt: NOW,
      visibility: 'private' as const, actorIds: ['host'], targetActorIds: ['assignee'],
      witnessActorIds: ['witness'], mapId: 'world', locationId: 'council_hall',
    };
    expect(deriveGroupSocialOpportunities(input({ events: [event] }))).toHaveLength(0);
    expect(deriveGroupSocialOpportunities(input())).toHaveLength(0);
  });

  test.each([
    'group_conversation_terminal',
    'group_conversation_utterance',
    'group_proposal_opened',
    'group_vote_recorded',
    'group_commitment_fulfilled',
    'social_outcome_closed',
    'action_completed',
  ])(
    'social lifecycle event %s cannot recursively create a group opportunity',
    (eventType) => {
      expect(deriveGroupSocialOpportunities(input({ events: [{
        eventId: `event:${eventType}`, eventType, createdAt: NOW,
        visibility: 'witnessed', actorIds: ['host'], targetActorIds: ['assignee'],
        witnessActorIds: ['witness'], mapId: 'world', locationId: 'council_hall',
      }] }))).toHaveLength(0);
    },
  );

  test('scarce resource requires a responsible host and at least two real claimants', () => {
    const base = input({
      actors: [
        actor('host', 'steward'),
        actor('a', 'outer_disciple', { neededItemIds: ['spirit_herb'] }),
        actor('b', 'inner_disciple', { neededItemIds: ['spirit_herb'] }),
        actor('has_one', 'outer_disciple', { inventory: [{ itemId: 'spirit_herb', qty: 1 }] }),
      ],
      resources: [{ resourceNodeId: 'herb-bank', itemId: 'spirit_herb', revision: 'stock:1', available: 1 }],
    });
    const opportunities = deriveGroupSocialOpportunities(base);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ sourceKind: 'resource_dispute' });
    expect(opportunities[0].participantRoles.map((entry) => entry.actorId).sort()).toEqual(['a', 'b', 'host']);
    expect(deriveGroupSocialOpportunities({
      ...base,
      actors: base.actors.map((entry) => ({ ...entry, neededItemIds: [] })),
    })).toHaveLength(0);
    expect(deriveGroupSocialOpportunities({
      ...base,
      actors: base.actors.map((entry) => entry.actorId === 'b'
        ? { ...entry, inventory: [{ itemId: 'spirit_herb', qty: 1 }] }
        : entry),
    })).toHaveLength(0);
  });

  test('dawn duty meeting is bounded, deterministic and absent outside its window', () => {
    const dutyInput = input({
      nowGameHour: 30,
      actors: [
        actor('host', 'guard'), actor('guard-a', 'guard'), actor('guard-b', 'guard'),
        actor('disciple', 'outer_disciple'),
      ],
    });
    const first = deriveGroupSocialOpportunities(dutyInput);
    const second = deriveGroupSocialOpportunities({ ...dutyInput, actors: [...dutyInput.actors].reverse() });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ sourceKind: 'duty_meeting' });
    expect(second[0].warrant.sourceRevision).toBe(first[0].warrant.sourceRevision);
    expect(second[0].candidate.targetActorIds).toEqual(first[0].candidate.targetActorIds);
    expect(deriveGroupSocialOpportunities({ ...dutyInput, nowGameHour: 35 })).toHaveLength(0);
  });

  test.each([
    ['busy participant', { busy: true }],
    ['moved participant', { locationId: 'elsewhere' }],
    ['unavailable participant', { aliveAndCapable: false }],
  ])('%s is excluded and an undersized source fails closed', (_label, change) => {
    const events = [{
      eventId: 'event-1', eventType: 'alarm', createdAt: NOW,
      visibility: 'witnessed' as const, actorIds: ['host'], targetActorIds: ['assignee'],
      witnessActorIds: ['witness'], mapId: 'world', locationId: 'council_hall',
    }];
    expect(deriveGroupSocialOpportunities(input({
      actors: input().actors.map((entry) => entry.actorId === 'witness' ? { ...entry, ...change } : entry),
      events,
    }))).toHaveLength(0);
  });

  test('unsafe, unsupported or full locations produce no candidate', () => {
    for (const location of [
      { allowedActions: ['group_talk', 'group_decide'], dangerLevel: 2, capacity: 8, occupiedCapacity: 0 },
      { allowedActions: ['talk'], dangerLevel: 0, capacity: 8, occupiedCapacity: 0 },
      { allowedActions: ['group_talk', 'group_decide'], dangerLevel: 0, capacity: 2, occupiedCapacity: 0 },
    ]) {
      expect(deriveGroupSocialOpportunities(input({
        location,
        requests: [{
          requestId: 'request-1', revision: 1, status: 'accepted', type: 'collect_item',
          issuerActorId: 'host', assigneeActorId: 'assignee',
        }],
      }))).toHaveLength(0);
    }
  });
});

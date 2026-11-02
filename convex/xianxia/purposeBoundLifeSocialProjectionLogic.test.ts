import {
  PURPOSE_BOUND_LIFE_SOCIAL_PROJECTION_VERSION,
  projectPurposeBoundLifeSocialFacts,
  type PurposeBoundLifeSocialProjectionInput,
} from './purposeBoundLifeSocialProjectionLogic';
import {
  buildSameLocationSocialOpportunityBundle,
  revalidateSameLocationSocialOpportunityEntry,
} from './sameLocationSocialOpportunityLogic';

function input(
  overrides: Partial<PurposeBoundLifeSocialProjectionInput> = {},
): PurposeBoundLifeSocialProjectionInput {
  return {
    now: 100_000,
    nowGameHour: 240,
    currentGameDay: 10,
    mapId: 'lab',
    actor: {
      actorId: 'actor:a',
      locationId: 'meeting_hall',
      health: 4,
      maxHealth: 10,
      hasHealingItem: false,
      hasGiftableItem: true,
      aliveAndCapable: true,
      busy: false,
    },
    targets: [{
      actorId: 'actor:b',
      role: 'herbalist',
      locationId: 'meeting_hall',
      relationship: 35,
      trust: 20,
      suspicion: 5,
      debt: 10,
      fear: 0,
      lastTouchedDay: 3,
      recentlyTalked: false,
      aliveAndCapable: true,
      busy: false,
      cooldownClear: true,
      sessionCapacityAvailable: true,
    }],
    requests: [{
      requestId: 'same-request',
      revision: 2,
      status: 'ready_to_turn_in',
      issuerActorId: 'actor:b',
    }],
    remoteRequests: [{
      requestId: 'remote-request',
      revision: 1,
      status: 'accepted',
      issuerActorId: 'actor:remote',
      issuerMapId: 'lab',
      issuerLocationId: 'quiet_retreat',
      issuerAliveAndCapable: true,
      issuerBusy: false,
      summary: '汇报远程委托进展',
    }],
    beliefs: [{
      beliefId: 'belief-1',
      revision: 1,
      sourceActorId: 'actor:b',
      kind: 'belief',
      active: true,
      validity: 'active',
      truthStatus: 'unknown',
    }],
    memories: [{
      sourceEventId: 'event:repair',
      aboutActorIds: ['actor:b'],
      type: 'gift',
      source: 'direct',
      createdAt: 200,
      expiresAt: 400,
    }],
    group: {
      location: {
        allowedActions: ['group_talk', 'group_decide'],
        dangerLevel: 0,
        capacity: 8,
        occupiedCapacity: 0,
      },
      actors: [
        groupActor('actor:a', 'steward'),
        groupActor('actor:b', 'outer_disciple'),
        groupActor('actor:c', 'guard'),
      ],
      requests: [],
      events: [{
        eventId: 'event:shared-loss',
        eventType: 'resource_loss',
        createdAt: 99_999,
        visibility: 'witnessed',
        actorIds: ['actor:a'],
        targetActorIds: ['actor:b'],
        witnessActorIds: ['actor:c'],
        mapId: 'lab',
        locationId: 'meeting_hall',
      }],
      resources: [],
      coordinationAllowed: true,
    },
    ...overrides,
  };
}

function groupActor(actorId: string, role: string) {
  return {
    actorId,
    role,
    mapId: 'lab',
    locationId: 'meeting_hall',
    aliveAndCapable: true,
    busy: false,
    inventory: [],
  };
}

describe('C021f F1 unified life/social fact projection', () => {
  test('projects explicit facts into existing direct, remote and group builders', () => {
    const result = projectPurposeBoundLifeSocialFacts(input());

    expect(result.contractVersion).toBe(PURPOSE_BOUND_LIFE_SOCIAL_PROJECTION_VERSION);
    expect(new Set(result.sameLocationSources.map((source) => source.kind))).toEqual(new Set([
      'care_or_aid',
      'active_obligation',
      'knowledge_gap',
      'gratitude_or_repair',
      'relationship_maintenance',
    ]));
    expect(result.remoteInvitationOpportunities).toEqual([
      expect.objectContaining({ targetActorId: 'actor:remote' }),
    ]);
    expect(result.groupOpportunities).toEqual([
      expect.objectContaining({ sourceKind: 'shared_event' }),
    ]);
    expect(result.groupCoordinationProposals).toEqual([
      expect.objectContaining({
        type: 'group_talk',
        params: expect.objectContaining({ operation: 'invite' }),
      }),
    ]);
  });

  test('source removal and request revision change fail closed instead of preserving a stale entry', () => {
    const original = projectPurposeBoundLifeSocialFacts(input());
    const entry = buildSameLocationSocialOpportunityBundle({
      now: 240,
      actorId: 'actor:a',
      locationId: 'meeting_hall',
      actorAliveAndCapable: true,
      actorBusy: false,
      sources: original.sameLocationSources,
    }).entries.find((candidate) => candidate.source.sourceRef === 'request:same-request');
    if (!entry) throw new Error('projection_test_request_entry_missing');

    expect(revalidateSameLocationSocialOpportunityEntry({
      entry,
      now: 240,
      actorAliveAndCapable: true,
      actorBusy: false,
    })).toBe('social_warrant_missing');

    const revised = projectPurposeBoundLifeSocialFacts(input({
      requests: [{
        requestId: 'same-request',
        revision: 3,
        status: 'ready_to_turn_in',
        issuerActorId: 'actor:b',
      }],
    }));
    const latest = revised.sameLocationSources.find(
      (source) => source.sourceRef === 'request:same-request',
    );
    expect(revalidateSameLocationSocialOpportunityEntry({
      entry,
      now: 240,
      actorAliveAndCapable: true,
      actorBusy: false,
      latestSource: latest,
    })).toBe('social_source_stale');
  });

  test.each<[string, Partial<PurposeBoundLifeSocialProjectionInput>, string]>([
    ['privacy', { disclosureDeniedSourceRefs: ['body:actor:a'] }, 'social_disclosure_forbidden'],
    ['busy', { targets: [{ ...input().targets[0], busy: true }] }, 'social_target_busy'],
    ['cooldown', { targets: [{ ...input().targets[0], cooldownClear: false }] }, 'social_cooldown_active'],
  ])('%s removes the affected direct opportunity with a stable reason', (_label, patch, reason) => {
    const projected = projectPurposeBoundLifeSocialFacts(input(patch));
    const bundle = buildSameLocationSocialOpportunityBundle({
      now: 240,
      actorId: 'actor:a',
      locationId: 'meeting_hall',
      actorAliveAndCapable: true,
      actorBusy: false,
      sources: projected.sameLocationSources.filter((source) => source.kind === 'care_or_aid'),
    });
    expect(bundle.entries).toHaveLength(0);
    expect(bundle.rejections[0]?.reasonCode).toBe(reason);
  });

  test('movement and group capacity changes close their exact opportunity classes', () => {
    const original = projectPurposeBoundLifeSocialFacts(input());
    const entry = buildSameLocationSocialOpportunityBundle({
      now: 240,
      actorId: 'actor:a',
      locationId: 'meeting_hall',
      actorAliveAndCapable: true,
      actorBusy: false,
      sources: original.sameLocationSources,
    }).entries[0];
    expect(revalidateSameLocationSocialOpportunityEntry({
      entry,
      now: 240,
      actorAliveAndCapable: true,
      actorBusy: false,
      latestSource: { ...entry.source, targetLocationId: 'elsewhere' },
    })).toBe('social_target_moved');

    const full = projectPurposeBoundLifeSocialFacts(input({
      group: {
        ...input().group,
        location: {
          allowedActions: ['group_talk', 'group_decide'],
          dangerLevel: 0,
          capacity: 2,
          occupiedCapacity: 0,
        },
      },
    }));
    expect(full.groupOpportunities).toEqual([]);
    expect(full.groupCoordinationProposals).toEqual([]);
  });

  test('passes all four explicit group causes through the frozen group builder', () => {
    const sharedRequest = projectPurposeBoundLifeSocialFacts(input({
      group: {
        ...input().group,
        actors: [
          groupActor('actor:a', 'steward'),
          groupActor('actor:b', 'outer_disciple'),
          groupActor('actor:c', 'merchant'),
        ],
        requests: [{
          requestId: 'group-request',
          revision: 1,
          status: 'accepted',
          type: 'collect_item',
          issuerActorId: 'actor:a',
          assigneeActorId: 'actor:b',
          itemId: 'spirit_herb',
        }],
        events: [],
      },
    }));
    expect(sharedRequest.groupOpportunities[0]?.sourceKind).toBe('shared_request');

    const resourceDispute = projectPurposeBoundLifeSocialFacts(input({
      group: {
        ...input().group,
        actors: [
          groupActor('actor:a', 'steward'),
          { ...groupActor('actor:b', 'outer_disciple'), neededItemIds: ['spirit_herb'] },
          { ...groupActor('actor:c', 'inner_disciple'), neededItemIds: ['spirit_herb'] },
        ],
        events: [],
        resources: [{
          resourceNodeId: 'scarce-herb',
          itemId: 'spirit_herb',
          revision: 'stock:1',
          available: 1,
        }],
      },
    }));
    expect(resourceDispute.groupOpportunities[0]?.sourceKind).toBe('resource_dispute');

    const dutyMeeting = projectPurposeBoundLifeSocialFacts(input({
      nowGameHour: 30,
      currentGameDay: 1,
      group: {
        ...input().group,
        actors: [
          groupActor('actor:a', 'guard'),
          groupActor('actor:b', 'guard'),
          groupActor('actor:c', 'guard'),
        ],
        events: [],
      },
    }));
    expect(dutyMeeting.groupOpportunities[0]?.sourceKind).toBe('duty_meeting');

    expect(projectPurposeBoundLifeSocialFacts(input()).groupOpportunities[0]?.sourceKind).toBe(
      'shared_event',
    );
  });
});

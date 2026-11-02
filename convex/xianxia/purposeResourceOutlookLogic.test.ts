import type { AgentContext, AgentProposal } from './agentLogic';
import {
  RESOURCE_CONTENDED_NEED_SCORE,
  isContendedGatherForNewChoice,
  isContendedResourceOutlook,
  projectPurposeResourceOutlook,
  purposeResourceOutlookForProposal,
  purposeResourceOutlookSummary,
} from './purposeResourceOutlookLogic';
import { buildPurposeBoundLifeCandidateBundle } from './purposeBoundLifeCandidateLogic';

describe('purpose resource outlook', () => {
  test('projects stock left on arrival from refreshes, reservations, claimants and commissions', () => {
    expect(
      projectPurposeResourceOutlook({
        stock: 1,
        reserved: 0,
        capacity: 3,
        claimantsAhead: 1,
        nowGameHour: 10,
        etaGameHours: 0.75,
        nextRefreshGameHour: 10.5,
        refreshPeriodGameHours: 12,
      }),
    ).toEqual({
      inTransitActorCount: 1,
      heldForRequestCount: 0,
      etaGameHours: 0.75,
      expectedAvailableOnArrival: 1,
    });
    // Refreshes stop at capacity; a reservation, a claimant and a commission each take one.
    expect(
      projectPurposeResourceOutlook({
        stock: 2,
        reserved: 1,
        capacity: 3,
        claimantsAhead: 1,
        heldForRequests: 1,
        nowGameHour: 0,
        etaGameHours: 30,
        nextRefreshGameHour: 1,
        refreshPeriodGameHours: 12,
      }).expectedAvailableOnArrival,
    ).toBe(0);
    expect(
      projectPurposeResourceOutlook({
        stock: 2,
        reserved: 0,
        capacity: 3,
        claimantsAhead: 0,
        nowGameHour: 0,
        etaGameHours: 30,
        nextRefreshGameHour: 1,
        refreshPeriodGameHours: 12,
      }).expectedAvailableOnArrival,
    ).toBe(3);
  });

  test('gives no refresh credit when the next refresh is after arrival and never goes negative', () => {
    const outlook = projectPurposeResourceOutlook({
      stock: 1,
      reserved: 0,
      capacity: 3,
      claimantsAhead: 3,
      nowGameHour: 10,
      etaGameHours: 0.75,
      nextRefreshGameHour: 11,
      refreshPeriodGameHours: 12,
    });
    expect(outlook.expectedAvailableOnArrival).toBe(0);
    expect(isContendedResourceOutlook(outlook)).toBe(true);
    expect(
      projectPurposeResourceOutlook({
        stock: Number.NaN,
        reserved: -2,
        capacity: 3,
        claimantsAhead: Number.POSITIVE_INFINITY,
        nowGameHour: 0,
        etaGameHours: -1,
      }),
    ).toEqual({
      inTransitActorCount: 0,
      heldForRequestCount: 0,
      etaGameHours: 0,
      expectedAvailableOnArrival: 0,
    });
  });

  test('summarizes the outlook in the words a model reads', () => {
    expect(
      purposeResourceOutlookSummary({
        inTransitActorCount: 2,
        heldForRequestCount: 0,
        etaGameHours: 0.75,
        expectedAvailableOnArrival: 0,
      }),
    ).toBe('（另有2人已动身，预计到达时剩0份）');
    expect(
      purposeResourceOutlookSummary({
        inTransitActorCount: 0,
        heldForRequestCount: 1,
        etaGameHours: 0,
        expectedAvailableOnArrival: 0,
        lastOutcome: { status: 'failed', reasonCode: 'purpose_goal_source_missing', hoursAgo: 6.25 },
      }),
    ).toBe('（另有0人已动身，1份已被委托预留，预计到达时剩0份，你上次来此扑空（6小时前））');
    expect(
      purposeResourceOutlookSummary({
        inTransitActorCount: 0,
        heldForRequestCount: 0,
        etaGameHours: 0,
        expectedAvailableOnArrival: 1,
        lastOutcome: { status: 'completed', reasonCode: 'purpose_goal_activity_completed', hoursAgo: 0.5 },
      }),
    ).toBe('（另有0人已动身，预计到达时剩1份，你上次来此采到了（刚才））');
  });

  test('marks a contended gather only for actors who have not already set out for it', () => {
    const contended = gatherContext(0);
    const gather = gatherProposal(contended);
    expect(purposeResourceOutlookForProposal(contended, gather)?.expectedAvailableOnArrival).toBe(0);
    expect(isContendedGatherForNewChoice(contended, gather)).toBe(true);

    const sourceRef = (gather.params?.purposeBoundIntent as { sourceRef: string }).sourceRef;
    const committed: AgentContext = {
      ...contended,
      personalGoal: { sourceRef } as AgentContext['personalGoal'],
    };
    expect(isContendedGatherForNewChoice(committed, gather)).toBe(false);

    const open = gatherContext(1);
    expect(isContendedGatherForNewChoice(open, gatherProposal(open))).toBe(false);

    const unobserved = gatherContext(undefined);
    expect(purposeResourceOutlookForProposal(unobserved, gatherProposal(unobserved))).toBeUndefined();
    expect(isContendedGatherForNewChoice(unobserved, gatherProposal(unobserved))).toBe(false);

    const cultivate = buildPurposeBoundLifeCandidateBundle(contended).candidates.find(
      (candidate) => candidate.proposal.type === 'cultivate',
    )?.proposal;
    expect(cultivate).toBeDefined();
    expect(isContendedGatherForNewChoice(contended, cultivate)).toBe(false);
    expect(RESOURCE_CONTENDED_NEED_SCORE).toBeLessThan(25);
  });
});

function gatherProposal(context: AgentContext): AgentProposal {
  const proposal = buildPurposeBoundLifeCandidateBundle(context).candidates.find(
    (candidate) => candidate.proposal.type === 'gather',
  )?.proposal;
  if (!proposal) throw new Error('gather_fixture_missing');
  return proposal;
}

function gatherContext(expectedAvailableOnArrival: number | undefined): AgentContext {
  return {
    lifeObservation: {
      observationRevision: 'taixu.life_observation.v2:outlook',
    } as AgentContext['lifeObservation'],
    purposeBoundLifeIntentV2: true,
    currentGameHour: 10,
    self: {
      actorId: 'gatherer',
      name: '采药人',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: 0,
      mood: 5,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 5,
      reputation: 0,
      currentLocationId: 'herb_field',
      inventory: [],
    },
    others: [],
    recentEvents: [],
    availableActions: ['gather', 'cultivate', 'rest'],
    knownLocations: [
      {
        locationId: 'herb_field',
        name: '药圃',
        allowedActions: ['gather', 'cultivate', 'rest'],
        dangerLevel: 0,
        spiritualEnergy: 1,
      },
    ],
    purposeResourceNodes: [
      {
        resourceNodeId: 'dew_patch',
        name: '朝露草丛',
        locationId: 'herb_field',
        itemId: 'spirit_herb',
        available: 1,
        sourceRevision: 'resource:dew:1',
        ...(expectedAvailableOnArrival === undefined
          ? {}
          : {
              outlook: {
                inTransitActorCount: expectedAvailableOnArrival === 0 ? 1 : 0,
                heldForRequestCount: 0,
                etaGameHours: 0,
                expectedAvailableOnArrival,
              },
            }),
      },
    ],
    purposeShopOffers: [],
  };
}

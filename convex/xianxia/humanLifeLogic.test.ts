import type { AgentContext, AgentProposal } from './agentLogic';
import {
  HUMAN_GIFT_ACTOR_COOLDOWN_DAYS,
  chatAffinityGain,
  humanChronotype,
  humanCultivationSpacingHours,
  humanDayFocus,
  humanDayFocusAdjustment,
  humanGiftKeepQuantity,
  humanLifeEnabled,
  humanLivelihoodQuantity,
  humanMaintenanceDebtDays,
  humanMaintenancePlan,
  humanMaintenanceTargetIds,
  humanMoodAfterWaking,
  humanMoodLifted,
  humanSocialAdjustment,
  isHumanCultivationRestDue,
  isHumanLeisureSpot,
  isHumanSleepTime,
  isRecentlyFailedTrip,
  nextHumanWakeGameHour,
  recentFailureBackoffHours,
} from './humanLifeLogic';
import { buildPurposeBoundLifeCandidateBundle } from './purposeBoundLifeCandidateLogic';
import type { PurposeGoalCadenceWindow } from './personalGoalContracts';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    lifeObservation: {
      observationRevision: 'taixu.life_observation.v2:human-fixture',
    } as AgentContext['lifeObservation'],
    self: {
      actorId: 'disciple_a',
      name: '清河',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: 3,
      mood: 5,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 3,
      reputation: 0,
      currentLocationId: 'mountain_gate',
      inventory: [],
    },
    currentLocationName: '山门',
    currentLocationSpiritualEnergy: 4,
    cultivationModes: ['ambient'],
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'gather', 'rest', 'trade', 'talk', 'gift'],
    knownLocations: [
      {
        locationId: 'mountain_gate',
        name: '山门',
        allowedActions: ['cultivate', 'rest', 'talk', 'gift'],
        dangerLevel: 0,
        spiritualEnergy: 4,
      },
      {
        locationId: 'herb_field',
        name: '药圃',
        allowedActions: ['gather', 'cultivate', 'rest', 'talk'],
        dangerLevel: 0,
        spiritualEnergy: 1,
      },
    ],
    stableLifeSemanticTravelV1: false,
    purposeBoundLifeIntentV2: true,
    purposeResourceNodes: [],
    purposeShopOffers: [],
    humanLifeV1: true,
    currentGameHour: 12,
    humanDay: { bedtimeHour: 22, wakeHour: 6 },
  };
  return {
    ...base,
    ...overrides,
    self: { ...base.self, ...(overrides.self ?? {}) },
  };
}

function proposal(type: AgentProposal['type'], extra: Partial<AgentProposal> = {}): AgentProposal {
  return { type, intent: 'fixture', source: 'agent', ...extra };
}

function cultivationWindow(terminalGameHour: number): PurposeGoalCadenceWindow {
  return {
    goalId: 'goal:cultivate',
    cadenceKey: 'purpose_cadence:cultivate',
    sourceRef: 'cultivation:disciple_a',
    sourceRevision: 'cultivation:rev',
    purposeKind: 'cultivation',
    intendedActivity: 'cultivate',
    terminalStatus: 'completed',
    terminalReasonCode: 'purpose_goal_activity_completed',
    terminalGameHour,
    nextEligibleGameHour: terminalGameHour + 2,
  };
}

describe('拟人生活 v1：纯规则', () => {
  test('only applies with the flag and a known game hour', () => {
    expect(humanLifeEnabled(context())).toBe(true);
    expect(humanLifeEnabled(context({ humanLifeV1: false }))).toBe(false);
    expect(humanLifeEnabled(context({ currentGameHour: undefined }))).toBe(false);
    expect(isHumanSleepTime(context({ humanLifeV1: false, currentGameHour: 23 }))).toBe(false);
  });

  test('the sleep window wraps midnight and the next wake is found from any hour', () => {
    const at = (hour: number, day?: Partial<NonNullable<AgentContext['humanDay']>>) =>
      context({ currentGameHour: hour, humanDay: { bedtimeHour: 22, wakeHour: 6, ...day } });
    expect([21.75, 22, 23, 2, 5.75, 6, 12].map((hour) => isHumanSleepTime(at(hour)))).toEqual([
      false, true, true, true, true, false, false,
    ]);
    expect(isHumanSleepTime(at(72 + 23))).toBe(true);
    expect(isHumanSleepTime(at(3, { bedtimeHour: 1, wakeHour: 9 }))).toBe(true);
    expect(isHumanSleepTime(at(23, { bedtimeHour: 1, wakeHour: 9 }))).toBe(false);
    expect(nextHumanWakeGameHour(at(23))).toBe(30);
    expect(nextHumanWakeGameHour(at(3))).toBe(6);
    expect(nextHumanWakeGameHour(at(6))).toBe(30);
  });

  test('everyone keeps their own fixed bed and wake times', () => {
    for (const actorId of ['a', 'b', 'life:q6:guard', 'life:q6:merchant', '甲']) {
      const rhythm = humanChronotype(actorId);
      expect(rhythm).toEqual(humanChronotype(actorId));
      expect(rhythm.bedtimeHour).toBeGreaterThanOrEqual(21);
      expect(rhythm.bedtimeHour).toBeLessThanOrEqual(23);
      expect(rhythm.wakeHour).toBeGreaterThanOrEqual(5);
      expect(rhythm.wakeHour).toBeLessThanOrEqual(7);
      expect((rhythm.bedtimeHour * 4) % 1).toBe(0);
      expect((rhythm.wakeHour * 4) % 1).toBe(0);
    }
  });

  test('what a day is spent on follows temperament', () => {
    const share = (input: { role: string; innerTrait?: string; outerTrait?: string }, focus: string) => {
      let hits = 0;
      for (let day = 0; day < 600; day += 1) {
        if (humanDayFocus({ seedKey: `focus-test:${day}`, ...input }) === focus) hits += 1;
      }
      return hits / 600;
    };
    const loner = { role: 'outer_disciple', innerTrait: '中庸', outerTrait: '孤僻' };
    const warm = { role: 'outer_disciple', innerTrait: '无私', outerTrait: '义气' };
    expect(share(loner, 'social')).toBeLessThan(0.1);
    expect(share(warm, 'social')).toBeGreaterThan(0.3);
    expect(share({ role: 'guard', innerTrait: '正直', outerTrait: '忠贞' }, 'livelihood')).toBeGreaterThan(0.4);
    expect(humanDayFocus({ seedKey: 'same-day', ...warm })).toBe(humanDayFocus({ seedKey: 'same-day', ...warm }));
  });

  test('after a fruitless trip the wait doubles up to four days', () => {
    expect([1, 2, 3, 4, 5, 6].map(recentFailureBackoffHours)).toEqual([6, 12, 24, 48, 96, 96]);
    expect(recentFailureBackoffHours(0)).toBe(6);
  });

  test('a trip that just came up empty waits; standing at the patch does not', () => {
    const withOutlook = (hoursAgo: number, etaGameHours = 0.75, humanLifeV1 = true) =>
      context({
        humanLifeV1,
        purposeResourceNodes: [{
          resourceNodeId: 'dew_patch',
          name: '凝露草地',
          locationId: 'herb_field',
          itemId: 'spirit_herb',
          available: 1,
          sourceRevision: 'resource:rev-1',
          outlook: {
            inTransitActorCount: 0,
            heldForRequestCount: 0,
            etaGameHours,
            expectedAvailableOnArrival: 1,
            lastOutcome: { status: 'failed', reasonCode: 'resource_depleted', hoursAgo, consecutiveFailures: 1 },
          },
        }],
      });
    const gather = (entry: AgentContext) =>
      buildPurposeBoundLifeCandidateBundle(entry).candidates.find((candidate) => candidate.planner === 'gather')
        ?.proposal;
    expect(isRecentlyFailedTrip(withOutlook(3), gather(withOutlook(3)))).toBe(true);
    expect(isRecentlyFailedTrip(withOutlook(7), gather(withOutlook(7)))).toBe(false);
    expect(isRecentlyFailedTrip(withOutlook(3, 0), gather(withOutlook(3, 0)))).toBe(false);
    expect(isRecentlyFailedTrip(withOutlook(3, 0.75, false), gather(withOutlook(3, 0.75, false)))).toBe(false);
  });

  test("today's focus nudges matching activities and holds back the rest", () => {
    const on = (focus: NonNullable<NonNullable<AgentContext['humanDay']>['focus']>) =>
      context({ humanDay: { bedtimeHour: 22, wakeHour: 6, focus } });
    expect(humanDayFocusAdjustment(on('cultivation'), proposal('cultivate'))).toBe(12);
    expect(humanDayFocusAdjustment(on('idle'), proposal('cultivate'))).toBe(-15);
    expect(humanDayFocusAdjustment(on('social'), proposal('talk'))).toBe(12);
    expect(humanDayFocusAdjustment(on('livelihood'), proposal('trade'))).toBe(12);
    expect(humanDayFocusAdjustment(on('idle'), proposal('rest'), 'leisure')).toBe(12);
    expect(humanDayFocusAdjustment(on('cultivation'), proposal('rest'), 'leisure')).toBe(0);
    expect(humanDayFocusAdjustment(context(), proposal('cultivate'))).toBe(0);
  });

  test('two people click by temperament plus a chemistry of their own', () => {
    const person = (actorId: string, innerTrait: string, outerTrait: string) => ({ actorId, innerTrait, outerTrait });
    const warmA = person('warm_a', '无私', '义气');
    const warmB = person('warm_b', '无私', '义气');
    const selfish = person('selfish', '利己', '孤僻');
    expect(chatAffinityGain(warmA, warmB)).toBe(3);
    expect(chatAffinityGain(warmA, selfish)).toBeLessThanOrEqual(0);
    expect(chatAffinityGain(selfish, warmA)).toBe(chatAffinityGain(warmA, selfish));
    for (let index = 0; index < 50; index += 1) {
      const gain = chatAffinityGain(person(`x${index}`, '中庸', '名声'), person(`y${index}`, '正直', '天伦'));
      expect(gain).toBeGreaterThanOrEqual(-1);
      expect(gain).toBeLessThanOrEqual(3);
    }
  });

  test('cultivation waits longer on days set aside for other things', () => {
    const day = (focus: 'cultivation' | 'idle' | 'social', currentGameHour: number) =>
      context({
        currentGameHour,
        humanDay: { bedtimeHour: 22, wakeHour: 6, focus },
        personalGoalCadences: [cultivationWindow(10)],
      });
    expect(humanCultivationSpacingHours('idle')).toBe(6);
    expect(isHumanCultivationRestDue(day('idle', 13))).toBe(true);
    expect(isHumanCultivationRestDue(day('idle', 16))).toBe(false);
    expect(isHumanCultivationRestDue(day('social', 13))).toBe(true);
    expect(isHumanCultivationRestDue(day('social', 14))).toBe(false);
    expect(isHumanCultivationRestDue(day('cultivation', 11))).toBe(false);
  });

  test('closer people are sought sooner, and fewer of them on a cultivation day', () => {
    expect([45, 30, 18, 10].map((relationship) => humanMaintenanceDebtDays(undefined, relationship))).toEqual([
      1, 3, 6, Number.POSITIVE_INFINITY,
    ]);
    expect([45, 30, 18].map((relationship) => humanMaintenanceDebtDays('social', relationship))).toEqual([1, 2, 4]);
    expect([45, 30, 18].map((relationship) => humanMaintenanceDebtDays('cultivation', relationship))).toEqual([
      2, 4, 8,
    ]);
    expect(humanMaintenancePlan(undefined)).toMatchObject({ minDebtDays: 1, targets: 2 });
    expect(humanMaintenancePlan('social').targets).toBe(3);
    expect(humanMaintenancePlan('cultivation')).toMatchObject({ minDebtDays: 2, targets: 1 });
  });

  test('the closest people present come to mind first', () => {
    const others = [
      { actorId: 'a', name: 'A', role: 'outer_disciple', realm: 'qi_refining', relationship: 50 },
      { actorId: 'b', name: 'B', role: 'outer_disciple', realm: 'qi_refining', relationship: 20 },
      { actorId: 'c', name: 'C', role: 'outer_disciple', realm: 'qi_refining', relationship: 35 },
    ] as AgentContext['others'];
    const due = [
      { targetActorId: 'b', debtDays: 9 },
      { targetActorId: 'c', debtDays: 4 },
      { targetActorId: 'a', debtDays: 2 },
    ];
    expect([...humanMaintenanceTargetIds(context({ others }), due)].sort()).toEqual(['a', 'c']);
    expect([
      ...humanMaintenanceTargetIds(
        context({ others, humanDay: { bedtimeHour: 22, wakeHour: 6, focus: 'cultivation' } }),
        due,
      ),
    ]).toEqual(['a']);
  });

  test('closeness raises the wish to talk; a gift weighs as much as a talk', () => {
    const others = [
      { actorId: 'close', name: 'C', role: 'outer_disciple', realm: 'qi_refining', relationship: 60 },
      { actorId: 'plain', name: 'P', role: 'outer_disciple', realm: 'qi_refining', relationship: 20 },
      { actorId: 'cold', name: 'D', role: 'outer_disciple', realm: 'qi_refining', relationship: 0 },
      { actorId: 'friend', name: 'F', role: 'outer_disciple', realm: 'qi_refining', relationship: 40 },
    ] as AgentContext['others'];
    const human = context({ others });
    expect(humanSocialAdjustment(human, proposal('talk', { targetActorId: 'close' }))).toBe(10);
    expect(humanSocialAdjustment(human, proposal('talk', { targetActorId: 'plain' }))).toBe(0);
    expect(humanSocialAdjustment(human, proposal('talk', { targetActorId: 'cold' }))).toBe(-5);
    expect(humanSocialAdjustment(human, proposal('gift', { targetActorId: 'friend' }))).toBe(15);
    expect(humanSocialAdjustment(human, proposal('cultivate'))).toBe(0);
    expect(humanSocialAdjustment(context({ others, humanLifeV1: false }), proposal('talk', { targetActorId: 'close' }))).toBe(0);
  });

  test('one herb is kept back for a gift owed, or for a friend not given anything lately', () => {
    const base = { ownGiftable: 1, owesSomeone: false, hasCloseFriendDue: true };
    expect(humanGiftKeepQuantity({ ...base, ownGiftable: 0, owesSomeone: true })).toBe(0);
    expect(humanGiftKeepQuantity({ ...base, owesSomeone: true, hasCloseFriendDue: false, daysSinceOwnLastGift: 0 })).toBe(1);
    expect(humanGiftKeepQuantity(base)).toBe(1);
    expect(humanGiftKeepQuantity({ ...base, daysSinceOwnLastGift: HUMAN_GIFT_ACTOR_COOLDOWN_DAYS - 1 })).toBe(0);
    expect(humanGiftKeepQuantity({ ...base, daysSinceOwnLastGift: HUMAN_GIFT_ACTOR_COOLDOWN_DAYS })).toBe(1);
    expect(humanGiftKeepQuantity({ ...base, hasCloseFriendDue: false })).toBe(0);
  });

  test('herbs kept for a gift, received as a gift or promised are not for sale', () => {
    const human = context({
      humanDay: { bedtimeHour: 22, wakeHour: 6, keepForGift: 1, receivedGiftsKept: 1 },
      activeRequests: [
        { requestId: 'r1', status: 'accepted', type: 'collect_item', itemId: 'spirit_herb', qty: 1, summary: 'herb' },
        { requestId: 'r2', status: 'offered', type: 'collect_item', itemId: 'spirit_herb', qty: 5, summary: 'herb' },
      ],
    });
    expect(humanLivelihoodQuantity(human, 'spirit_herb', 4)).toBe(1);
    expect(humanLivelihoodQuantity(human, 'spirit_herb', 2)).toBe(0);
    expect(humanLivelihoodQuantity(human, 'iron_ore', 3)).toBe(3);
    expect(humanLivelihoodQuantity({ ...human, humanLifeV1: false }, 'spirit_herb', 4)).toBe(4);
  });

  test('a leisure spot is public, not a workplace and not home; moods settle and lift', () => {
    const spot = (allowedActions: string[], locationId = 'pavilion') => ({ locationId, allowedActions });
    expect(isHumanLeisureSpot(spot(['rest', 'talk']), 'mountain_gate')).toBe(true);
    expect(isHumanLeisureSpot(spot(['rest', 'talk', 'gift', 'trade']), 'mountain_gate')).toBe(true);
    expect(isHumanLeisureSpot(spot(['rest', 'talk', 'inspect']), 'mountain_gate')).toBe(false);
    expect(isHumanLeisureSpot(spot(['rest', 'talk', 'cultivate']), 'mountain_gate')).toBe(false);
    expect(isHumanLeisureSpot(spot(['rest', 'talk', 'gather']), 'mountain_gate')).toBe(false);
    expect(isHumanLeisureSpot(spot(['rest', 'talk'], 'market'), 'market')).toBe(false);
    expect([8, 2, 5].map(humanMoodAfterWaking)).toEqual([7, 3, 5]);
    expect([5, 10].map(humanMoodLifted)).toEqual([6, 10]);
  });
});

import {
  PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK,
  PURPOSE_BOUND_LIFE_SOAK_VERSION,
  assertPurposeBoundLifeSoakReady,
  runPurposeBoundLifeSoak,
  type PurposeBoundLifeNetworkSnapshot,
  type PurposeBoundLifeRuntimeEvent,
} from './purposeBoundLifeSoakLogic';

describe('C021q6 provider=0 purpose-bound life soak', () => {
  test('rejects missing seeds and out-of-contract tick counts', () => {
    expect(() => runPurposeBoundLifeSoak({ seed: ' ' })).toThrow(
      'purpose_bound_life_soak_seed_required',
    );
    expect(() => runPurposeBoundLifeSoak({ seed: 'short', ticks: 999 })).toThrow(
      'purpose_bound_life_soak_ticks_out_of_range',
    );
    expect(() => runPurposeBoundLifeSoak({ seed: 'long', ticks: 10_001 })).toThrow(
      'purpose_bound_life_soak_ticks_out_of_range',
    );
  });

  test('runs the full purpose-v2 chain deterministically for 1,000 ticks', () => {
    const first = runPurposeBoundLifeSoak({ seed: 'c021q6-unit-mist', ticks: 1_000 });
    const replay = runPurposeBoundLifeSoak({ seed: 'c021q6-unit-mist', ticks: 1_000 });

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      contractVersion: PURPOSE_BOUND_LIFE_SOAK_VERSION,
      decisionTicks: 1_000,
      schedulerOpportunities: 1_000 * PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK,
      providerCalls: 0,
      drainTicks: expect.any(Number),
      releaseAudit: {
        releaseStatus: 'pass',
        travels: { selected: expect.any(Number), arrived: expect.any(Number) },
      },
    });
    expect(first.drainTicks).toBeLessThanOrEqual(128);
    expect(first.fairness.spread).toBeLessThanOrEqual(1);
    expect(first.actions).toBe(first.settlements);
    expect(first.releaseAudit.actions.pendingAtEnd).toBe(0);
    expect(first.releaseAudit.goals.activeAtEnd).toBe(0);
    expect(first.resources.finalHerbs).toBe(
      first.resources.initialHerbs + first.resources.refreshedHerbs,
    );
    expect(first.resources.finalSpiritStones).toBe(first.resources.initialSpiritStones);
    expect(first.resources.finalHealingPills + first.resources.healingPillSinks).toBe(
      first.resources.initialHealingPills,
    );
    const { resourceDepletionsObserved, resourceContentionsAvoided, ...requiredCoverage } =
      first.scenarioCoverage;
    for (const count of Object.values(requiredCoverage)) {
      expect(count).toBeGreaterThan(0);
    }
    expect(resourceDepletionsObserved + resourceContentionsAvoided).toBeGreaterThan(0);
    for (const count of Object.values(first.integrity)) {
      expect(count).toBe(0);
    }
    expect(() => assertPurposeBoundLifeSoakReady(first)).not.toThrow();
  });

  test('herb trips stop racing for the same patch once the outlook is visible', () => {
    const events: PurposeBoundLifeRuntimeEvent[] = [];
    let offeredOutlooks = 0;
    const result = runPurposeBoundLifeSoak({
      seed: 'c021q6-unit-mist',
      ticks: 1_000,
      decisionHook: (input) => {
        offeredOutlooks += input.candidates.filter((candidate) => candidate.resourceOutlook).length;
        return undefined;
      },
      runtimeEventHook: (event) => events.push(event),
    });
    const herbGoals = events.filter(
      (event) =>
        event.type === 'goal_terminal' && (event.sourceRef ?? '').startsWith('resource:'),
    );

    expect(herbGoals.length).toBeGreaterThan(0);
    expect(herbGoals.filter((event) => event.status === 'failed')).toEqual([]);
    expect(result.scenarioCoverage.resourceContentionsAvoided).toBeGreaterThan(0);
    expect(result.scenarioCoverage.requestsCompleted).toBeGreaterThan(0);
    expect(offeredOutlooks).toBeGreaterThan(0);
    expect(() => assertPurposeBoundLifeSoakReady(result)).not.toThrow();
  });

  test('human life: night is for sleep, tasks are put down at bedtime, ties grow unevenly', () => {
    const run = () => {
      const events: PurposeBoundLifeRuntimeEvent[] = [];
      const networks: PurposeBoundLifeNetworkSnapshot[] = [];
      const result = runPurposeBoundLifeSoak({
        seed: 'c021q6-unit-mist',
        ticks: 1_000,
        humanLife: true,
        runtimeEventHook: (event) => events.push(event),
        observeNetwork: (snapshot) => networks.push(snapshot),
      });
      return { result, events, networks };
    };
    const { result, events, networks } = run();
    expect(() => assertPurposeBoundLifeSoakReady(result)).not.toThrow();
    expect(run().result.trajectoryDigest).toBe(result.trajectoryDigest);

    const hourOf = (tick: number) => (tick * 0.25) % 24;
    // Everyone is in bed by 23:00 and up after 05:00: the small hours hold no work or talk.
    const smallHours = events.filter(
      (event) => event.type === 'action_selected' && hourOf(event.tick) >= 1 && hourOf(event.tick) < 4,
    );
    expect(smallHours.filter((event) => event.actionType !== 'rest')).toEqual([]);
    expect(
      events.some((event) => event.type === 'intentional_idle' && event.reasonCode === 'sleeping'),
    ).toBe(true);
    // Whatever was in hand at bedtime is set aside, never failed for it.
    const nightEndings = events.filter(
      (event) => event.type === 'goal_terminal' && event.reasonCode === 'human_bedtime_set_aside',
    );
    expect(nightEndings.length).toBeGreaterThan(0);
    expect(nightEndings.every((event) => event.status === 'cancelled')).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.type === 'goal_terminal' &&
          event.status === 'failed' &&
          (event.sourceRef ?? '').startsWith('cultivation:'),
      ),
    ).toEqual([]);
    // One snapshot a day; some pairs have become friends while others stay distant.
    expect(networks.length).toBeGreaterThanOrEqual(10);
    const last = networks.at(-1)!.rows.map((row) => row.affinity);
    expect(Math.max(...last)).toBeGreaterThanOrEqual(25);
    expect(Math.min(...last)).toBeLessThan(15);
  });

  test('human life: stories travel by word of mouth, and quarrels leave grudges', () => {
    const events: PurposeBoundLifeRuntimeEvent[] = [];
    const networks: PurposeBoundLifeNetworkSnapshot[] = [];
    const result = runPurposeBoundLifeSoak({
      seed: 'c021q6-unit-mist',
      ticks: 1_000,
      humanLife: true,
      runtimeEventHook: (event) => events.push(event),
      observeNetwork: (snapshot) => networks.push(snapshot),
    });
    expect(() => assertPurposeBoundLifeSoakReady(result)).not.toThrow();

    const heard = events.filter((event) => event.type === 'news_heard');
    // The planted story starts with the quester alone, then spreads by talk.
    const deer = heard.filter((event) => event.newsId === 'event:q6:white_deer_sighting');
    expect(deer[0]).toMatchObject({ actorId: 'life:q6:quester', newsSource: 'direct' });
    expect(deer.filter((event) => event.newsSource !== 'told')).toHaveLength(1);
    expect(new Set(deer.map((event) => event.actorId)).size).toBeGreaterThan(1);
    // Nobody hears a story from someone who did not know it yet.
    const knewAt = new Map<string, number>();
    for (const event of heard) {
      const key = `${event.newsId}|${event.actorId}`;
      if (event.newsSource === 'told') {
        const tellerKnew = knewAt.get(`${event.newsId}|${event.fromActorId}`);
        expect(tellerKnew).toBeDefined();
        expect(tellerKnew!).toBeLessThanOrEqual(event.tick);
      }
      if (!knewAt.has(key)) knewAt.set(key, event.tick);
    }
    // Whoever was wronged in a quarrel holds a grudge against the one who started it.
    for (const quarrel of events.filter((event) => event.type === 'social_event' && event.reasonCode === 'quarrel')) {
      const next = networks.find((snapshot) => snapshot.tick > quarrel.tick);
      if (!next) continue;
      const row = next.rows.find((entry) => entry.from === quarrel.targetActorId && entry.to === quarrel.actorId);
      expect(row?.suspicion ?? 0).toBeGreaterThan(0);
    }
  });

  test('keeps replay stable while a different seed changes real state', () => {
    const mist = runPurposeBoundLifeSoak({ seed: 'c021q6-unit-mist', ticks: 1_000 });
    const river = runPurposeBoundLifeSoak({ seed: 'c021q6-unit-river', ticks: 1_000 });

    expect(river.trajectoryDigest).not.toBe(mist.trajectoryDigest);
    expect(river.finalStateDigest).not.toBe(mist.finalStateDigest);
  });

  test('lets a bounded live hook select only a fresh eligible candidate', () => {
    let liveTurns = 0;
    let maximumSocialCandidateCount = 0;
    const runtimeEvents: PurposeBoundLifeRuntimeEvent[] = [];
    let socialContext:
      | {
          nearbyActorCount: number;
          nearbyRelationshipEligibleActorCount: number;
          recentlyTalkedActorCount: number;
          activeGroupConversation: boolean;
          sameLocationSourceCount: number;
          remoteInvitationOpportunityCount: number;
          groupOpportunityCount: number;
          socialCandidateCount: number;
        }
      | undefined;
    const result = runPurposeBoundLifeSoak({
      seed: 'c021q7-live-hook',
      ticks: 1_000,
      decisionHook: (input) => {
        maximumSocialCandidateCount = Math.max(
          maximumSocialCandidateCount,
          input.socialContext.socialCandidateCount,
        );
        if (liveTurns > 0) return undefined;
        liveTurns += 1;
        socialContext = input.socialContext;
        const selected =
          input.candidates.find(
            (candidate) => candidate.candidateId === input.defaultCandidateId,
          ) ?? input.candidates[0];
        if (!selected) throw new Error('test_candidate_missing');
        return {
          kind: 'selected',
          candidateId: selected.candidateId,
          reasonCode: 'routine',
          summary: '选择最新快照中的合法候选。',
        };
      },
      runtimeEventHook: (event) => runtimeEvents.push(event),
    });

    expect(liveTurns).toBe(1);
    expect(socialContext).toEqual({
      nearbyActorCount: expect.any(Number),
      nearbyRelationshipEligibleActorCount: expect.any(Number),
      recentlyTalkedActorCount: expect.any(Number),
      activeGroupConversation: false,
      sameLocationSourceCount: expect.any(Number),
      remoteInvitationOpportunityCount: expect.any(Number),
      groupOpportunityCount: expect.any(Number),
      socialCandidateCount: expect.any(Number),
    });
    expect(maximumSocialCandidateCount).toBeGreaterThan(0);
    expect(result.socialProjectionCoverage).toMatchObject({
      sameLocationSourceKinds: {
        active_obligation: expect.any(Number),
        relationship_maintenance: expect.any(Number),
      },
      remoteInvitationOpportunities: expect.any(Number),
      groupOpportunityKinds: { shared_event: expect.any(Number) },
      decisionHookSocialCandidateObservations: expect.any(Number),
    });
    expect(result.socialProjectionCoverage.sameLocationSourceKinds.active_obligation).toBeGreaterThan(0);
    expect(result.socialProjectionCoverage.sameLocationSourceKinds.relationship_maintenance).toBeGreaterThan(0);
    expect(result.socialProjectionCoverage.remoteInvitationOpportunities).toBeGreaterThan(0);
    expect(result.socialProjectionCoverage.groupOpportunityKinds.shared_event).toBeGreaterThan(0);
    expect(result.socialProjectionCoverage.decisionHookSocialCandidateObservations).toBeGreaterThan(0);
    expect(runtimeEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'goal_created',
        'action_selected',
        'action_terminal',
        'goal_terminal',
        'causal_change',
      ]),
    );
    expect(
      runtimeEvents.filter((event) => event.type === 'causal_change'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: expect.stringMatching(
            /^(need|resource|relationship|duty|world_event)$/u,
          ),
          sourceRef: expect.any(String),
        }),
      ]),
    );
    expect(() => assertPurposeBoundLifeSoakReady(result)).not.toThrow();
  });

  test('rejects an unknown live candidate before an action is admitted', () => {
    expect(() =>
      runPurposeBoundLifeSoak({
        seed: 'c021q7-invalid-hook',
        ticks: 1_000,
        decisionHook: () => ({
          kind: 'selected',
          candidateId: 'candidate:does-not-exist',
          reasonCode: 'routine',
          summary: '非法候选。',
        }),
      }),
    ).toThrow('purpose_bound_life_live_candidate_invalid');
  });
});

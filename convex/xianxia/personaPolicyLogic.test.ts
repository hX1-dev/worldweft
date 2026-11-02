import {
  INNER_TRAITS,
  OUTER_TRAITS,
} from './personalityLogic';
import {
  PERSONA_EXCEPTION_FIT_THRESHOLD,
  PERSONA_POLICY_VERSION,
  buildPersonaPolicy,
  evaluatePersonaCandidate,
  personaCandidateRank,
} from './personaPolicyLogic';

describe('C017c versioned persona policy', () => {
  test('all 7×12 trait combinations are finite, bounded and replay-stable', () => {
    for (const innerTrait of INNER_TRAITS) {
      for (const outerTrait of OUTER_TRAITS) {
        const first = buildPersonaPolicy(innerTrait, outerTrait);
        const replay = buildPersonaPolicy(innerTrait, outerTrait);
        expect(first).toEqual(replay);
        expect(first.policyVersion).toBe(PERSONA_POLICY_VERSION);
        expect(first.policyDigest).toMatch(/^stable64:[0-9a-f]{16}$/);
        expect(first.innerTraitKnown).toBe(true);
        expect(first.outerTraitKnown).toBe(true);
        expect(first.dimensions.riskTolerance).toBeGreaterThanOrEqual(0);
        expect(first.dimensions.riskTolerance).toBeLessThanOrEqual(100);
        for (const value of Object.values(first.dimensions)) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  test('unknown or absent traits produce an explicit neutral compatibility policy', () => {
    const unknown = buildPersonaPolicy('不存在', '也不存在');
    const absent = buildPersonaPolicy(undefined, undefined);
    for (const policy of [unknown, absent]) {
      expect(policy.reasonCodes).toContain('persona_policy_traits_unknown');
      expect(policy.innerTraitKnown).toBe(false);
      expect(policy.outerTraitKnown).toBe(false);
      expect(policy.dimensions).toMatchObject({
        riskTolerance: 50,
        helpingBias: 0,
        commitmentBias: 0,
        conflictBias: 0,
        socialBias: 0,
        cultivationBias: 0,
        persistenceBias: 0,
      });
    }
  });

  test('aggressive traits prefer bounded conflict while benevolent traits prefer avoidance', () => {
    const aggressive = buildPersonaPolicy('狂邪', '睚眦');
    const benevolent = buildPersonaPolicy('仁善', '孤僻');
    const attack = {
      actionType: 'attack',
      risk: 70,
      conflict: 100,
      persistence: 70,
      disposition: 'continue' as const,
    };
    const flee = {
      actionType: 'flee',
      risk: 10,
      conflict: 10,
      disposition: 'avoid' as const,
    };
    expect(evaluatePersonaCandidate(aggressive, attack).personaFit)
      .toBeGreaterThan(evaluatePersonaCandidate(aggressive, flee).personaFit);
    expect(evaluatePersonaCandidate(benevolent, flee).personaFit)
      .toBeGreaterThan(evaluatePersonaCandidate(benevolent, attack).personaFit);
  });

  test('selfless loyal traits accept help while selfish independent traits decline', () => {
    const loyal = buildPersonaPolicy('无私', '义气');
    const selfish = buildPersonaPolicy('利己', '任我');
    const accept = {
      actionType: 'accept_request',
      helping: 100,
      social: 50,
      disposition: 'accept' as const,
    };
    const decline = {
      actionType: 'decline_request',
      helping: 10,
      social: 20,
      disposition: 'decline' as const,
    };
    expect(evaluatePersonaCandidate(loyal, accept).personaFit)
      .toBeGreaterThan(evaluatePersonaCandidate(loyal, decline).personaFit);
    expect(evaluatePersonaCandidate(selfish, decline).personaFit)
      .toBeGreaterThan(evaluatePersonaCandidate(selfish, accept).personaFit);
  });

  test('power favours cultivation while a romantic profile is less cultivation-driven', () => {
    const power = buildPersonaPolicy('中庸', '权力');
    const romantic = buildPersonaPolicy('中庸', '情种');
    const cultivate = { actionType: 'cultivate', cultivation: 100 };
    expect(evaluatePersonaCandidate(power, cultivate).personaFit)
      .toBeGreaterThan(evaluatePersonaCandidate(romantic, cultivate).personaFit);
  });

  test('need and commitment remain stronger than ordinary persona preference', () => {
    const dislikedCommitment = personaCandidateRank({
      needScore: 82,
      commitmentUrgency: 90,
      personaFit: PERSONA_EXCEPTION_FIT_THRESHOLD,
    });
    const likedLeisure = personaCandidateRank({
      needScore: 35,
      commitmentUrgency: 0,
      personaFit: 60,
    });
    expect(dislikedCommitment).toBeGreaterThan(likedLeisure);
  });
});

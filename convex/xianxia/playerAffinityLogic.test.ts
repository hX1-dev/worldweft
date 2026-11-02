import {
  KIND_CAP_PER_CONVERSATION,
  KIND_CAP_PER_DAY,
  MAX_WITNESSES,
  PLAYER_ACTOR_ID,
  apologyStanding,
  applyApology,
  applyPlayerTone,
  attitudeOf,
  forgiveDrift,
  hearerPenalty,
  pickWitnesses,
  spreadPlayerRumor,
  visitBonus,
  witnessChance,
  type AffinityRecord,
  type PlayerRumor,
} from './playerAffinityLogic';

const DAY = 24 * 4; // ticks per day (0.25 h a tick)
const plain = { innerTrait: '中庸', outerTrait: '义气' };

describe('好感度 v1：口气改好感度', () => {
  test('insults and threats cost a lot; swearing and made-up claims a little; nothing is gained by them', () => {
    const record: AffinityRecord = { relationship: 0 };
    const base = { record, voice: 'upright' as const, temper: 0, kindThisConversation: 0, day: 10 };
    expect(applyPlayerTone({ ...base, tone: 'insult' })).toMatchObject({ affinityDelta: -10, temper: 2, offended: true, stormOff: false });
    expect(applyPlayerTone({ ...base, tone: 'threat' })).toMatchObject({ affinityDelta: -6, offended: true });
    expect(applyPlayerTone({ ...base, tone: 'crude' })).toMatchObject({ affinityDelta: -2, temper: 1, offended: false });
    expect(applyPlayerTone({ ...base, tone: 'false_claim' })).toMatchObject({ affinityDelta: -3 });
    expect(applyPlayerTone({ ...base, tone: 'backchannel' })).toMatchObject({ affinityDelta: 0, temper: 0 });
  });

  test('he storms off once the temper reaches what his temper can take', () => {
    const record: AffinityRecord = { relationship: 0 };
    // A terse loner leaves at the first insult; an upright one rebukes once and leaves at the second.
    expect(applyPlayerTone({ record, voice: 'curt', tone: 'insult', temper: 0, kindThisConversation: 0, day: 1 }).stormOff).toBe(true);
    const first = applyPlayerTone({ record, voice: 'upright', tone: 'insult', temper: 0, kindThisConversation: 0, day: 1 });
    expect(first.stormOff).toBe(false);
    expect(applyPlayerTone({ record, voice: 'upright', tone: 'insult', temper: first.temper, kindThisConversation: 0, day: 1 }).stormOff).toBe(true);
    // A seller snaps back at a threat, then leaves at the next insult.
    const threat = applyPlayerTone({ record, voice: 'shrewd', tone: 'threat', temper: 0, kindThisConversation: 0, day: 1 });
    expect(threat.stormOff).toBe(false);
    expect(applyPlayerTone({ record, voice: 'shrewd', tone: 'insult', temper: threat.temper, kindThisConversation: 0, day: 1 }).stormOff).toBe(true);
    // Kind words never make anyone storm off.
    expect(applyPlayerTone({ record, voice: 'curt', tone: 'kind', temper: 5, kindThisConversation: 0, day: 1 }).stormOff).toBe(false);
  });

  test('kind words help, but only so much per talk and per day', () => {
    const record: AffinityRecord = { relationship: 0 };
    let kindThisConversation = 0;
    let total = 0;
    for (let index = 0; index < 6; index += 1) {
      const effect = applyPlayerTone({ record, voice: 'gentle', tone: 'care', temper: 0, kindThisConversation, day: 3 });
      kindThisConversation = effect.kindThisConversation;
      record.kindDay = 3;
      record.kindToday = effect.kindToday;
      total += effect.affinityDelta;
    }
    expect(total).toBe(KIND_CAP_PER_CONVERSATION);
    // A second talk the same day only fills up to the daily cap.
    const second = applyPlayerTone({ record, voice: 'gentle', tone: 'care', temper: 0, kindThisConversation: 0, day: 3 });
    expect(second.affinityDelta).toBe(KIND_CAP_PER_DAY - KIND_CAP_PER_CONVERSATION);
    // A new day starts fresh.
    expect(applyPlayerTone({ record, voice: 'gentle', tone: 'care', temper: 0, kindThisConversation: 0, day: 4 }).affinityDelta).toBe(2);
  });

  test('the "met once more" bonus counts once a day, and not for a talk with insults or a storm-off', () => {
    expect(visitBonus({ record: { relationship: 0 }, day: 5, closedBy: 'player', offended: false })).toBe(2);
    expect(visitBonus({ record: { relationship: 0 }, day: 5, closedBy: 'npc_rule', offended: false })).toBe(1);
    expect(visitBonus({ record: { relationship: 0, lastVisitBonusDay: 5 }, day: 5, closedBy: 'player', offended: false })).toBe(0);
    expect(visitBonus({ record: { relationship: 0 }, day: 5, closedBy: 'player', offended: true })).toBe(0);
    expect(visitBonus({ record: { relationship: 0 }, day: 5, closedBy: 'npc_angry', offended: false })).toBe(0);
  });
});

describe('好感度 v1：态度、记仇', () => {
  test('attitude follows the number, and an insult keeps him cold for a few days', () => {
    expect(attitudeOf({ relationship: -25 }, 0, plain)).toBe('hostile');
    expect(attitudeOf({ relationship: -5 }, 0, plain)).toBe('cold');
    expect(attitudeOf({ relationship: 5 }, 0, plain)).toBe('neutral');
    expect(attitudeOf({ relationship: 20 }, 0, plain)).toBe('friendly');
    expect(attitudeOf({ relationship: 45 }, 0, plain)).toBe('close');
    const insulted: AffinityRecord = { relationship: 5, lastInsultTick: 1_000 };
    expect(attitudeOf(insulted, 1_000 + 2 * DAY, plain)).toBe('cold');
    expect(attitudeOf(insulted, 1_000 + 4 * DAY, plain)).toBe('neutral');
    // Someone who never forgets stays cold twice as long; a kind soul forgets sooner.
    expect(attitudeOf(insulted, 1_000 + 5 * DAY, { innerTrait: '中庸', outerTrait: '睚眦' })).toBe('cold');
    expect(attitudeOf(insulted, 1_000 + 2.5 * DAY, { innerTrait: '仁善', outerTrait: '义气' })).toBe('neutral');
  });

  test('a grudge fades a little each day, never past zero, and only once for the same days', () => {
    const record: AffinityRecord = { relationship: -10, lastMetTick: 0 };
    const later = forgiveDrift(record, 3 * DAY, plain);
    expect(later.relationship).toBeCloseTo(-7);
    const again = forgiveDrift({ ...record, relationship: later.relationship, lastDriftTick: later.lastDriftTick }, 3 * DAY, plain);
    expect(again.relationship).toBeCloseTo(-7);
    expect(forgiveDrift({ relationship: -2, lastMetTick: 0 }, 30 * DAY, plain).relationship).toBe(0);
    expect(forgiveDrift({ relationship: -10, lastMetTick: 0 }, 30 * DAY, { innerTrait: '中庸', outerTrait: '睚眦' }).relationship).toBe(-10);
    expect(forgiveDrift({ relationship: 12, lastMetTick: 0 }, 30 * DAY, plain).relationship).toBe(12);
  });
});

describe('好感度 v1：流言', () => {
  const rumor: PlayerRumor = {
    newsId: 'player:offense:seller:100',
    victimId: 'seller',
    tick: 100,
    tone: 'insult',
    knowers: { seller: { tick: 100, source: 'direct' }, witness: { tick: 100, source: 'witness' } },
  };
  const gossip = { innerTrait: '利己', outerTrait: '名声' };

  test('it spreads only along later meetings, from someone who already knew', () => {
    const knowers = spreadPlayerRumor({
      rumor,
      interactions: [
        { tick: 90, a: 'seller', b: 'early' },
        { tick: 120, a: 'witness', b: 'friend' },
        { tick: 130, a: 'stranger', b: 'nobody' },
        { tick: 140, a: 'friend', b: PLAYER_ACTOR_ID },
      ],
      traitsOf: () => gossip,
      closeness: () => 50,
      seedKey: 'test',
    });
    expect(knowers.early).toBeUndefined();
    expect(knowers.nobody).toBeUndefined();
    expect(knowers[PLAYER_ACTOR_ID]).toBeUndefined();
    expect(knowers.seller.source).toBe('direct');
    // With a gossip at high closeness the chance is at its cap, so over many seeds most meetings pass it on.
    let passed = 0;
    for (let index = 0; index < 40; index += 1) {
      const result = spreadPlayerRumor({ rumor, interactions: [{ tick: 120, a: 'witness', b: 'friend' }], traitsOf: () => gossip, closeness: () => 50, seedKey: `s${index}` });
      if (result.friend) {
        passed += 1;
        expect(result.friend).toEqual({ tick: 120, source: 'told' });
      }
    }
    expect(passed).toBeGreaterThan(25);
    // A loner passes it on far less often.
    let lonerPassed = 0;
    for (let index = 0; index < 40; index += 1) {
      const result = spreadPlayerRumor({
        rumor,
        interactions: [{ tick: 120, a: 'witness', b: 'friend' }],
        traitsOf: () => ({ innerTrait: '中庸', outerTrait: '孤僻' }),
        closeness: () => 0,
        seedKey: `s${index}`,
      });
      if (result.friend) lonerPassed += 1;
    }
    expect(lonerPassed).toBeLessThan(passed);
  });

  test('hearing it costs the player goodwill, more if the victim is a close friend, less if only heard second-hand', () => {
    expect(hearerPenalty(10)).toBe(-3);
    expect(hearerPenalty(45)).toBe(-9);
    expect(hearerPenalty(10, 'told')).toBe(-2);
    expect(hearerPenalty(45, 'told')).toBe(-6);
  });

  test('not everyone in the same place hears it: at most two nearby, idle people more than those meditating', () => {
    expect(witnessChance('歇着')).toBeGreaterThan(witnessChance('修炼'));
    expect(witnessChance('修炼间歇，打坐调息')).toBeGreaterThan(witnessChance('修炼'));
    const crowd = Array.from({ length: 8 }, (_, index) => ({ actorId: `npc${index}`, activity: '歇着' }));
    let total = 0;
    for (let index = 0; index < 50; index += 1) {
      const heard = pickWitnesses({ candidates: crowd, seedKey: `w${index}` });
      expect(heard.length).toBeLessThanOrEqual(MAX_WITNESSES);
      total += heard.length;
    }
    expect(total).toBeGreaterThan(0);
    // Everyone deep in meditation: rarely anyone notices.
    const meditating = Array.from({ length: 8 }, (_, index) => ({ actorId: `npc${index}`, activity: '修炼' }));
    let quiet = 0;
    for (let index = 0; index < 50; index += 1) quiet += pickWitnesses({ candidates: meditating, seedKey: `w${index}` }).length;
    expect(quiet).toBeLessThan(total);
  });

  test('second-hand tellers pass it on half as often, and after seven days nobody passes it on', () => {
    const toldRumor: PlayerRumor = { ...rumor, knowers: { seller: { tick: 100, source: 'direct' }, gossip: { tick: 110, source: 'told' } } };
    let firstHand = 0;
    let secondHand = 0;
    for (let index = 0; index < 200; index += 1) {
      const seedKey = `h${index}`;
      if (spreadPlayerRumor({ rumor, interactions: [{ tick: 120, a: 'witness', b: 'x' }], traitsOf: () => gossip, closeness: () => 0, seedKey }).x) firstHand += 1;
      if (spreadPlayerRumor({ rumor: toldRumor, interactions: [{ tick: 120, a: 'gossip', b: 'x' }], traitsOf: () => gossip, closeness: () => 0, seedKey }).x) secondHand += 1;
    }
    expect(secondHand).toBeLessThan(firstHand);
    const stale = spreadPlayerRumor({ rumor, interactions: [{ tick: 100 + 8 * DAY, a: 'seller', b: 'late' }], traitsOf: () => gossip, closeness: () => 50, seedKey: 'stale' });
    expect(stale.late).toBeUndefined();
  });
});

describe('好感度 v1.4/v1.5：道歉', () => {
  test('an apology works only on someone you wronged, once per wrong and once a day; it halves the cold spell and keeps the memory', () => {
    expect(applyApology({ relationship: 0 }, 11)).toMatchObject({ accepted: false, reason: 'no_grievance', affinityDelta: 0 });
    const wronged: AffinityRecord = { relationship: -10, insults: 1, lastInsultTick: 1_000, apologyOwed: 10 };
    const accepted = applyApology(wronged, 11);
    expect(accepted).toMatchObject({ accepted: true, affinityDelta: 3, lastApologyDay: 11, apologyForInsultTick: 1_000, apologyOwed: 0 });
    expect(applyApology({ ...wronged, lastApologyDay: 11 }, 11)).toMatchObject({ accepted: false, reason: 'again_today' });
    // Apologizing again on another day for the same wrong gains nothing (v1.4 gave +3 every day).
    const settled: AffinityRecord = { ...wronged, lastApologyDay: 11, apologyForInsultTick: 1_000, apologyOwed: 0 };
    expect(apologyStanding(settled, 12)).toBe('done');
    expect(applyApology(settled, 12)).toMatchObject({ accepted: false, reason: 'already', affinityDelta: 0 });
    // A new wrong after that can be apologized for, on another day.
    expect(applyApology({ ...settled, apologyOwed: 4 }, 11)).toMatchObject({ accepted: false, reason: 'again_today' });
    expect(applyApology({ ...settled, apologyOwed: 4 }, 12)).toMatchObject({ accepted: true, affinityDelta: 3 });
    // The cold spell after the insult is cut in half by the apology (3 days → 1.5 days).
    const afterTwoDays = 1_000 + 2 * DAY;
    expect(attitudeOf({ relationship: 0, lastInsultTick: 1_000 }, afterTwoDays, plain)).toBe('cold');
    expect(attitudeOf({ relationship: 0, lastInsultTick: 1_000, apologyForInsultTick: 1_000 }, afterTwoDays, plain)).toBe('neutral');
    // A new insult after the apology starts a new cold spell at full length.
    expect(attitudeOf({ relationship: 0, lastInsultTick: 2_000, apologyForInsultTick: 1_000 }, 2_000 + 2 * DAY, plain)).toBe('cold');
  });

  test('swearing, made-up claims and rudeness the model caught are wrongs too; an apology gives back at most what they cost', () => {
    const base = { voice: 'upright' as const, temper: 0, kindThisConversation: 0, day: 10 };
    const rude = applyPlayerTone({ ...base, record: { relationship: 0 }, tone: 'ai_rude' });
    expect(rude).toMatchObject({ affinityDelta: -4, apologyOwed: 4, offended: false });
    expect(apologyStanding({ relationship: -4, apologyOwed: rude.apologyOwed }, 10)).toBe('owed');
    expect(applyApology({ relationship: -4, apologyOwed: rude.apologyOwed }, 10)).toMatchObject({ accepted: true, affinityDelta: 3 });
    // Swearing cost 2, so the apology gives back 2: no profit from swearing and apologizing.
    const crude = applyPlayerTone({ ...base, record: { relationship: 0 }, tone: 'crude' });
    expect(applyApology({ relationship: -2, apologyOwed: crude.apologyOwed }, 10)).toMatchObject({ accepted: true, affinityDelta: 2 });
    // Kind words and short replies owe nothing.
    expect(applyPlayerTone({ ...base, record: { relationship: 0 }, tone: 'kind' }).apologyOwed).toBe(0);
    expect(applyPlayerTone({ ...base, record: { relationship: 0 }, tone: 'backchannel' }).apologyOwed).toBe(0);
    // Two insults, one apology: +3 once.
    const first = applyPlayerTone({ ...base, record: { relationship: 0 }, tone: 'insult' });
    const second = applyPlayerTone({ ...base, temper: first.temper, record: { relationship: -10, apologyOwed: first.apologyOwed }, tone: 'insult' });
    expect(second.apologyOwed).toBe(20);
    expect(applyApology({ relationship: -20, insults: 2, apologyOwed: second.apologyOwed }, 10)).toMatchObject({ accepted: true, affinityDelta: 3 });
  });
});

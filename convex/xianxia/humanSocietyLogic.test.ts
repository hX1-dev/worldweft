import {
  HUMAN_NEWS_SALIENCE,
  humanAllyGrudge,
  humanDailyGrudgeRelief,
  humanDistortNews,
  humanGossipChance,
  humanImpressionAdjustment,
  humanImpressionFromNews,
  humanImpressionOf,
  humanQuarrelChance,
  humanQuarrelOffender,
  humanReputationLabel,
  humanTellsSelfServing,
  humanTemper,
  humanWillApologize,
  isNegativeHumanNews,
  sameHumanNewsVersion,
  type HumanNewsVersion,
} from './humanSocietyLogic';

const calm = { innerTrait: '仁善', outerTrait: '义气' };
const plain = { innerTrait: '中庸', outerTrait: '天伦' };
const hot = { innerTrait: '利己', outerTrait: '睚眦' };

describe('拟人生活 v1：争执与记仇', () => {
  test('ill-matched, hot-tempered, low-spirited people quarrel more, up to one chat in two', () => {
    const chance = (overrides: Partial<Parameters<typeof humanQuarrelChance>[0]> = {}) =>
      humanQuarrelChance({
        chemistry: 1,
        speaker: plain,
        listener: plain,
        speakerMood: 5,
        tension: 0,
        troubleImpression: 0,
        ...overrides,
      });
    expect(chance({ chemistry: -1 })).toBeGreaterThan(chance({ chemistry: 0 }));
    expect(chance({ chemistry: 0 })).toBeGreaterThan(chance({ chemistry: 1 }));
    expect(chance({ chemistry: 1 })).toBeGreaterThan(chance({ chemistry: 3 }));
    expect(chance({ speaker: hot })).toBeGreaterThan(chance());
    expect(chance({ speaker: calm })).toBeLessThan(chance());
    expect(chance({ speakerMood: 2 })).toBeGreaterThan(chance());
    expect(chance({ tension: 60 })).toBeGreaterThan(chance());
    expect(chance({ troubleImpression: 2 })).toBeGreaterThan(chance());
    expect(
      chance({ chemistry: -1, speaker: hot, listener: hot, speakerMood: 0, tension: 100, troubleImpression: 5 }),
    ).toBe(0.5);
  });

  test('the hotter temper said the hurtful thing; on a tie, the one who spoke', () => {
    expect(humanTemper(hot)).toBeGreaterThan(humanTemper(plain));
    expect(humanQuarrelOffender({ actorId: 'a', ...calm }, { actorId: 'b', ...hot })).toBe('b');
    expect(humanQuarrelOffender({ actorId: 'a', ...plain }, { actorId: 'b', ...plain })).toBe('a');
  });

  test('upright and kind people apologize and tell the truth; the others do not', () => {
    expect(humanWillApologize({ innerTrait: '正直', outerTrait: '义气' })).toBe(true);
    expect(humanWillApologize({ innerTrait: '中庸', outerTrait: '孤僻' })).toBe(true);
    expect(humanWillApologize({ innerTrait: '中庸', outerTrait: '睚眦' })).toBe(false);
    expect(humanWillApologize({ innerTrait: '利己', outerTrait: '名声' })).toBe(false);
    expect(humanTellsSelfServing({ innerTrait: '仁善' })).toBe(false);
    expect(humanTellsSelfServing({ innerTrait: '利己' })).toBe(true);
  });

  test('grudges fade by temperament: never for the vengeful, sooner for the kind', () => {
    expect(humanDailyGrudgeRelief({ innerTrait: '中庸', outerTrait: '睚眦' })).toEqual({
      suspicion: 0,
      recoveryShare: 0,
    });
    const usual = humanDailyGrudgeRelief(plain);
    const kind = humanDailyGrudgeRelief({ innerTrait: '仁善', outerTrait: '天伦' });
    expect(kind.suspicion).toBeGreaterThan(usual.suspicion);
    expect(kind.recoveryShare).toBeGreaterThan(usual.recoveryShare);
  });

  test('a loyal close friend of the one wronged takes it up; others do not', () => {
    const loyal = { actorId: 'friend', innerTrait: '正直', outerTrait: '义气' };
    expect(humanAllyGrudge({ offenderId: 'x', hearer: loyal, closenessToVictim: 45 })?.delta).toEqual({
      affinity: -6,
      suspicion: 3,
    });
    expect(humanAllyGrudge({ offenderId: 'x', hearer: loyal, closenessToVictim: 20 })).toBeUndefined();
    expect(
      humanAllyGrudge({
        offenderId: 'x',
        hearer: { actorId: 'loner', innerTrait: '中庸', outerTrait: '孤僻' },
        closenessToVictim: 60,
      }),
    ).toBeUndefined();
  });
});

describe('拟人生活 v1：流言与名声', () => {
  const quarrel: HumanNewsVersion = { kind: 'quarrel', subjectId: 'a', objectId: 'b' };

  test('retelling garbles: who did what to whom, how bad, then who', () => {
    expect(humanDistortNews(quarrel, 0.1, ['c', 'd'])).toEqual({
      version: { kind: 'quarrel', subjectId: 'b', objectId: 'a' },
      distortion: 'swapped',
    });
    expect(humanDistortNews(quarrel, 0.9, ['c', 'd'])).toEqual({
      version: { ...quarrel, exaggerated: true },
      distortion: 'exaggerated',
    });
    const told = humanDistortNews({ kind: 'sighting', subjectId: 'a', exaggerated: true }, 0.9, ['a', 'c', 'd']);
    expect(told.distortion).toBe('wrong_person');
    expect(['c', 'd']).toContain(told.version.subjectId);
    expect(sameHumanNewsVersion(quarrel, { ...quarrel })).toBe(true);
    expect(sameHumanNewsVersion(quarrel, { ...quarrel, exaggerated: true })).toBe(false);
  });

  test('striking news gets told more, loners and the upright tell less, friends hear more', () => {
    const gossip = humanGossipChance({ innerTrait: '利己', outerTrait: '名声' }, 10, HUMAN_NEWS_SALIENCE.quarrel);
    const quiet = humanGossipChance({ innerTrait: '正直', outerTrait: '孤僻' }, 10, HUMAN_NEWS_SALIENCE.quarrel);
    expect(gossip).toBeGreaterThan(quiet);
    expect(humanGossipChance(plain, 10, HUMAN_NEWS_SALIENCE.injury)).toBeGreaterThan(
      humanGossipChance(plain, 10, HUMAN_NEWS_SALIENCE.commission),
    );
    expect(humanGossipChance(plain, 45)).toBeGreaterThan(humanGossipChance(plain, 10));
    expect(isNegativeHumanNews('quarrel')).toBe(true);
    expect(isNegativeHumanNews('gift')).toBe(false);
  });

  test('impressions come from what one knows, weighed by how one knows it', () => {
    expect(humanImpressionFromNews(quarrel, 'witness', 'a')).toEqual({ warmth: 0, trouble: 1 });
    expect(humanImpressionFromNews({ ...quarrel, exaggerated: true }, 'told', 'a')).toEqual({
      warmth: 0,
      trouble: 1.2,
    });
    expect(humanImpressionFromNews(quarrel, 'witness', 'b')).toEqual({ warmth: 0, trouble: 0 });
    expect(humanImpressionFromNews({ kind: 'gift', subjectId: 'a', objectId: 'b' }, 'told', 'a')).toEqual({
      warmth: 0.6,
      trouble: 0,
    });
    expect(
      humanImpressionOf(
        [
          { version: quarrel, source: 'told' },
          { version: { kind: 'apology', subjectId: 'a', objectId: 'b' }, source: 'direct' },
        ],
        'a',
      ),
    ).toEqual({ warmth: 0.5, trouble: 0.6 });
  });

  test('a name sticks once three in ten share it, and it changes who is sought out', () => {
    const view = (warmth: number, trouble: number) => ({ warmth, trouble });
    expect(humanReputationLabel([view(0, 1), view(0, 1), view(0, 1), ...Array(7).fill(view(0, 0))])).toBe('惹事');
    expect(humanReputationLabel([view(1, 0), view(1, 0), view(1, 0), ...Array(7).fill(view(0, 0))])).toBe('热心肠');
    expect(humanReputationLabel([view(0, 1), view(0, 1), ...Array(8).fill(view(0, 0))])).toBeUndefined();
    expect(humanReputationLabel([])).toBeUndefined();
    expect(humanImpressionAdjustment(view(2, 0))).toBe(6);
    expect(humanImpressionAdjustment(view(0, 1))).toBe(-6);
    expect(humanImpressionAdjustment(view(5, 5))).toBe(9 - 18);
    expect(humanImpressionAdjustment(undefined)).toBe(0);
  });
});

import { MS_PER_LIFE_YEAR } from './lifeCalendarLogic';
import {
  ACTOR_LIFECYCLE_VERSION,
  ACTOR_DEATH_VERSION,
  LEGACY_LIFE_BIRTH_SOURCE,
  REALM_LIFESPAN_YEARS,
  actorLifecycleAt,
  deterministicLegacyInitialAgeYears,
  legacyLifeBirthAnchor,
  oldAgeDeathBoundary,
  isAtOrBeyondOldAgeDeath,
  realmLifespanYears,
} from './lifeProfileLogic';

const NOW = 1_780_000_000_000;

describe('C019b authoritative actor age and realm lifespan', () => {
  test('freezes the five low-high-power lifespan limits', () => {
    expect(REALM_LIFESPAN_YEARS).toEqual({
      qi_refining: 80,
      foundation_building: 160,
      golden_core: 260,
      nascent_soul: 350,
      deity_transformation: 500,
    });
  });

  test('derives age from birth anchor without a mutable age counter', () => {
    expect(
      actorLifecycleAt({
        now: NOW,
        lifeBornAt: NOW - 42.5 * MS_PER_LIFE_YEAR,
        realm: 'qi_refining',
      }),
    ).toMatchObject({
      contractVersion: ACTOR_LIFECYCLE_VERSION,
      ageLifeYears: 42.5,
      completedAgeYears: 42,
      lifespanYears: 80,
      remainingLifeYears: 37.5,
      atOrBeyondLifespan: false,
    });
  });

  test('clamps observations before birth to zero age', () => {
    expect(
      actorLifecycleAt({
        now: NOW,
        lifeBornAt: NOW + MS_PER_LIFE_YEAR,
        realm: 'qi_refining',
      }),
    ).toMatchObject({
      ageLifeYears: 0,
      completedAgeYears: 0,
      remainingLifeYears: 80,
      lifeProgress: 0,
    });
  });

  test('marks the exact lifespan boundary without causing death', () => {
    expect(
      actorLifecycleAt({
        now: NOW,
        lifeBornAt: NOW - 260 * MS_PER_LIFE_YEAR,
        realm: 'golden_core',
      }),
    ).toMatchObject({
      completedAgeYears: 260,
      remainingLifeYears: 0,
      lifeProgress: 1,
      atOrBeyondLifespan: true,
    });
  });

  test('freezes the exact C019c old-age boundary independently of scheduler delay', () => {
    const lifeBornAt = NOW - 80 * MS_PER_LIFE_YEAR;
    const boundary = oldAgeDeathBoundary({ lifeBornAt, realm: 'qi_refining' });
    expect(ACTOR_DEATH_VERSION).toBe('taixu.actor_death.v1');
    expect(boundary).toBe(NOW);
    expect(
      isAtOrBeyondOldAgeDeath({
        now: boundary - 1,
        lifeBornAt,
        realm: 'qi_refining',
      }),
    ).toBe(false);
    expect(
      isAtOrBeyondOldAgeDeath({
        now: boundary,
        lifeBornAt,
        realm: 'qi_refining',
      }),
    ).toBe(true);
    expect(
      isAtOrBeyondOldAgeDeath({
        now: boundary + 10 * MS_PER_LIFE_YEAR,
        lifeBornAt,
        realm: 'qi_refining',
      }),
    ).toBe(true);
  });

  test('realm breakthrough changes lifespan but not age or birth anchor', () => {
    const lifeBornAt = NOW - 70 * MS_PER_LIFE_YEAR;
    const before = actorLifecycleAt({ now: NOW, lifeBornAt, realm: 'qi_refining' });
    const after = actorLifecycleAt({ now: NOW, lifeBornAt, realm: 'foundation_building' });
    expect(after.lifeBornAt).toBe(before.lifeBornAt);
    expect(after.ageLifeYears).toBe(before.ageLifeYears);
    expect([before.lifespanYears, after.lifespanYears]).toEqual([80, 160]);
    expect(after.remainingLifeYears - before.remainingLifeYears).toBe(80);
  });

  test.each(Object.entries(REALM_LIFESPAN_YEARS))(
    'returns the frozen lifespan for %s',
    (realm, lifespan) => {
      expect(realmLifespanYears(realm)).toBe(lifespan);
    },
  );

  test('legacy initial ages are deterministic, varied and below current lifespan', () => {
    const first = deterministicLegacyInitialAgeYears({
      actorId: '墨长老',
      realm: 'golden_core',
      realmStage: 1,
    });
    const replay = deterministicLegacyInitialAgeYears({
      actorId: '墨长老',
      realm: 'golden_core',
      realmStage: 1,
    });
    const other = deterministicLegacyInitialAgeYears({
      actorId: '另一位长老',
      realm: 'golden_core',
      realmStage: 1,
    });
    expect(first).toBe(replay);
    expect(first).toBeLessThan(REALM_LIFESPAN_YEARS.golden_core);
    expect(other).not.toBe(first);
  });

  test('migration uses calendar start for older profiles and creation for later profiles', () => {
    const oldProfile = legacyLifeBirthAnchor({
      actorId: 'old',
      realm: 'qi_refining',
      realmStage: 1,
      profileCreatedAt: NOW - MS_PER_LIFE_YEAR,
      lifeCalendarStartedAt: NOW,
    });
    const newProfile = legacyLifeBirthAnchor({
      actorId: 'new',
      realm: 'qi_refining',
      realmStage: 1,
      profileCreatedAt: NOW + MS_PER_LIFE_YEAR,
      lifeCalendarStartedAt: NOW,
    });
    expect(oldProfile.referenceAt).toBe(NOW);
    expect(newProfile.referenceAt).toBe(NOW + MS_PER_LIFE_YEAR);
    expect(oldProfile.source).toBe(LEGACY_LIFE_BIRTH_SOURCE);
    expect(
      actorLifecycleAt({
        now: oldProfile.referenceAt,
        lifeBornAt: oldProfile.lifeBornAt,
        realm: 'qi_refining',
      }).ageLifeYears,
    ).toBe(oldProfile.initialAgeYears);
  });

  test('rejects invalid time, birth, realm and realm stage', () => {
    expect(() =>
      actorLifecycleAt({ now: Number.NaN, lifeBornAt: NOW, realm: 'qi_refining' }),
    ).toThrow('lifecycle_invalid_time');
    expect(() =>
      actorLifecycleAt({ now: NOW, lifeBornAt: Number.NaN, realm: 'qi_refining' }),
    ).toThrow('lifecycle_invalid_birth_anchor');
    expect(() => realmLifespanYears('immortal_emperor')).toThrow('lifecycle_unknown_realm');
    expect(() =>
      deterministicLegacyInitialAgeYears({
        actorId: 'bad-stage',
        realm: 'foundation_building',
        realmStage: 4,
      }),
    ).toThrow('lifecycle_invalid_realm_stage');
  });
});

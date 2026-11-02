import { MS_PER_LIFE_SEASON, MS_PER_LIFE_YEAR } from './lifeCalendarLogic';
import {
  POPULATION_HARD_CAPACITY,
  POPULATION_MIGRATION_COOLDOWN_MS,
  POPULATION_MIGRATION_SOURCE_ID,
  POPULATION_TRIGGER_BELOW,
  buildMigrantProfileSeed,
  planPopulationMigration,
  populationMigrationId,
} from './populationMigrationLogic';

const T0 = 1_800_000_000_000;

describe('bounded population migration', () => {
  test.each([0, 1, 2, 3, 4, 5])(
    'population %i is eligible for one bounded admission',
    (alivePopulation) => {
      const plan = planPopulationMigration({
        alivePopulation,
        now: T0,
        lifeCalendarStartedAt: T0,
        usedSourceSlots: [],
      });
      expect(plan).toMatchObject({
        status: 'eligible',
        calendarYear: 1,
        sourceSlot: 0,
        populationBefore: alivePopulation,
        populationAfter: alivePopulation + 1,
      });
    },
  );

  test.each([POPULATION_TRIGGER_BELOW, POPULATION_TRIGGER_BELOW + 1])(
    'population %i does not admit above the trigger floor',
    (alivePopulation) => {
      expect(
        planPopulationMigration({
          alivePopulation,
          now: T0,
          lifeCalendarStartedAt: T0,
          usedSourceSlots: [],
        }),
      ).toMatchObject({
        status: 'no_op',
        reason: 'population_at_or_above_trigger',
      });
    },
  );

  test.each([POPULATION_HARD_CAPACITY, POPULATION_HARD_CAPACITY + 10])(
    'population %i fails closed at hard capacity',
    (alivePopulation) => {
      expect(
        planPopulationMigration({
          alivePopulation,
          now: T0,
          lifeCalendarStartedAt: T0,
          usedSourceSlots: [],
        }),
      ).toMatchObject({
        status: 'no_op',
        reason: 'population_capacity_reached',
      });
    },
  );

  test('cooldown includes clock rollback and opens exactly at one season', () => {
    const lastAdmittedAt = T0 + MS_PER_LIFE_YEAR;
    const beforeBoundary = planPopulationMigration({
      alivePopulation: 3,
      now: lastAdmittedAt + MS_PER_LIFE_SEASON - 1,
      lifeCalendarStartedAt: T0,
      lastAdmittedAt,
      usedSourceSlots: [0],
    });
    const rollback = planPopulationMigration({
      alivePopulation: 3,
      now: lastAdmittedAt - 1,
      lifeCalendarStartedAt: T0,
      lastAdmittedAt,
      usedSourceSlots: [0],
    });
    const atBoundary = planPopulationMigration({
      alivePopulation: 3,
      now: lastAdmittedAt + MS_PER_LIFE_SEASON,
      lifeCalendarStartedAt: T0,
      lastAdmittedAt,
      usedSourceSlots: [0],
    });
    expect(beforeBoundary).toMatchObject({
      status: 'no_op',
      reason: 'migration_cooldown_active',
      nextEligibleAt: lastAdmittedAt + POPULATION_MIGRATION_COOLDOWN_MS,
    });
    expect(rollback).toMatchObject({
      status: 'no_op',
      reason: 'migration_cooldown_active',
    });
    expect(atBoundary).toMatchObject({ status: 'eligible', sourceSlot: 1 });
  });

  test('a source admits at most two people per life year', () => {
    expect(
      planPopulationMigration({
        alivePopulation: 3,
        now: T0,
        lifeCalendarStartedAt: T0,
        usedSourceSlots: [0, 1],
      }),
    ).toMatchObject({
      status: 'no_op',
      reason: 'source_year_capacity_reached',
    });
    expect(
      planPopulationMigration({
        alivePopulation: 3,
        now: T0 + MS_PER_LIFE_YEAR,
        lifeCalendarStartedAt: T0,
        usedSourceSlots: [],
      }),
    ).toMatchObject({
      status: 'eligible',
      calendarYear: 2,
      sourceSlot: 0,
    });
  });

  test('identity is deterministic and creates no inventory faucet', () => {
    const migrationId = populationMigrationId(37, 1);
    const first = buildMigrantProfileSeed({
      migrationId,
      actorId: `migrant:${POPULATION_MIGRATION_SOURCE_ID}:year:37:slot:1`,
      admittedAt: T0,
    });
    const replay = buildMigrantProfileSeed({
      migrationId,
      actorId: first.actorId,
      admittedAt: T0,
    });
    const other = buildMigrantProfileSeed({
      migrationId: populationMigrationId(38, 0),
      actorId: `migrant:${POPULATION_MIGRATION_SOURCE_ID}:year:38:slot:0`,
      admittedAt: T0 + MS_PER_LIFE_YEAR,
    });

    expect(replay).toEqual(first);
    expect(other.actorId).not.toBe(first.actorId);
    expect(first).toMatchObject({
      role: 'outer_disciple',
      realm: 'qi_refining',
      lifeStatus: 'alive',
      mapId: 'world',
      currentLocationId: 'mountain_gate',
      inventory: [],
    });
    expect(first.initialAgeYears).toBeGreaterThanOrEqual(18);
    expect(first.initialAgeYears).toBeLessThanOrEqual(25);
    expect(first.realmStage).toBeGreaterThanOrEqual(1);
    expect(first.realmStage).toBeLessThanOrEqual(3);
    expect((T0 - first.lifeBornAt) / MS_PER_LIFE_YEAR).toBe(first.initialAgeYears);
  });

  test('invalid counts, years and slots fail closed', () => {
    expect(() =>
      planPopulationMigration({
        alivePopulation: -1,
        now: T0,
        lifeCalendarStartedAt: T0,
        usedSourceSlots: [],
      }),
    ).toThrow('population_migration_invalid_population');
    expect(() => populationMigrationId(0, 0)).toThrow(
      'population_migration_invalid_year',
    );
    expect(() => populationMigrationId(1, 2)).toThrow(
      'population_migration_invalid_source_slot',
    );
  });
});

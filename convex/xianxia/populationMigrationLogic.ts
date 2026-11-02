import {
  MS_PER_LIFE_SEASON,
  MS_PER_LIFE_YEAR,
  lifeCalendarAt,
} from './lifeCalendarLogic';
import { INNER_TRAITS, OUTER_TRAITS, personaFragment } from './personalityLogic';

export const POPULATION_MIGRATION_VERSION = 'taixu.population_migration.v1' as const;
export const POPULATION_POOL_ID = 'main_world_residents' as const;
export const POPULATION_POOL_MAP_ID = 'world' as const;
export const POPULATION_ENTRY_LOCATION_ID = 'mountain_gate' as const;
export const POPULATION_MIGRATION_SOURCE_ID = 'qinglan_outer_villages' as const;
export const POPULATION_TRIGGER_BELOW = 6;
export const POPULATION_HARD_CAPACITY = 8;
export const POPULATION_SOURCE_YEAR_CAPACITY = 2;
export const POPULATION_MIGRATION_COOLDOWN_MS = MS_PER_LIFE_SEASON;
export const POPULATION_MIGRATION_BATCH_SIZE = 1;

export type PopulationMigrationNoopReason =
  | 'population_capacity_reached'
  | 'population_at_or_above_trigger'
  | 'migration_cooldown_active'
  | 'source_year_capacity_reached';

export type PopulationMigrationPlan =
  | {
      status: 'eligible';
      contractVersion: typeof POPULATION_MIGRATION_VERSION;
      poolId: typeof POPULATION_POOL_ID;
      sourceId: typeof POPULATION_MIGRATION_SOURCE_ID;
      calendarYear: number;
      sourceSlot: number;
      migrationId: string;
      actorId: string;
      populationBefore: number;
      populationAfter: number;
      nextEligibleAt: number;
    }
  | {
      status: 'no_op';
      contractVersion: typeof POPULATION_MIGRATION_VERSION;
      reason: PopulationMigrationNoopReason;
      calendarYear: number;
      populationBefore: number;
      nextEligibleAt?: number;
    };

export type MigrantProfileSeed = {
  actorId: string;
  name: string;
  role: 'outer_disciple';
  realm: 'qi_refining';
  realmStage: number;
  spiritRoot: string;
  innerTrait: string;
  outerTrait: string;
  cultivationXp: number;
  realmEnteredAt: number;
  lifeBornAt: number;
  lifeBirthSource: string;
  lifeBirthRecordedAt: number;
  lifeStatus: 'alive';
  mood: number;
  health: number;
  maxHealth: number;
  fatigue: number;
  spirit: number;
  reputation: number;
  inventory: [];
  mapId: typeof POPULATION_POOL_MAP_ID;
  currentLocationId: typeof POPULATION_ENTRY_LOCATION_ID;
  currentIntent: string;
  persona: string;
  initialAgeYears: number;
};

const SURNAMES = [
  '沈',
  '陆',
  '顾',
  '叶',
  '苏',
  '秦',
  '程',
  '谢',
  '许',
  '周',
  '唐',
  '温',
] as const;
const GIVEN_PREFIXES = [
  '清',
  '云',
  '知',
  '怀',
  '景',
  '若',
  '承',
  '念',
  '安',
  '临',
  '修',
  '归',
] as const;
const GIVEN_SUFFIXES = [
  '川',
  '宁',
  '禾',
  '舟',
  '岚',
  '真',
  '远',
  '微',
  '言',
  '青',
  '白',
  '生',
] as const;
const SPIRIT_ROOTS = ['metal', 'wood', 'water', 'fire', 'earth', 'mixed'] as const;

export function planPopulationMigration(args: {
  alivePopulation: number;
  now: number;
  lifeCalendarStartedAt: number;
  lastAdmittedAt?: number;
  usedSourceSlots: number[];
}): PopulationMigrationPlan {
  assertCount(args.alivePopulation, 'population_migration_invalid_population');
  assertFiniteTime(args.now);
  assertFiniteTime(args.lifeCalendarStartedAt);
  if (args.lastAdmittedAt !== undefined) assertFiniteTime(args.lastAdmittedAt);
  const calendarYear = lifeCalendarAt(args.now, args.lifeCalendarStartedAt).year;

  if (args.alivePopulation >= POPULATION_HARD_CAPACITY) {
    return noOp('population_capacity_reached', calendarYear, args.alivePopulation);
  }
  if (args.alivePopulation >= POPULATION_TRIGGER_BELOW) {
    return noOp('population_at_or_above_trigger', calendarYear, args.alivePopulation);
  }

  if (args.lastAdmittedAt !== undefined) {
    const nextEligibleAt = args.lastAdmittedAt + POPULATION_MIGRATION_COOLDOWN_MS;
    if (args.now < nextEligibleAt) {
      return noOp(
        'migration_cooldown_active',
        calendarYear,
        args.alivePopulation,
        nextEligibleAt,
      );
    }
  }

  const usedSlots = new Set(args.usedSourceSlots);
  const sourceSlot = Array.from(
    { length: POPULATION_SOURCE_YEAR_CAPACITY },
    (_, slot) => slot,
  ).find((slot) => !usedSlots.has(slot));
  if (sourceSlot === undefined) {
    return noOp('source_year_capacity_reached', calendarYear, args.alivePopulation);
  }

  const migrationId = populationMigrationId(calendarYear, sourceSlot);
  return {
    status: 'eligible',
    contractVersion: POPULATION_MIGRATION_VERSION,
    poolId: POPULATION_POOL_ID,
    sourceId: POPULATION_MIGRATION_SOURCE_ID,
    calendarYear,
    sourceSlot,
    migrationId,
    actorId: populationMigrantActorId(calendarYear, sourceSlot),
    populationBefore: args.alivePopulation,
    populationAfter: args.alivePopulation + 1,
    nextEligibleAt: args.now + POPULATION_MIGRATION_COOLDOWN_MS,
  };
}

export function populationMigrationId(calendarYear: number, sourceSlot: number): string {
  assertPositiveYear(calendarYear);
  assertSourceSlot(sourceSlot);
  return `population-migration:${POPULATION_MIGRATION_SOURCE_ID}:year:${calendarYear}:slot:${sourceSlot}`;
}

export function populationMigrantActorId(calendarYear: number, sourceSlot: number): string {
  return `migrant:${POPULATION_MIGRATION_SOURCE_ID}:year:${calendarYear}:slot:${sourceSlot}`;
}

export function buildMigrantProfileSeed(args: {
  migrationId: string;
  actorId: string;
  admittedAt: number;
}): MigrantProfileSeed {
  if (args.migrationId.length === 0 || args.actorId.length === 0) {
    throw new Error('population_migration_invalid_identity');
  }
  assertFiniteTime(args.admittedAt);
  const hash = stableUint32(args.migrationId);
  const surname = SURNAMES[hash % SURNAMES.length];
  const givenPrefix = GIVEN_PREFIXES[(hash >>> 5) % GIVEN_PREFIXES.length];
  const givenSuffix = GIVEN_SUFFIXES[(hash >>> 11) % GIVEN_SUFFIXES.length];
  const initialAgeYears = 18 + ((hash >>> 17) % 8);
  const realmStage = 1 + ((hash >>> 21) % 3);
  const spiritRoot = SPIRIT_ROOTS[(hash >>> 24) % SPIRIT_ROOTS.length];
  const innerTrait = INNER_TRAITS[(hash >>> 8) % INNER_TRAITS.length];
  const outerTrait = OUTER_TRAITS[(hash >>> 13) % OUTER_TRAITS.length];
  const traitText = personaFragment(innerTrait, outerTrait);

  return {
    actorId: args.actorId,
    name: `${surname}${givenPrefix}${givenSuffix}`,
    role: 'outer_disciple',
    realm: 'qi_refining',
    realmStage,
    spiritRoot,
    innerTrait,
    outerTrait,
    cultivationXp: (realmStage - 1) * 20,
    realmEnteredAt: args.admittedAt,
    lifeBornAt: args.admittedAt - initialAgeYears * MS_PER_LIFE_YEAR,
    lifeBirthSource: `migration:${POPULATION_MIGRATION_SOURCE_ID}`,
    lifeBirthRecordedAt: args.admittedAt,
    lifeStatus: 'alive',
    mood: 1,
    health: 8,
    maxHealth: 8,
    fatigue: 0,
    spirit: 6,
    reputation: 0,
    inventory: [],
    mapId: POPULATION_POOL_MAP_ID,
    currentLocationId: POPULATION_ENTRY_LOCATION_ID,
    currentIntent: '初入青岚，先安顿住处并熟悉宗门规矩',
    persona: `${traitText}；初入宗门，以安身、守规矩和稳步修行为先。`,
    initialAgeYears,
  };
}

function noOp(
  reason: PopulationMigrationNoopReason,
  calendarYear: number,
  populationBefore: number,
  nextEligibleAt?: number,
): PopulationMigrationPlan {
  return {
    status: 'no_op',
    contractVersion: POPULATION_MIGRATION_VERSION,
    reason,
    calendarYear,
    populationBefore,
    nextEligibleAt,
  };
}

function stableUint32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertCount(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function assertFiniteTime(value: number) {
  if (!Number.isFinite(value)) throw new Error('population_migration_invalid_time');
}

function assertPositiveYear(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('population_migration_invalid_year');
  }
}

function assertSourceSlot(value: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= POPULATION_SOURCE_YEAR_CAPACITY
  ) {
    throw new Error('population_migration_invalid_source_slot');
  }
}

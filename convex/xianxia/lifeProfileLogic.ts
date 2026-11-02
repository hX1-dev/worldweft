import { MS_PER_LIFE_YEAR } from './lifeCalendarLogic';

export const ACTOR_LIFECYCLE_VERSION = 'taixu.actor_lifecycle.v1' as const;
export const ACTOR_DEATH_VERSION = 'taixu.actor_death.v1' as const;
export const OLD_AGE_DEATH_BATCH_SIZE = 16;
export const LIFE_PROFILE_MIGRATION_BATCH_SIZE = 32;
export const LEGACY_LIFE_BIRTH_SOURCE = 'legacy_profile_migration_v1' as const;

export const REALM_LIFESPAN_YEARS = {
  qi_refining: 80,
  foundation_building: 160,
  golden_core: 260,
  nascent_soul: 350,
  deity_transformation: 500,
} as const;

export type LifecycleRealm = keyof typeof REALM_LIFESPAN_YEARS;
export type ActorLifeStatus = 'alive' | 'deceased';

const LEGACY_AGE_BANDS: Record<
  LifecycleRealm,
  { base: number; perStage: number; jitterValues: number }
> = {
  qi_refining: { base: 18, perStage: 2, jitterValues: 5 },
  foundation_building: { base: 52, perStage: 12, jitterValues: 7 },
  golden_core: { base: 120, perStage: 20, jitterValues: 10 },
  nascent_soul: { base: 220, perStage: 30, jitterValues: 10 },
  deity_transformation: { base: 360, perStage: 35, jitterValues: 10 },
};

const REALM_MAX_STAGE: Record<LifecycleRealm, number> = {
  qi_refining: 9,
  foundation_building: 3,
  golden_core: 3,
  nascent_soul: 3,
  deity_transformation: 3,
};

export type ActorLifecycleProjection = {
  contractVersion: typeof ACTOR_LIFECYCLE_VERSION;
  observedAt: number;
  lifeBornAt: number;
  realm: LifecycleRealm;
  ageLifeYears: number;
  completedAgeYears: number;
  lifespanYears: number;
  remainingLifeYears: number;
  lifeProgress: number;
  atOrBeyondLifespan: boolean;
};

export function actorLifecycleAt(args: {
  now: number;
  lifeBornAt: number;
  realm: string;
}): ActorLifecycleProjection {
  assertFiniteTime(args.now);
  if (!Number.isFinite(args.lifeBornAt)) {
    throw new Error('lifecycle_invalid_birth_anchor');
  }
  const realm = assertLifecycleRealm(args.realm);
  const lifespanYears = REALM_LIFESPAN_YEARS[realm];
  const ageLifeYears = Math.max(0, args.now - args.lifeBornAt) / MS_PER_LIFE_YEAR;
  return {
    contractVersion: ACTOR_LIFECYCLE_VERSION,
    observedAt: args.now,
    lifeBornAt: args.lifeBornAt,
    realm,
    ageLifeYears,
    completedAgeYears: Math.floor(ageLifeYears),
    lifespanYears,
    remainingLifeYears: Math.max(0, lifespanYears - ageLifeYears),
    lifeProgress: Math.min(1, ageLifeYears / lifespanYears),
    atOrBeyondLifespan: ageLifeYears >= lifespanYears,
  };
}

export function realmLifespanYears(realm: string): number {
  return REALM_LIFESPAN_YEARS[assertLifecycleRealm(realm)];
}

export function oldAgeDeathBoundary(args: {
  lifeBornAt: number;
  realm: string;
}): number {
  if (!Number.isFinite(args.lifeBornAt)) {
    throw new Error('lifecycle_invalid_birth_anchor');
  }
  return args.lifeBornAt + realmLifespanYears(args.realm) * MS_PER_LIFE_YEAR;
}

export function isAtOrBeyondOldAgeDeath(args: {
  now: number;
  lifeBornAt: number;
  realm: string;
}): boolean {
  assertFiniteTime(args.now);
  return args.now >= oldAgeDeathBoundary(args);
}

export function effectiveLifeStatus(status: ActorLifeStatus | undefined): ActorLifeStatus {
  return status ?? 'alive';
}

export function deterministicLegacyInitialAgeYears(args: {
  actorId: string;
  realm: string;
  realmStage: number;
}): number {
  if (args.actorId.length === 0) throw new Error('lifecycle_invalid_actor_id');
  const realm = assertLifecycleRealm(args.realm);
  if (
    !Number.isSafeInteger(args.realmStage) ||
    args.realmStage < 1 ||
    args.realmStage > REALM_MAX_STAGE[realm]
  ) {
    throw new Error('lifecycle_invalid_realm_stage');
  }
  const band = LEGACY_AGE_BANDS[realm];
  const jitter = stableUint32(args.actorId) % band.jitterValues;
  const age = band.base + (args.realmStage - 1) * band.perStage + jitter;
  return Math.min(REALM_LIFESPAN_YEARS[realm] - 1, age);
}

export function legacyLifeBirthAnchor(args: {
  actorId: string;
  realm: string;
  realmStage: number;
  profileCreatedAt: number;
  lifeCalendarStartedAt: number;
}): {
  lifeBornAt: number;
  initialAgeYears: number;
  referenceAt: number;
  source: typeof LEGACY_LIFE_BIRTH_SOURCE;
} {
  assertFiniteTime(args.profileCreatedAt);
  assertFiniteTime(args.lifeCalendarStartedAt);
  const initialAgeYears = deterministicLegacyInitialAgeYears(args);
  const referenceAt = Math.max(args.profileCreatedAt, args.lifeCalendarStartedAt);
  return {
    lifeBornAt: referenceAt - initialAgeYears * MS_PER_LIFE_YEAR,
    initialAgeYears,
    referenceAt,
    source: LEGACY_LIFE_BIRTH_SOURCE,
  };
}

function assertLifecycleRealm(realm: string): LifecycleRealm {
  if (!(realm in REALM_LIFESPAN_YEARS)) throw new Error('lifecycle_unknown_realm');
  return realm as LifecycleRealm;
}

function assertFiniteTime(value: number): void {
  if (!Number.isFinite(value)) throw new Error('lifecycle_invalid_time');
}

function stableUint32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

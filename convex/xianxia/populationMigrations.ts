import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { isGodotControlledActorId } from './agentTickScheduler';
import { effectiveLifeStatus } from './lifeProfileLogic';
import {
  POPULATION_ENTRY_LOCATION_ID,
  POPULATION_MIGRATION_BATCH_SIZE,
  POPULATION_MIGRATION_SOURCE_ID,
  POPULATION_MIGRATION_VERSION,
  POPULATION_POOL_ID,
  POPULATION_POOL_MAP_ID,
  buildMigrantProfileSeed,
  planPopulationMigration,
} from './populationMigrationLogic';
import { lifeCalendarAt } from './lifeCalendarLogic';

export const tickPopulationMigration = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.lifeCalendarStartedAt === undefined) {
      return emptyMigrationTick('calendar_uninitialized');
    }

    const entryLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('locationId', POPULATION_ENTRY_LOCATION_ID),
      )
      .first();
    if (!entryLocation || entryLocation.mapId !== POPULATION_POOL_MAP_ID) {
      return emptyMigrationTick('entry_location_missing');
    }

    const livingProfiles = await collectLivingMainWorldProfiles(ctx, args.worldId);
    const alivePopulation = livingProfiles.filter(
      (profile) =>
        !isGodotControlledActorId(profile.actorId) &&
        effectiveLifeStatus(profile.lifeStatus) === 'alive',
    ).length;
    const calendarYear = lifeCalendarAt(
      args.now,
      config.lifeCalendarStartedAt,
    ).year;
    const [cohortAdmissions, lastAdmission] = await Promise.all([
      ctx.db
        .query('populationMigrations')
        .withIndex('bySourceCohort', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('sourceId', POPULATION_MIGRATION_SOURCE_ID)
            .eq('calendarYear', calendarYear),
        )
        .collect(),
      ctx.db
        .query('populationMigrations')
        .withIndex('byAdmittedAt', (q) => q.eq('worldId', args.worldId))
        .order('desc')
        .first(),
    ]);
    const plan = planPopulationMigration({
      alivePopulation,
      now: args.now,
      lifeCalendarStartedAt: config.lifeCalendarStartedAt,
      lastAdmittedAt: lastAdmission?.admittedAt,
      usedSourceSlots: cohortAdmissions.map((admission) => admission.sourceSlot),
    });
    if (plan.status === 'no_op') {
      return {
        status: 'no_op' as const,
        contractVersion: POPULATION_MIGRATION_VERSION,
        reason: plan.reason,
        calendarYear: plan.calendarYear,
        populationBefore: plan.populationBefore,
        nextEligibleAt: plan.nextEligibleAt,
        admittedCount: 0,
        batchLimit: POPULATION_MIGRATION_BATCH_SIZE,
      };
    }

    const existingAdmission = await ctx.db
      .query('populationMigrations')
      .withIndex('byMigration', (q) =>
        q.eq('worldId', args.worldId).eq('migrationId', plan.migrationId),
      )
      .first();
    if (existingAdmission) {
      return {
        status: 'migration_replayed' as const,
        contractVersion: POPULATION_MIGRATION_VERSION,
        reason: 'migration_replayed' as const,
        migrationId: existingAdmission.migrationId,
        actorId: existingAdmission.actorId,
        eventId: existingAdmission.eventId,
        calendarYear: existingAdmission.calendarYear,
        sourceSlot: existingAdmission.sourceSlot,
        populationBefore: existingAdmission.populationBefore,
        populationAfter: existingAdmission.populationAfter,
        admittedCount: 0,
        batchLimit: POPULATION_MIGRATION_BATCH_SIZE,
      };
    }

    const existingActor = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', plan.actorId),
      )
      .first();
    if (existingActor) {
      return {
        status: 'no_op' as const,
        contractVersion: POPULATION_MIGRATION_VERSION,
        reason: 'migration_identity_conflict' as const,
        migrationId: plan.migrationId,
        actorId: plan.actorId,
        calendarYear: plan.calendarYear,
        populationBefore: plan.populationBefore,
        admittedCount: 0,
        batchLimit: POPULATION_MIGRATION_BATCH_SIZE,
      };
    }

    const profile = buildMigrantProfileSeed({
      migrationId: plan.migrationId,
      actorId: plan.actorId,
      admittedAt: args.now,
    });
    await ctx.db.insert('xianxiaProfiles', {
      worldId: args.worldId,
      actorId: profile.actorId,
      name: profile.name,
      role: profile.role,
      realm: profile.realm,
      realmStage: profile.realmStage,
      spiritRoot: profile.spiritRoot,
      innerTrait: profile.innerTrait,
      outerTrait: profile.outerTrait,
      cultivationXp: profile.cultivationXp,
      realmEnteredAt: profile.realmEnteredAt,
      lifeBornAt: profile.lifeBornAt,
      lifeBirthSource: profile.lifeBirthSource,
      lifeBirthRecordedAt: profile.lifeBirthRecordedAt,
      lifeStatus: profile.lifeStatus,
      mood: profile.mood,
      health: profile.health,
      maxHealth: profile.maxHealth,
      fatigue: profile.fatigue,
      spirit: profile.spirit,
      reputation: profile.reputation,
      inventory: profile.inventory,
      mapId: profile.mapId,
      currentLocationId: profile.currentLocationId,
      currentIntent: profile.currentIntent,
      persona: profile.persona,
    });
    const eventId = await appendWorldEvent(ctx, {
      worldId: args.worldId,
      type: 'actor_migrated_into_world',
      createdAt: args.now,
      actorIds: [profile.actorId],
      locationId: POPULATION_ENTRY_LOCATION_ID,
      actionId: plan.migrationId,
      visibility: 'public',
      summary: `${profile.name}自青岚外郡来到山门，录入外门名册。`,
      mapId: POPULATION_POOL_MAP_ID,
      facts: versionDurableEventFacts({
        resultCode: 'actor_migrated_into_world',
        migrationVersion: POPULATION_MIGRATION_VERSION,
        migrationId: plan.migrationId,
        poolId: POPULATION_POOL_ID,
        sourceId: POPULATION_MIGRATION_SOURCE_ID,
        calendarYear: plan.calendarYear,
        sourceSlot: plan.sourceSlot,
        actorId: profile.actorId,
        populationBefore: plan.populationBefore,
        populationAfter: plan.populationAfter,
        mapId: POPULATION_POOL_MAP_ID,
        locationId: POPULATION_ENTRY_LOCATION_ID,
        initialAgeYears: profile.initialAgeYears,
        inventoryItemCount: 0,
      }),
    });
    await ctx.db.insert('populationMigrations', {
      worldId: args.worldId,
      contractVersion: POPULATION_MIGRATION_VERSION,
      migrationId: plan.migrationId,
      poolId: POPULATION_POOL_ID,
      sourceId: POPULATION_MIGRATION_SOURCE_ID,
      calendarYear: plan.calendarYear,
      sourceSlot: plan.sourceSlot,
      actorId: profile.actorId,
      status: 'admitted',
      mapId: POPULATION_POOL_MAP_ID,
      locationId: POPULATION_ENTRY_LOCATION_ID,
      populationBefore: plan.populationBefore,
      populationAfter: plan.populationAfter,
      admittedAt: args.now,
      nextEligibleAt: plan.nextEligibleAt,
      lifeBornAt: profile.lifeBornAt,
      initialAgeYears: profile.initialAgeYears,
      eventActionId: plan.migrationId,
      eventId,
    });

    return {
      status: 'admitted' as const,
      contractVersion: POPULATION_MIGRATION_VERSION,
      migrationId: plan.migrationId,
      actorId: profile.actorId,
      name: profile.name,
      eventId,
      calendarYear: plan.calendarYear,
      sourceSlot: plan.sourceSlot,
      populationBefore: plan.populationBefore,
      populationAfter: plan.populationAfter,
      admittedCount: 1,
      nextEligibleAt: plan.nextEligibleAt,
      batchLimit: POPULATION_MIGRATION_BATCH_SIZE,
    };
  },
});

export const listPopulationMigrations = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 32)));
    return await ctx.db
      .query('populationMigrations')
      .withIndex('byAdmittedAt', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(limit);
  },
});

async function collectLivingMainWorldProfiles(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
) {
  const rows = await Promise.all(
    ([POPULATION_POOL_MAP_ID, undefined] as const).flatMap((mapId) =>
      ([undefined, 'alive'] as const).map((lifeStatus) =>
        ctx.db
          .query('xianxiaProfiles')
          .withIndex('byMapLifeStatusActor', (q) =>
            q
              .eq('worldId', worldId)
              .eq('mapId', mapId)
              .eq('lifeStatus', lifeStatus),
          )
          .collect(),
      ),
    ),
  );
  return [...new Map(rows.flat().map((profile) => [profile._id, profile])).values()];
}

function emptyMigrationTick(reason: 'calendar_uninitialized' | 'entry_location_missing') {
  return {
    status: 'no_op' as const,
    contractVersion: POPULATION_MIGRATION_VERSION,
    reason,
    admittedCount: 0,
    batchLimit: POPULATION_MIGRATION_BATCH_SIZE,
  };
}

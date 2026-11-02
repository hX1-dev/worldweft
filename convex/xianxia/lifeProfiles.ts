import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import {
  LIFE_PROFILE_MIGRATION_BATCH_SIZE,
  actorLifecycleAt,
  legacyLifeBirthAnchor,
} from './lifeProfileLogic';

export const getActorLifecycle = query({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const [config, profile] = await Promise.all([
      ctx.db
        .query('xianxiaConfig')
        .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
        .first(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .first(),
    ]);
    if (!profile) return { status: 'profile_not_found' as const };
    if (config?.lifeCalendarStartedAt === undefined) {
      return { status: 'calendar_uninitialized' as const, actorId: profile.actorId };
    }
    if (profile.lifeBornAt === undefined) {
      return { status: 'birth_anchor_pending' as const, actorId: profile.actorId };
    }
    const lifeStatus = profile.lifeStatus ?? 'alive';
    const observedAt =
      lifeStatus === 'deceased' && profile.deceasedAt !== undefined
        ? profile.deceasedAt
        : args.now;
    return {
      status: 'ready' as const,
      actorId: profile.actorId,
      name: profile.name,
      lifeStatus,
      lifeBirthSource: profile.lifeBirthSource,
      lifeBirthRecordedAt: profile.lifeBirthRecordedAt,
      deceasedAt: profile.deceasedAt,
      deathRecordedAt: profile.deathRecordedAt,
      deathCause: profile.deathCause,
      deathActionId: profile.deathActionId,
      deathEventId: profile.deathEventId,
      ...actorLifecycleAt({
        now: observedAt,
        lifeBornAt: profile.lifeBornAt,
        realm: profile.deathRealm ?? profile.realm,
      }),
    };
  },
});

export const migrateLifeProfileBirthAnchors = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.lifeCalendarStartedAt === undefined) {
      return {
        status: 'calendar_uninitialized' as const,
        migratedCount: 0,
        actorIds: [] as string[],
      };
    }

    const profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('byLifeBirth', (q) =>
        q.eq('worldId', args.worldId).eq('lifeBornAt', undefined),
      )
      .take(LIFE_PROFILE_MIGRATION_BATCH_SIZE);
    const actorIds: string[] = [];
    for (const profile of profiles) {
      const anchor = legacyLifeBirthAnchor({
        actorId: profile.actorId,
        realm: profile.realm,
        realmStage: profile.realmStage,
        profileCreatedAt: profile._creationTime,
        lifeCalendarStartedAt: config.lifeCalendarStartedAt,
      });
      await ctx.db.patch(profile._id, {
        lifeBornAt: anchor.lifeBornAt,
        lifeBirthSource: anchor.source,
        lifeBirthRecordedAt: args.now,
        lifeStatus: 'alive',
      });
      actorIds.push(profile.actorId);
    }
    return {
      status: profiles.length === 0 ? ('no_op' as const) : ('migrated' as const),
      migratedCount: profiles.length,
      actorIds,
      batchLimit: LIFE_PROFILE_MIGRATION_BATCH_SIZE,
      mayHaveMore: profiles.length === LIFE_PROFILE_MIGRATION_BATCH_SIZE,
    };
  },
});

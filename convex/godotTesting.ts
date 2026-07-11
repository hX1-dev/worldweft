import type { Doc, Id } from './_generated/dataModel';
import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { breakthroughThreshold } from './xianxia/rules';
import { assertLocalGodotFixtureAccess } from './xianxia/access';
import { cancelMemoryFanoutForEvent } from './xianxia/memory';
import { versionDurableEventFacts } from './xianxia/durableContracts';
import {
  assertGodotSmokeActorId,
  godotSmokeCleanupPageLimit,
  nextGodotSmokeCleanupPhase,
  type GodotSmokeCleanupPhase,
} from './godotTestingPolicy';

export const primeGodotSoakActor = mutation({
  args: {
    actorId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotSoakActor');
    assertGodotSmokeActorId(args.actorId, 'primeGodotSoakActor');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const patch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 30,
      mood: 1,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 6 }],
      mapId: args.mapId,
      currentLocationId: args.locationId,
      currentIntent: 'Godot long-soak semantic action fixture.',
      persona: 'Temporary long-soak actor; every outcome still resolves through Convex rules.',
    };
    const existing = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...patch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId: args.mapId,
      locationId: args.locationId,
    };
  },
});

export const primeGodotBreakthroughCandidate = mutation({
  args: {
    actorId: v.string(),
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotBreakthroughCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotBreakthroughCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const mapId = args.mapId ?? 'qinglan';
    const locationId = args.locationId ?? 'market_tea_stall';
    const realm = 'qi_refining';
    const realmStage = 9;
    const cultivationXp = breakthroughThreshold(realm, realmStage);
    const patch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm,
      realmStage,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp,
      mood: 2,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: 'Godot bridge smoke test breakthrough candidate.',
      persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
    };

    const existing = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...patch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId,
      locationId,
      realm,
      realmStage,
      cultivationXp,
    };
  },
});

export const primeGodotTeachingCandidate = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.optional(v.string()),
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotTeachingCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotTeachingCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const mapId = args.mapId ?? 'qinglan';
    const locationId = args.locationId ?? 'market_tea_stall';
    const targetActorId = args.targetActorId ?? 'qinglan:qinglan-elder-mu';
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', locationId),
      )
      .first();
    if (!location) throw new Error(`No location ${locationId} found.`);
    const tile = location.entryPoints[0] ?? { x: 50, y: 50 };

    const residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .collect();
    const resident = residents.find((entry) => entry.actorId === targetActorId);
    if (!resident) throw new Error(`No Qinglan resident ${targetActorId} found.`);
    await ctx.db.patch(resident._id, {
      currentLocationId: locationId,
      displayTile: tile,
      targetTile: tile,
      finalTargetTile: tile,
      status: 'waiting',
      currentIntent: '在茶摊清静处点拨后辈。',
      activityLabel: 'teaching',
      waypointId: locationId,
      updatedAt: Date.now(),
    });

    const actorPatch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 20,
      mood: 2,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: 'Godot bridge smoke test teaching candidate.',
      persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
    };
    const actorProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (actorProfile) await ctx.db.patch(actorProfile._id, actorPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...actorPatch,
      });
    }

    const targetPatch = {
      name: resident.name,
      role: resident.role,
      realm: 'foundation_building',
      realmStage: 2,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 180,
      mood: 2,
      health: 9,
      spirit: 9,
      reputation: 25,
      inventory: [{ itemId: 'spirit_stone', qty: 8 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: '在茶摊清静处点拨后辈。',
      persona: 'Qinglan elder prepared for Godot bridge teaching smoke tests.',
    };
    const targetProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', targetActorId))
      .first();
    if (targetProfile) await ctx.db.patch(targetProfile._id, targetPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: targetActorId,
        ...targetPatch,
      });
    }

    const relationship = await ctx.db
      .query('relationships')
      .withIndex('pair', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('fromActorId', args.actorId)
          .eq('toActorId', targetActorId),
      )
      .first();
    const relationshipPatch = {
      value: 8,
      trust: 4,
      suspicion: 0,
      debt: 0,
      fear: 0,
      tags: ['smoke_test'],
    };
    if (relationship) await ctx.db.patch(relationship._id, relationshipPatch);
    else {
      await ctx.db.insert('relationships', {
        worldId: status.worldId,
        fromActorId: args.actorId,
        toActorId: targetActorId,
        ...relationshipPatch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId,
      mapId,
      locationId,
      tile,
    };
  },
});

export const primeGodotTradeCandidate = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.optional(v.string()),
    mapId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotTradeCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotTradeCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const mapId = args.mapId ?? 'qinglan';
    const targetActorId = args.targetActorId ?? 'qinglan:qinglan-medicine-keeper';
    const residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .collect();
    const resident = residents.find((entry) => entry.actorId === targetActorId);
    if (!resident) throw new Error(`No Qinglan resident ${targetActorId} found.`);

    const actorProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    const actorPatch = {
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: resident.currentLocationId,
      currentIntent: 'Godot bridge smoke test trade candidate.',
    };
    if (actorProfile) await ctx.db.patch(actorProfile._id, actorPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        name: args.actorId,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 1,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 20,
        mood: 2,
        health: 9,
        spirit: 8,
        reputation: 0,
        persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
        ...actorPatch,
      });
    }

    const targetPatch = {
      name: resident.name,
      role: resident.role,
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 80,
      mood: 1,
      health: 8,
      spirit: 7,
      reputation: 8,
      inventory: [
        { itemId: 'spirit_stone', qty: 40 },
        { itemId: 'spirit_herb', qty: 3 },
      ],
      mapId,
      currentLocationId: resident.currentLocationId,
      currentIntent: 'Godot bridge smoke test trade seller.',
      persona: 'Qinglan merchant prepared for Godot bridge trade smoke tests.',
    };
    const targetProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', targetActorId))
      .first();
    if (targetProfile) await ctx.db.patch(targetProfile._id, targetPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: targetActorId,
        ...targetPatch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId,
      mapId,
      locationId: resident.currentLocationId,
      actorSpiritStones: 24,
      targetStock: 3,
    };
  },
});

function godotMapIsolationFixtureKeys(actorId: string) {
  const suffix = actorId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-48);
  const fixtureId = `map_isolation_${suffix}`;
  return {
    fixtureId,
    otherMapId: `godot_other_${suffix}`,
    locationId: `godot_other_location_${suffix}`,
    residentId: `godot-other-resident-${suffix}`,
    residentActorId: `godot:other:${suffix}`,
    profileActorId: `aaa_map_isolation_${suffix}`,
  };
}

const godotMapIsolationEventTypes = [
  'godot_map_isolation_qinglan',
  'godot_map_isolation_other',
  'godot_map_isolation_legacy_mapless',
] as const;

export const primeGodotMapIsolationFixture = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotMapIsolationFixture');
    assertGodotSmokeActorId(args.actorId, 'primeGodotMapIsolationFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const keys = godotMapIsolationFixtureKeys(args.actorId);
    const now = Date.now();
    const locationPatch = {
      name: 'Godot isolation test location',
      kind: 'test_location',
      dangerLevel: 0,
      spiritualEnergy: 1,
      allowedActions: ['cultivate'],
      mapId: keys.otherMapId,
      entryPoints: [{ x: 3, y: 4 }],
      bounds: { x1: 0, y1: 0, x2: 8, y2: 8 },
      description: 'Restricted local fixture for proving Godot map isolation.',
    };
    const existingLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', keys.locationId),
      )
      .first();
    if (existingLocation) await ctx.db.patch(existingLocation._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: keys.locationId,
        ...locationPatch,
      });
    }

    const residentPatch = {
      actorId: keys.residentActorId,
      name: 'Isolation Resident',
      role: 'test_resident',
      character: 'f1',
      mapId: keys.otherMapId,
      currentLocationId: keys.locationId,
      displayTile: { x: 3, y: 4 },
      targetTile: { x: 3, y: 4 },
      finalTargetTile: { x: 3, y: 4 },
      pathTiles: [],
      orientation: 0,
      status: 'waiting' as const,
      currentIntent: 'Wait inside the isolated map fixture.',
      activityLabel: 'isolation_test',
      waypointId: keys.locationId,
      nextActionAt: now + 60_000,
      updatedAt: now,
    };
    const existingResident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byResident', (q) =>
        q.eq('worldId', status.worldId).eq('residentId', keys.residentId),
      )
      .first();
    if (existingResident) await ctx.db.patch(existingResident._id, residentPatch);
    else {
      await ctx.db.insert('qinglanResidents', {
        worldId: status.worldId,
        residentId: keys.residentId,
        ...residentPatch,
      });
    }

    const profilePatch = {
      name: 'Isolation Tick Candidate',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 1,
      mood: 0,
      health: 10,
      spirit: 10,
      reputation: 0,
      inventory: [],
      mapId: keys.otherMapId,
      currentLocationId: keys.locationId,
      currentIntent: 'Prove map-scoped agent selection.',
      persona: 'Restricted local fixture for map-scoped tick selection.',
    };
    const existingProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', keys.profileActorId))
      .first();
    if (existingProfile) await ctx.db.patch(existingProfile._id, profilePatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: keys.profileActorId,
        ...profilePatch,
      });
    }

    const eventSpecs = [
      {
        type: godotMapIsolationEventTypes[0],
        mapId: 'qinglan' as string | undefined,
        summary: `${keys.fixtureId}: qinglan event`,
      },
      {
        type: godotMapIsolationEventTypes[1],
        mapId: keys.otherMapId as string | undefined,
        summary: `${keys.fixtureId}: other-map event`,
      },
      {
        type: godotMapIsolationEventTypes[2],
        mapId: undefined,
        summary: `${keys.fixtureId}: legacy mapless event`,
      },
    ];
    const eventIds: Id<'worldEvents'>[] = [];
    for (const [index, spec] of eventSpecs.entries()) {
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type: spec.type,
        createdAt: now + index,
        actorIds: [args.actorId],
        targetActorIds: [keys.residentActorId],
        locationId: spec.mapId === keys.otherMapId ? keys.locationId : undefined,
        visibility: 'public',
        summary: spec.summary,
        facts: versionDurableEventFacts({
          fixtureId: keys.fixtureId,
          source: 'restricted_test_fixture',
        }),
        mapId: spec.mapId,
      });
      eventIds.push(eventId);
      await ctx.db.insert('shortMemories', {
        worldId: status.worldId,
        actorId: args.actorId,
        sourceEventId: eventId,
        aboutActorIds: [keys.residentActorId],
        type: spec.type,
        salience: 1,
        createdAt: now + index,
        expiresAt: 1_000_000_000,
        summary: spec.summary,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      ...keys,
      eventIds,
      qinglanEventId: eventIds[0],
      otherMapEventId: eventIds[1],
      maplessEventId: eventIds[2],
    };
  },
});

export const cleanupGodotMapIsolationFixture = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupGodotMapIsolationFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupGodotMapIsolationFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const keys = godotMapIsolationFixtureKeys(args.actorId);

    const fixtureEvents: Doc<'worldEvents'>[] = [];
    for (const type of godotMapIsolationEventTypes) {
      const events = await ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) => q.eq('worldId', status.worldId).eq('type', type))
        .collect();
      fixtureEvents.push(
        ...events.filter((event) => {
          const facts: unknown = event.facts;
          return (
            facts !== null &&
            typeof facts === 'object' &&
            !Array.isArray(facts) &&
            (facts as Record<string, unknown>).fixtureId === keys.fixtureId
          );
        }),
      );
    }
    const eventIds = new Set(fixtureEvents.map((event) => String(event._id)));
    for (const event of fixtureEvents) {
      await cancelMemoryFanoutForEvent(ctx, status.worldId, event._id);
    }
    let memoriesDeleted = 0;
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .collect();
    for (const memory of memories) {
      if (!eventIds.has(memory.sourceEventId)) continue;
      await ctx.db.delete(memory._id);
      memoriesDeleted += 1;
    }
    for (const event of fixtureEvents) await ctx.db.delete(event._id);

    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byResident', (q) =>
        q.eq('worldId', status.worldId).eq('residentId', keys.residentId),
      )
      .first();
    if (resident) await ctx.db.delete(resident._id);
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', keys.locationId),
      )
      .first();
    if (location) await ctx.db.delete(location._id);
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', keys.profileActorId))
      .first();
    if (profile) await ctx.db.delete(profile._id);

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      fixtureId: keys.fixtureId,
      eventsDeleted: fixtureEvents.length,
      memoriesDeleted,
      residentDeleted: resident ? 1 : 0,
      locationDeleted: location ? 1 : 0,
      profileDeleted: profile ? 1 : 0,
    };
  },
});

export const cleanupGodotSmokeFixture = mutation({
  args: {
    actorId: v.string(),
    phase: v.optional(
      v.union(
        v.literal('profile'),
        v.literal('relationships_from'),
        v.literal('relationships_to'),
        v.literal('memories'),
        v.literal('requests_assignee'),
        v.literal('requests_issuer'),
      ),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupGodotSmokeFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupGodotSmokeFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const phase: GodotSmokeCleanupPhase = args.phase ?? 'profile';
    const limit = godotSmokeCleanupPageLimit(args.limit);
    const counts = {
      profilesDeleted: 0,
      relationshipsDeleted: 0,
      memoriesDeleted: 0,
      requestsDeleted: 0,
    };

    if (phase === 'profile') {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
        .first();
      if (profile) {
        await ctx.db.delete(profile._id);
        counts.profilesDeleted = 1;
      }
      return cleanupPageResult(status.worldId, args.actorId, phase, true, null, 1, counts);
    }

    if (phase === 'relationships_from') {
      const page = await ctx.db
        .query('relationships')
        .withIndex('from', (q) =>
          q.eq('worldId', status.worldId).eq('fromActorId', args.actorId),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const relationship of page.page) {
        await ctx.db.delete(relationship._id);
        counts.relationshipsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    if (phase === 'relationships_to') {
      const page = await ctx.db
        .query('relationships')
        .withIndex('to', (q) => q.eq('worldId', status.worldId).eq('toActorId', args.actorId))
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const relationship of page.page) {
        await ctx.db.delete(relationship._id);
        counts.relationshipsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    if (phase === 'memories') {
      const actionPage = await ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
        .paginate({ cursor: args.cursor ?? null, numItems: 1 });
      const actionRecord = actionPage.page[0];
      if (actionRecord) {
        const event = await ctx.db
          .query('worldEvents')
          .withIndex('byAction', (q) =>
            q.eq('worldId', status.worldId).eq('actionId', String(actionRecord._id)),
          )
          .first();
        if (event) await cancelMemoryFanoutForEvent(ctx, status.worldId, event._id);
        const memories = event
          ? await ctx.db
              .query('shortMemories')
              .withIndex('bySourceEvent', (q) =>
                q.eq('worldId', status.worldId).eq('sourceEventId', String(event._id)),
              )
              .take(limit)
          : [];
        for (const memory of memories) {
          await ctx.db.delete(memory._id);
          counts.memoriesDeleted += 1;
        }
        if (memories.length === limit) {
          return cleanupPageResult(
            status.worldId,
            args.actorId,
            phase,
            false,
            args.cursor ?? null,
            1,
            counts,
            true,
          );
        }
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        actionPage.isDone,
        actionPage.isDone ? null : actionPage.continueCursor,
        actionPage.page.length,
        counts,
      );
    }

    if (phase === 'requests_assignee') {
      const page = await ctx.db
        .query('requests')
        .withIndex('byAssignee', (q) =>
          q.eq('worldId', status.worldId).eq('assigneeActorId', args.actorId),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const request of page.page) {
        await ctx.db.delete(request._id);
        counts.requestsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    const page = await ctx.db
      .query('requests')
      .withIndex('byIssuer', (q) =>
        q.eq('worldId', status.worldId).eq('issuerActorId', args.actorId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    for (const request of page.page) {
      await ctx.db.delete(request._id);
      counts.requestsDeleted += 1;
    }
    return cleanupPageResult(
      status.worldId,
      args.actorId,
      phase,
      page.isDone,
      page.isDone ? null : page.continueCursor,
      page.page.length,
      counts,
    );
  },
});

function cleanupPageResult(
  worldId: Id<'worlds'>,
  actorId: string,
  phase: GodotSmokeCleanupPhase,
  phaseDone: boolean,
  continueCursor: string | null,
  scanned: number,
  counts: {
    profilesDeleted: number;
    relationshipsDeleted: number;
    memoriesDeleted: number;
    requestsDeleted: number;
  },
  repeatCursor = false,
) {
  const nextPhase = phaseDone ? nextGodotSmokeCleanupPhase(phase) : phase;
  return {
    worldId,
    actorId,
    phase,
    phaseDone,
    nextPhase: nextPhase ?? null,
    continueCursor,
    repeatCursor,
    done: phaseDone && nextPhase === undefined,
    scanned,
    ...counts,
    durableTracePreserved: true,
  };
}

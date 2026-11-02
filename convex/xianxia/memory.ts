import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import type { EventVisibility } from './actionSchema';
import {
  MAX_ACTIVE_EPISODIC_MEMORIES,
  MAX_PROMPT_SOCIAL_SUMMARIES,
  isMemorable,
  memorySalience,
  memoryExpiresAtHour,
  isExpired,
  mergeSocialSummary,
  planMemoryCompaction,
  primaryMemorySubject,
} from './memoryLogic';
import { propagateEvent, type RumorActor, type RumorEvent } from './rumorLogic';

// 短期记忆的「接线层」（Stage 2 · M5）。纯判定在 memoryLogic.ts，谁能听说在 rumorLogic.ts，
// 这里把二者接到 DB：重要事件 → 传播 → 为每个知情者落一条 shortMemory。

export type MemoryEventInput = {
  eventId: Id<'worldEvents'>;
  type: string;
  visibility: EventVisibility;
  actorIds: string[];
  targetActorIds?: string[];
  witnessActorIds?: string[];
  locationId?: string;
  summary: string;
  createdAt: number;
};

const MAX_SYNCHRONOUS_MEMORY_ACTORS = 100;
const MEMORY_FANOUT_PAGE_SIZE = 50;

export type MemoryFanoutJobState = 'pending' | 'completed';
export type MemoryFanoutPageResult = {
  status: 'missing' | 'already_completed' | 'event_unavailable' | 'processed';
  processed: number;
  inserted: number;
  isDone: boolean;
};

export function shouldRunMemoryFanoutJob(
  job: { status: MemoryFanoutJobState } | null | undefined,
) {
  return job?.status === 'pending';
}

// 由一桩世界事件生成记忆（§10.1）。不值得记的直接跳过；否则按可见性/传闻算出知情者，
// 各自落一条记忆（传闻获知者存的是走样版本）。
export async function generateMemories(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  ev: MemoryEventInput,
  nowGameHour: number, // W3b：过期以游戏小时计
) {
  if (!isMemorable(ev.type)) return;
  const salience = memorySalience(ev.type);

  const profiles = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId))
    .take(MAX_SYNCHRONOUS_MEMORY_ACTORS + 1);
  if (profiles.length > MAX_SYNCHRONOUS_MEMORY_ACTORS) {
    const existingJob = await ctx.db
      .query('memoryFanoutJobs')
      .withIndex('byEvent', (q) => q.eq('worldId', worldId).eq('eventId', ev.eventId))
      .first();
    if (existingJob) return;

    const principals = [...new Set([...ev.actorIds, ...(ev.targetActorIds ?? [])])];
    const expiresAt = memoryExpiresAtHour(nowGameHour, salience);
    let principalsInserted = 0;
    for (const actorId of principals) {
      if (await insertMemory(
        ctx,
        worldId,
        ev,
        actorId,
        ev.summary,
        salience,
        expiresAt,
        nowGameHour,
        'direct',
        false,
      )) principalsInserted += 1;
    }
    const now = Date.now();
    const jobId = await ctx.db.insert('memoryFanoutJobs', {
      worldId,
      eventId: ev.eventId,
      nowGameHour,
      status: 'pending',
      pagesProcessed: 0,
      actorsProcessed: 0,
      memoriesInserted: principalsInserted,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.xianxia.memory.generateMemoryFanoutPage, {
      jobId,
    });
    return;
  }

  const actors: RumorActor[] = profiles.map((p) => ({
    actorId: p.actorId,
    currentLocationId: p.currentLocationId,
    reputation: p.reputation,
  }));

  const rumorEvent: RumorEvent = {
    eventId: ev.eventId,
    type: ev.type,
    visibility: ev.visibility,
    actorIds: ev.actorIds,
    targetActorIds: ev.targetActorIds,
    witnessActorIds: ev.witnessActorIds,
    locationId: ev.locationId,
    summary: ev.summary,
  };
  const expiresAt = memoryExpiresAtHour(nowGameHour, salience); // 游戏小时

  for (const delivery of propagateEvent(rumorEvent, actors)) {
    await insertMemory(
      ctx,
      worldId,
      ev,
      delivery.actorId,
      delivery.summary,
      salience,
      expiresAt,
      nowGameHour,
      delivery.source,
      delivery.distorted,
    );
  }
}

export const generateMemoryFanoutPage = internalMutation({
  args: {
    jobId: v.id('memoryFanoutJobs'),
  },
  handler: async (ctx, args): Promise<MemoryFanoutPageResult> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { status: 'missing', processed: 0, inserted: 0, isDone: true };
    }
    if (!shouldRunMemoryFanoutJob(job)) {
      return { status: 'already_completed', processed: 0, inserted: 0, isDone: true };
    }

    const event = await ctx.db.get(job.eventId);
    if (!event || event.worldId !== job.worldId || !isMemorable(event.type)) {
      await ctx.db.patch(job._id, { status: 'completed', updatedAt: Date.now() });
      return { status: 'event_unavailable', processed: 0, inserted: 0, isDone: true };
    }
    const page = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', job.worldId))
      .paginate({ cursor: job.cursor ?? null, numItems: MEMORY_FANOUT_PAGE_SIZE });
    const principalIds = [...new Set([...event.actorIds, ...(event.targetActorIds ?? [])])];
    const principalProfiles = [];
    for (const actorId of principalIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', job.worldId).eq('actorId', actorId))
        .first();
      if (profile) principalProfiles.push(profile);
    }
    const deliveries = memoryFanoutDeliveriesForPage(
      toRumorEvent(event),
      page.page.map(toRumorActor),
      principalProfiles.map(toRumorActor),
    );
    const salience = memorySalience(event.type);
    const expiresAt = memoryExpiresAtHour(job.nowGameHour, salience);
    let inserted = 0;
    for (const delivery of deliveries) {
      if (await insertMemory(
        ctx,
        job.worldId,
        {
          eventId: event._id,
          type: event.type,
          visibility: event.visibility,
          actorIds: event.actorIds,
          targetActorIds: event.targetActorIds,
          witnessActorIds: event.witnessActorIds,
          locationId: event.locationId,
          summary: event.summary,
          createdAt: event.createdAt,
        },
        delivery.actorId,
        delivery.summary,
        salience,
        expiresAt,
        job.nowGameHour,
        delivery.source,
        delivery.distorted,
      )) inserted += 1;
    }
    await ctx.db.patch(job._id, {
      status: page.isDone ? 'completed' : 'pending',
      cursor: page.isDone ? undefined : page.continueCursor,
      pagesProcessed: job.pagesProcessed + 1,
      actorsProcessed: job.actorsProcessed + page.page.length,
      memoriesInserted: job.memoriesInserted + inserted,
      updatedAt: Date.now(),
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.xianxia.memory.generateMemoryFanoutPage, {
        jobId: job._id,
      });
    }
    return {
      status: 'processed',
      processed: page.page.length,
      inserted,
      isDone: page.isDone,
    };
  },
});

export async function cancelMemoryFanoutForEvent(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  eventId: Id<'worldEvents'>,
) {
  const job = await ctx.db
    .query('memoryFanoutJobs')
    .withIndex('byEvent', (q) => q.eq('worldId', worldId).eq('eventId', eventId))
    .first();
  if (!job) return false;
  await ctx.db.delete(job._id);
  return true;
}

export function memoryFanoutDeliveriesForPage(
  event: RumorEvent,
  pageActors: RumorActor[],
  principalActors: RumorActor[],
) {
  const pageIds = new Set(pageActors.map((actor) => actor.actorId));
  const principalIds = new Set([...event.actorIds, ...(event.targetActorIds ?? [])]);
  const actors = new Map<string, RumorActor>();
  for (const actor of [...principalActors, ...pageActors]) actors.set(actor.actorId, actor);
  return propagateEvent(event, [...actors.values()]).filter(
    (delivery) => pageIds.has(delivery.actorId) && !principalIds.has(delivery.actorId),
  );
}

function toRumorActor(profile: Doc<'xianxiaProfiles'>): RumorActor {
  return {
    actorId: profile.actorId,
    currentLocationId: profile.currentLocationId,
    reputation: profile.reputation,
  };
}

function toRumorEvent(event: Doc<'worldEvents'>): RumorEvent {
  return {
    eventId: event._id,
    type: event.type,
    visibility: event.visibility,
    actorIds: event.actorIds,
    targetActorIds: event.targetActorIds,
    witnessActorIds: event.witnessActorIds,
    locationId: event.locationId,
    summary: event.summary,
  };
}

export type MemoryCompactionResult = {
  status: 'compacted' | 'no_op';
  actorId: string;
  archived: number;
  active: number;
  summariesCreated: number;
  summariesUpdated: number;
  expiredArchived: number;
  overflowArchived: number;
};

const MEMORY_COMPACTION_RETRY_MS = 60_000;

function socialSummaryId(actorId: string, subjectActorId: string) {
  return `social_memory:${actorId}:${subjectActorId}`;
}

export async function compactActorMemoriesInMutation(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  nowGameHour: number,
): Promise<MemoryCompactionResult> {
  const compactionState = await ctx.db
    .query('memoryCompactionStates')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
  const memories = compactionState?.status === 'migrated'
    ? await ctx.db
        .query('shortMemories')
        .withIndex('byActorLifecycle', (q) =>
          q.eq('worldId', worldId).eq('actorId', actorId).eq('lifecycle', 'active'),
        )
        .collect()
    : await ctx.db
        .query('shortMemories')
        .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
        .collect();
  const plan = planMemoryCompaction(
    memories.map((memory) => ({
      id: String(memory._id),
      salience: memory.salience,
      createdAt: memory.createdAt,
      expiresAt: memory.expiresAt,
      lifecycle: memory.lifecycle,
    })),
    nowGameHour,
    MAX_ACTIVE_EPISODIC_MEMORIES,
  );
  if (plan.archiveIds.length === 0) {
    if (compactionState?.status !== 'migrated') {
      for (const memory of memories) {
        if (memory.lifecycle === undefined) await ctx.db.patch(memory._id, { lifecycle: 'active' });
      }
      const now = Date.now();
      if (compactionState) {
        await ctx.db.patch(compactionState._id, {
          status: 'migrated',
          lastCompactedAtGameHour: nowGameHour,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert('memoryCompactionStates', {
          worldId,
          actorId,
          status: 'migrated',
          requestedAtGameHour: nowGameHour,
          lastCompactedAtGameHour: nowGameHour,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return {
      status: 'no_op',
      actorId,
      archived: 0,
      active: memories.filter((memory) => memory.lifecycle !== 'archived').length,
      summariesCreated: 0,
      summariesUpdated: 0,
      expiredArchived: 0,
      overflowArchived: 0,
    };
  }

  const archiveIds = new Set(plan.archiveIds);
  const toArchive = memories.filter((memory) => archiveIds.has(String(memory._id)));
  const groups = new Map<string, typeof toArchive>();
  for (const memory of toArchive) {
    const subjectActorId = primaryMemorySubject(memory.aboutActorIds);
    const group = groups.get(subjectActorId) ?? [];
    group.push(memory);
    groups.set(subjectActorId, group);
  }

  let summariesCreated = 0;
  let summariesUpdated = 0;
  for (const [subjectActorId, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const existing = await ctx.db
      .query('socialMemorySummaries')
      .withIndex('byActorSubject', (q) =>
        q.eq('worldId', worldId).eq('actorId', actorId).eq('subjectActorId', subjectActorId),
      )
      .first();
    const merged = mergeSocialSummary(subjectActorId, existing
      ? {
          memoryCount: existing.memoryCount,
          sourceEventIds: existing.sourceEventIds,
          eventTypes: existing.eventTypes,
          sourceKinds: existing.sourceKinds,
          firstOccurredAt: existing.firstOccurredAt,
          lastOccurredAt: existing.lastOccurredAt,
          highestSalience: existing.highestSalience,
          containsDistortion: existing.containsDistortion,
          revision: existing.revision,
        }
      : undefined, group.map((memory) => ({
        sourceEventId: memory.sourceEventId,
        type: memory.type,
        salience: memory.salience,
        createdAt: memory.createdAt,
        source: memory.source,
        distorted: memory.distorted,
      })));
    const now = Date.now();
    const summaryId = existing?.summaryId ?? socialSummaryId(actorId, subjectActorId);
    if (existing) {
      await ctx.db.patch(existing._id, { ...merged, updatedAt: now });
      summariesUpdated += 1;
    } else {
      await ctx.db.insert('socialMemorySummaries', {
        worldId,
        summaryId,
        actorId,
        subjectActorId,
        ...merged,
        createdAt: now,
        updatedAt: now,
      });
      summariesCreated += 1;
    }
    for (const memory of group) {
      await ctx.db.patch(memory._id, {
        lifecycle: 'archived',
        archivedAtGameHour: nowGameHour,
        socialSummaryId: summaryId,
      });
    }
  }

  const activeIds = new Set(plan.activeIds);
  for (const memory of memories) {
    if (activeIds.has(String(memory._id)) && memory.lifecycle === undefined) {
      await ctx.db.patch(memory._id, { lifecycle: 'active' });
    }
  }
  const now = Date.now();
  if (compactionState) {
    await ctx.db.patch(compactionState._id, {
      status: 'migrated',
      lastCompactedAtGameHour: nowGameHour,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('memoryCompactionStates', {
      worldId,
      actorId,
      status: 'migrated',
      requestedAtGameHour: nowGameHour,
      lastCompactedAtGameHour: nowGameHour,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    status: 'compacted',
    actorId,
    archived: toArchive.length,
    active: plan.activeIds.length,
    summariesCreated,
    summariesUpdated,
    expiredArchived: plan.expiredArchiveCount,
    overflowArchived: plan.overflowArchiveCount,
  };
}

export const compactActorMemories = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    nowGameHour: v.number(),
  },
  handler: async (ctx, args): Promise<MemoryCompactionResult> => {
    const actor = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .first();
    if (!actor) throw new Error('memory_actor_not_found');
    return compactActorMemoriesInMutation(ctx, args.worldId, args.actorId, args.nowGameHour);
  },
});

export const runScheduledMemoryCompaction = internalMutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    nowGameHour: v.number(),
  },
  handler: async (ctx, args): Promise<MemoryCompactionResult> => {
    const actor = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .first();
    if (!actor) {
      const state = await ctx.db
        .query('memoryCompactionStates')
        .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
        .first();
      if (state) await ctx.db.delete(state._id);
      return {
        status: 'no_op',
        actorId: args.actorId,
        archived: 0,
        active: 0,
        summariesCreated: 0,
        summariesUpdated: 0,
        expiredArchived: 0,
        overflowArchived: 0,
      };
    }
    return compactActorMemoriesInMutation(ctx, args.worldId, args.actorId, args.nowGameHour);
  },
});

async function maintainActorMemoryCap(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  nowGameHour: number,
) {
  const state = await ctx.db
    .query('memoryCompactionStates')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
  if (state?.status === 'migrated') {
    await compactActorMemoriesInMutation(ctx, worldId, actorId, nowGameHour);
    return;
  }
  if (state) {
    const now = Date.now();
    if (now - state.updatedAt < MEMORY_COMPACTION_RETRY_MS) return;
    await ctx.db.patch(state._id, {
      requestedAtGameHour: nowGameHour,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(100, internal.xianxia.memory.runScheduledMemoryCompaction, {
      worldId,
      actorId,
      nowGameHour,
    });
    return;
  }
  const now = Date.now();
  await ctx.db.insert('memoryCompactionStates', {
    worldId,
    actorId,
    status: 'pending',
    requestedAtGameHour: nowGameHour,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(100, internal.xianxia.memory.runScheduledMemoryCompaction, {
    worldId,
    actorId,
    nowGameHour,
  });
}

async function insertMemory(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  event: MemoryEventInput,
  actorId: string,
  summary: string,
  salience: number,
  expiresAt: number,
  nowGameHour: number,
  source: 'direct' | 'witness' | 'present' | 'rumor' = 'direct',
  distorted = false,
) {
  const sourceEventId = String(event.eventId);
  const existing = await ctx.db
    .query('shortMemories')
    .withIndex('byActorSourceEvent', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('sourceEventId', sourceEventId),
    )
    .first();
  if (existing) return false;
  const principals = new Set([...event.actorIds, ...(event.targetActorIds ?? [])]);
  await ctx.db.insert('shortMemories', {
    worldId,
    actorId,
    sourceEventId,
    aboutActorIds: [...principals].filter((principalId) => principalId !== actorId),
    type: event.type,
    salience,
    createdAt: event.createdAt,
    expiresAt,
    summary,
    source,
    distorted,
    lifecycle: 'active',
  });
  await maintainActorMemoryCap(ctx, worldId, actorId, nowGameHour);
  return true;
}

// 某角色当下记得的事（未过期，倒序）。nowGameHour 由调用方传入（取当前游戏小时，W3b）。
export const getRecentMemories = query({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    nowGameHour: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const [active, legacy] = await Promise.all([
      ctx.db
        .query('shortMemories')
        .withIndex('byActorLifecycle', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId).eq('lifecycle', 'active'),
        )
        .order('desc')
        .take(limit * 3),
      ctx.db
        .query('shortMemories')
        .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
        .order('desc')
        .take(limit * 6),
    ]);
    return [...active, ...legacy.filter((memory) => memory.lifecycle === undefined)]
      .sort((left, right) => right.createdAt - left.createdAt || String(right._id).localeCompare(String(left._id)))
      .filter((memory) => !isExpired(memory, args.nowGameHour))
      .slice(0, limit);
  },
});

export const getRecentSocialSummaries = query({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? MAX_PROMPT_SOCIAL_SUMMARIES, MAX_PROMPT_SOCIAL_SUMMARIES);
    return ctx.db
      .query('socialMemorySummaries')
      .withIndex('byActorUpdated', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .order('desc')
      .take(limit);
  },
});

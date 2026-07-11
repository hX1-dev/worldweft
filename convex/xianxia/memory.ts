import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import type { EventVisibility } from './actionSchema';
import { isMemorable, memorySalience, memoryExpiresAtHour, isExpired } from './memoryLogic';
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
    for (const actorId of principals) {
      await insertMemory(ctx, worldId, ev, actorId, ev.summary, salience, expiresAt);
    }
    const now = Date.now();
    const jobId = await ctx.db.insert('memoryFanoutJobs', {
      worldId,
      eventId: ev.eventId,
      nowGameHour,
      status: 'pending',
      pagesProcessed: 0,
      actorsProcessed: 0,
      memoriesInserted: principals.length,
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
    for (const delivery of deliveries) {
      await insertMemory(
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
      );
    }
    await ctx.db.patch(job._id, {
      status: page.isDone ? 'completed' : 'pending',
      cursor: page.isDone ? undefined : page.continueCursor,
      pagesProcessed: job.pagesProcessed + 1,
      actorsProcessed: job.actorsProcessed + page.page.length,
      memoriesInserted: job.memoriesInserted + deliveries.length,
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
      inserted: deliveries.length,
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

async function insertMemory(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  event: MemoryEventInput,
  actorId: string,
  summary: string,
  salience: number,
  expiresAt: number,
) {
  const principals = new Set([...event.actorIds, ...(event.targetActorIds ?? [])]);
  await ctx.db.insert('shortMemories', {
    worldId,
    actorId,
    sourceEventId: event.eventId,
    aboutActorIds: [...principals].filter((principalId) => principalId !== actorId),
    type: event.type,
    salience,
    createdAt: event.createdAt,
    expiresAt,
    summary,
  });
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
    const mems = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .order('desc')
      .take(limit * 3);
    return mems.filter((m) => !isExpired(m, args.nowGameHour)).slice(0, limit);
  },
});

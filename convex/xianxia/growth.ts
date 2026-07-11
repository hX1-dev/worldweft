import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { autoCultivationGain, proposeBonds, BOND_THRESHOLD, type BondKind, type BondPair } from './cultivationLogic';
import { breakthroughThreshold, realmMaxStage } from './rules';
import { autoAdvanceLayers, loadProfile } from './actions';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { readClockStartedAt } from './config';
import { gameTimeAt, phaseModifiers } from './timeLogic';

const MAX_GROWTH_PROFILES = 32;
const MAX_GROWTH_LOCATIONS = 128;
const MAX_BOND_RELATIONSHIPS_PER_ACTOR = 8;
const MAX_BOND_PAIRS = 64;

// 自主成长 tick（鬼谷仿造 · G，命门）。确定性、无 LLM、通过持久游标分批覆盖全员：
//   1) 每个角色轮到时得「背景修为涓流」并兑现境内升层——守职者(商贩/守卫)、未被动作循环选中者也不停滞；
//   2) 深交者按性格在运行时缔结新关系（道侣/师徒/结义）——补鬼谷「关系出生即定、不再生长」的空缺。
// 让「无玩家干预、放着不管，世界格局也会可见地改变」成真，这是我们区别于鬼谷「假活木桩」的命门。
// 风险性的跨境大关仍由动作循环手动 breakthrough 裁决，本 tick 不静默触发天劫（平衡阀门）。
// 由 runAgentTick 每回合调用（与 tickQuests / tickGroupScenes 并列）。

export const tickAutonomousGrowth = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const startedAt = await readClockStartedAt(ctx, worldId);
    const gt = startedAt === null ? null : gameTimeAt(now, startedAt);
    const phaseBonus = gt ? phaseModifiers(gt.phase).cultivationXpBonus : 0;
    const gameDay = gt ? Math.floor(gt.totalHours / 24) : 0;

    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    const afterActorId = config?.growthCursorActorId;
    let profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        afterActorId
          ? q.eq('worldId', worldId).gt('actorId', afterActorId)
          : q.eq('worldId', worldId),
      )
      .order('asc')
      .take(MAX_GROWTH_PROFILES);
    const wrapped = Boolean(afterActorId) && profiles.length === 0;
    if (wrapped) {
      profiles = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', worldId))
        .order('asc')
        .take(MAX_GROWTH_PROFILES);
    }

    // 地点灵气一次性建表，免去逐人查库。
    const locs = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) => q.eq('worldId', worldId))
      .take(MAX_GROWTH_LOCATIONS);
    const energyOf = new Map(locs.map((l) => [l.locationId, l.spiritualEnergy]));

    // 1) 全员背景涓流 + 兑现境内升层（只在攒够且非大关时才调 autoAdvanceLayers，省无谓读写）。
    let advanced = 0;
    for (const p of profiles) {
      const energy = (p.currentLocationId && energyOf.get(p.currentLocationId)) || 0;
      const gain = autoCultivationGain({
        spiritualEnergy: energy,
        spiritRoot: p.spiritRoot,
        realm: p.realm,
        innerTrait: p.innerTrait ?? '',
        outerTrait: p.outerTrait ?? '',
        phaseBonus,
      });
      const newXp = p.cultivationXp + gain;
      await ctx.db.patch(p._id, { cultivationXp: newXp });
      const atRealmGate = p.realmStage >= realmMaxStage(p.realm);
      if (!atRealmGate && newXp >= breakthroughThreshold(p.realm, p.realmStage)) {
        await autoAdvanceLayers(ctx, worldId, p.actorId, now);
        advanced++;
      }
    }

    // 2) 关系网生长。
    const bonds = await formBonds(ctx, worldId, profiles, now, gameDay);

    const nextAfterActorId = profiles.at(-1)?.actorId;
    if (config && nextAfterActorId) {
      await ctx.db.patch(config._id, { growthCursorActorId: nextAfterActorId });
    }

    return {
      cultivated: profiles.length,
      advanced,
      bonds,
      startAfterActorId: afterActorId,
      nextAfterActorId,
      wrapped,
      locationsScanned: locs.length,
      locationWindowTruncated: locs.length === MAX_GROWTH_LOCATIONS,
    };
  },
});

// 收集双向好感都达门槛、尚无缔结的有序对，交纯逻辑 proposeBonds 定夺，成则双向打标签 + 记一条世界事件。
async function formBonds(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  profiles: Doc<'xianxiaProfiles'>[],
  now: number,
  gameDay: number,
): Promise<number> {
  const pmap = new Map(profiles.map((p) => [p.actorId, p]));
  const pairs: BondPair[] = [];
  const seen = new Set<string>();
  for (const p of profiles) {
    if (pairs.length >= MAX_BOND_PAIRS) break;
    const rels = await ctx.db
      .query('relationships')
      .withIndex('from', (q) => q.eq('worldId', worldId).eq('fromActorId', p.actorId))
      .take(MAX_BOND_RELATIONSHIPS_PER_ACTOR);
    for (const r of rels) {
      if (pairs.length >= MAX_BOND_PAIRS) break;
      if (r.value < BOND_THRESHOLD) continue;
      let other = pmap.get(r.toActorId);
      if (!other) {
        other = (await loadProfile(ctx, worldId, r.toActorId)) ?? undefined;
        if (other) pmap.set(other.actorId, other);
      }
      if (!other) continue;
      const key = [p.actorId, r.toActorId].sort().join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      const back = await loadRel(ctx, worldId, r.toActorId, p.actorId);
      if (!back || back.value < BOND_THRESHOLD) continue; // 须双向都深
      pairs.push({
        a: p.actorId,
        b: r.toActorId,
        affinityAB: r.value,
        affinityBA: back.value,
        aInner: p.innerTrait ?? '',
        aOuter: p.outerTrait ?? '',
        bInner: other.innerTrait ?? '',
        bOuter: other.outerTrait ?? '',
        existingTags: [...(r.tags ?? []), ...(back.tags ?? [])],
      });
    }
  }

  const proposals = proposeBonds(pairs);
  for (const bp of proposals) {
    await tagBond(ctx, worldId, bp.a, bp.b, bp.kind, gameDay);
    const an = pmap.get(bp.a)?.name ?? bp.a;
    const bn = pmap.get(bp.b)?.name ?? bp.b;
    await appendWorldEvent(ctx, {
      worldId,
      type: 'bond_formed',
      createdAt: now,
      actorIds: [bp.a],
      targetActorIds: [bp.b],
      visibility: 'public',
      summary: `${an}与${bn}${bp.reason}。`,
      facts: versionDurableEventFacts({ resultCode: 'bond_formed', kind: bp.kind }),
    });
  }
  return proposals.length;
}

async function loadRel(ctx: MutationCtx, worldId: Id<'worlds'>, from: string, to: string) {
  return await ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first();
}

// 给 a↔b 两向关系都打上缔结标签（避免下次重复缔结），并戳记游戏日。
async function tagBond(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  a: string,
  b: string,
  kind: BondKind,
  gameDay: number,
) {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    const rel = await loadRel(ctx, worldId, from, to);
    if (!rel) continue;
    const tags = new Set(rel.tags ?? []);
    tags.add(kind);
    await ctx.db.patch(rel._id, { tags: [...tags], lastTouchedDay: gameDay });
  }
}

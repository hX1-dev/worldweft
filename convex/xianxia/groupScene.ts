import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { planGroupScene, type SceneActor } from './groupSceneLogic';
import { readClockStartedAt } from './config';
import { gameTimeAt } from './timeLogic';

const MAX_GROUP_SCENE_PROFILES = 256;
const MAX_GROUP_SCENE_LOCATIONS = 128;

// 群体场景的「接线层」（World Foundation · W4b-F）。纯判定在 groupSceneLogic.ts。
// 每次世界推进调用：按当前在场人群 + 昼夜，确定性地把晨课/坊市议价/秘境组队
// 写成 group_scene worldEvent（不走 AI Town 双人 conversation）。
// 去重：同一地点、同一 phase、同一游戏日最多一次，避免刷屏。

export const tickGroupScenes = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const startedAt = await readClockStartedAt(ctx, worldId);
    if (startedAt === null) return { fired: 0 };
    const gt = gameTimeAt(now, startedAt);

    const profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', worldId))
      .take(MAX_GROUP_SCENE_PROFILES);
    const locations = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) => q.eq('worldId', worldId))
      .take(MAX_GROUP_SCENE_LOCATIONS);
    const mapIdByLocation = new Map(
      locations.map((location) => [location.locationId, location.mapId ?? 'world']),
    );

    // 按语义地点聚集在场角色（无地点者不计入任何场景）。
    const byLoc = new Map<string, SceneActor[]>();
    for (const p of profiles) {
      if (!p.currentLocationId) continue;
      const arr = byLoc.get(p.currentLocationId) ?? [];
      arr.push({ actorId: p.actorId, name: p.name, role: p.role });
      byLoc.set(p.currentLocationId, arr);
    }

    // 近期 group_scene 用于去重。
    const recent = await ctx.db
      .query('worldEvents')
      .withIndex('byType', (q) => q.eq('worldId', worldId).eq('type', 'group_scene'))
      .order('desc')
      .take(30);
    const firedKey = new Set(
      recent.map((e) => `${e.locationId}|${(e.facts as { phase?: string })?.phase}|${(e.facts as { gameDay?: number })?.gameDay}`),
    );

    let fired = 0;
    for (const [locationId, actors] of byLoc) {
      const scene = planGroupScene(locationId, gt.phase, actors);
      if (!scene) continue;
      if (firedKey.has(`${locationId}|${gt.phase}|${gt.day}`)) continue; // 同地点同 phase 同游戏日已发

      await appendWorldEvent(ctx, {
        worldId,
        type: 'group_scene',
        createdAt: now,
        actorIds: scene.targetActorIds,
        targetActorIds: scene.targetActorIds,
        locationId,
        visibility: 'local',
        summary: scene.summary,
        facts: versionDurableEventFacts({
          purpose: scene.purpose,
          phase: gt.phase,
          gameDay: gt.day,
          lines: scene.lines,
        }),
        mapId: mapIdByLocation.get(locationId),
      });
      fired++;
    }
    return {
      fired,
      profilesScanned: profiles.length,
      locationsScanned: locations.length,
      truncated:
        profiles.length === MAX_GROUP_SCENE_PROFILES ||
        locations.length === MAX_GROUP_SCENE_LOCATIONS,
    };
  },
});

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
  actionEnvelopeArgs,
  gmVerdictValidator,
  type ActionResult,
  type Effects,
  type ItemTransfer,
} from './actionSchema';
import {
  breakthroughThreshold,
  buildStealResult,
  clamp,
  realmDisplayName,
  realmMaxStage,
  resolveBreakthrough,
  resolveCultivate,
  resolveExplore,
  resolveGift,
  resolveRequestTeaching,
  resolveSpar,
  resolveSteal,
  resolveTalk,
  resolveTrade,
  seededRoll,
  type ActorSnapshot,
  type LocationSnapshot,
} from './rules';
import { clampGmVerdict } from './gmLogic';
import { roleAllows } from './policy';
import { resolveTravelTarget } from './movementLogic';
import {
  applyDimDelta,
  relationshipEffectFor,
  decayDims,
  giftAffinityMult,
  DECAY_PERIOD_DAYS,
  type DimDelta,
  type Dims,
} from './relationshipLogic';
import { evaluateRefusal, type TargetView } from './refusalLogic';
import { deriveGrudges, type AllyRelation } from './grudgeLogic';
import { generateMemories } from './memory';
import {
  normalizeDurableActionMetadata,
  toDurableActionResult,
  versionDurableEventFacts,
} from './durableContracts';
import { isSensitive } from './items';
import { readClockStartedAt, readGameHour } from './config';
import { gameTimeAt, phaseModifiers, MS_PER_GAME_HOUR } from './timeLogic';
import { findPlayerIdByName, loadLocationPoints } from './movement';
import { insertInput } from '../aiTown/insertInput';
import { appendWorldEvent } from './events';
import { actionIdempotencyFingerprint } from './actionIdempotency';
import {
  evaluateGodotSpatialState,
  isGodotTargetedLocalAction,
  type GodotTile,
} from '../godotSpatial';

// 动作系统的统一入口（M2 起，M3 接齐 8 动作）。玩家与 Agent 都经由 submitAction 提交；
// resolver 校验 → 装载状态 → 跑确定性规则 → 应用 effects（含物品转移）→ 写事件 → 落 actionRecord。
// 移动（travel）仍复用 AI Town 的 moveTo，未在此实现。
// 依据：docs/xianxia-blueprint.md §8、§14.3、§18。

export const submitAction = internalMutation({
  // gmVerdict 仅 steal 用：由 gm.act 预先算好传入，这里再钳一次（纵深防御）。
  args: { ...actionEnvelopeArgs, gmVerdict: v.optional(gmVerdictValidator) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestMetadata = objectOrEmpty(args.metadata);
    const requestMapId =
      typeof requestMetadata.mapId === 'string' ? requestMetadata.mapId : undefined;
    const clientActionFingerprint = args.clientActionId
      ? actionIdempotencyFingerprint(args)
      : undefined;
    if (args.clientActionId) {
      const existing = await ctx.db
        .query('actionRecords')
        .withIndex('byClientAction', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('actorId', args.actorId)
            .eq('clientActionId', args.clientActionId),
        )
        .first();
      if (existing) {
        return await replayIdempotentAction(
          ctx,
          existing,
          args.clientActionId,
          clientActionFingerprint!,
        );
      }
    }

    // 1) 记一条 proposed 的 actionRecord（生命周期起点）。
    const actionRecordId = await ctx.db.insert('actionRecords', {
      worldId: args.worldId,
      actorId: args.actorId,
      type: args.type,
      status: 'proposed',
      targetId: args.targetId,
      targetActorId: args.targetActorId,
      locationId: args.locationId,
      intent: args.intent,
      source: args.source,
      mapId: requestMapId,
      clientActionId: args.clientActionId,
      clientActionFingerprint,
      riskTolerance: args.riskTolerance,
      createdAt: now,
      metadata:
        args.metadata === undefined ? undefined : normalizeDurableActionMetadata(requestMetadata),
    });

    // 2) 装载行动者档案。
    const profile = await loadProfile(ctx, args.worldId, args.actorId);
    if (!profile) {
      return await finalize(ctx, actionRecordId, args, now, null, {
        status: 'rejected',
        resultCode: 'actor_not_found',
        reason: `未找到行动者 ${args.actorId} 的修仙档案。`,
        effects: {},
        eventType: 'action_rejected',
        visibility: 'private',
      });
    }

    // 2.5) NPC 行为白名单硬校验（M1 §2.3）：守卫不偷、掌柜不探索…。
    // travel/arrive 是通用移动/抵达，豁免。这是 submitAction 唯一的 role 闸门（agent 端只是少提案，仍以此为准）。
    if (!['travel', 'arrive'].includes(args.type) && !roleAllows(profile.role, args.type)) {
      return await finalize(ctx, actionRecordId, args, now, null, {
        status: 'rejected',
        resultCode: 'role_not_allowed',
        reason: `${profile.name}身为${profile.role}，不会行此事。`,
        effects: {},
        eventType: 'action_rejected',
        visibility: 'private',
      });
    }

    // 3) 按类型分派裁决。
    const seed = `${args.worldId}_${args.actorId}_${args.type}_${now}`;
    const roll = seededRoll(seed);
    const finalSpatialIssue = await loadFinalGodotSpatialIssue(
      ctx,
      args,
      profile,
      requestMetadata,
    );
    if (finalSpatialIssue) {
      return await finalize(
        ctx,
        actionRecordId,
        args,
        now,
        { seed, roll, profile },
        reject(finalSpatialIssue.resultCode, finalSpatialIssue.reason),
      );
    }
    // W3a 世界时钟：取当前昼夜阶段的修正，喂给 cultivate/steal/explore（无时钟则中性）。
    const clockStartedAt = await readClockStartedAt(ctx, args.worldId);
    const phaseMods =
      clockStartedAt === null ? undefined : phaseModifiers(gameTimeAt(now, clockStartedAt).phase);
    const params = (args.params ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
    const qty = (k: string) => {
      const raw = params[k];
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      return Number.isFinite(value) ? Math.max(1, Math.min(99, Math.floor(value))) : undefined;
    };
    const actor = toActorSnapshot(profile);
    let result: ActionResult;

    switch (args.type) {
      case 'cultivate': {
        const location = await resolveLocation(ctx, args, profile);
        result = location
          ? resolveCultivate({ actor, location: toLocationSnapshot(location), roll, phaseMods })
          : reject('unknown_location', '未指定有效的修炼地点。');
        break;
      }
      case 'explore': {
        const location = await resolveLocation(ctx, args, profile);
        result = location
          ? resolveExplore({ actor, location: toLocationSnapshot(location), roll, phaseMods })
          : reject('unknown_location', '未指定有效的探索地点。');
        break;
      }
      case 'breakthrough': {
        const location = await resolveLocation(ctx, args, profile);
        result = location
          ? resolveBreakthrough({
              actor,
              location: toLocationSnapshot(location),
              roll,
              mishapRoll: seededRoll(seed + ':mishap'),
            })
          : reject('unknown_location', '未指定突破发生的地点。');
        break;
      }
      case 'talk':
      case 'spar':
      case 'request_teaching':
      case 'gift':
      case 'trade':
      case 'steal': {
        if (!args.targetActorId) {
          result = reject('target_required', `动作「${args.type}」需要指定目标角色。`);
          break;
        }
        const targetDoc = await loadProfile(ctx, args.worldId, args.targetActorId);
        if (!targetDoc) {
          result = reject('target_not_found', `未找到目标 ${args.targetActorId} 的修仙档案。`);
          break;
        }
        const target = toActorSnapshot(targetDoc);
        // M1 §2.2：针对角色的动作要求双方同处一地（位置已与身体同步，此校验才成立）。
        if (
          !actor.currentLocationId ||
          !target.currentLocationId ||
          actor.currentLocationId !== target.currentLocationId ||
          (args.locationId !== undefined && actor.currentLocationId !== args.locationId) ||
          (profile.mapId ?? 'world') !== (targetDoc.mapId ?? 'world')
        ) {
          result = reject('target_not_present', `${target.name}不在你身边，无从${args.type}。`);
          break;
        }
        // 对方(target)如何看你(actor)——M3 拒绝判断与 M4 报价共用此关系快照。
        const targetView = await loadRelationshipDims(
          ctx,
          args.worldId,
          args.targetActorId,
          args.actorId,
        );
        // M3 拒绝系统：社会性动作先判对方愿不愿（≠失败）。spar/steal 非「请求」，不走此闸。
        if (['talk', 'gift', 'trade', 'request_teaching'].includes(args.type)) {
          const reqItem = str('requestedItemId') ?? str('itemId');
          const refusal = evaluateRefusal({
            actionType: args.type,
            targetView,
            actorReputation: profile.reputation,
            itemSensitive: reqItem ? isSensitive(reqItem) : false,
          });
          if (refusal.refused) {
            result = {
              status: 'rejected',
              resultCode: refusal.reasonCode!,
              reason: refusal.reason!,
              effects: {},
              eventType: 'action_refused',
              visibility: 'local',
            };
            break;
          }
        }

        const relationship = await loadRelationshipValue(
          ctx,
          args.worldId,
          args.actorId,
          args.targetActorId,
        );

        if (args.type === 'talk') {
          result = resolveTalk({ actor, target, relationship, roll, topic: args.intent });
        } else if (args.type === 'spar') {
          result = resolveSpar({ actor, target, relationship, roll });
        } else if (args.type === 'request_teaching') {
          result = resolveRequestTeaching({ actor, master: target, relationship, roll });
        } else if (args.type === 'gift') {
          const itemId = str('itemId');
          result = itemId
            ? resolveGift({ actor, target, itemId, relationship, roll })
            : reject('missing_param', '赠礼需要 params.itemId。');
        } else if (args.type === 'trade') {
          const offeredItemId = str('offeredItemId');
          const requestedItemId = str('requestedItemId');
          result =
            offeredItemId && requestedItemId
              ? resolveTrade({
                  actor,
                  target,
                  offeredItemId,
                  offeredQty: qty('offeredQty'),
                  requestedItemId,
                  requestedQty: qty('requestedQty'),
                  sellerView: targetView,
                })
              : reject(
                  'missing_param',
                  '交易需要 params.offeredItemId 与 params.requestedItemId。',
                );
        } else {
          // steal：高风险。有弱 GM 裁决（已钳制）则采纳，否则退回确定性规则。
          const itemId = str('itemId');
          const location = await resolveLocation(ctx, args, profile);
          const targetHasItem = (target.inventory ?? []).some(
            (i) => i.itemId === itemId && i.qty >= 1,
          );
          if (!itemId) result = reject('missing_param', '偷取需要 params.itemId。');
          else if (!location) result = reject('unknown_location', '未指定偷取发生的地点。');
          else if (!targetHasItem)
            result = reject('target_lacks_item', `${target.name}身上并无「${itemId}」，无从偷取。`);
          else {
            const verdict = args.gmVerdict ? clampGmVerdict(args.gmVerdict) : null;
            result = verdict
              ? buildStealResult({
                  outcome: verdict.outcome,
                  actorActorId: actor.actorId,
                  targetActorId: target.actorId,
                  actorName: actor.name,
                  targetName: target.name,
                  itemId,
                  reason: verdict.reasonText,
                  reputationDelta: verdict.reputationDelta,
                  // 受害者→小偷的关系反应由 relationshipEffectFor(steal_*) 统一给出（W4b-E）。
                })
              : resolveSteal({
                  actor,
                  target,
                  location: toLocationSnapshot(location),
                  itemId,
                  roll,
                  detectionRoll: seededRoll(seed + ':det'),
                  phaseMods,
                });
          }
        }
        break;
      }
      case 'travel': {
        // 语义地点 → entryPoint → 驱动 AI Town moveTo。目标地点用 targetId 携带。
        // Agent 只提语义地点，坐标/路径全由系统算（架构铁律 #4）。
        const dest = args.targetId;
        if (!dest) {
          result = reject('missing_target', 'travel 需要 targetId＝目标语义地点。');
          break;
        }
        const { points } = await loadLocationPoints(ctx, args.worldId);
        const tt = resolveTravelTarget(points, dest);
        if (tt.ok === false) {
          result = {
            status: 'rejected',
            resultCode: tt.reasonCode,
            reason: tt.reason,
            effects: {},
            eventType: 'travel_failed',
            visibility: 'local',
          };
          break;
        }
        const playerId = await findPlayerIdByName(ctx, args.worldId, args.actorId);
        if (!playerId) {
          result = reject('no_body', `${profile.name}在此世界中没有身体，无法移动。`);
          break;
        }
        await insertInput(ctx, args.worldId, 'moveTo', { playerId, destination: tt.destination });
        result = {
          status: 'applied',
          resultCode: 'travel_started',
          reason: `${profile.name}动身前往${dest}。`,
          effects: {},
          eventType: 'travel_started',
          visibility: 'local',
        };
        break;
      }
      case 'arrive': {
        const location = args.locationId
          ? await loadLocation(ctx, args.worldId, args.locationId)
          : null;
        result = location
          ? {
              status: 'applied',
              resultCode: 'arrived_location',
              reason: `${profile.name}抵达${location.name}。`,
              effects: {
                locationChange: {
                  fromMapId: profile.mapId,
                  fromLocationId: profile.currentLocationId,
                  toMapId: location.mapId ?? profile.mapId ?? 'world',
                  toLocationId: location.locationId,
                  intent: args.intent ?? `抵达${location.name}`,
                },
              },
              eventType: 'actor_arrived_location',
              visibility: 'local',
            }
          : reject('unknown_location', '未指定有效的抵达地点。');
        break;
      }
      default:
        result = reject('not_implemented', '该动作尚未实现。');
    }

    return await finalize(ctx, actionRecordId, args, now, { seed, roll, profile }, result);
  },
});

// —— 收尾：写事件 → 应用 effects（含物品）→ patch actionRecord → 返回结果 ——
async function finalize(
  ctx: MutationCtx,
  actionRecordId: Id<'actionRecords'>,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId?: string;
    locationId?: string;
    metadata?: unknown;
    clientActionId?: string;
  },
  now: number,
  rolled: { seed: string; roll: number; profile: Doc<'xianxiaProfiles'> } | null,
  result: ActionResult,
) {
  const metadata = objectOrEmpty(args.metadata);
  const mapId = typeof metadata.mapId === 'string' ? metadata.mapId : rolled?.profile.mapId;
  const source = metadata.client === 'godot' ? 'godot' : undefined;
  // 所有结果都进事件日志（拒绝也记，便于回看「为什么失败」），可见性由规则给出。
  // witnessed 可见性默认把目标记为目击者。
  const eventId = await appendWorldEvent(ctx, {
    worldId: args.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [args.actorId],
    targetActorIds: args.targetActorId ? [args.targetActorId] : undefined,
    witnessActorIds:
      result.visibility === 'witnessed' && args.targetActorId ? [args.targetActorId] : undefined,
    locationId: args.locationId ?? rolled?.profile.currentLocationId,
    actionId: actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts(
      source ? { resultCode: result.resultCode, source } : { resultCode: result.resultCode },
    ),
    effects: result.effects,
    mapId,
  });

  // M5：重要事件经可见性/传闻生成各知情者的短期记忆（拒绝也可能值得记，故不限 applied）。
  // W3b：过期以当前游戏小时为基准。
  const nowGameHour = await readGameHour(ctx, args.worldId, now);
  await generateMemories(
    ctx,
    args.worldId,
    {
      eventId,
      type: result.eventType,
      visibility: result.visibility,
      actorIds: [args.actorId],
      targetActorIds: args.targetActorId ? [args.targetActorId] : undefined,
      witnessActorIds:
        result.visibility === 'witnessed' && args.targetActorId ? [args.targetActorId] : undefined,
      locationId: args.locationId ?? rolled?.profile.currentLocationId,
      summary: result.reason,
      createdAt: now,
    },
    nowGameHour,
  );

  if (result.status === 'applied' && rolled) {
    await applyEffects(ctx, rolled.profile, result.effects, eventId);
    await applyItemTransfers(ctx, args.worldId, result.effects.items);
    // M2：按 resultCode 施加双向多维关系反应（§7）——世界对这桩行为作出社会反应。
    // E：传入当前游戏日，让 upsert 惰性补衰减；重复送礼好感收益递减（反套利）。
    if (args.targetActorId) {
      const gameDay = Math.floor(nowGameHour / 24);
      let relEffect = relationshipEffectFor(result.resultCode);
      if (result.resultCode === 'gift_accepted' && relEffect.targetToActor?.affinity) {
        const priorGifts = await countRecentGiftsBetween(
          ctx,
          args.worldId,
          args.actorId,
          args.targetActorId,
          result.eventType,
          now,
        );
        const scaled = Math.round(relEffect.targetToActor.affinity * giftAffinityMult(priorGifts));
        relEffect = {
          ...relEffect,
          targetToActor: { ...relEffect.targetToActor, affinity: scaled },
        };
      }
      if (relEffect.actorToTarget) {
        await upsertRelationship(
          ctx,
          args.worldId,
          args.actorId,
          args.targetActorId,
          relEffect.actorToTarget,
          eventId,
          gameDay,
        );
      }
      if (relEffect.targetToActor) {
        await upsertRelationship(
          ctx,
          args.worldId,
          args.targetActorId,
          args.actorId,
          relEffect.targetToActor,
          eventId,
          gameDay,
        );
      }
      // F：受害者察觉被害 → 其亲友（义气护友/护短护徒/天伦护亲/爱家护侣）对加害者生二次仇恨。
      // 现仅偷窃被发现触发（本游戏暂无杀人动作）；severity 偏小，待重度动作加入自动放大。
      const grudgeSeverity = GRUDGE_SEVERITY[result.resultCode];
      if (grudgeSeverity !== undefined) {
        await rippleVictimGrudges(
          ctx,
          args.worldId,
          args.targetActorId,
          args.actorId,
          grudgeSeverity,
          eventId,
          gameDay,
        );
      }
    }
    // 境内修为攒够则自动升层（一路直达）；跨境大关（realmChange）已由突破处理，不再自动。
    if (!result.effects.realmChange) {
      await autoAdvanceLayers(ctx, args.worldId, rolled.profile.actorId, now);
    }
  }

  await ctx.db.patch(actionRecordId, {
    status: result.status,
    mapId,
    result: toDurableActionResult(
      result,
      rolled ? { seed: rolled.seed, roll: rolled.roll } : undefined,
    ),
    seed: rolled?.seed,
  });

  return {
    ...result,
    eventId,
    actionRecordId,
    clientActionId: args.clientActionId,
    idempotentReplay: false,
  };
}

async function replayIdempotentAction(
  ctx: MutationCtx,
  record: Doc<'actionRecords'>,
  clientActionId: string,
  expectedFingerprint: string,
) {
  if (record.clientActionFingerprint !== expectedFingerprint) {
    throw new Error(
      `action_idempotency_conflict: clientActionId ${clientActionId} was already used for different action semantics.`,
    );
  }
  const result = objectOrEmpty(record.result) as Partial<ActionResult>;
  if (
    typeof result.status !== 'string' ||
    typeof result.resultCode !== 'string' ||
    typeof result.reason !== 'string'
  ) {
    throw new Error(
      `action_idempotency_incomplete: clientActionId ${clientActionId} has no finalized result.`,
    );
  }
  const event = await ctx.db
    .query('worldEvents')
    .withIndex('byAction', (q) => q.eq('worldId', record.worldId).eq('actionId', record._id))
    .first();
  if (!event) {
    throw new Error(
      `action_idempotency_incomplete: clientActionId ${clientActionId} has no linked worldEvent.`,
    );
  }
  return {
    ...(result as ActionResult),
    eventId: event._id,
    actionRecordId: record._id,
    clientActionId,
    idempotentReplay: true,
  };
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// —— 角色数值与关系落库（带夹值）。关系变化必须关联事件（§13.6）——
async function applyEffects(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  effects: Effects,
  eventId: Id<'worldEvents'>,
) {
  const patch: Partial<Doc<'xianxiaProfiles'>> = {};
  if (effects.realmChange) {
    // 突破：境界与层数绝对覆盖，修为重置为溢出值。
    patch.realm = effects.realmChange.realm;
    patch.realmStage = effects.realmChange.realmStage;
    patch.cultivationXp = Math.max(0, effects.realmChange.cultivationXp);
  } else if (effects.cultivationXp) {
    patch.cultivationXp = Math.max(0, profile.cultivationXp + effects.cultivationXp);
  }
  if (effects.mood !== undefined) patch.mood = clamp(profile.mood + effects.mood, -5, 5);
  if (effects.health !== undefined) patch.health = clamp(profile.health + effects.health, 0, 10);
  if (effects.spirit !== undefined) patch.spirit = clamp(profile.spirit + effects.spirit, 0, 10);
  if (effects.reputation !== undefined) {
    patch.reputation = clamp(profile.reputation + effects.reputation, -100, 100);
  }
  if (effects.locationChange) {
    patch.mapId = effects.locationChange.toMapId;
    patch.currentLocationId = effects.locationChange.toLocationId;
    patch.currentIntent = effects.locationChange.intent ?? profile.currentIntent;
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(profile._id, patch);

  // rules.ts 的 value delta = actor 对 target 的好感(affinity)变化。
  for (const rel of effects.relationships ?? []) {
    await upsertRelationship(
      ctx,
      profile.worldId,
      profile.actorId,
      rel.targetActorId,
      { affinity: rel.delta },
      eventId,
    );
  }
}

// —— 物品转移：from 扣减、to 增加；无档案的语义实体第一阶段从简跳过 ——
async function applyItemTransfers(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  transfers: ItemTransfer[] | undefined,
) {
  for (const t of transfers ?? []) {
    if (t.from) await addToInventory(ctx, worldId, t.from, t.itemId, -t.qty);
    if (t.to) await addToInventory(ctx, worldId, t.to, t.itemId, t.qty);
  }
}

// 境内自动升层：修为攒够即水到渠成晋级、无风险；到达本境界顶层（大关）便停下，
// 须由突破动作手动冲关。这样练气 1→9 一路直达，唯有练气满→筑基才是那道坎。
// 境内自动升层（攒够即升，不跨境界大关）。G 的自主成长 tick 也复用此函数兑现升层。
export async function autoAdvanceLayers(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
) {
  const profile = await loadProfile(ctx, worldId, actorId);
  if (!profile) return;
  // 境内自动升层不跨境界，故 realm 不变；用独立基本变量跟踪循环状态。
  const realm = profile.realm;
  let realmStage = profile.realmStage;
  let cultivationXp = profile.cultivationXp;
  let mood = profile.mood;
  let guard = 0;
  while (guard++ < 20) {
    if (realmStage >= realmMaxStage(realm)) break; // 大关，需手动冲
    const threshold = breakthroughThreshold(realm, realmStage);
    if (cultivationXp < threshold) break;
    realmStage += 1;
    cultivationXp -= threshold;
    mood = clamp(mood + 1, -5, 5);
    await ctx.db.patch(profile._id, { realmStage, cultivationXp, mood });
    await appendWorldEvent(ctx, {
      worldId,
      type: 'breakthrough_resolved',
      createdAt: now,
      actorIds: [actorId],
      visibility: 'local',
      summary: `${profile.name}水到渠成，晋入${realmDisplayName(realm)} ${realmStage} 层。`,
      facts: versionDurableEventFacts({ resultCode: 'breakthrough_success' }),
    });
  }
}

export async function addToInventory(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  itemId: string,
  delta: number,
) {
  const p = await loadProfile(ctx, worldId, actorId);
  if (!p) return;
  const inv = [...(p.inventory ?? [])];
  const idx = inv.findIndex((i) => i.itemId === itemId);
  if (idx >= 0) {
    const qty = inv[idx].qty + delta;
    if (qty <= 0) inv.splice(idx, 1);
    else inv[idx] = { itemId, qty };
  } else if (delta > 0) {
    inv.push({ itemId, qty: delta });
  }
  await ctx.db.patch(p._id, { inventory: inv });
}

// 多维关系 upsert（M2）：读现状 →（E：惰性补衰减）→ 叠加并钳值（纯逻辑）→ 落库。
// value 存好感(affinity)，其余 4 维各列。稀疏：首次交互才建记录。
// gameDay 给定时（社交主路径）：先把自上次变动以来的「遗忘」补算上，再叠加新增量，并戳记 lastTouchedDay。
export async function upsertRelationship(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  fromActorId: string,
  toActorId: string,
  delta: DimDelta,
  eventId: Id<'worldEvents'>,
  gameDay?: number,
) {
  const existing = await ctx.db
    .query('relationships')
    .withIndex('pair', (q) =>
      q.eq('worldId', worldId).eq('fromActorId', fromActorId).eq('toActorId', toActorId),
    )
    .first();
  let current: Partial<Dims> = existing
    ? {
        affinity: existing.value,
        trust: existing.trust,
        suspicion: existing.suspicion,
        debt: existing.debt,
        fear: existing.fear,
      }
    : {};
  // E：惰性遗忘——按持有者(fromActor)的性格，把上次变动到现在的衰减补上（睚眦不忘、仁善宽宥）。
  if (existing && gameDay !== undefined && existing.lastTouchedDay !== undefined) {
    const holder = await loadProfile(ctx, worldId, fromActorId);
    current = decayDims(
      current,
      existing.lastTouchedDay,
      gameDay,
      holder?.innerTrait ?? '',
      holder?.outerTrait ?? '',
    );
  }
  const next = applyDimDelta(current, delta);
  const fields = {
    value: next.affinity,
    trust: next.trust,
    suspicion: next.suspicion,
    debt: next.debt,
    fear: next.fear,
    lastChangedByEventId: eventId,
    ...(gameDay !== undefined ? { lastTouchedDay: gameDay } : {}),
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert('relationships', { worldId, fromActorId, toActorId, ...fields });
}

// F：偷窃被察觉的二次仇恨严重度（事件 resultCode → severity）。本游戏暂无杀人，故只有偷窃两档。
const GRUDGE_SEVERITY: Record<string, number> = {
  steal_failed_detected: 0.3, // 当场被抓，亲友最不齿
  steal_success_suspected: 0.2, // 事后起疑，略轻
};

// 据关系 tags / 好感，把「受害者→某人」归为亲疏类别（供 deriveGrudges 判定谁出头）。
function classifyAllyKind(tags: string[] | undefined, affinity: number): AllyRelation['kind'] {
  const t = tags ?? [];
  if (t.includes('道侣')) return 'spouse';
  if (t.includes('血亲') || t.includes('亲族')) return 'kin';
  if (t.includes('师徒') || t.includes('弟子')) return 'disciple';
  if (affinity >= 25) return 'friend'; // 无 kind 标签时，以深交好感作「挚友」近似
  return 'other';
}

// F：受害者(victim)被加害(perpetrator) → 关系网里在乎他的人对加害者生二次仇恨并落库。
// 先按 tags/好感粗筛候选（不读库），仅对候选载入性格，最后由纯逻辑 deriveGrudges 决定谁真出头。
async function rippleVictimGrudges(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  victimActorId: string,
  perpetratorActorId: string,
  severity: number,
  eventId: Id<'worldEvents'>,
  gameDay: number,
) {
  const rels = await ctx.db
    .query('relationships')
    .withIndex('from', (q) => q.eq('worldId', worldId).eq('fromActorId', victimActorId))
    .take(40);
  const allies: AllyRelation[] = [];
  for (const r of rels) {
    if (r.toActorId === perpetratorActorId) continue; // 加害者自己不算受害者的亲友
    const kind = classifyAllyKind(r.tags, r.value);
    if (kind === 'other') continue;
    const p = await loadProfile(ctx, worldId, r.toActorId);
    if (!p) continue;
    allies.push({
      actorId: r.toActorId,
      kind,
      innerTrait: p.innerTrait ?? '',
      outerTrait: p.outerTrait ?? '',
    });
  }
  for (const seed of deriveGrudges(perpetratorActorId, allies, severity)) {
    await upsertRelationship(
      ctx,
      worldId,
      seed.actorId,
      perpetratorActorId,
      seed.delta,
      eventId,
      gameDay,
    );
  }
}

// E 反套利：统计 fromActor 在「一个衰减周期」内、此前已送给 toActor 多少次礼（不含当前这桩）。
// 用 byType 索引限量取近期同型事件，按参与方与时间窗过滤。供 giftAffinityMult 递减好感收益。
async function countRecentGiftsBetween(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  fromActorId: string,
  toActorId: string,
  eventType: string,
  now: number,
): Promise<number> {
  const since = now - DECAY_PERIOD_DAYS * 24 * MS_PER_GAME_HOUR;
  const events = await ctx.db
    .query('worldEvents')
    .withIndex('byType', (q) => q.eq('worldId', worldId).eq('type', eventType))
    .order('desc')
    .take(50);
  return events.filter(
    (e) =>
      e.createdAt < now &&
      e.createdAt >= since &&
      e.actorIds.includes(fromActorId) &&
      (e.targetActorIds ?? []).includes(toActorId),
  ).length;
}

// —— 装载、关系读取与快照 ——
export async function loadProfile(ctx: MutationCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}

async function loadLocation(ctx: MutationCtx, worldId: Id<'worlds'>, locationId: string) {
  return await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) => q.eq('worldId', worldId).eq('locationId', locationId))
    .first();
}

async function loadFinalGodotSpatialIssue(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    type: string;
    targetActorId?: string;
    locationId?: string;
  },
  profile: Doc<'xianxiaProfiles'>,
  metadata: Record<string, unknown>,
) {
  if (metadata.client !== 'godot') return null;
  const mapId = typeof metadata.mapId === 'string' ? metadata.mapId : undefined;
  if (!mapId) {
    return {
      status: 400 as const,
      resultCode: 'missing_map_id',
      reason: 'Godot local actions require a server-prepared map id.',
    };
  }
  const locationId = args.locationId ?? profile.currentLocationId ?? '';
  const location = locationId ? await loadLocation(ctx, args.worldId, locationId) : null;
  const targetResident =
    args.targetActorId && isGodotTargetedLocalAction(args.type)
      ? await ctx.db
          .query('qinglanResidents')
          .withIndex('byActor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.targetActorId!),
          )
          .filter((q) => q.eq(q.field('mapId'), mapId))
          .first()
      : null;
  return evaluateGodotSpatialState({
    type: args.type,
    actorId: args.actorId,
    targetActorId: args.targetActorId,
    mapId,
    locationId,
    actorTile: readGodotTile(metadata.actorTile),
    interactionRangeTiles:
      typeof metadata.interactionRangeTiles === 'number'
        ? metadata.interactionRangeTiles
        : undefined,
    actorProfile: profile,
    targetResident,
    location,
  });
}

function readGodotTile(value: unknown): GodotTile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const tile = value as Record<string, unknown>;
  return typeof tile.x === 'number' && typeof tile.y === 'number'
    ? { x: tile.x, y: tile.y }
    : undefined;
}

// 动作地点 = 显式 locationId，否则取行动者当前所在地。
async function resolveLocation(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; locationId?: string },
  profile: Doc<'xianxiaProfiles'>,
) {
  const locationId = args.locationId ?? profile.currentLocationId;
  if (!locationId) return null;
  if (!profile.currentLocationId || profile.currentLocationId !== locationId) return null;
  const location = await loadLocation(ctx, args.worldId, locationId);
  if (!location) return null;
  const profileMapId = profile.mapId ?? 'world';
  return (location.mapId ?? 'world') === profileMapId ? location : null;
}

async function loadRelationshipValue(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  from: string,
  to: string,
): Promise<number> {
  const rel = await ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first();
  return rel?.value ?? 0;
}

// 读 from→to 的多维关系快照（M3 拒绝系统用：对方如何看你）。无记录则全 0。
async function loadRelationshipDims(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  from: string,
  to: string,
): Promise<TargetView> {
  const rel = await ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first();
  return {
    affinity: rel?.value ?? 0,
    trust: rel?.trust ?? 0,
    suspicion: rel?.suspicion ?? 0,
    debt: rel?.debt ?? 0,
    fear: rel?.fear ?? 0,
    tags: rel?.tags,
  };
}

function toActorSnapshot(p: Doc<'xianxiaProfiles'>): ActorSnapshot {
  return {
    actorId: p.actorId,
    name: p.name,
    realm: p.realm,
    realmStage: p.realmStage,
    cultivationXp: p.cultivationXp,
    mood: p.mood,
    health: p.health,
    spirit: p.spirit,
    reputation: p.reputation,
    currentLocationId: p.currentLocationId,
    inventory: p.inventory,
  };
}

function toLocationSnapshot(l: Doc<'locations'>): LocationSnapshot {
  return {
    locationId: l.locationId,
    name: l.name,
    kind: l.kind,
    dangerLevel: l.dangerLevel,
    spiritualEnergy: l.spiritualEnergy,
    allowedActions: l.allowedActions,
  };
}

// 统一构造拒绝结果。
function reject(resultCode: string, reason: string): ActionResult {
  return {
    status: 'rejected',
    resultCode,
    reason,
    effects: {},
    eventType: 'action_rejected',
    visibility: 'private',
  };
}

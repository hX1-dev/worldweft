import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
  actionEnvelopeArgs,
  gmVerdictValidator,
  type ActionResult,
  type Effects,
  type ItemTransfer,
} from '../actionSchema';
import {
  buildStealResult,
  clamp,
  resolveBreakthrough,
  resolveCultivate,
  resolveExplore,
  resolveGift,
  resolveRequestTeaching,
  resolveSpar,
  resolveSteal,
  resolveTalk,
  resolveUseItem,
  seededRoll,
  type ActorSnapshot,
  type LocationSnapshot,
} from '../rules';
import { clampGmVerdict } from '../gmLogic';
import { roleAllows } from '../policy';
import {
  mergeDimDeltas,
  relationshipDimsAt,
  relationshipEffectFor,
  relationshipEffectKindFor,
  RELATIONSHIP_EVENT_POLICIES,
  relationshipStorageAfterEvent,
  resolveRelationshipEvent,
  type DimDelta,
  type RelationshipEffectKind,
} from '../relationshipLogic';
import { evaluateRefusal, type TargetView } from '../refusalLogic';
import { deriveGrudges, type AllyRelation } from '../grudgeLogic';
import { generateMemories } from '../memory';
import {
  normalizeDurableActionMetadata,
  toDurableActionResult,
  versionDurableEventFacts,
  type DurableEventFacts,
} from '../durableContracts';
import { isSensitive, itemBaseValue, itemName } from '../items';
import { quotePrice } from '../priceLogic';
import { readClockStartedAt, readGameHour } from '../config';
import { gameTimeAt, phaseModifiers, MS_PER_GAME_HOUR } from '../timeLogic';
import {
  findPlayerIdByName,
  resolveAvailableWorldTravelTarget,
  worldBodyEngineReady,
} from '../movement';
import { insertInput } from '../../aiTown/insertInput';
import { appendWorldEvent } from '../events';
import {
  actionIdempotencyFingerprint,
  agentActionClientId,
} from '../actionIdempotency';
import { AUTONOMY_DECISION_CONTRACT_VERSION } from '../autonomyDecisionContracts';
import { admitServerVerifiedTaixuTerminalResultTx } from '../taixuResultFactOwnerAdmission';
import { stableObservationDigest } from '../lifeObservation';
import { purposeGoalFenceValidator } from '../personalGoalContracts';
import { purposeGoalCausalFenceMatches } from '../purposeBoundLifeGoalLogic';
import {
  clampGodotRange,
  evaluateGodotSpatialState,
  godotTileDistance,
  isGodotTargetedLocalAction,
  type GodotTile,
} from '../../godotSpatial';
import {
  cancelActiveValleyMovementCommands,
  createValleyMovementCommand,
  finishValleyResidentAction,
  markValleyResidentActionStarted,
} from '../valleyMovement';
import {
  commitValleyPortalTransition,
  prepareValleyPortalTransition,
  type PreparedValleyPortalTransition,
} from '../valleyPortal';
import { prepareValleyInspection } from '../valleyInspect';
import {
  QINGLAN_VALLEY_GATE_MAP_ID,
  type MovementDecisionSource,
  type MovementTarget,
} from '../valleyMovementContracts';
import {
  INCAPACITATED_RECOVERY_DELAY_MS,
  evaluateLifeActionGate,
  evaluateTargetLifeGate,
  isActorDeceased,
  isActorIncapacitated,
  needsIncapacitationRecoveryEnrollment,
  resolveHealthTransition,
  type HealthTransition,
} from '../lifeStateLogic';
import {
  ACTION_EXECUTION_LEASE_MS,
  ACTION_EXECUTION_MAX_RUNTIME_MS,
  ACTION_EXECUTION_PROTOCOL_VERSION,
  ACTIVE_ACTION_EXECUTION_STATUSES,
  BREAKTHROUGH_EXECUTION_DURATION_MS,
  ATTACK_EXECUTION_DURATION_MS,
  FLEE_EXECUTION_DURATION_MS,
  GIFT_EXECUTION_DURATION_MS,
  TEACHING_EXECUTION_DURATION_MS,
  REQUEST_DECLINE_EXECUTION_DURATION_MS,
  TRADE_EXECUTION_DURATION_MS,
  LOOT_EXECUTION_DURATION_MS,
  TERMINAL_ACTION_EXECUTION_STATUSES,
  actionExecutionReportStatusValidator,
  type ActionExecutionGoal,
  type ActionExecutionReport,
} from '../actionExecutionContracts';
import {
  evaluateActionExecutionReport,
  nextActionExecutionRevision,
} from '../actionExecutionLogic';
import {
  admitAttack,
  admitFlee,
  admitLoot,
  admitTradeEnvelope,
  admitGiftEnvelope,
  admitRequestTeachingEnvelope,
  admitSpar,
  admitStealEnvelope,
  admitUseItem,
  admitBreakthrough,
  admitExplore,
  admitTimedAction,
  prepareTimedActionSettlement,
  receiptForTimedActionSettlement,
  timedActionIdempotencyKey,
} from '../runtimeTimedActionPort';
import {
  admitTalk,
  conversationSessionIdempotencyKey,
  receiptForConversationSession,
  type ConversationSessionOperation,
} from '../runtimeConversationSessionPort';
import { evaluateGiftActionCooldown, unreservedGiftQuantity } from '../giftLogic';
import {
  evaluateTradeActionCooldown,
  parseTradeQuantity,
  unreservedTradeQuantity,
} from '../tradeLogic';
import {
  evaluateTeachingActionCooldown,
  parseTeachingTopic,
  type TeachingTopic,
} from '../teachingLogic';
import {
  availableResourceStock,
  consumeResourceStock,
  resourceAccessAllowed,
} from '../resourceNodeLogic';
import {
  evaluateFatigueActionGate,
  fatigueAfterCompletedAction,
  normalizeFatigue,
} from '../fatigueLogic';
import {
  cultivationModeAvailable,
  cultivationResourceForMode,
  inventoryQuantity,
  parseCultivationMode,
  type CultivationMode,
} from '../cultivationResourceLogic';
import {
  BREAKTHROUGH_MATERIAL_ITEM_ID,
  BREAKTHROUGH_RECOVERY_GAME_HOURS,
  evaluateBreakthroughProgress,
} from '../breakthroughProgressLogic';
import {
  quoteShopPurchase,
  quoteShopSale,
  refreshShopState,
  settleReservedShopTrade,
  type ShopState,
} from '../shopLogic';
import {
  GUARD_ATTACK_REPUTATION_DELTA,
  GUARD_LOOT_REPUTATION_DELTA,
  LOOT_PROTECTION_MS,
  inventoryHasUnreservedTargetItem,
  lootPriorityAllows,
  resolveAttackDamage,
  resolveFlee,
} from '../conflictLogic';
import {
  isExpired as isRequestExpired,
  requestRevision,
  requestRevisionMatches,
  requestRequirementReady,
  type RequestStatus,
  type RequestType,
  type Requirements,
} from '../questLogic';
import { commitRequestTransitionFromAction, type RequestTransitionPatch } from '../requestTransitions';
import {
  commitConversationExpiration,
  commitConversationStart,
  commitConversationTurn,
  prepareConversationStart,
  prepareConversationTurn,
  type ConversationStartPlan,
  type PreparedConversationTurn,
} from '../conversations';
import { parseSpeechAct } from '../conversationLogic';
import {
  commitNegotiationInvalidation,
  commitNegotiationPlan,
  prepareNegotiationAction,
  prepareNegotiationInvalidation,
  type NegotiationCommitPlan,
  type NegotiationInvalidationPlan,
} from '../negotiations';
import type { NegotiationOperation } from '../negotiationContracts';
import {
  commitGroupConversationStart,
  commitGroupConversationTerminal,
  commitGroupConversationTurn,
  prepareGroupConversationLeave,
  prepareGroupConversationStart,
  prepareGroupConversationTurn,
  type GroupConversationStartPlan,
  type GroupConversationTerminalPlan,
  type PreparedGroupConversationTurn,
} from '../groupConversations';
import {
  commitGroupDecision,
  prepareGroupCommitmentExecution,
  prepareGroupProposal,
  prepareGroupVote,
  type GroupDecisionCommitPlan,
} from '../groupDecisions';
import {
  createSocialInvitationTx,
  linkSocialInvitationConversationTx,
  loadAcceptedSocialInvitationSource,
  respondToSocialInvitationTx,
} from '../socialInvitations';
import {
  commitGroupSocialInitiationStarted,
  createGroupSocialInitiationTx,
  loadGroupSocialInitiationReceipt,
  prepareGroupSocialInitiationStart,
  respondGroupSocialInitiationTx,
} from '../groupSocialInitiations';
import { socialWarrantCandidateDigest, validateSocialWarrant } from '../socialWarrantContracts';
import {
  prepareSocialOutcomeBinding,
  type SocialOutcomeBinding,
} from '../socialOutcomeContracts';
import {
  beginSocialOutcomeTx,
  bindGroupConversationSocialOutcomeTx,
  ensureSocialOutcomeEventTx,
  groupSocialOutcomePendingTx,
  groupSocialOutcomeBinding,
  insertDerivedSocialConsequencesTx,
  settleActionSocialOutcomeTx,
  settleConversationSocialOutcomeTx,
  settleGroupSocialOutcomeTx,
  settleSocialOutcomeTx,
  socialOutcomeScopeAvailable,
} from '../socialOutcomeReceipts';
import { deriveGrievanceSocialConsequenceDraft } from '../socialConsequenceContracts';
import {
  domainOutcomeEvidenceIdempotencyKey,
  projectDomainOutcomeEvidence,
} from '../runtimeDomainOutcomeEvidencePort';
import { admitRelationshipMemoryOutcome } from '../relationshipMemoryOutcomeAdmissionLogic';
import { loadProfile } from './life/profile';
import { autoAdvanceLayers } from './cultivation/progression';
import {
  activeResourceReservationQuantity,
  loadResourceNode,
  refreshResourceNodeDocument,
} from './resources/repository';
import {
  activeInventoryReservationQuantity,
  activeTargetItemReservationQuantity,
} from './inventory/repository';
import {
  parseGroupVoteChoice,
  parseSocialInvitationActivity,
} from './social/parsers';
import { combatOpponent, encounterHasPair } from './conflict/encounters';

export { loadProfile } from './life/profile';
export { autoAdvanceLayers } from './cultivation/progression';
export { addToInventory } from './inventory/repository';

// 动作系统的统一入口（M2 起，M3 接齐 8 动作）。玩家与 Agent 都经由 submitAction 提交；
// resolver 校验 → 装载状态 → 跑确定性规则 → 应用 effects（含物品转移）→ 写事件 → 落 actionRecord。
// 移动（travel）仍复用 AI Town 的 moveTo，未在此实现。
// 依据：docs/xianxia-blueprint.md §8、§14.3、§18。

export const submitAction = internalMutation({
  // gmVerdict 仅 steal 用：由 gm.act 预先算好传入，这里再钳一次（纵深防御）。
  args: {
    ...actionEnvelopeArgs,
    gmVerdict: v.optional(gmVerdictValidator),
    purposeGoalFence: v.optional(purposeGoalFenceValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const requestMetadata = objectOrEmpty(args.metadata);
    const requestMapId =
      typeof requestMetadata.mapId === 'string' ? requestMetadata.mapId : undefined;
    const clientActionFingerprint = args.clientActionId
      ? actionIdempotencyFingerprint(args)
      : undefined;
    if (args.purposeGoalFence) {
      if (args.source !== 'agent') {
        throw new Error('purpose_goal_causal_fence_mismatch');
      }
      const goal = await ctx.db
        .query('personalGoals')
        .withIndex('byGoal', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('goalId', args.purposeGoalFence!.goalId),
        )
        .unique();
      if (
        !goal ||
        !purposeGoalCausalFenceMatches({
          fence: args.purposeGoalFence,
          goal,
          actorId: args.actorId,
          actionType: args.type,
          targetId: args.targetId,
          targetActorId: args.targetActorId,
          locationId: args.locationId,
          params: objectOrEmpty(args.params),
        })
      ) {
        throw new Error('purpose_goal_causal_fence_mismatch');
      }
    }
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
        if (
          (existing.personalGoalId !== undefined) !==
            (args.purposeGoalFence !== undefined) ||
          (args.purposeGoalFence &&
            (existing.personalGoalId !== args.purposeGoalFence.goalId ||
              existing.personalGoalRevision !== args.purposeGoalFence.revision ||
              existing.purposeIntentDigest !== args.purposeGoalFence.intentDigest))
        ) {
          throw new Error('purpose_goal_causal_fence_mismatch');
        }
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
      personalGoalId: args.purposeGoalFence?.goalId,
      personalGoalRevision: args.purposeGoalFence?.revision,
      purposeIntentDigest: args.purposeGoalFence?.intentDigest,
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
    let profile = await loadProfile(ctx, args.worldId, args.actorId);
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
    if (await ensureIncapacitationRecovery(ctx, profile, now)) {
      profile = (await loadProfile(ctx, args.worldId, args.actorId))!;
    }

    const seed = `${args.worldId}_${args.actorId}_${args.type}_${now}`;
    const roll = seededRoll(seed);
    const params = (args.params ?? {}) as Record<string, unknown>;
    const requestedRecoveryToken =
      typeof params.recoveryToken === 'string' ? params.recoveryToken : undefined;
    const lifeGate = evaluateLifeActionGate({
      health: profile.health,
      lifeStatus: profile.lifeStatus,
      actionType: args.type,
      source: args.source,
      now,
      recoveryEligibleAt: profile.recoveryEligibleAt,
      recoveryToken: profile.recoveryToken,
      requestedRecoveryToken,
    });
    if (!lifeGate.ok) {
      const negotiationInvalidationPlan =
        args.type === 'negotiate'
          ? await prepareNegotiationInvalidation(ctx, {
              worldId: args.worldId,
              negotiationId:
                typeof params.negotiationId === 'string' ? params.negotiationId : undefined,
              actorId: args.actorId,
              reasonCode: lifeGate.resultCode,
              reason: lifeGate.reason,
            })
          : undefined;
      const finalized = await finalize(
        ctx,
        actionRecordId,
        args,
        now,
        { seed, roll, profile },
        negotiationInvalidationPlan
          ? negotiationInvalidationResult(lifeGate.resultCode, lifeGate.reason)
          : reject(lifeGate.resultCode, lifeGate.reason),
        negotiationInvalidationPlan?.facts,
      );
      if (negotiationInvalidationPlan) {
        await commitNegotiationInvalidation(ctx, {
          plan: negotiationInvalidationPlan,
          actionRecordId,
          eventId: finalized.eventId,
          now,
        });
      }
      return finalized;
    }
    const fatigueGate = evaluateFatigueActionGate(profile.fatigue, args.type);
    if (!fatigueGate.ok) {
      return await finalize(
        ctx,
        actionRecordId,
        args,
        now,
        { seed, roll, profile },
        reject(fatigueGate.resultCode, fatigueGate.reason),
      );
    }

    // 2.5) NPC 行为白名单硬校验（M1 §2.3）：守卫不偷、掌柜不探索…。
    // travel/arrive 是通用移动/抵达，recover 是系统生命流程，三者豁免身份闸门。
    if (
      !['travel', 'arrive', 'recover'].includes(args.type) &&
      !roleAllows(profile.role, args.type)
    ) {
      return await finalize(ctx, actionRecordId, args, now, null, {
        status: 'rejected',
        resultCode: 'role_not_allowed',
        reason: `${profile.name}身为${profile.role}，不会行此事。`,
        effects: {},
        eventType: 'action_rejected',
        visibility: 'private',
      });
    }

    // C004：持续身体动作占用角色。移动是明确的打断源；其他普通动作不能在
    // acting 期间偷偷并行。过期 lease 会先被收束为无收益中断。
    const activeExecution = await findActiveActionExecution(ctx, args.worldId, args.actorId, now);
    if (activeExecution && !['travel', 'arrive', 'recover'].includes(args.type)) {
      return await finalize(
        ctx,
        actionRecordId,
        args,
        now,
        { seed, roll, profile },
        reject('action_execution_busy', `${profile.name}正在执行另一项持续身体动作。`),
      );
    }

    // 3) 按类型分派裁决。
    const finalSpatialIssue = await loadFinalGodotSpatialIssue(ctx, args, profile, requestMetadata);
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
    const currentGameTime = clockStartedAt === null ? null : gameTimeAt(now, clockStartedAt);
    const phaseMods = currentGameTime === null ? undefined : phaseModifiers(currentGameTime.phase);
    const actionGameHour = currentGameTime?.totalHours ?? await readGameHour(ctx, args.worldId, now);
    const actionGameDay = Math.floor(actionGameHour / 24);
    const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
    const exactQty = (k: string) => {
      const raw = params[k];
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      return Number.isFinite(value) ? value : undefined;
    };
    const actor = toActorSnapshot(profile);
    let result: ActionResult;
    let executionGoal: ActionExecutionGoal | undefined;
    let finalEventFacts: DurableEventFacts | undefined;
    let questRelationshipReward:
      | { issuerActorId: string; trust: number; debt: number }
      | undefined;
    let requestTransitionPlan:
      | {
          request: Doc<'requests'>;
          fromStatus: RequestStatus;
          toStatus: RequestStatus;
          expectedRevision: number;
          nowGameHour: number;
          patch?: RequestTransitionPatch;
        }
      | undefined;
    let conversationStartPlan: ConversationStartPlan | undefined;
    let conversationTurnPlan: PreparedConversationTurn | undefined;
    let conversationExpiredSession: Doc<'conversationSessions'> | undefined;
    let conversationSessionBinding:
      | {
          operation: ConversationSessionOperation;
          sessionRef: string;
          sourceRevision: number;
        }
      | undefined;
    let negotiationPlan: NegotiationCommitPlan | undefined;
    let negotiationInvalidationPlan: NegotiationInvalidationPlan | undefined;
    let groupConversationStartPlan: GroupConversationStartPlan | undefined;
    let groupConversationTurnPlan: PreparedGroupConversationTurn | undefined;
    let groupConversationTerminalPlan: GroupConversationTerminalPlan | undefined;
    let groupDecisionPlan: GroupDecisionCommitPlan | undefined;
    let finalEventAudience:
      | { targetActorIds?: string[]; witnessActorIds?: string[] }
      | undefined;
    let portalTransitionPlan: PreparedValleyPortalTransition | undefined;
    let directSocialOutcomeBinding: SocialOutcomeBinding | undefined;
    let acceptedSocialInvitationConversationLink:
      | { invitationId: string; revision: number }
      | undefined;
    let groupSocialOutcomeOpeningBinding: SocialOutcomeBinding | undefined;
    let groupSocialOutcomeStartBinding: SocialOutcomeBinding | undefined;
    let groupSocialOutcomeTerminalBinding: SocialOutcomeBinding | undefined;
    let groupSocialOutcomeTerminalStatus: 'cancelled' | 'expired' | undefined;

    switch (args.type) {
      case 'invite_social': {
        if (!args.targetActorId) {
          result = reject('target_required', '跨地点邀请需要指定目标角色。');
          break;
        }
        const warrantValidation = validateSocialWarrant(params.socialWarrant);
        const candidateId = str('socialCandidateId');
        const activity = parseSocialInvitationActivity(params.intendedActivity);
        const summary = str('summary') ?? args.intent;
        if (!warrantValidation.ok || !candidateId || !activity || !summary) {
          result = reject(
            'social_invitation_contract_invalid',
            '邀请缺少合法的 warrant、candidate、活动或摘要。',
          );
          break;
        }
        const created = await createSocialInvitationTx(ctx, {
          worldId: args.worldId,
          actorId: args.actorId,
          targetActorId: args.targetActorId,
          warrant: warrantValidation.warrant,
          candidateId,
          intendedActivity: activity,
          summary,
          now,
        });
        if (!created.ok) {
          result = reject(created.reasonCode, '当前邀请无法建立。');
          break;
        }
        if (created.replay) {
          result = reject(
            'social_invitation_already_active',
            '相同原因的邀请已经在等待或执行中。',
          );
          break;
        }
        conversationSessionBinding = {
          operation: 'invite',
          sessionRef: created.receipt.invitationId,
          sourceRevision: created.receipt.revision,
        };
        result = {
          status: 'applied',
          resultCode: 'social_invitation_pending',
          reason: `${profile.name}向${args.targetActorId}发出一次有原因的会面邀请。`,
          effects: {},
          eventType: 'social_invitation_created',
          visibility: 'private',
        };
        finalEventAudience = { targetActorIds: [args.targetActorId] };
        finalEventFacts = versionDurableEventFacts({
          resultCode: result.resultCode,
          reasonCode: created.receipt.invitationId,
        });
        break;
      }
      case 'respond_social_invitation': {
        const invitationId = str('socialInvitationId');
        const expectedRevision = exactInteger(params.expectedRevision);
        const response = params.response === 'accept' || params.response === 'decline'
          ? params.response
          : undefined;
        if (!invitationId || expectedRevision === undefined || !response) {
          result = reject(
            'social_invitation_response_invalid',
            '回应邀请需要 invitationId、revision 与 accept/decline。',
          );
          break;
        }
        const responded = await respondToSocialInvitationTx(ctx, {
          worldId: args.worldId,
          invitationId,
          targetActorId: args.actorId,
          expectedRevision,
          response,
          now,
        });
        if (!responded.ok) {
          result = reject(responded.reasonCode, '这次邀请已经不能按当前回应继续。');
          break;
        }
        conversationSessionBinding = {
          operation: response === 'accept' ? 'accept' : 'refuse',
          sessionRef: responded.receipt.invitationId,
          sourceRevision: responded.receipt.revision,
        };
        result = {
          status: 'applied',
          resultCode: response === 'accept'
            ? 'social_invitation_accepted'
            : 'social_invitation_declined',
          reason: response === 'accept'
            ? `${profile.name}接受了这次有界会面邀请。`
            : `${profile.name}拒绝了这次会面邀请。`,
          effects: {},
          eventType: response === 'accept'
            ? 'social_invitation_accepted'
            : 'social_invitation_declined',
          visibility: 'private',
        };
        finalEventAudience = { targetActorIds: [responded.receipt.actorId] };
        finalEventFacts = versionDurableEventFacts({
          resultCode: result.resultCode,
          reasonCode: responded.receipt.invitationId,
        });
        break;
      }
      case 'cultivate': {
        const location = await resolveLocation(ctx, args, profile);
        const cultivationMode = parseCultivationMode(params.cultivationMode);
        const candidate = location
          ? resolveCultivate({
              actor,
              location: toLocationSnapshot(location),
              roll,
              phaseMods,
              cultivationMode: params.cultivationMode,
            })
          : reject('unknown_location', '未指定有效的修炼地点。');
        const resource = cultivationMode ? cultivationResourceForMode(cultivationMode) : null;
        let resourceAvailable = true;
        if (resource && cultivationMode) {
          const reserved = await activeInventoryReservationQuantity(
            ctx,
            args.worldId,
            args.actorId,
            resource.itemId,
            now,
          );
          resourceAvailable = cultivationModeAvailable(cultivationMode, profile.inventory, reserved);
        }
        const admission = admitTimedAction({ actionType: 'cultivate', profileName: profile.name, profileMapId: profile.mapId, intent: args.intent, candidate, location: location ? { locationId: location.locationId, name: location.name } : undefined, cultivationMode: cultivationMode ?? undefined, resource: resource ?? undefined, resourceAvailable });
        result = admission.result;
        if (admission.execution) executionGoal = await createPendingActionExecution(ctx, { worldId: args.worldId, actionRecordId, actorId: args.actorId, source: args.source, now, ...admission.execution });
        break;
      }
      case 'gather': {
        const resourceNodeId = str('resourceNodeId');
        const location = await resolveLocation(ctx, args, profile);
        const resourceNode = resourceNodeId ? await loadResourceNode(ctx, args.worldId, resourceNodeId) : null;
        const actorTile = readGodotTile(requestMetadata.actorTile);
        const refreshed = resourceNode ? await refreshResourceNodeDocument(ctx, resourceNode, now) : null;
        const reserved = resourceNodeId ? await activeResourceReservationQuantity(ctx, args.worldId, resourceNodeId) : 0;
        const admission = admitTimedAction({ actionType: 'gather', profileName: profile.name, profileMapId: profile.mapId, intent: args.intent, resourceNodeId, location: location ? { locationId: location.locationId, allowsGather: location.allowedActions.includes('gather') } : undefined, resourceNode: resourceNode ? { name: resourceNode.name, mapId: resourceNode.mapId, locationId: resourceNode.locationId } : undefined, accessAllowed: resourceNode ? resourceAccessAllowed(resourceNode, args.actorId) : false, withinGodotRange: requestMetadata.client !== 'godot' || Boolean(actorTile && resourceNode && godotTileDistance(actorTile, resourceNode.tile) <= 2), stock: refreshed?.stock ?? 0, availableStock: refreshed ? availableResourceStock(refreshed.stock, reserved) : 0 });
        result = admission.result;
        if (admission.execution) executionGoal = await createPendingActionExecution(ctx, { worldId: args.worldId, actionRecordId, actorId: args.actorId, source: args.source, now, ...admission.execution });
        break;
      }
      case 'rest': {
        const location = await resolveLocation(ctx, args, profile);
        const admission = admitTimedAction({ actionType: 'rest', profileName: profile.name, profileMapId: profile.mapId, intent: args.intent, location: location ? { locationId: location.locationId, name: location.name, allowsRest: location.allowedActions.includes('rest') } : undefined });
        result = admission.result;
        if (admission.execution) executionGoal = await createPendingActionExecution(ctx, { worldId: args.worldId, actionRecordId, actorId: args.actorId, source: args.source, now, ...admission.execution });
        break;
      }
      case 'explore': {
        const location = await resolveLocation(ctx, args, profile);
        const candidate = location
          ? resolveExplore({ actor, location: toLocationSnapshot(location), roll, phaseMods })
          : reject('unknown_location', '未指定有效的探索地点。');
        result = admitExplore({ locationKnown: Boolean(location), candidate });
        break;
      }
      case 'inspect': {
        const interactionId = str('interactionId');
        if (!interactionId) {
          result = reject(
            'inspect_target_required',
            '查看交互物需要 params.interactionId。',
          );
          break;
        }
        const preparedInspection = await prepareValleyInspection(ctx, {
          worldId: args.worldId,
          actorId: args.actorId,
          profile,
          interactionId,
          reportedTile: readGodotTile(requestMetadata.actorTile),
        });
        if (!preparedInspection.ok) {
          result = reject(preparedInspection.reasonCode, preparedInspection.reason);
          break;
        }
        result = preparedInspection.result;
        finalEventFacts = preparedInspection.eventFacts;
        break;
      }
      case 'breakthrough': {
        const location = await resolveLocation(ctx, args, profile);
        const reserved = await activeInventoryReservationQuantity(
          ctx,
          args.worldId,
          args.actorId,
          BREAKTHROUGH_MATERIAL_ITEM_ID,
          now,
        );
        const progress = evaluateBreakthroughProgress({
          realm: profile.realm,
          realmEnteredAt: profile.realmEnteredAt,
          profileCreatedAt: profile._creationTime,
          breakthroughRecoveryUntil: profile.breakthroughRecoveryUntil,
          inventory: profile.inventory,
          materialReserved: reserved,
          now,
        });
        // A completed failure deliberately lowers XP. Surface the still-active
        // recovery window first so an immediate retry has one stable reason;
        // all other structural and XP gates remain owned by resolveBreakthrough.
        const candidate = location
          ? resolveBreakthrough({
              actor,
              location: toLocationSnapshot(location),
              roll,
              mishapRoll: seededRoll(seed + ':mishap'),
            })
          : reject('unknown_location', '未指定突破发生的地点。');
        const admission = admitBreakthrough({
          recoveryFailure: progress.resultCode === 'breakthrough_recovery_active' ? { resultCode: progress.resultCode, reason: progress.reason! } : undefined,
          candidate,
          progressFailure: !progress.ok && progress.resultCode !== 'breakthrough_recovery_active' ? { resultCode: progress.resultCode!, reason: progress.reason! } : undefined,
        });
        if (!admission.ok || !location) {
          result = admission.ok ? candidate : admission.result;
          break;
        }
        executionGoal = await createPendingActionExecution(ctx, {
          worldId: args.worldId,
          actionRecordId,
          actorId: args.actorId,
          actionType: args.type,
          source: args.source,
          mapId: profile.mapId,
          locationId: location.locationId,
          reservedItemId: progress.materialItemId,
          reservedItemQuantity: progress.materialQuantity,
          intent: args.intent ?? `在${location.name}尝试突破境界`,
          durationMs: BREAKTHROUGH_EXECUTION_DURATION_MS,
          now,
        });
        result = {
          status: 'applied',
          resultCode: 'action_execution_started',
          reason: `${profile.name}在${location.name}开始冲关，完成前只预约 ${progress.materialQuantity} 枚灵石。`,
          effects: {},
          eventType: 'action_execution_started',
          visibility: 'local',
        };
        break;
      }
      case 'recover': {
        result = {
          status: 'applied',
          resultCode: 'actor_recovered',
          reason: `${profile.name}的伤势初步稳定，恢复了最低行动能力。`,
          effects: { health: 1 },
          eventType: 'actor_recovered',
          visibility: 'local',
        };
        break;
      }
      case 'use_item': {
        const itemId = str('itemId');
        const admission = admitUseItem({ targetActorId: args.targetActorId, itemId });
        result = admission.ok ? resolveUseItem({ actor, itemId: admission.itemId }) : admission.result;
        break;
      }
      case 'attack': {
        const targetDoc = args.targetActorId
          ? await loadProfile(ctx, args.worldId, args.targetActorId)
          : null;
        const targetGate = targetDoc ? evaluateTargetLifeGate({
          health: targetDoc.health,
          lifeStatus: targetDoc.lifeStatus,
          actionType: 'attack',
          targetName: targetDoc.name,
        }) : undefined;
        const location = await resolveLocation(ctx, args, profile);
        const admission = admitAttack({
          actorId: args.actorId,
          targetActorId: args.targetActorId,
          target: targetDoc ? { name: targetDoc.name } : undefined,
          targetLifeFailure: targetGate && !targetGate.ok
            ? { resultCode: targetGate.resultCode, reason: targetGate.reason }
            : undefined,
          attackAllowed: Boolean(location?.allowedActions.includes('attack')),
          sameLocation: Boolean(targetDoc && actorsShareLocation(profile, targetDoc, args.locationId)),
        });
        if (!admission.ok || !targetDoc || !location || !args.targetActorId) {
          result = admission.ok ? reject('target_not_found', '攻击目标不可用。') : admission.result;
          break;
        }
        const actorEncounter = await loadActiveCombatEncounterForActor(
          ctx,
          args.worldId,
          args.actorId,
        );
        const targetEncounter = await loadActiveCombatEncounterForActor(
          ctx,
          args.worldId,
          args.targetActorId,
        );
        let encounter = actorEncounter ?? targetEncounter;
        if (
          encounter &&
          !encounterHasPair(encounter, args.actorId, args.targetActorId)
        ) {
          result = reject('combat_busy', '其中一方已卷入另一场尚未结束的冲突。');
          break;
        }
        if (!encounter) {
          const observers = await currentCombatObservers(
            ctx,
            args.worldId,
            profile,
            [args.actorId, args.targetActorId],
          );
          const encounterId = `combat:${String(actionRecordId)}`;
          const id = await ctx.db.insert('combatEncounters', {
            worldId: args.worldId,
            encounterId,
            attackerActorId: args.actorId,
            defenderActorId: args.targetActorId,
            mapId: profile.mapId ?? 'world',
            locationId: location.locationId,
            status: 'active',
            witnessActorIds: observers.witnessActorIds,
            guardActorIds: observers.guardActorIds,
            initiatedByActionId: actionRecordId,
            startedAt: now,
            updatedAt: now,
          });
          encounter = await ctx.db.get(id);
        }
        if (!encounter) throw new Error('combat_encounter_invariant: encounter insert failed.');
        executionGoal = await createPendingActionExecution(ctx, {
          worldId: args.worldId,
          actionRecordId,
          actorId: args.actorId,
          actionType: args.type,
          source: args.source,
          mapId: profile.mapId,
          locationId: location.locationId,
          targetActorId: args.targetActorId,
          encounterId: encounter.encounterId,
          intent: args.intent ?? `向${targetDoc.name}发起攻击`,
          durationMs: ATTACK_EXECUTION_DURATION_MS,
          now,
        });
        result = {
          status: 'applied',
          resultCode: 'action_execution_started',
          reason: `${profile.name}向${targetDoc.name}发起攻击，伤害将在身体动作完成后裁决。`,
          effects: {},
          eventType: 'combat_attack_started',
          visibility: 'local',
        };
        break;
      }
      case 'flee': {
        const encounter = await loadActiveCombatEncounterForActor(
          ctx,
          args.worldId,
          args.actorId,
        );
        const opponentActorId = encounter ? combatOpponent(encounter, args.actorId) : undefined;
        const opponent = opponentActorId
          ? await loadProfile(ctx, args.worldId, opponentActorId)
          : null;
        const admission = admitFlee({
          hasEncounter: Boolean(encounter),
          opponent: opponent ? { actorId: opponent.actorId, name: opponent.name } : undefined,
          sameLocation: Boolean(opponent && actorsShareLocation(profile, opponent, args.locationId)),
        });
        if (!admission.ok || !encounter) {
          result = admission.ok ? reject('flee_not_in_combat', '角色当前不在可逃离的冲突中。') : admission.result;
          break;
        }
        executionGoal = await createPendingActionExecution(ctx, {
          worldId: args.worldId,
          actionRecordId,
          actorId: args.actorId,
          actionType: args.type,
          source: args.source,
          mapId: profile.mapId,
          locationId: profile.currentLocationId,
          targetActorId: admission.opponent.actorId,
          encounterId: encounter.encounterId,
          intent: args.intent ?? `试图脱离与${admission.opponent.name}的冲突`,
          durationMs: FLEE_EXECUTION_DURATION_MS,
          now,
        });
        result = {
          status: 'applied',
          resultCode: 'action_execution_started',
          reason: `${profile.name}开始寻找脱离冲突的机会。`,
          effects: {},
          eventType: 'combat_flee_started',
          visibility: 'local',
        };
        break;
      }
      case 'loot': {
        const itemId = str('itemId');
        const targetDoc = args.targetActorId ? await loadProfile(ctx, args.worldId, args.targetActorId) : null;
        const encounter = targetDoc && args.targetActorId ? await loadDefeatEncounter(ctx, args.worldId, args.targetActorId, profile.mapId ?? 'world', profile.currentLocationId!) : null;
        const priorityAllowed = Boolean(encounter && lootPriorityAllows({
            actorId: args.actorId,
            lootOwnerActorId: encounter.lootOwnerActorId,
            lootProtectedUntil: encounter.lootProtectedUntil,
            now,
          }));
        const reserved = targetDoc && args.targetActorId && itemId ? await activeTargetItemReservationQuantity(ctx, args.worldId, args.targetActorId, itemId, now) : 0;
        const admission = admitLoot({ actorId: args.actorId, targetActorId: args.targetActorId, itemId, target: targetDoc ? { name: targetDoc.name, incapacitated: isActorIncapacitated(targetDoc.health) } : undefined, sameLocation: Boolean(targetDoc && actorsShareLocation(profile, targetDoc, args.locationId)), defeatEncounterId: encounter?.encounterId, priorityAllowed, itemAvailable: Boolean(targetDoc && itemId && inventoryHasUnreservedTargetItem(targetDoc.inventory, itemId, reserved)) });
        if (!admission.ok) {
          result = admission.result;
          break;
        }
        executionGoal = await createPendingActionExecution(ctx, {
          worldId: args.worldId,
          actionRecordId,
          actorId: args.actorId,
          actionType: args.type,
          source: args.source,
          mapId: profile.mapId,
          locationId: profile.currentLocationId,
          targetActorId: args.targetActorId,
          encounterId: admission.encounterId,
          reservedTargetItemId: admission.itemId,
          reservedTargetItemQuantity: 1,
          intent: args.intent ?? `从${admission.target.name}处取走一件战利品`,
          durationMs: LOOT_EXECUTION_DURATION_MS,
          now,
        });
        result = {
          status: 'applied',
          resultCode: 'action_execution_started',
          reason: `${profile.name}开始取走${admission.target.name}的一件「${admission.itemId}」，完成前不转移物品。`,
          effects: {},
          eventType: 'combat_loot_started',
          visibility: 'local',
        };
        break;
      }
      case 'accept_request':
      case 'decline_request':
      case 'turn_in_request': {
        const requestId = str('requestId');
        if (!requestId) {
          result = reject('request_not_found', '委托动作需要 params.requestId。');
          break;
        }
        const request = await ctx.db.get(requestId as Id<'requests'>);
        if (!request || request.worldId !== args.worldId) {
          result = reject('request_not_found', '找不到这桩委托。');
          break;
        }
        const currentRequestRevision = requestRevision(request);
        const expectedRequestRevision = exactQty('expectedRevision');
        if (args.type === 'decline_request' && expectedRequestRevision === undefined) {
          result = reject('request_revision_required', '拒绝委托必须携带当前 expectedRevision。');
          break;
        }
        if (
          expectedRequestRevision !== undefined &&
          !requestRevisionMatches(request, expectedRequestRevision)
        ) {
          result = reject(
            'request_stale_revision',
            `委托已从 revision ${expectedRequestRevision} 变化为 ${currentRequestRevision}。`,
          );
          break;
        }
        if (request.assigneeActorId !== args.actorId) {
          result = reject('request_not_assignee', '只有这桩委托的受托人可以作出决定或交付。');
          break;
        }
        if (args.targetActorId !== request.issuerActorId) {
          result = reject('request_issuer_mismatch', '委托必须当面向原发起者答复或交付。');
          break;
        }
        const issuer = await loadProfile(ctx, args.worldId, request.issuerActorId);
        if (!issuer) {
          result = reject('request_issuer_unavailable', '委托发起者已经无法确认此事。');
          break;
        }
        const issuerLife = evaluateTargetLifeGate({
          health: issuer.health,
          lifeStatus: issuer.lifeStatus,
          actionType: args.type,
          targetName: issuer.name,
        });
        if (!issuerLife.ok) {
          result = reject(issuerLife.resultCode, issuerLife.reason);
          break;
        }
        if (!actorsShareLocation(profile, issuer, args.locationId)) {
          result = reject('target_not_present', `${issuer.name}不在身边，无法当面处理委托。`);
          break;
        }
        const requestLocation = profile.currentLocationId
          ? await loadLocation(ctx, args.worldId, profile.currentLocationId)
          : null;
        if (
          !requestLocation ||
          !requestLocation.allowedActions.includes('talk') ||
          (requestLocation.mapId ?? 'world') !== (profile.mapId ?? 'world')
        ) {
          result = reject(
            'location_forbids_request_response',
            '当前地点不允许当面答复委托。',
          );
          break;
        }
        const nowGameHour = await readGameHour(ctx, args.worldId, now);
        if (isRequestExpired(request, nowGameHour)) {
          requestTransitionPlan = {
            request,
            fromStatus: request.status as RequestStatus,
            toStatus: 'expired',
            expectedRevision: currentRequestRevision,
            nowGameHour,
          };
          result = {
            status: 'rejected',
            resultCode: 'request_expired',
            reason: '这桩委托已经超过期限。',
            effects: {},
            eventType: 'request_expired',
            visibility: 'private',
          };
          finalEventFacts = versionDurableEventFacts({
            resultCode: 'request_expired',
            requestType: request.type,
            requestId: String(request._id),
            requestStatus: 'expired',
            fromStatus: request.status,
            toStatus: 'expired',
            requestRevision: currentRequestRevision + 1,
            sourceGameHour: nowGameHour,
          });
          break;
        }
        if (args.type === 'accept_request') {
          if (request.status !== 'offered') {
            result = reject('request_not_offered', '这桩委托已不在等待答复的状态。');
            break;
          }
          requestTransitionPlan = {
            request,
            fromStatus: 'offered',
            toStatus: 'accepted',
            expectedRevision: currentRequestRevision,
            nowGameHour,
            patch: { acceptedAt: now },
          };
          result = {
            status: 'applied',
            resultCode: 'request_accepted',
            reason: `${profile.name}当面接受了${issuer.name}的委托：${request.summary}`,
            effects: {},
            eventType: 'request_accepted',
            visibility: 'local',
          };
          finalEventFacts = versionDurableEventFacts({
            resultCode: 'request_accepted',
            requestType: request.type,
            requestId: String(request._id),
            requestStatus: 'accepted',
            fromStatus: 'offered',
            toStatus: 'accepted',
            requestRevision: currentRequestRevision + 1,
            sourceGameHour: nowGameHour,
          });
          break;
        }
        if (args.type === 'decline_request') {
          if (request.status !== 'offered') {
            result = reject('request_not_offered', '这桩委托已不在等待答复的状态。');
            break;
          }
          executionGoal = await createPendingActionExecution(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actorId: args.actorId,
            actionType: args.type,
            source: args.source,
            mapId: profile.mapId,
            locationId: profile.currentLocationId,
            targetActorId: issuer.actorId,
            requestId: request._id,
            requestRevision: currentRequestRevision,
            intent: args.intent ?? `当面婉拒${issuer.name}的委托`,
            durationMs: REQUEST_DECLINE_EXECUTION_DURATION_MS,
            now,
          });
          result = {
            status: 'applied',
            resultCode: 'action_execution_started',
            reason: `${profile.name}开始当面答复${issuer.name}，委托尚未变更。`,
            effects: {},
            eventType: 'request_decline_started',
            visibility: 'local',
          };
          break;
        }
        if (request.status !== 'ready_to_turn_in') {
          result = reject('request_not_ready', '这桩委托尚未达到可交付状态。');
          break;
        }
        const requirementReady = requestRequirementReady(
          request.type as RequestType,
          request.requirements as Requirements,
          { inventory: profile.inventory, currentLocationId: profile.currentLocationId },
          request.fulfilledAt,
        );
        if (!requirementReady) {
          if (request.type === 'collect_item') {
            requestTransitionPlan = {
              request,
              fromStatus: 'ready_to_turn_in',
              toStatus: 'accepted',
              expectedRevision: currentRequestRevision,
              nowGameHour,
              patch: { readyAt: undefined },
            };
          }
          result = reject('request_requirement_lost', '交付前复核发现所需物品已不在行囊中。');
          finalEventFacts = versionDurableEventFacts({
            resultCode: 'request_requirement_lost',
            requestType: request.type,
            requestId: String(request._id),
            requestStatus: request.type === 'collect_item' ? 'accepted' : request.status,
            fromStatus: request.status,
            toStatus: request.type === 'collect_item' ? 'accepted' : request.status,
            requestRevision:
              request.type === 'collect_item'
                ? currentRequestRevision + 1
                : currentRequestRevision,
            sourceGameHour: nowGameHour,
          });
          break;
        }
        const deliveredQty = request.requirements.qty ?? 1;
        const deliveredItemId = request.requirements.itemId;
        const rewardItems = request.rewards.items ?? [];
        const itemEffects: ItemTransfer[] = [];
        if (request.type === 'collect_item' && deliveredItemId) {
          itemEffects.push({ from: args.actorId, itemId: deliveredItemId, qty: deliveredQty });
        }
        for (const reward of rewardItems) {
          itemEffects.push({ to: args.actorId, itemId: reward.itemId, qty: reward.qty });
        }
        requestTransitionPlan = {
          request,
          fromStatus: 'ready_to_turn_in',
          toStatus: 'completed',
          expectedRevision: currentRequestRevision,
          nowGameHour,
          patch: { completedAt: now },
        };
        result = {
          status: 'applied',
          resultCode: 'request_completed',
          reason: `${profile.name}向${issuer.name}交付了委托：${request.summary}`,
          effects: {
            cultivationXp: request.rewards.cultivationXp,
            items: itemEffects,
          },
          eventType: 'request_resolved',
          visibility: 'local',
        };
        questRelationshipReward = {
          issuerActorId: issuer.actorId,
          trust: request.rewards.trust ?? 0,
          debt: request.rewards.debt ?? 0,
        };
        finalEventFacts = versionDurableEventFacts({
          resultCode: 'request_completed',
          requestType: request.type,
          requestId: String(request._id),
          requestStatus: 'completed',
          fromStatus: 'ready_to_turn_in',
          toStatus: 'completed',
          requestRevision: currentRequestRevision + 1,
          sourceGameHour: nowGameHour,
          deliveredItemId,
          deliveredQty: deliveredItemId ? deliveredQty : undefined,
          rewardSourceId: `request_reward:${String(request._id)}`,
          rewardCultivationXp: request.rewards.cultivationXp,
          rewardItems,
        });
        break;
      }
      case 'group_talk': {
        const operation = str('operation') ?? (str('groupConversationId') ? 'speak' : 'start');
        if (operation === 'invite') {
          const candidateId = str('candidateId');
          if (!candidateId) {
            result = reject('missing_param', '群体邀请需要服务器派生的 candidateId。');
            break;
          }
          const created = await createGroupSocialInitiationTx(ctx, {
            worldId: args.worldId,
            actorId: args.actorId,
            candidateId,
            now,
          });
          if (!created.ok) {
            result = reject(created.reasonCode, '当前共同事实不足以建立群体邀请。');
            break;
          }
          if (created.replay) {
            result = reject('group_social_session_conflict', '相同来源的群体邀请已存在。');
            break;
          }
          groupSocialOutcomeOpeningBinding = groupSocialOutcomeBinding(created.receipt);
          result = {
            status: 'applied',
            resultCode: 'group_social_invitation_pending',
            reason: `${profile.name}基于共同事实发起了一次有界群体邀请。`,
            effects: {},
            eventType: 'group_social_invitation_created',
            visibility: created.receipt.audience === 'local_public' ? 'local' : 'private',
          };
          finalEventAudience = {
            targetActorIds: created.receipt.participantActorIds.filter((id) => id !== args.actorId),
            witnessActorIds: created.receipt.observerActorIds,
          };
          finalEventFacts = versionDurableEventFacts({
            resultCode: result.resultCode,
            migration: created.receipt.initiationId,
          });
        } else if (operation === 'respond_invitation') {
          const initiationId = str('initiationId');
          const expectedRevision = exactInteger(params.expectedRevision);
          const response = params.response === 'accept' || params.response === 'decline'
            ? params.response
            : undefined;
          if (!initiationId || expectedRevision === undefined || !response) {
            result = reject('missing_param', '回应群体邀请需要 initiationId、revision 与 accept/decline。');
            break;
          }
          const responded = await respondGroupSocialInitiationTx(ctx, {
            worldId: args.worldId,
            initiationId,
            actorId: args.actorId,
            expectedRevision,
            response,
            now,
          });
          if (!responded.ok) {
            const terminalReceipt = await loadGroupSocialInitiationReceipt(
              ctx, args.worldId, initiationId,
            );
            if (terminalReceipt && ['cancelled', 'expired'].includes(terminalReceipt.status)) {
              groupSocialOutcomeTerminalBinding = groupSocialOutcomeBinding(
                terminalReceipt,
              );
              groupSocialOutcomeTerminalStatus = terminalReceipt.status === 'expired'
                ? 'expired'
                : 'cancelled';
            }
            result = reject(responded.reasonCode, '这次群体邀请已经不能按当前回应继续。');
            break;
          }
          if (responded.replay) {
            result = reject('group_social_terminal_replay', '这名成员已经提交过相同回应。');
            break;
          }
          result = {
            status: 'applied',
            resultCode: response === 'accept'
              ? 'group_social_invitation_accepted'
              : 'group_social_invitation_declined',
            reason: response === 'accept'
              ? `${profile.name}接受了这次群体商议邀请。`
              : `${profile.name}拒绝了这次群体商议邀请。`,
            effects: {},
            eventType: response === 'accept'
              ? 'group_social_invitation_accepted'
              : 'group_social_invitation_declined',
            visibility: 'private',
          };
          finalEventAudience = { targetActorIds: [responded.receipt.hostActorId] };
          finalEventFacts = versionDurableEventFacts({
            resultCode: result.resultCode,
            migration: responded.receipt.initiationId,
          });
          if (response === 'decline') {
            groupSocialOutcomeTerminalBinding = groupSocialOutcomeBinding(responded.receipt);
            groupSocialOutcomeTerminalStatus = 'cancelled';
          }
        } else if (operation === 'start') {
          const initiationId = str('initiationId');
          const expectedRevision = exactInteger(params.expectedRevision);
          let participants = stringArray(params.participantActorIds);
          let observers = stringArray(params.observerActorIds) ?? [];
          let topicId = str('topicId');
          let sourceBinding: GroupConversationStartPlan['sourceBinding'];
          if (initiationId) {
            if (expectedRevision === undefined) {
              result = reject('missing_param', '启动已同意群议需要 expectedRevision。');
              break;
            }
            const initiation = await prepareGroupSocialInitiationStart(ctx, {
              worldId: args.worldId,
              initiationId,
              actorId: args.actorId,
              expectedRevision,
              now,
            });
            if (!initiation.ok) {
              const terminalReceipt = await loadGroupSocialInitiationReceipt(
                ctx, args.worldId, initiationId,
              );
              if (terminalReceipt && ['cancelled', 'expired'].includes(terminalReceipt.status)) {
                groupSocialOutcomeTerminalBinding = groupSocialOutcomeBinding(
                  terminalReceipt,
                );
                groupSocialOutcomeTerminalStatus = terminalReceipt.status === 'expired'
                  ? 'expired'
                  : 'cancelled';
              }
              result = reject(initiation.reasonCode, '当前群体邀请尚不能启动会话。');
              break;
            }
            participants = initiation.receipt.participantActorIds;
            observers = initiation.receipt.observerActorIds;
            topicId = initiation.receipt.topicRefs[0];
            sourceBinding = {
              initiationId: initiation.receipt.initiationId,
              outcomeId: groupSocialOutcomeBinding(initiation.receipt).outcomeId,
              warrantId: initiation.receipt.warrantId,
              warrantDigest: initiation.receipt.warrantDigest,
              sourceRef: initiation.receipt.sourceRef,
              sourceRevision: initiation.receipt.sourceRevision,
              participantRoles: initiation.receipt.participantRoles,
            };
            groupSocialOutcomeStartBinding = groupSocialOutcomeBinding(initiation.receipt);
          }
          if (!participants) {
            result = reject('missing_param', '开始群体会话需要 participantActorIds 或 ready initiation。');
            break;
          }
          const prepared = await prepareGroupConversationStart(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actor: profile,
            participantActorIds: participants,
            observerActorIds: observers,
            topicId,
            intent: args.intent,
            sourceBinding,
            now,
          });
          result = prepared.result;
          if (prepared.ok) {
            groupConversationStartPlan = prepared.plan;
            finalEventFacts = prepared.facts;
            finalEventAudience = {
              targetActorIds: prepared.plan.participantActorIds.filter((id) => id !== args.actorId),
              witnessActorIds: [
                ...prepared.plan.participantActorIds.filter((id) => id !== args.actorId),
                ...prepared.plan.observerActorIds,
              ],
            };
          }
        } else if (operation === 'speak') {
          const groupConversationId = str('groupConversationId');
          const speechAct = parseSpeechAct(params.speechAct);
          const turnId = str('turnId');
          const expectedTurnNumber = exactInteger(params.expectedTurnNumber);
          const utteranceText = str('utteranceText');
          if (!groupConversationId || !speechAct || !turnId || expectedTurnNumber === undefined || !utteranceText) {
            result = reject('missing_param', '群体发言需要 groupConversationId、turnId、expectedTurnNumber、speechAct 与 utteranceText。');
            break;
          }
          const prepared = await prepareGroupConversationTurn(ctx, {
            worldId: args.worldId,
            actorId: args.actorId,
            groupConversationId,
            turnId,
            expectedTurnNumber,
            speechAct,
            utteranceText,
            addressedActorIds: stringArray(params.addressedActorIds) ?? [],
            referencedFactIds: stringArray(params.referencedFactIds) ?? [],
            referencedBeliefIds: stringArray(params.referencedBeliefIds) ?? [],
            now,
          });
          result = prepared.result;
          if (prepared.ok) {
            groupConversationTurnPlan = prepared.prepared;
            finalEventFacts = prepared.facts;
            finalEventAudience = {
              targetActorIds: prepared.prepared.plan.addressedActorIds,
              witnessActorIds: prepared.prepared.plan.listenerActorIds,
            };
          } else if (prepared.terminalPlan) {
            groupConversationTerminalPlan = prepared.terminalPlan;
            finalEventFacts = versionDurableEventFacts({
              resultCode: result.resultCode,
              groupConversationId: prepared.terminalPlan.session.groupConversationId,
              terminalStatus: prepared.terminalPlan.status,
              reasonCode: prepared.terminalPlan.reasonCode,
              participantActorIds: prepared.terminalPlan.session.participantActorIds,
              observerActorIds: prepared.terminalPlan.session.observerActorIds,
            });
            finalEventAudience = {
              targetActorIds: prepared.terminalPlan.session.participantActorIds.filter((id) => id !== args.actorId),
              witnessActorIds: [
                ...prepared.terminalPlan.session.participantActorIds.filter((id) => id !== args.actorId),
                ...prepared.terminalPlan.session.observerActorIds,
              ],
            };
          }
        } else if (operation === 'leave') {
          const groupConversationId = str('groupConversationId');
          if (!groupConversationId) {
            result = reject('missing_param', '离开群体会话需要 groupConversationId。');
            break;
          }
          const prepared = await prepareGroupConversationLeave(ctx, {
            worldId: args.worldId, actorId: args.actorId, groupConversationId,
          });
          result = prepared.result;
          if (prepared.ok) {
            groupConversationTerminalPlan = prepared.plan;
            finalEventFacts = prepared.facts;
            finalEventAudience = {
              targetActorIds: prepared.plan.session.participantActorIds.filter((id) => id !== args.actorId),
              witnessActorIds: [
                ...prepared.plan.session.participantActorIds.filter((id) => id !== args.actorId),
                ...prepared.plan.session.observerActorIds,
              ],
            };
          }
        } else {
          result = reject('group_operation_invalid', '群体会话操作只能是 start、speak 或 leave。');
        }
        break;
      }
      case 'group_decide': {
        const operation = str('operation');
        const groupConversationId = str('groupConversationId');
        if (!operation || !groupConversationId) {
          result = reject('missing_param', '群体决定需要 operation 与 groupConversationId。');
          break;
        }
        let prepared: Awaited<ReturnType<typeof prepareGroupProposal>>;
        if (operation === 'propose') {
          const recipientActorId = str('recipientActorId');
          if (!recipientActorId) {
            result = reject('missing_param', '资源分配提案需要 recipientActorId。');
            break;
          }
          prepared = await prepareGroupProposal(ctx, {
            worldId: args.worldId, actionRecordId, actorId: args.actorId,
            groupConversationId, recipientActorId, now,
          });
        } else if (operation === 'vote') {
          const proposalId = str('proposalId');
          const choice = parseGroupVoteChoice(params.choice);
          if (!proposalId || !choice) {
            result = reject('missing_param', '群体表决需要 proposalId 与合法 choice。');
            break;
          }
          prepared = await prepareGroupVote(ctx, {
            worldId: args.worldId, actorId: args.actorId, groupConversationId,
            proposalId, choice, source: args.source, now,
          });
        } else if (operation === 'execute') {
          const commitmentId = str('commitmentId');
          if (!commitmentId) {
            result = reject('missing_param', '履行群体承诺需要 commitmentId。');
            break;
          }
          prepared = await prepareGroupCommitmentExecution(ctx, {
            worldId: args.worldId, actorId: args.actorId, groupConversationId, commitmentId, now,
          });
        } else {
          result = reject('group_operation_invalid', '群体决定操作只能是 propose、vote 或 execute。');
          break;
        }
        result = prepared.result;
        groupDecisionPlan = prepared.plan;
        finalEventFacts = prepared.facts;
        if (prepared.plan) {
          const participantActorIds = prepared.plan.kind === 'proposal'
            ? prepared.plan.session.participantActorIds
            : prepared.plan.proposal.participantActorIds;
          if (prepared.plan.kind === 'execute' || prepared.plan.kind === 'breach') {
            finalEventAudience = {
              targetActorIds: [prepared.plan.commitment.recipientActorId],
              witnessActorIds: [...new Set([
                ...participantActorIds,
                ...prepared.plan.observerActorIds,
              ])].filter((id) => id !== args.actorId),
            };
          } else {
            finalEventAudience = {
              targetActorIds: participantActorIds.filter((id) => id !== args.actorId),
              witnessActorIds: participantActorIds.filter((id) => id !== args.actorId),
            };
          }
        }
        break;
      }
      case 'talk':
      case 'negotiate':
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
        const targetLifeGate = evaluateTargetLifeGate({
          health: targetDoc.health,
          lifeStatus: targetDoc.lifeStatus,
          actionType: args.type,
          targetName: targetDoc.name,
        });
        if (!targetLifeGate.ok) {
          negotiationInvalidationPlan =
            args.type === 'negotiate'
              ? await prepareNegotiationInvalidation(ctx, {
                  worldId: args.worldId,
                  negotiationId: str('negotiationId'),
                  actorId: args.actorId,
                  reasonCode: targetLifeGate.resultCode,
                  reason: targetLifeGate.reason,
                })
              : undefined;
          result = negotiationInvalidationPlan
            ? negotiationInvalidationResult(targetLifeGate.resultCode, targetLifeGate.reason)
            : reject(targetLifeGate.resultCode, targetLifeGate.reason);
          finalEventFacts = negotiationInvalidationPlan?.facts;
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
          const reason = `${target.name}不在你身边，无从${args.type}。`;
          negotiationInvalidationPlan =
            args.type === 'negotiate'
              ? await prepareNegotiationInvalidation(ctx, {
                  worldId: args.worldId,
                  negotiationId: str('negotiationId'),
                  actorId: args.actorId,
                  reasonCode: 'target_not_present',
                  reason,
                })
              : undefined;
          result = negotiationInvalidationPlan
            ? negotiationInvalidationResult('target_not_present', reason)
            : reject('target_not_present', reason);
          finalEventFacts = negotiationInvalidationPlan?.facts;
          break;
        }
        // 对方(target)如何看你(actor)——M3 拒绝判断与 M4 报价共用此关系快照。
        const targetView = await loadRelationshipDims(
          ctx,
          args.worldId,
          args.targetActorId,
          args.actorId,
          actionGameDay,
        );
        const socialOutcome = await prepareDirectSocialOutcomeForAction(ctx, {
          worldId: args.worldId,
          actorId: args.actorId,
          targetActorId: args.targetActorId,
          actionType: args.type,
          params,
          gameHour: actionGameHour,
        });
        if (!socialOutcome.ok) {
          result = reject(socialOutcome.reasonCode, '有因社交绑定已失效、被替换或仍在冷却。');
          break;
        }
        const acceptedInvitationOutcome = socialOutcome.binding
          ? { ok: true as const }
          : await prepareAcceptedSocialInvitationOutcomeForAction(ctx, {
              worldId: args.worldId,
              actorId: args.actorId,
              targetActorId: args.targetActorId,
              actionType: args.type,
              params,
              now,
            });
        if (!acceptedInvitationOutcome.ok) {
          result = reject(acceptedInvitationOutcome.reasonCode, '已接受的会面邀请已失效或不再可绑定。');
          break;
        }
        directSocialOutcomeBinding = socialOutcome.binding ?? acceptedInvitationOutcome.binding;
        acceptedSocialInvitationConversationLink = acceptedInvitationOutcome.invitationLink;
        // M3 拒绝系统：社会性动作先判对方愿不愿（≠失败）。spar/steal 非「请求」，不走此闸。
        // gift 在身体执行完成点才判对方是否接受。否则仅提交一个意图就会
        // 消耗社交结果，且目标在两秒执行期间离开/失能也无法重验。
        if (args.type === 'talk') {
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
          actionGameDay,
        );

        if (args.type === 'negotiate') {
          const operation = parseNegotiationOperation(params.operation);
          const conversationId = str('conversationId');
          const expectedRevision = exactInteger(params.expectedRevision);
          const turnId = str('turnId');
          const expectedTurnNumber = exactInteger(params.expectedTurnNumber);
          const utteranceText = str('utteranceText');
          const needsTurn = operation !== 'withdraw';
          const preparedNegotiation = await prepareNegotiationAction(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actor: profile,
            target: targetDoc,
            operation,
            conversationId,
            negotiationId: str('negotiationId'),
            expectedRevision,
            termsInput: params.terms,
            turn:
              needsTurn && turnId && expectedTurnNumber !== undefined && utteranceText
                ? {
                    turnId,
                    expectedTurnNumber,
                    utteranceText,
                    referencedFactIds: stringArray(params.referencedFactIds) ?? [],
                    referencedBeliefIds: stringArray(params.referencedBeliefIds) ?? [],
                  }
                : undefined,
            now,
          });
          result = preparedNegotiation.result;
          finalEventFacts = preparedNegotiation.facts;
          negotiationPlan = preparedNegotiation.plan;
          negotiationInvalidationPlan = preparedNegotiation.invalidationPlan;
          conversationTurnPlan = preparedNegotiation.conversationTurn;
        } else if (args.type === 'talk') {
          const admission = admitTalk({
            conversationId: str('conversationId'),
            turnId: str('turnId'),
            expectedTurnNumber: exactInteger(params.expectedTurnNumber),
            speechAct: params.speechAct,
            utteranceText: str('utteranceText'),
          });
          if (admission.kind === 'rejected') {
            result = admission.result;
          } else if (admission.kind === 'speech') {
              const preparedTurn = await prepareConversationTurn(ctx, {
                worldId: args.worldId,
                actorId: args.actorId,
                targetActorId: args.targetActorId,
                conversationId: admission.conversationId,
                turnId: admission.turnId,
                expectedTurnNumber: admission.expectedTurnNumber,
                speechAct: admission.speechAct,
                utteranceText: admission.utteranceText,
                addressedActorIds: stringArray(params.addressedActorIds) ?? [args.targetActorId],
                referencedFactIds: stringArray(params.referencedFactIds) ?? [],
                referencedBeliefIds: stringArray(params.referencedBeliefIds) ?? [],
                now,
                actorMapId: profile.mapId ?? 'world',
                actorLocationId: profile.currentLocationId,
                actorHealth: profile.health,
              });
              result = preparedTurn.result;
              if (preparedTurn.ok) {
                conversationTurnPlan = preparedTurn.prepared;
                finalEventFacts = preparedTurn.facts;
              } else {
                conversationExpiredSession = preparedTurn.expiredSession;
              }
          } else {
            result = resolveTalk({ actor, target, relationship, roll, topic: args.intent });
            if (result.status === 'applied') {
              const preparedStart = await prepareConversationStart(ctx, {
                worldId: args.worldId,
                actorId: args.actorId,
                targetActorId: args.targetActorId,
                actionRecordId,
                actorName: actor.name,
                targetName: target.name,
                intent: args.intent,
                mapId: profile.mapId ?? 'world',
                locationId: profile.currentLocationId!,
                now,
                socialOutcomeBinding: directSocialOutcomeBinding,
              });
              if (!preparedStart.ok) result = preparedStart.result;
              else {
                conversationStartPlan = preparedStart.plan;
                finalEventFacts = versionDurableEventFacts({
                  resultCode: result.resultCode,
                  conversationId: preparedStart.plan.conversationId,
                  turnId: `${preparedStart.plan.conversationId}:turn:1`,
                  turnNumber: 1,
                  speechAct: preparedStart.plan.firstSpeechAct,
                  topicId: preparedStart.plan.topicId,
                  addressedActorIds: [preparedStart.plan.targetActorId],
                  referencedFactIds: [],
                  referencedBeliefIds: [],
                });
              }
            }
          }
        } else if (args.type === 'spar') {
          const sparResolution = resolveSpar({ actor, target, relationship, roll });
          const admission = admitSpar({ candidate: sparResolution });
          result = admission.ok ? sparResolution : admission.result;
        } else if (args.type === 'request_teaching') {
          const teachingTopic = parseTeachingTopic(params.topic);
          const location = await resolveLocation(ctx, args, profile);
          const eligibility = resolveRequestTeaching({
            actor,
            master: target,
            relationship,
            roll: 1,
          });
          const cooldown = evaluateTeachingActionCooldown(
            actionGameDay,
            args.targetActorId,
            await loadTeachingUsages(ctx, args.worldId, args.actorId),
          );
          const teacherUnavailable = await activeTeacherUnavailableReason(
            ctx,
            args.worldId,
            args.targetActorId,
            now,
          );
          const admission = admitRequestTeachingEnvelope({
            actorId: args.actorId,
            targetActorId: args.targetActorId,
            teachingTopic: teachingTopic ?? undefined,
            locationAllowsTeaching: Boolean(location?.allowedActions.includes('request_teaching')),
            eligibilityFailure: eligibility.resultCode === 'teaching_granted'
              ? undefined
              : { resultCode: eligibility.resultCode, reason: eligibility.reason },
            cooldownFailure: cooldown.ok ? undefined : { resultCode: cooldown.resultCode, reason: cooldown.reason },
            teacherUnavailableReason: teacherUnavailable ?? undefined,
          });
          if (!admission.ok || !location) {
            result = admission.ok
              ? reject('location_forbids_teaching', '当前地点不允许进行当面指点。')
              : admission.result;
            break;
          }
          executionGoal = await createPendingActionExecution(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actorId: args.actorId,
            actionType: args.type,
            source: args.source,
            mapId: profile.mapId,
            locationId: location.locationId,
            targetActorId: args.targetActorId,
            teachingTopic: admission.teachingTopic,
            intent: args.intent ?? `向${target.name}请教修行基础`,
            durationMs: TEACHING_EXECUTION_DURATION_MS,
            now,
          });
          result = {
            status: 'applied',
            resultCode: 'action_execution_started',
            reason: `${profile.name}开始向${target.name}当面求教，完成前不增加修为。`,
            effects: {},
            eventType: 'teaching_started',
            visibility: 'local',
          };
        } else if (args.type === 'gift') {
          const itemId = str('itemId');
          const location = await resolveLocation(ctx, args, profile);
          const owned = itemId ? inventoryQuantity(profile.inventory, itemId) : 0;
          const reserved = itemId ? await activeInventoryReservationQuantity(ctx, args.worldId, args.actorId, itemId, now) : 0;
          const cooldown = args.targetActorId ? evaluateGiftActionCooldown(actionGameDay, await loadGiftUsageDays(ctx, args.worldId, args.actorId, args.targetActorId)) : undefined;
          const admission = admitGiftEnvelope({ actorId: args.actorId, actorName: profile.name, targetActorId: args.targetActorId, itemId, locationAllowsGift: Boolean(location?.allowedActions.includes('gift')), owned, unreserved: itemId ? unreservedGiftQuantity(profile.inventory, itemId, reserved) : 0, cooldownFailure: cooldown && !cooldown.ok ? { resultCode: cooldown.resultCode, reason: cooldown.reason } : undefined });
          if (!admission.ok || !location) {
            result = admission.ok ? reject('location_forbids_gift', '当前地点不允许进行赠礼。') : admission.result;
            break;
          }
          executionGoal = await createPendingActionExecution(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actorId: args.actorId,
            actionType: args.type,
            source: args.source,
            mapId: profile.mapId,
            locationId: location.locationId,
            targetActorId: args.targetActorId,
            reservedItemId: admission.itemId,
            reservedItemQuantity: 1,
            intent: args.intent ?? `向${target.name}赠送一件「${admission.itemId}」`,
            durationMs: GIFT_EXECUTION_DURATION_MS,
            now,
          });
          result = {
            status: 'applied',
            resultCode: 'action_execution_started',
            reason: `${profile.name}开始当面向${target.name}递出「${admission.itemId}」，完成前不转移物品。`,
            effects: {},
            eventType: 'gift_started',
            visibility: 'local',
          };
        } else if (args.type === 'trade') {
          const offeredItemId = str('offeredItemId');
          const requestedItemId = str('requestedItemId');
          const location = await resolveLocation(ctx, args, profile);
          const actionGameHour = await readGameHour(ctx, args.worldId, now);
          const cooldown = args.targetActorId ? evaluateTradeActionCooldown(actionGameHour, await loadTradeUsageHours(ctx, args.worldId, args.actorId, args.targetActorId)) : undefined;
          const admission = admitTradeEnvelope({ actorId: args.actorId, targetActorId: args.targetActorId, offeredItemId, requestedItemId, locationAllowsTrade: Boolean(location?.allowedActions.includes('trade')), cooldownFailure: cooldown && !cooldown.ok ? { resultCode: cooldown.resultCode, reason: cooldown.reason } : undefined });
          if (!admission.ok) {
            result = admission.result;
            break;
          }
          if (!location || !offeredItemId || !requestedItemId) {
            throw new Error('trade_admission_invariant');
          }
          {
            const shopDoc = await ctx.db
              .query('shopInventories')
              .withIndex('byMerchant', (q) =>
                q.eq('worldId', args.worldId).eq('merchantActorId', args.targetActorId!),
              )
              .first();
            if (shopDoc) {
              if (
                shopDoc.mapId !== (profile.mapId ?? 'world') ||
                shopDoc.locationId !== profile.currentLocationId
              ) {
                result = reject('shop_not_found', '该商店不在角色当前所在的地图与地点。');
              } else {
                const refreshed = await refreshShopForAction(ctx, shopDoc, now);
                const reservations = await activeShopReservations(
                  ctx,
                  args.worldId,
                  refreshed.shopId,
                  now,
                );
                if (offeredItemId === 'spirit_stone' && requestedItemId !== 'spirit_stone') {
                  const quantity = parseTradeQuantity(params.requestedQty);
                  const line = refreshed.stock.find((candidate) => candidate.itemId === requestedItemId);
                  if (!quantity) {
                    result = reject('trade_quantity_invalid', '购买数量必须是 1–99 的整数。');
                  } else if (!line || itemBaseValue(requestedItemId) <= 0) {
                    result = reject('shop_item_not_stocked', `${refreshed.name}并不经营「${requestedItemId}」。`);
                  } else {
                    const reservedStock = reservations.outgoingStock.get(requestedItemId) ?? 0;
                    const availableStock = Math.max(0, line.qty - reservedStock);
                    const quote = quoteShopSale(
                      requestedItemId,
                      availableStock,
                      line.capacity,
                      targetView,
                    );
                    const total = quote.finalPrice * quantity;
                    const explicitTotal = exactQty('offeredQty');
                    const actorReserved = await activeInventoryReservationQuantity(
                      ctx,
                      args.worldId,
                      args.actorId,
                      'spirit_stone',
                      now,
                    );
                    if (line.qty < quantity) {
                      result = reject('shop_out_of_stock', `${refreshed.name}的「${itemName(requestedItemId)}」库存不足。`);
                    } else if (availableStock < quantity) {
                      result = reject('shop_stock_reserved', '最后的商品已被另一项活动交易预约。');
                    } else if (explicitTotal !== undefined && explicitTotal !== total) {
                      result = reject('shop_quote_changed', `当前冻结报价为 ${total} 枚灵石，请按新报价确认。`);
                    } else if (inventoryQuantity(profile.inventory, 'spirit_stone') < total) {
                      result = reject('insufficient_funds', `${profile.name}需要 ${total} 枚灵石才能完成购买。`);
                    } else if (
                      unreservedTradeQuantity(profile.inventory, 'spirit_stone', actorReserved) < total
                    ) {
                      result = reject('trade_actor_item_reserved', '用于付款的灵石已被另一项活动执行预约。');
                    } else {
                      executionGoal = await createPendingActionExecution(ctx, {
                        worldId: args.worldId,
                        actionRecordId,
                        actorId: args.actorId,
                        actionType: 'trade',
                        source: args.source,
                        mapId: profile.mapId,
                        locationId: location.locationId,
                        targetActorId: args.targetActorId,
                        reservedItemId: 'spirit_stone',
                        reservedItemQuantity: total,
                        tradeMode: 'shop_buy',
                        shopId: refreshed.shopId,
                        tradeItemId: requestedItemId,
                        tradeItemQuantity: quantity,
                        tradeUnitPrice: quote.finalPrice,
                        tradeTotalPrice: total,
                        reservedShopItemId: requestedItemId,
                        reservedShopItemQuantity: quantity,
                        intent: args.intent ?? `在${refreshed.name}购买${quantity}件「${itemName(requestedItemId)}」`,
                        durationMs: TRADE_EXECUTION_DURATION_MS,
                        now,
                      });
                      result = tradeStartedResult(profile.name, target.name);
                    }
                  }
                } else if (requestedItemId === 'spirit_stone' && offeredItemId !== 'spirit_stone') {
                  const quantity = parseTradeQuantity(params.offeredQty);
                  const line = refreshed.stock.find((candidate) => candidate.itemId === offeredItemId);
                  if (!quantity) {
                    result = reject('trade_quantity_invalid', '出售数量必须是 1–99 的整数。');
                  } else if (!line || itemBaseValue(offeredItemId) <= 0) {
                    result = reject('shop_item_not_stocked', `${refreshed.name}不收购「${offeredItemId}」。`);
                  } else {
                    const reservedCapacity = reservations.incomingStock.get(offeredItemId) ?? 0;
                    const availableCapacity = Math.max(0, line.capacity - line.qty - reservedCapacity);
                    const projectedQty = Math.min(line.capacity, line.qty + reservedCapacity);
                    const quote = quoteShopPurchase(offeredItemId, projectedQty, line.capacity);
                    const total = quote.finalPrice * quantity;
                    const explicitTotal = exactQty('requestedQty');
                    const actorReserved = await activeInventoryReservationQuantity(
                      ctx,
                      args.worldId,
                      args.actorId,
                      offeredItemId,
                      now,
                    );
                    const availableWallet = Math.max(
                      0,
                      refreshed.walletSpiritStones - reservations.walletSpiritStones,
                    );
                    if (inventoryQuantity(profile.inventory, offeredItemId) < quantity) {
                      result = reject('actor_lacks_item', `${profile.name}没有足够的「${itemName(offeredItemId)}」可出售。`);
                    } else if (
                      unreservedTradeQuantity(profile.inventory, offeredItemId, actorReserved) < quantity
                    ) {
                      result = reject('trade_actor_item_reserved', '准备出售的物品已被另一项活动执行预约。');
                    } else if (line.qty + quantity > line.capacity) {
                      result = reject('shop_stock_full', `${refreshed.name}的「${itemName(offeredItemId)}」货架已满。`);
                    } else if (availableCapacity < quantity) {
                      result = reject('shop_capacity_reserved', '剩余货架容量已被另一项活动交易预约。');
                    } else if (explicitTotal !== undefined && explicitTotal !== total) {
                      result = reject('shop_quote_changed', `当前冻结收购价为 ${total} 枚灵石，请按新报价确认。`);
                    } else if (refreshed.walletSpiritStones < total) {
                      result = reject('shop_insufficient_funds', `${refreshed.name}当前资金不足。`);
                    } else if (availableWallet < total) {
                      result = reject('shop_wallet_reserved', '店铺剩余资金已被另一项活动交易预约。');
                    } else {
                      executionGoal = await createPendingActionExecution(ctx, {
                        worldId: args.worldId,
                        actionRecordId,
                        actorId: args.actorId,
                        actionType: 'trade',
                        source: args.source,
                        mapId: profile.mapId,
                        locationId: location.locationId,
                        targetActorId: args.targetActorId,
                        reservedItemId: offeredItemId,
                        reservedItemQuantity: quantity,
                        tradeMode: 'shop_sell',
                        shopId: refreshed.shopId,
                        tradeItemId: offeredItemId,
                        tradeItemQuantity: quantity,
                        tradeUnitPrice: quote.finalPrice,
                        tradeTotalPrice: total,
                        reservedShopWalletSpiritStones: total,
                        reservedShopCapacityItemId: offeredItemId,
                        reservedShopCapacityQuantity: quantity,
                        intent: args.intent ?? `向${refreshed.name}出售${quantity}件「${itemName(offeredItemId)}」`,
                        durationMs: TRADE_EXECUTION_DURATION_MS,
                        now,
                      });
                      result = tradeStartedResult(profile.name, target.name);
                    }
                  }
                } else {
                  result = reject('shop_trade_mode_invalid', '商店只接受灵石购买，或以物品换取灵石。');
                }
              }
            } else {
              const offeredQuantity = parseTradeQuantity(params.offeredQty);
              const requestedQuantity = parseTradeQuantity(params.requestedQty);
              if (!offeredQuantity || !requestedQuantity) {
                result = reject('trade_quantity_invalid', '交易数量必须是 1–99 的整数。');
                break;
              }
              const unitPrice = quotePrice(itemBaseValue(requestedItemId), targetView).finalPrice;
              const totalPrice = unitPrice * requestedQuantity;
              const actorReservationQuantity =
                offeredItemId === 'spirit_stone' ? totalPrice : offeredQuantity;
              const explicitTotal = exactQty('offeredQty');
              const actorReserved = await activeInventoryReservationQuantity(
                ctx, args.worldId, args.actorId, offeredItemId, now,
              );
              const targetReserved = await activeInventoryReservationQuantity(
                ctx, args.worldId, args.targetActorId, requestedItemId, now,
              );
              if (
                offeredItemId === 'spirit_stone' &&
                explicitTotal !== undefined &&
                explicitTotal !== totalPrice
              ) {
                result = reject('trade_quote_changed', `对方当前报价为 ${totalPrice} 枚灵石。`);
              } else if (inventoryQuantity(profile.inventory, offeredItemId) < actorReservationQuantity) {
                result = reject(
                  offeredItemId === 'spirit_stone' ? 'insufficient_funds' : 'actor_lacks_item',
                  `${profile.name}没有足够的「${offeredItemId}」可供交易。`,
                );
              } else if (
                unreservedTradeQuantity(profile.inventory, offeredItemId, actorReserved) < actorReservationQuantity
              ) {
                result = reject('trade_actor_item_reserved', '出让物已被另一项活动执行预约。');
              } else if (inventoryQuantity(targetDoc.inventory, requestedItemId) < requestedQuantity) {
                result = reject('merchant_lacks_item', `${target.name}没有足够的「${requestedItemId}」。`);
              } else if (
                unreservedTradeQuantity(targetDoc.inventory, requestedItemId, targetReserved) < requestedQuantity
              ) {
                result = reject('trade_target_item_reserved', '目标交付物已被另一项活动交易预约。');
              } else {
                executionGoal = await createPendingActionExecution(ctx, {
                  worldId: args.worldId,
                  actionRecordId,
                  actorId: args.actorId,
                  actionType: 'trade',
                  source: args.source,
                  mapId: profile.mapId,
                  locationId: location.locationId,
                  targetActorId: args.targetActorId,
                  reservedItemId: offeredItemId,
                  reservedItemQuantity: actorReservationQuantity,
                  reservedTargetItemId: requestedItemId,
                  reservedTargetItemQuantity: requestedQuantity,
                  tradeMode: 'direct',
                  tradeItemId: requestedItemId,
                  tradeItemQuantity: requestedQuantity,
                  tradeUnitPrice: unitPrice,
                  tradeTotalPrice: totalPrice,
                  intent: args.intent ?? `与${target.name}交换物品`,
                  durationMs: TRADE_EXECUTION_DURATION_MS,
                  now,
                });
                result = tradeStartedResult(profile.name, target.name);
              }
            }
          }
        } else {
          // steal：高风险。有弱 GM 裁决（已钳制）则采纳，否则退回确定性规则。
          const itemId = str('itemId');
          const location = await resolveLocation(ctx, args, profile);
          const targetHasItem = (target.inventory ?? []).some(
            (i) => i.itemId === itemId && i.qty >= 1,
          );
          const admission = admitStealEnvelope({ itemId, locationPresent: Boolean(location), targetName: target.name, targetHasItem });
          if (!admission.ok) result = admission.result;
          else if (!location) throw new Error('steal_admission_invariant');
          else {
            const verdict = args.gmVerdict ? clampGmVerdict(args.gmVerdict) : null;
            result = verdict
              ? buildStealResult({
                  outcome: verdict.outcome,
                  actorActorId: actor.actorId,
                  targetActorId: target.actorId,
                  actorName: actor.name,
                  targetName: target.name,
                  itemId: admission.itemId,
                  reason: verdict.reasonText,
                  reputationDelta: verdict.reputationDelta,
                  // 受害者→小偷的关系反应由 relationshipEffectFor(steal_*) 统一给出（W4b-E）。
                })
              : resolveSteal({
                  actor,
                  target,
                  location: toLocationSnapshot(location),
                  itemId: admission.itemId,
                  roll,
                  detectionRoll: seededRoll(seed + ':det'),
                  phaseMods,
                });
          }
        }
        break;
      }
      case 'travel': {
        if ((profile.mapId ?? 'world') === QINGLAN_VALLEY_GATE_MAP_ID) {
          const requestedTarget = readValleyMovementTarget(params.movementTarget, args.targetId);
          if (!requestedTarget) {
            result = reject(
              'missing_target',
              '溪谷 travel 需要合法的语义目标或受限 movementTarget。',
            );
            break;
          }
          const requestedSource = params.decisionSource;
          const decisionSource: MovementDecisionSource =
            typeof requestedSource === 'string' &&
            ['llm', 'event', 'utility', 'test'].includes(requestedSource)
              ? (requestedSource as MovementDecisionSource)
              : args.source === 'agent'
                ? 'llm'
                : 'test';
          const command = await createValleyMovementCommand(ctx, {
            worldId: args.worldId,
            actionRecordId,
            actorId: args.actorId,
            intent: args.intent ?? '在溪谷中前往新的目标',
            decisionSource,
            requestedTarget,
            now,
          });
          if (!command.ok) {
            result = {
              status: 'rejected',
              resultCode: command.reasonCode,
              reason: command.reason,
              effects: {},
              eventType: 'travel_failed',
              visibility: 'local',
            };
            break;
          }
          if (activeExecution) {
            await terminalizeActionExecution(ctx, activeExecution, now, {
              status: 'interrupted',
              reasonCode: 'movement_started',
              reason: `${profile.name}开始移动，原持续动作已中断。`,
            });
          }
          result = {
            status: 'applied',
            resultCode: 'travel_started',
            reason: `${profile.name}决定动身，目标格为 (${command.goal.acceptedTile.x}, ${command.goal.acceptedTile.y})。`,
            effects: {},
            eventType: 'travel_started',
            visibility: 'local',
          };
          break;
        }
        // 语义地点 → entryPoint → 驱动 AI Town moveTo。目标地点用 targetId 携带。
        // Agent 只提语义地点，坐标/路径全由系统算（架构铁律 #4）。
        const dest = args.targetId;
        if (!dest) {
          result = reject('missing_target', 'travel 需要 targetId＝目标语义地点。');
          break;
        }
        const playerId = await findPlayerIdByName(ctx, args.worldId, args.actorId);
        if (!playerId) {
          result = reject(
            'travel_body_missing',
            `${profile.name}在此世界中没有身体，无法移动。`,
          );
          break;
        }
        const tt = await resolveAvailableWorldTravelTarget(
          ctx,
          args.worldId,
          dest,
          playerId,
        );
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
        if (!(await worldBodyEngineReady(ctx, args.worldId))) {
          result = reject(
            'body_engine_stopped',
            `${profile.name}的身体引擎未运行，不能接收移动命令。`,
          );
          break;
        }
        if (activeExecution) {
          await terminalizeActionExecution(ctx, activeExecution, now, {
            status: 'interrupted',
            reasonCode: 'movement_started',
            reason: `${profile.name}开始移动，原持续动作已中断。`,
          });
        }
        executionGoal = await createPendingActionExecution(ctx, {
          worldId: args.worldId,
          actionRecordId,
          actorId: args.actorId,
          actionType: 'travel',
          source: args.source,
          mapId: 'world',
          locationId: dest,
          targetTile: tt.destination,
          intent: args.intent ?? `前往${dest}`,
          durationMs: 0,
          now,
        });
        const movementInputId = await insertInput(
          ctx,
          args.worldId,
          'moveTo',
          { playerId, destination: tt.destination },
        );
        const movementInput = await ctx.db.get(movementInputId);
        if (!movementInput) {
          throw new Error('travel_movement_input_missing');
        }
        await ctx.db.patch(
          executionGoal.executionId as Id<'actionExecutions'>,
          {
            movementInputId,
            movementInputNumber: movementInput.number,
            movementPlayerId: playerId,
            movementInputDigest: stableObservationDigest({
              engineId: String(movementInput.engineId),
              number: movementInput.number,
              name: movementInput.name,
              args: movementInput.args as unknown,
            }),
          },
        );
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
        const portalId = str('portalId');
        if (portalId) {
          const preparedPortal = await prepareValleyPortalTransition(ctx, {
            worldId: args.worldId,
            actorId: args.actorId,
            profile,
            portalId,
            reportedTile: readGodotTile(requestMetadata.actorTile),
            intent: args.intent,
          });
          if (!preparedPortal.ok) {
            result = reject(preparedPortal.reasonCode, preparedPortal.reason);
            break;
          }
          result = preparedPortal.result;
          finalEventFacts = preparedPortal.eventFacts;
          portalTransitionPlan = preparedPortal.transition;
          break;
        }
        const location = args.locationId
          ? await loadLocation(ctx, args.worldId, args.locationId)
          : null;
        const profileMapId = profile.mapId ?? 'world';
        result =
          location && (location.mapId ?? 'world') !== profileMapId
          ? reject(
              'location_cross_map_forbidden',
              '普通 arrive 不能跨图；必须引用一个已抵达的显式 Portal。',
            )
          : location
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

    if (executionGoal) {
        return await beginActionExecution(
          ctx,
          actionRecordId,
        args,
        now,
          { seed, roll, profile },
          result,
          executionGoal,
          {
            socialOutcomeBinding: directSocialOutcomeBinding,
          },
        );
    }
    const finalized = await finalize(
      ctx,
      actionRecordId,
      args,
      now,
      { seed, roll, profile },
      result,
      finalEventFacts,
      finalEventAudience,
    );
    if (
      directSocialOutcomeBinding &&
      !conversationStartPlan &&
      !conversationTurnPlan
    ) {
      const opened = await beginSocialOutcomeTx(ctx, {
        worldId: args.worldId,
        binding: directSocialOutcomeBinding,
        openedByActionId: actionRecordId,
        openedEventId: finalized.eventId,
        gameHour: actionGameHour,
        now,
      });
      if (!opened.ok) throw new Error(opened.reasonCode);
      const settled = await settleSocialOutcomeTx(ctx, {
        worldId: args.worldId,
        outcomeId: directSocialOutcomeBinding.outcomeId,
        evidence: { resultCode: result.resultCode },
        terminalActionId: actionRecordId,
        terminalEventId: finalized.eventId,
        gameHour: actionGameHour,
        now,
      });
      if (!settled.ok) throw new Error(settled.reasonCode);
      const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
        worldId: args.worldId,
        outcomeId: settled.receipt.outcomeId,
        now,
        gameHour: actionGameHour,
      });
      if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
    }
    if (requestTransitionPlan) {
      await commitRequestTransitionFromAction(ctx, {
        ...requestTransitionPlan,
        actionRecordId,
        eventId: finalized.eventId,
        now,
      });
    }
    if (result.status === 'applied' && portalTransitionPlan) {
      await commitValleyPortalTransition(ctx, portalTransitionPlan, now);
    }
    let conversation:
      | Awaited<ReturnType<typeof commitConversationStart>>
      | Awaited<ReturnType<typeof commitConversationTurn>>
      | undefined;
    if (result.status === 'applied' && negotiationPlan) {
      await commitNegotiationPlan(ctx, {
        worldId: args.worldId,
        actionRecordId,
        eventId: finalized.eventId,
        plan: negotiationPlan,
        now,
      });
    }
    if (negotiationInvalidationPlan) {
      await commitNegotiationInvalidation(ctx, {
        plan: negotiationInvalidationPlan,
        actionRecordId,
        eventId: finalized.eventId,
        now,
      });
    }
    if (result.status === 'applied' && conversationStartPlan) {
      conversation = await commitConversationStart(
        ctx,
        args.worldId,
        actionRecordId,
        finalized.eventId,
        conversationStartPlan,
      );
      conversationSessionBinding = {
        operation: 'speech',
        sessionRef: conversation.conversationId,
        sourceRevision: 1,
      };
      if (directSocialOutcomeBinding) {
        const opened = await beginSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          binding: directSocialOutcomeBinding,
          openedByActionId: actionRecordId,
          openedEventId: finalized.eventId,
          conversationId: conversation.conversationId,
          gameHour: actionGameHour,
          now,
        });
        if (!opened.ok) throw new Error(opened.reasonCode);
      }
      if (acceptedSocialInvitationConversationLink) {
        const linked = await linkSocialInvitationConversationTx(ctx, {
          worldId: args.worldId,
          invitationId: acceptedSocialInvitationConversationLink.invitationId,
          actorId: args.actorId,
          expectedRevision: acceptedSocialInvitationConversationLink.revision,
          conversationId: conversation.conversationId,
          now,
        });
        if (!linked.ok) throw new Error(linked.reasonCode);
      }
    } else if (result.status === 'applied' && conversationTurnPlan) {
      conversation = await commitConversationTurn(ctx, {
        worldId: args.worldId,
        actorId: args.actorId,
        actionRecordId,
        eventId: finalized.eventId,
        prepared: conversationTurnPlan,
        now,
      });
      conversationSessionBinding = {
        operation: conversation.status === 'active' ? 'speech' : 'close',
        sessionRef: conversation.conversationId,
        sourceRevision: conversationTurnPlan.session.revision + 1,
      };
      if (conversation.status !== 'active') {
        const terminalStatus = conversation.status === 'resolved' ||
          conversation.status === 'cancelled' || conversation.status === 'expired'
          ? conversation.status
          : undefined;
        if (!terminalStatus) throw new Error('conversation_terminal_status_invalid');
        const settled = await settleConversationSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          conversationId: conversation.conversationId,
          status: terminalStatus,
          resultCode: result.resultCode,
          terminalActionId: actionRecordId,
          terminalEventId: finalized.eventId,
          gameHour: actionGameHour,
          now,
        });
        if (!settled.ok) throw new Error(settled.reasonCode);
        if (!('unbound' in settled) && settled.receipt.status !== 'pending') {
          const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
            worldId: args.worldId,
            outcomeId: settled.receipt.outcomeId,
            now,
            gameHour: actionGameHour,
          });
          if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
        }
      }
    } else if (conversationExpiredSession) {
      await commitConversationExpiration(ctx, conversationExpiredSession, now, actionRecordId);
      conversationSessionBinding = {
        operation: 'expired',
        sessionRef: conversationExpiredSession.conversationId,
        sourceRevision: conversationExpiredSession.revision + 1,
      };
    }
    let groupConversation:
      | Awaited<ReturnType<typeof commitGroupConversationStart>>
      | Awaited<ReturnType<typeof commitGroupConversationTurn>>
      | undefined;
    if (result.status === 'applied' && groupSocialOutcomeOpeningBinding) {
      const opened = await beginSocialOutcomeTx(ctx, {
        worldId: args.worldId,
        binding: groupSocialOutcomeOpeningBinding,
        openedByActionId: actionRecordId,
        openedEventId: finalized.eventId,
        gameHour: actionGameHour,
        now,
      });
      if (!opened.ok) throw new Error(opened.reasonCode);
    }
    if (groupSocialOutcomeTerminalBinding && groupSocialOutcomeTerminalStatus) {
      const settled = await settleSocialOutcomeTx(ctx, {
        worldId: args.worldId,
        outcomeId: groupSocialOutcomeTerminalBinding.outcomeId,
        evidence: {
          resultCode: result.resultCode,
          groupConversationStatus: groupSocialOutcomeTerminalStatus,
        },
        terminalActionId: actionRecordId,
        terminalEventId: finalized.eventId,
        gameHour: actionGameHour,
        now,
      });
      if (!settled.ok) throw new Error(settled.reasonCode);
      const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
        worldId: args.worldId,
        outcomeId: settled.receipt.outcomeId,
        now,
        gameHour: actionGameHour,
      });
      if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
    }
    if (result.status === 'applied' && groupConversationStartPlan) {
      groupConversation = await commitGroupConversationStart(ctx, {
        worldId: args.worldId,
        actionRecordId,
        eventId: finalized.eventId,
        plan: groupConversationStartPlan,
      });
      if (groupConversationStartPlan.sourceBinding) {
        const linked = await commitGroupSocialInitiationStarted(ctx, {
          worldId: args.worldId,
          initiationId: groupConversationStartPlan.sourceBinding.initiationId,
          actorId: args.actorId,
          expectedRevision: exactInteger(params.expectedRevision)!,
          groupConversationId: groupConversation.groupConversationId,
          now,
        });
        if (!linked.ok) throw new Error(linked.reasonCode);
        if (!groupSocialOutcomeStartBinding) {
          throw new Error('social_outcome_group_binding_missing');
        }
        const bound = await bindGroupConversationSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          binding: groupSocialOutcomeStartBinding,
          groupConversationId: groupConversation.groupConversationId,
          now,
        });
        if (!bound.ok) throw new Error(bound.reasonCode);
      }
    } else if (result.status === 'applied' && groupConversationTurnPlan) {
      groupConversation = await commitGroupConversationTurn(ctx, {
        worldId: args.worldId,
        actorId: args.actorId,
        actionRecordId,
        eventId: finalized.eventId,
        prepared: groupConversationTurnPlan,
        now,
      });
      if (groupConversation.status !== 'active' && await groupSocialOutcomePendingTx(ctx, {
        worldId: args.worldId, groupConversationId: groupConversation.groupConversationId,
      })) {
        const settled = await settleGroupSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          groupConversationId: groupConversation.groupConversationId,
          evidence: {
            resultCode: result.resultCode,
            groupConversationStatus: groupConversation.status,
            participantTurnCount: groupConversation.turnNumber,
          },
          terminalActionId: actionRecordId,
          terminalEventId: finalized.eventId,
          gameHour: actionGameHour,
          now,
        });
        if (!settled.ok) throw new Error(settled.reasonCode);
        if (!('unbound' in settled) && settled.receipt.status !== 'pending') {
          const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
            worldId: args.worldId,
            outcomeId: settled.receipt.outcomeId,
            now,
            gameHour: actionGameHour,
          });
          if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
        }
      }
    } else if (result.status === 'applied' && groupConversationTerminalPlan) {
      await commitGroupConversationTerminal(
        ctx,
        groupConversationTerminalPlan,
        actionRecordId,
        finalized.eventId,
        now,
      );
      if (await groupSocialOutcomePendingTx(ctx, {
        worldId: args.worldId,
        groupConversationId: groupConversationTerminalPlan.session.groupConversationId,
      })) {
        const settled = await settleGroupSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          groupConversationId: groupConversationTerminalPlan.session.groupConversationId,
          evidence: {
            resultCode: result.resultCode,
            groupConversationStatus: groupConversationTerminalPlan.status,
          },
          terminalActionId: actionRecordId,
          terminalEventId: finalized.eventId,
          gameHour: actionGameHour,
          now,
        });
        if (!settled.ok) throw new Error(settled.reasonCode);
        if (!('unbound' in settled) && settled.receipt.status !== 'pending') {
          const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
            worldId: args.worldId,
            outcomeId: settled.receipt.outcomeId,
            now,
            gameHour: actionGameHour,
          });
          if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
        }
      }
    }
    const groupDecision = groupDecisionPlan && (
      result.status === 'applied' ||
      groupDecisionPlan.kind === 'expire_proposal'
    )
      ? await commitGroupDecision(ctx, {
          worldId: args.worldId,
          actionRecordId,
          eventId: finalized.eventId,
          plan: groupDecisionPlan,
          now,
        })
      : undefined;
    if (groupDecisionPlan && groupDecision) {
      const terminalEvidence = groupDecisionPlan.kind === 'vote' && groupDecisionPlan.outcome === 'rejected'
        ? { resultCode: result.resultCode, groupProposalStatus: 'rejected' }
        : groupDecisionPlan.kind === 'execute'
          ? { resultCode: result.resultCode, commitmentStatus: 'fulfilled' }
          : groupDecisionPlan.kind === 'breach'
            ? { resultCode: result.resultCode, commitmentStatus: 'breached' }
            : groupDecisionPlan.kind === 'expire_proposal'
              ? { resultCode: 'group_proposal_expired', groupProposalStatus: 'expired' }
              : undefined;
      const groupConversationId = groupDecisionPlan.kind === 'proposal'
        ? groupDecisionPlan.session.groupConversationId
        : groupDecisionPlan.proposal.groupConversationId;
      if (terminalEvidence && await groupSocialOutcomePendingTx(ctx, {
        worldId: args.worldId, groupConversationId,
      })) {
        const settled = await settleGroupSocialOutcomeTx(ctx, {
          worldId: args.worldId,
          groupConversationId,
          evidence: terminalEvidence,
          terminalActionId: actionRecordId,
          terminalEventId: finalized.eventId,
          gameHour: actionGameHour,
          now,
        });
        if (!settled.ok) throw new Error(settled.reasonCode);
        if (!('unbound' in settled) && settled.receipt.status !== 'pending') {
          const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
            worldId: args.worldId,
            outcomeId: settled.receipt.outcomeId,
            now,
            gameHour: actionGameHour,
          });
          if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
        }
      }
    }
    if (
      result.status === 'applied' &&
      groupDecisionPlan &&
      (groupDecisionPlan.kind === 'execute' || groupDecisionPlan.kind === 'breach')
    ) {
      const relationEffect = relationshipEffectFor(result.resultCode).targetToActor;
      const effectKind = relationshipEffectKindFor(result.resultCode);
      if (!relationEffect || !effectKind) {
        throw new Error(`group_commitment_relationship_policy_missing:${result.resultCode}`);
      }
      const relationshipSourceRef = groupDecisionPlan.commitment.commitmentId;
      const relationshipSourceRevision = groupDecisionPlan.proposal.sessionRevision;
      const relationshipEffectReceiptRef = [
        'relationship_change',
        String(finalized.eventId),
        groupDecisionPlan.commitment.recipientActorId,
        groupDecisionPlan.commitment.donorActorId,
        effectKind,
      ].join(':');
      const relationshipOutcomeReceipt = projectDomainOutcomeEvidence({
        domain: 'relationship',
        source: 'group_pair_duty',
        sourceRef: relationshipSourceRef,
        sourceRevision: relationshipSourceRevision,
        idempotencyKey: domainOutcomeEvidenceIdempotencyKey(
          'relationship',
          relationshipSourceRef,
          relationshipSourceRevision,
        ),
        effectReceiptRef: relationshipEffectReceiptRef,
        outcome: 'applied',
        replay: false,
      });
      const relationshipAdmission = relationshipOutcomeReceipt
        ? admitRelationshipMemoryOutcome({
            receipt: relationshipOutcomeReceipt,
            expected: {
              domain: 'relationship',
              source: 'group_pair_duty',
              sourceRef: relationshipSourceRef,
              sourceRevision: relationshipSourceRevision,
              effectReceiptRef: relationshipEffectReceiptRef,
            },
          })
        : undefined;
      if (relationshipAdmission?.status !== 'admitted') {
        throw new Error('group_commitment_relationship_outcome_evidence_invalid');
      }
      await applyRelationshipEvent(
        ctx,
        args.worldId,
        groupDecisionPlan.commitment.recipientActorId,
        groupDecisionPlan.commitment.donorActorId,
        relationEffect,
        finalized.eventId,
        effectKind,
        Math.floor((await readGameHour(ctx, args.worldId, now)) / 24),
        now,
      );
    }
    if (
      result.status === 'applied' &&
      result.resultCode === 'request_completed' &&
      questRelationshipReward &&
      (questRelationshipReward.trust !== 0 || questRelationshipReward.debt !== 0)
    ) {
      await applyRelationshipEvent(
        ctx,
        args.worldId,
        questRelationshipReward.issuerActorId,
        args.actorId,
        {
          trust: questRelationshipReward.trust,
          debt: questRelationshipReward.debt,
        },
        finalized.eventId,
        'quest_completion',
        Math.floor((await readGameHour(ctx, args.worldId, now)) / 24),
        now,
      );
    }
    const negotiation = negotiationPlan
      ? {
          negotiationId: negotiationPlan.negotiationId,
          proposalId: negotiationPlan.proposalId,
          revision: negotiationPlan.revision,
          operation: negotiationPlan.operation,
        }
      : undefined;
    const conversationSessionReceipt = conversationSessionBinding
      ? receiptForConversationSession({
          source: 'action_record',
          ...conversationSessionBinding,
          actionRecordId: String(actionRecordId),
          actorId: args.actorId,
          idempotencyKey: conversationSessionIdempotencyKey(
            String(actionRecordId),
            conversationSessionBinding.sourceRevision,
          ),
          result,
        })
      : undefined;
    return {
      ...finalized,
      ...(conversation ? { conversation } : {}),
      ...(groupConversation ? { groupConversation } : {}),
      ...(groupDecision ? { groupDecision } : {}),
      ...(negotiation ? { negotiation } : {}),
      ...(conversationSessionReceipt ? { conversationSessionReceipt } : {}),
    };
  },
});

export const reportActionExecution = internalMutation({
  args: {
    worldId: v.id('worlds'),
    executionId: v.id('actionExecutions'),
    revision: v.number(),
    actorId: v.string(),
    executorId: v.string(),
    status: actionExecutionReportStatusValidator,
    mapId: v.optional(v.string()),
    positionTiles: v.optional(v.object({ x: v.number(), y: v.number() })),
    reasonCode: v.optional(v.string()),
    reportedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      return protocolFailure('execution_not_found', 'The action execution does not exist.');
    }
    if (execution.worldId !== args.worldId) {
      return protocolFailure(
        'execution_world_mismatch',
        'The action execution does not belong to the authenticated world.',
      );
    }
    const latest = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', execution.worldId).eq('actorId', execution.actorId),
      )
      .order('desc')
      .first();
    if (latest && latest.revision !== execution.revision) {
      return protocolFailure('stale_revision', 'A newer action execution revision exists.');
    }
    if (
      ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status) &&
      (execution.expiresAt <= now || execution.hardDeadlineAt <= now)
    ) {
      const deadlineExceeded = execution.hardDeadlineAt <= now;
      const terminal = await terminalizeActionExecution(ctx, execution, now, {
        status: 'interrupted',
        reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
        reason: deadlineExceeded
          ? '持续动作超过最大执行时限，已中断且没有成果。'
          : '持续动作因执行器租约到期而中断。',
      });
      return {
        ...protocolFailure(
          deadlineExceeded ? 'execution_deadline_exceeded' : 'execution_lease_expired',
          deadlineExceeded
            ? 'The action execution hard deadline passed before this report.'
            : 'The action execution lease expired before this report.',
        ),
        execution: executionView({
          ...execution,
          status: 'interrupted',
          terminalAt: now,
          terminalEventId: terminal.eventId,
          resultCode: terminal.result.resultCode,
          reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
        }),
      };
    }

    const decision = evaluateActionExecutionReport(
      execution,
      args as ActionExecutionReport,
      now,
    );
    if (!decision.ok) return decision;
    if (decision.idempotentReplay) {
      return {
        ok: true,
        idempotentReplay: true,
        execution: executionView(execution),
        eventId: execution.terminalEventId,
      };
    }
    const patch = decision.patch!;
    if (patch.status === 'completed') {
      // `completed` 是执行器的请求，不是服务端已经接受的终态。完成重验器
      // 仍需看到原 active 状态，才能在距离/资源/生命失败时真正落成
      // blocked/interrupted；否则 terminalize 会把请求误认作既有终态。
      const terminal = await completeActionExecution(
        ctx,
        { ...execution, ...patch, status: execution.status },
        now,
      );
      const timedSettlement = prepareTimedActionSettlement({
        source: 'action_execution',
        actionType: execution.actionType,
        executionStatus: execution.status,
        reportedStatus: args.status,
        executionId: String(execution._id),
        actionRecordId: String(execution.actionRecordId),
        actorId: execution.actorId,
        executorId: args.executorId,
        revision: execution.revision,
        idempotencyKey: timedActionIdempotencyKey(String(execution._id), execution.revision),
      });
      if (terminal.eventId) {
        await settleExecutionSocialOutcomeIfBound(
          ctx,
          terminal.execution,
          terminal.eventId,
          terminal.result.resultCode,
          now,
        );
      }
      const terminalTraceId = (terminal.execution as typeof terminal.execution & {
        autonomyDecisionTraceId?: Id<'autonomyDecisionTraces'>;
      }).autonomyDecisionTraceId;
      if (terminalTraceId && !terminal.eventId) {
        throw new Error('taixu_result_admission_terminal_event_missing');
      }
      // H5/H6 selective-memory admission represents a successfully embodied
      // result. A blocked/interrupted execution or a target-refused action is
      // still an authoritative terminal, but must not be adopted as a
      // completed habit. Its event remains available to ordinary failure and
      // social-memory paths.
      if (
        terminalTraceId &&
        terminal.eventId &&
        terminal.execution.status === 'completed' &&
        terminal.result.status === 'applied'
      ) {
        await admitServerVerifiedTaixuTerminalResultTx(ctx, {
          worldId: args.worldId,
          traceId: terminalTraceId,
          actionRecordId: terminal.execution.actionRecordId,
          executionId: terminal.execution._id,
          terminalEventId: terminal.eventId,
        });
      }
      const timedActionReceipt =
        timedSettlement.ok &&
        (terminal.execution.status === 'completed' ||
          terminal.execution.status === 'interrupted' ||
          terminal.execution.status === 'blocked')
          ? receiptForTimedActionSettlement({
              request: timedSettlement.request,
              executionTerminal: terminal.execution.status,
              result: terminal.result,
              idempotentReplay: false,
            })
          : undefined;
      return {
        ok: true,
        idempotentReplay: false,
        execution: executionView(terminal.execution),
        result: terminal.result,
        eventId: terminal.eventId,
        ...(timedActionReceipt ? { timedActionReceipt } : {}),
      };
    }
    if (patch.status === 'interrupted' || patch.status === 'blocked') {
      const terminal = await terminalizeActionExecution(ctx, execution, now, {
        status: patch.status,
        reasonCode:
          patch.reasonCode ?? (patch.status === 'blocked' ? 'executor_blocked' : 'cancelled_by_actor'),
        reason:
          patch.status === 'blocked'
            ? '持续动作无法由当前身体执行。'
            : '持续动作已被明确中断。',
      });
      return {
        ok: true,
        idempotentReplay: false,
        execution: executionView(terminal.execution),
        result: terminal.result,
        eventId: terminal.eventId,
      };
    }
    await ctx.db.patch(execution._id, patch);
    return {
      ok: true,
      idempotentReplay: false,
      execution: executionView({ ...execution, ...patch }),
    };
  },
});

export const expireActionExecution = internalMutation({
  args: {
    executionId: v.id('actionExecutions'),
    revision: v.number(),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.revision !== args.revision ||
      TERMINAL_ACTION_EXECUTION_STATUSES.has(execution.status)
    ) {
      return { expired: false, reason: 'execution_inactive' as const };
    }
    const now = Date.now();
    if (execution.expiresAt > now && execution.hardDeadlineAt > now) {
      await ctx.scheduler.runAfter(
        Math.max(1, Math.min(execution.expiresAt, execution.hardDeadlineAt) - now),
        internal.xianxia.actions.expireActionExecution,
        args,
      );
      return { expired: false, reason: 'lease_renewed' as const };
    }
    const deadlineExceeded = execution.hardDeadlineAt <= now;
    const terminal = await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
      reason: deadlineExceeded
        ? '持续动作超过最大执行时限，已中断且没有成果。'
        : '持续动作因执行器租约到期而中断。',
    });
    return { expired: true, eventId: terminal.eventId };
  },
});

// Godot 以稀疏轮询拉取持续动作。这里在同一个服务端事务中
// 清理已过租约，避免 Godot 重连后继续执行旧 revision。
export const prepareActionExecutionGoals = internalMutation({
  args: {
    worldId: v.id('worlds'),
    mapId: v.string(),
    actorId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const goals: ActionExecutionGoal[] = [];
    const terminals: ReturnType<typeof executionView>[] = [];
    for (const status of ['pending', 'accepted', 'acting'] as const) {
      const rows = await ctx.db
        .query('actionExecutions')
        .withIndex('byMapStatus', (q) =>
          q.eq('worldId', args.worldId).eq('mapId', args.mapId).eq('status', status),
        )
        .order('desc')
        .take(64);
      for (const execution of rows) {
        if (args.actorId && execution.actorId !== args.actorId) continue;
        if (execution.expiresAt <= args.now || execution.hardDeadlineAt <= args.now) {
          const deadlineExceeded = execution.hardDeadlineAt <= args.now;
          const terminal = await terminalizeActionExecution(ctx, execution, args.now, {
            status: 'interrupted',
            reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
            reason: deadlineExceeded
              ? '持续动作超过最大执行时限，已中断且没有成果。'
              : '持续动作因执行器租约到期而中断。',
          });
          terminals.push(executionView(terminal.execution));
          continue;
        }
        goals.push(actionExecutionGoalFromDoc(execution));
      }
    }
    for (const status of ['completed', 'interrupted', 'blocked'] as const) {
      const rows = await ctx.db
        .query('actionExecutions')
        .withIndex('byMapStatus', (q) =>
          q.eq('worldId', args.worldId).eq('mapId', args.mapId).eq('status', status),
        )
        .order('desc')
        .take(32);
      for (const execution of rows) {
        if (args.actorId && execution.actorId !== args.actorId) continue;
        if ((execution.terminalAt ?? execution.updatedAt) < args.now - 120_000) continue;
        terminals.push(executionView(execution));
      }
    }
    goals.sort((a, b) => a.issuedAt - b.issuedAt || a.actorId.localeCompare(b.actorId));
    terminals.sort((a, b) => (b.terminalAt ?? b.issuedAt) - (a.terminalAt ?? a.issuedAt));
    return {
      ok: true,
      actionExecutionProtocolVersion: ACTION_EXECUTION_PROTOCOL_VERSION,
      serverTime: args.now,
      goals,
      terminals,
    };
  },
});

async function beginActionExecution(
  ctx: MutationCtx,
  actionRecordId: Id<'actionRecords'>,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    type: string;
    targetActorId?: string;
    locationId?: string;
    metadata?: unknown;
    clientActionId?: string;
  },
  now: number,
  rolled: { seed: string; roll: number; profile: Doc<'xianxiaProfiles'> },
  result: ActionResult,
  executionGoal: ActionExecutionGoal,
  options?: {
    suppressStartEvent?: boolean;
    suppressSeed?: boolean;
    socialOutcomeBinding?: SocialOutcomeBinding;
  },
) {
  const metadata = objectOrEmpty(args.metadata);
  const mapId = typeof metadata.mapId === 'string' ? metadata.mapId : rolled.profile.mapId;
  const source = metadata.client === 'godot' ? 'godot' : undefined;
  const eventId = options?.suppressStartEvent
    ? undefined
    : await appendWorldEvent(ctx, {
        worldId: args.worldId,
        type: result.eventType,
        createdAt: now,
        actorIds: [args.actorId],
        locationId: args.locationId ?? rolled.profile.currentLocationId,
        actionId: actionRecordId,
        visibility: result.visibility,
        summary: result.reason,
        facts: versionDurableEventFacts(
          source
            ? { resultCode: result.resultCode, source }
            : { resultCode: result.resultCode },
        ),
        effects: {},
        mapId,
      });
  // 开始事件用于执行审计/HUD，不进入角色短期记忆；只有终态成果或中断
  // 才产生记忆，避免一次 8 秒吐纳在 Agent 观察中出现两条重复叙事。
  await ctx.db.patch(actionRecordId, {
    status: 'resolving',
    mapId,
    seed: options?.suppressSeed ? undefined : rolled.seed,
  });
  if (options?.socialOutcomeBinding) {
    if (!eventId) throw new Error('social_outcome_start_event_missing');
    const opened = await beginSocialOutcomeTx(ctx, {
      worldId: args.worldId,
      binding: options.socialOutcomeBinding,
      openedByActionId: actionRecordId,
      openedEventId: eventId,
      gameHour: await readGameHour(ctx, args.worldId, now),
      now,
    });
    if (!opened.ok) throw new Error(opened.reasonCode);
  }
  if (
    mapId === QINGLAN_VALLEY_GATE_MAP_ID &&
    (args.type === 'rest' || args.type === 'gather')
  ) {
    await markValleyResidentActionStarted(ctx, {
      worldId: args.worldId,
      actorId: args.actorId,
      actionType: args.type,
      intent: executionGoal.intent,
      now,
    });
  }
  return {
    ...result,
    ...(eventId ? { eventId } : {}),
    actionRecordId,
    clientActionId: args.clientActionId,
    idempotentReplay: false,
    executionGoal,
  };
}

async function createPendingActionExecution(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    actorId: string;
    actionType: string;
    source: 'human' | 'agent' | 'system';
    mapId?: string;
    locationId?: string;
    targetTile?: { x: number; y: number };
    targetActorId?: string;
    encounterId?: string;
    resourceNodeId?: string;
    reservedQuantity?: number;
    cultivationMode?: CultivationMode;
    reservedItemId?: string;
    reservedItemQuantity?: number;
    reservedTargetItemId?: string;
    reservedTargetItemQuantity?: number;
    tradeMode?: 'direct' | 'shop_buy' | 'shop_sell';
    shopId?: string;
    tradeItemId?: string;
    tradeItemQuantity?: number;
    tradeUnitPrice?: number;
    tradeTotalPrice?: number;
    reservedShopItemId?: string;
    reservedShopItemQuantity?: number;
    reservedShopWalletSpiritStones?: number;
    reservedShopCapacityItemId?: string;
    reservedShopCapacityQuantity?: number;
    teachingTopic?: TeachingTopic;
    requestId?: Id<'requests'>;
    requestRevision?: number;
    intent: string;
    durationMs: number;
    now: number;
  },
): Promise<ActionExecutionGoal> {
  const active = await findActiveActionExecution(ctx, args.worldId, args.actorId, args.now);
  if (active) {
    throw new Error(`action_execution_busy: ${args.actorId} already has execution ${active._id}.`);
  }
  const latest = await ctx.db
    .query('actionExecutions')
    .withIndex('byActorRevision', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId),
    )
    .order('desc')
    .first();
  const actionRecord = await ctx.db.get(args.actionRecordId);
  if (!actionRecord || actionRecord.actorId !== args.actorId) {
    throw new Error('action_execution_action_record_invalid');
  }
  const revision = nextActionExecutionRevision(latest ? [latest] : []);
  const expiresAt = args.now + ACTION_EXECUTION_LEASE_MS;
  const hardDeadlineAt = args.now + ACTION_EXECUTION_MAX_RUNTIME_MS;
  const executionId = await ctx.db.insert('actionExecutions', {
    worldId: args.worldId,
    actionRecordId: args.actionRecordId,
    autonomyDecisionTraceId: actionRecord.autonomyDecisionTraceId,
    revision,
    actorId: args.actorId,
    personalGoalId: actionRecord.personalGoalId,
    personalGoalRevision: actionRecord.personalGoalRevision,
    purposeIntentDigest: actionRecord.purposeIntentDigest,
    actionType: args.actionType,
    source: args.source,
    mapId: args.mapId,
    locationId: args.locationId,
    targetTile: args.targetTile,
    targetActorId: args.targetActorId,
    encounterId: args.encounterId,
    resourceNodeId: args.resourceNodeId,
    reservedQuantity: args.reservedQuantity,
    cultivationMode: args.cultivationMode,
    reservedItemId: args.reservedItemId,
    reservedItemQuantity: args.reservedItemQuantity,
    reservedTargetItemId: args.reservedTargetItemId,
    reservedTargetItemQuantity: args.reservedTargetItemQuantity,
    tradeMode: args.tradeMode,
    shopId: args.shopId,
    tradeItemId: args.tradeItemId,
    tradeItemQuantity: args.tradeItemQuantity,
    tradeUnitPrice: args.tradeUnitPrice,
    tradeTotalPrice: args.tradeTotalPrice,
    reservedShopItemId: args.reservedShopItemId,
    reservedShopItemQuantity: args.reservedShopItemQuantity,
    reservedShopWalletSpiritStones: args.reservedShopWalletSpiritStones,
    reservedShopCapacityItemId: args.reservedShopCapacityItemId,
    reservedShopCapacityQuantity: args.reservedShopCapacityQuantity,
    teachingTopic: args.teachingTopic,
    requestId: args.requestId,
    requestRevision: args.requestRevision,
    intent: args.intent,
    status: 'pending',
    durationMs: args.durationMs,
    hardDeadlineAt,
    issuedAt: args.now,
    updatedAt: args.now,
    expiresAt,
  } as never);
  await ctx.scheduler.runAfter(
    ACTION_EXECUTION_LEASE_MS,
    internal.xianxia.actions.expireActionExecution,
    { executionId, revision },
  );
  return {
    protocolVersion: ACTION_EXECUTION_PROTOCOL_VERSION,
    executionId: String(executionId),
    actionRecordId: String(args.actionRecordId),
    revision,
    actorId: args.actorId,
    personalGoalId: actionRecord.personalGoalId,
    personalGoalRevision: actionRecord.personalGoalRevision,
    purposeIntentDigest: actionRecord.purposeIntentDigest,
    actionType: args.actionType,
    status: 'pending',
    mapId: args.mapId,
    locationId: args.locationId,
    targetTile: args.targetTile,
    targetActorId: args.targetActorId,
    encounterId: args.encounterId,
    resourceNodeId: args.resourceNodeId,
    reservedQuantity: args.reservedQuantity,
    cultivationMode: args.cultivationMode,
    reservedItemId: args.reservedItemId,
    reservedItemQuantity: args.reservedItemQuantity,
    reservedTargetItemId: args.reservedTargetItemId,
    reservedTargetItemQuantity: args.reservedTargetItemQuantity,
    tradeMode: args.tradeMode,
    shopId: args.shopId,
    tradeItemId: args.tradeItemId,
    tradeItemQuantity: args.tradeItemQuantity,
    tradeUnitPrice: args.tradeUnitPrice,
    tradeTotalPrice: args.tradeTotalPrice,
    reservedShopItemId: args.reservedShopItemId,
    reservedShopItemQuantity: args.reservedShopItemQuantity,
    reservedShopWalletSpiritStones: args.reservedShopWalletSpiritStones,
    reservedShopCapacityItemId: args.reservedShopCapacityItemId,
    reservedShopCapacityQuantity: args.reservedShopCapacityQuantity,
    teachingTopic: args.teachingTopic,
    requestId: args.requestId ? String(args.requestId) : undefined,
    requestRevision: args.requestRevision,
    intent: args.intent,
    durationMs: args.durationMs,
    hardDeadlineAt,
    issuedAt: args.now,
    expiresAt,
  };
}

async function completeActionExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  if (execution.actionType === 'cultivate') {
    return await completeCultivateExecution(ctx, execution, now);
  }
  if (execution.actionType === 'gather') {
    return await completeGatherExecution(ctx, execution, now);
  }
  if (execution.actionType === 'rest') {
    return await completeRestExecution(ctx, execution, now);
  }
  if (execution.actionType === 'breakthrough') {
    return await completeBreakthroughExecution(ctx, execution, now);
  }
  if (execution.actionType === 'attack') {
    return await completeAttackExecution(ctx, execution, now);
  }
  if (execution.actionType === 'flee') {
    return await completeFleeExecution(ctx, execution, now);
  }
  if (execution.actionType === 'loot') {
    return await completeLootExecution(ctx, execution, now);
  }
  if (execution.actionType === 'gift') {
    return await completeGiftExecution(ctx, execution, now);
  }
  if (execution.actionType === 'trade') {
    return await completeTradeExecution(ctx, execution, now);
  }
  if (execution.actionType === 'request_teaching') {
    return await completeTeachingExecution(ctx, execution, now);
  }
  if (execution.actionType === 'decline_request') {
    return await completeRequestDeclineExecution(ctx, execution, now);
  }
  return await terminalizeActionExecution(ctx, execution, now, {
    status: 'blocked',
    reasonCode: 'completion_revalidation_failed',
    reason: `持续动作 ${execution.actionType} 尚无完成结算器。`,
  });
}

async function completeGiftExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const actorProfile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const targetActorId = execution.targetActorId;
  const targetProfile = targetActorId
    ? await loadProfile(ctx, execution.worldId, targetActorId)
    : null;
  const itemId = execution.reservedItemId;
  const block = async (reasonCode: string, reason: string) =>
    await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode,
      reason,
    });

  if (!record || !actorProfile || !targetActorId || !targetProfile || !itemId) {
    return await block('completion_revalidation_failed', '赠礼的动作、角色、目标或预约物品已经不存在。');
  }
  if (targetActorId === execution.actorId) {
    return await block('gift_self_target', '不能把礼物赠给自己。');
  }
  if (isActorIncapacitated(actorProfile.health)) {
    return await block('actor_incapacitated', `${actorProfile.name}已经失去行动能力。`);
  }
  if (isActorIncapacitated(targetProfile.health)) {
    return await block('target_incapacitated', `${targetProfile.name}已经失去行动能力。`);
  }
  if (!actorsShareLocation(actorProfile, targetProfile, execution.locationId)) {
    return await block('target_not_present', `${targetProfile.name}已不在赠礼发生的地图与地点。`);
  }
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (
    !location ||
    !location.allowedActions.includes('gift') ||
    (location.mapId ?? 'world') !== (execution.mapId ?? 'world')
  ) {
    return await block('location_forbids_gift', '完成时所在地点已不允许赠礼。');
  }
  if (!execution.lastMapId || !execution.lastTile) {
    return await block('gift_body_sample_required', '完成赠礼需要执行器上报可信身体位置。');
  }
  if (execution.lastMapId !== (execution.mapId ?? 'world')) {
    return await block('target_not_present', '赠礼者身体已经离开开始赠礼的地图。');
  }
  const targetBodyTile = await authoritativeActorBodyTile(
    ctx,
    execution.worldId,
    targetActorId,
    execution.lastMapId,
    execution.locationId,
  );
  if (!targetBodyTile) {
    return await block(
      'gift_target_body_unavailable',
      '完成赠礼时找不到目标在当前地点的权威身体。',
    );
  }
  const metadata = objectOrEmpty(record.metadata);
  const range = clampGodotRange(
    typeof metadata.interactionRangeTiles === 'number'
      ? metadata.interactionRangeTiles
      : undefined,
  );
  const distanceTiles = godotTileDistance(execution.lastTile, targetBodyTile);
  if (distanceTiles > range) {
    return await block(
      'target_out_of_range',
      `${targetProfile.name}距离赠礼者 ${Math.round(distanceTiles * 100) / 100} 格，超过 ${range} 格。`,
    );
  }
  if (
    execution.reservedItemQuantity !== 1 ||
    inventoryQuantity(actorProfile.inventory, itemId) < 1
  ) {
    return await block('gift_reservation_lost', '预约的赠礼物品已经不存在。');
  }
  const otherReserved = await activeInventoryReservationQuantity(
    ctx,
    execution.worldId,
    execution.actorId,
    itemId,
    now,
    execution._id,
  );
  if (unreservedGiftQuantity(actorProfile.inventory, itemId, otherReserved) < 1) {
    return await block('gift_reservation_lost', '预约物品已被其他权威动作占用。');
  }

  const gameDay = Math.floor((await readGameHour(ctx, execution.worldId, now)) / 24);
  const cooldown = evaluateGiftActionCooldown(
    gameDay,
    await loadGiftUsageDays(ctx, execution.worldId, execution.actorId, targetActorId),
  );
  if (!cooldown.ok) return await block(cooldown.resultCode, cooldown.reason);

  const targetView = await loadRelationshipDims(
    ctx,
    execution.worldId,
    targetActorId,
    execution.actorId,
    gameDay,
  );
  const refusal = evaluateRefusal({
    actionType: 'gift',
    targetView,
    actorReputation: actorProfile.reputation,
    itemSensitive: isSensitive(itemId),
  });
  const seed = record.seed ?? `${execution.worldId}_${execution.actorId}_gift_${record.createdAt}`;
  const roll = seededRoll(seed);
  const relationship = await loadRelationshipValue(
    ctx,
    execution.worldId,
    execution.actorId,
    targetActorId,
    gameDay,
  );
  const result: ActionResult = refusal.refused
    ? {
        status: 'rejected',
        resultCode: refusal.reasonCode!,
        reason: refusal.reason!,
        effects: {},
        eventType: 'action_refused',
        visibility: 'local',
      }
    : resolveGift({
        actor: toActorSnapshot(actorProfile),
        target: toActorSnapshot(targetProfile),
        itemId,
        relationship,
        roll,
      });

  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  // 先把本 execution 变为终态，使库存结算忽略它自己的预约；mutation
  // 后续任一步失败都会连同此 patch 一起回滚。
  await ctx.db.patch(execution._id, executionPatch);
  const source = metadata.client === 'godot' ? 'godot' as const : undefined;
  const finalized = await finalize(
    ctx,
    execution.actionRecordId,
    {
      worldId: execution.worldId,
      actorId: execution.actorId,
      type: 'gift',
      targetActorId,
      locationId: execution.locationId,
      metadata: record.metadata,
      clientActionId: record.clientActionId,
    },
    now,
    { seed, roll, profile: actorProfile },
    result,
    versionDurableEventFacts({
      resultCode: result.resultCode,
      kind: 'gift',
      actionExecutionId: String(execution._id),
      targetActorId,
      itemId,
      qty: 1,
      sourceGameDay: gameDay,
      distanceTiles: Math.round(distanceTiles * 100) / 100,
      source,
    }),
    { targetActorIds: [targetActorId] },
  );
  const existingUsage = await ctx.db
    .query('socialActionUsages')
    .withIndex('byAction', (q) =>
      q.eq('worldId', execution.worldId).eq('actionRecordId', execution.actionRecordId),
    )
    .first();
  if (!existingUsage) {
    await ctx.db.insert('socialActionUsages', {
      worldId: execution.worldId,
      usageId: `gift:${String(execution.actionRecordId)}`,
      actionRecordId: execution.actionRecordId,
      sourceEventId: finalized.eventId,
      actionType: 'gift',
      actorId: execution.actorId,
      targetActorId,
      sourceGameDay: gameDay,
      outcome: result.resultCode,
      createdAt: now,
    });
  }
  const terminalExecution = {
    ...execution,
    ...executionPatch,
    terminalEventId: finalized.eventId,
  };
  await ctx.db.patch(execution._id, { terminalEventId: finalized.eventId });
  return { execution: terminalExecution, result, eventId: finalized.eventId };
}

async function completeTradeExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const actorProfile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const targetActorId = execution.targetActorId;
  const targetProfile = targetActorId
    ? await loadProfile(ctx, execution.worldId, targetActorId)
    : null;
  const block = async (reasonCode: string, reason: string) =>
    await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode,
      reason,
    });
  if (
    !record ||
    !actorProfile ||
    !targetActorId ||
    !targetProfile ||
    !execution.tradeMode ||
    !execution.reservedItemId ||
    !execution.reservedItemQuantity ||
    !execution.tradeItemId ||
    !execution.tradeItemQuantity ||
    !execution.tradeUnitPrice ||
    !execution.tradeTotalPrice
  ) {
    return await block('completion_revalidation_failed', '交易的动作、参与者、报价或预约已经不存在。');
  }
  if (targetActorId === execution.actorId) return await block('trade_self_target', '不能与自己交易。');
  if (isActorIncapacitated(actorProfile.health)) {
    return await block('actor_incapacitated', `${actorProfile.name}已经失去行动能力。`);
  }
  if (isActorIncapacitated(targetProfile.health)) {
    return await block('target_incapacitated', `${targetProfile.name}已经失去行动能力。`);
  }
  if (!actorsShareLocation(actorProfile, targetProfile, execution.locationId)) {
    return await block('target_not_present', `${targetProfile.name}已不在交易发生的地图与地点。`);
  }
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (
    !location ||
    !location.allowedActions.includes('trade') ||
    (location.mapId ?? 'world') !== (execution.mapId ?? 'world')
  ) {
    return await block('location_forbids_trade', '完成时所在地点已不允许交易。');
  }
  if (!execution.lastMapId || !execution.lastTile) {
    return await block('trade_body_sample_required', '完成交易需要执行器上报可信身体位置。');
  }
  if (execution.lastMapId !== (execution.mapId ?? 'world')) {
    return await block('target_not_present', '交易者身体已经离开开始交易的地图。');
  }
  const targetBodyTile = await authoritativeActorBodyTile(
    ctx,
    execution.worldId,
    targetActorId,
    execution.lastMapId,
    execution.locationId,
  );
  if (!targetBodyTile) {
    return await block('trade_target_body_unavailable', '完成交易时找不到目标在当前地点的权威身体。');
  }
  const metadata = objectOrEmpty(record.metadata);
  const range = clampGodotRange(
    typeof metadata.interactionRangeTiles === 'number'
      ? metadata.interactionRangeTiles
      : undefined,
  );
  const distanceTiles = godotTileDistance(execution.lastTile, targetBodyTile);
  if (distanceTiles > range) {
    return await block(
      'target_out_of_range',
      `${targetProfile.name}距离交易者 ${Math.round(distanceTiles * 100) / 100} 格，超过 ${range} 格。`,
    );
  }

  const actorOtherReserved = await activeInventoryReservationQuantity(
    ctx,
    execution.worldId,
    execution.actorId,
    execution.reservedItemId,
    now,
    execution._id,
  );
  if (
    unreservedTradeQuantity(
      actorProfile.inventory,
      execution.reservedItemId,
      actorOtherReserved,
    ) < execution.reservedItemQuantity
  ) {
    return await block('trade_reservation_lost', '预约的出让物已不存在或被其他权威动作占用。');
  }

  let refreshedShopDoc: Doc<'shopInventories'> | null = null;
  let nextShop: ShopState | null = null;
  let shopFacts: ReturnType<typeof settleReservedShopTrade>['facts'];
  if (execution.tradeMode === 'direct') {
    if (
      !execution.reservedTargetItemId ||
      !execution.reservedTargetItemQuantity
    ) {
      return await block('trade_reservation_lost', '直接交易缺少目标交付物预约。');
    }
    const targetOtherReserved = await activeInventoryReservationQuantity(
      ctx,
      execution.worldId,
      targetActorId,
      execution.reservedTargetItemId,
      now,
      execution._id,
    );
    if (
      unreservedTradeQuantity(
        targetProfile.inventory,
        execution.reservedTargetItemId,
        targetOtherReserved,
      ) < execution.reservedTargetItemQuantity
    ) {
      return await block('trade_reservation_lost', '预约的目标交付物已不存在或被其他权威动作占用。');
    }
  } else {
    if (!execution.shopId) return await block('shop_reservation_lost', '活动交易缺少商店预约。');
    refreshedShopDoc = await ctx.db
      .query('shopInventories')
      .withIndex('byShop', (q) =>
        q.eq('worldId', execution.worldId).eq('shopId', execution.shopId!),
      )
      .first();
    if (
      !refreshedShopDoc ||
      refreshedShopDoc.merchantActorId !== targetActorId ||
      refreshedShopDoc.mapId !== (execution.mapId ?? 'world') ||
      refreshedShopDoc.locationId !== execution.locationId
    ) {
      return await block('shop_reservation_lost', '预约商店已不存在或不再属于当前掌柜与地点。');
    }
    const refreshed = await refreshShopForAction(ctx, refreshedShopDoc, now);
    const other = await activeShopReservations(
      ctx,
      execution.worldId,
      execution.shopId,
      now,
      execution._id,
    );
    const line = refreshed.stock.find((candidate) => candidate.itemId === execution.tradeItemId);
    if (!line) return await block('shop_reservation_lost', '预约商品已不在商店目录。');
    if (execution.tradeMode === 'shop_buy') {
      const available = line.qty - (other.outgoingStock.get(execution.tradeItemId) ?? 0);
      if (
        execution.reservedShopItemId !== execution.tradeItemId ||
        execution.reservedShopItemQuantity !== execution.tradeItemQuantity ||
        available < execution.tradeItemQuantity
      ) {
        return await block('shop_reservation_lost', '预约的货架商品已不存在或被其他权威动作占用。');
      }
    } else {
      const availableCapacity =
        line.capacity - line.qty - (other.incomingStock.get(execution.tradeItemId) ?? 0);
      const availableWallet = refreshed.walletSpiritStones - other.walletSpiritStones;
      if (
        execution.reservedShopCapacityItemId !== execution.tradeItemId ||
        execution.reservedShopCapacityQuantity !== execution.tradeItemQuantity ||
        execution.reservedShopWalletSpiritStones !== execution.tradeTotalPrice ||
        availableCapacity < execution.tradeItemQuantity ||
        availableWallet < execution.tradeTotalPrice
      ) {
        return await block('shop_reservation_lost', '预约的货架容量或店铺资金已不存在。');
      }
    }
  }

  const gameHour = await readGameHour(ctx, execution.worldId, now);
  const gameDay = Math.floor(gameHour / 24);
  const cooldown = evaluateTradeActionCooldown(
    gameHour,
    await loadTradeUsageHours(ctx, execution.worldId, execution.actorId, targetActorId),
  );
  if (!cooldown.ok) return await block(cooldown.resultCode, cooldown.reason);

  const targetView = await loadRelationshipDims(
    ctx,
    execution.worldId,
    targetActorId,
    execution.actorId,
    gameDay,
  );
  const refusal = evaluateRefusal({
    actionType: 'trade',
    targetView,
    actorReputation: actorProfile.reputation,
    itemSensitive: isSensitive(execution.tradeItemId),
  });
  let result: ActionResult;
  if (refusal.refused) {
    result = {
      status: 'rejected',
      resultCode: refusal.reasonCode!,
      reason: refusal.reason!,
      effects: {},
      eventType: 'action_refused',
      visibility: 'local',
    };
  } else if (execution.tradeMode === 'direct') {
    const offeredItemId = execution.reservedItemId;
    const requestedItemId = execution.reservedTargetItemId!;
    const offeredQty = execution.reservedItemQuantity;
    const requestedQty = execution.reservedTargetItemQuantity!;
    const offeredValue = itemBaseValue(offeredItemId) * offeredQty;
    if (offeredItemId !== 'spirit_stone' && offeredValue < execution.tradeTotalPrice) {
      result = {
        status: 'applied',
        resultCode: 'trade_refused',
        reason: `${targetProfile.name}认为这份出价低于冻结报价 ${execution.tradeTotalPrice} 枚灵石，拒绝交换。`,
        effects: {},
        eventType: 'trade_completed',
        visibility: 'local',
      };
    } else {
      result = {
        status: 'applied',
        resultCode: 'trade_completed',
        reason: `${actorProfile.name}与${targetProfile.name}按冻结报价完成了当面交易。`,
        effects: {
          items: [
            { from: actorProfile.actorId, to: targetProfile.actorId, itemId: offeredItemId, qty: offeredQty },
            { from: targetProfile.actorId, to: actorProfile.actorId, itemId: requestedItemId, qty: requestedQty },
          ],
        },
        eventType: 'trade_completed',
        visibility: 'local',
      };
    }
  } else {
    const settlement = settleReservedShopTrade({
      actor: toActorSnapshot(actorProfile),
      shop: await refreshShopForAction(ctx, refreshedShopDoc!, now),
      direction: execution.tradeMode === 'shop_buy' ? 'buy' : 'sell',
      itemId: execution.tradeItemId,
      qty: execution.tradeItemQuantity,
      unitPrice: execution.tradeUnitPrice,
      totalPrice: execution.tradeTotalPrice,
    });
    if (settlement.result.status !== 'applied' || !settlement.facts) {
      return await block('shop_reservation_lost', settlement.result.reason);
    }
    result = settlement.result;
    nextShop = settlement.shop;
    shopFacts = settlement.facts;
  }

  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(execution._id, executionPatch);
  const source = metadata.client === 'godot' ? 'godot' as const : undefined;
  const finalized = await finalize(
    ctx,
    execution.actionRecordId,
    {
      worldId: execution.worldId,
      actorId: execution.actorId,
      type: 'trade',
      targetActorId,
      locationId: execution.locationId,
      metadata: record.metadata,
      clientActionId: record.clientActionId,
    },
    now,
    {
      seed: record.seed ?? `${execution.worldId}_${execution.actorId}_trade_${record.createdAt}`,
      roll: 0,
      profile: actorProfile,
    },
    result,
    versionDurableEventFacts({
      ...(shopFacts ?? {}),
      resultCode: result.resultCode,
      kind: execution.tradeMode === 'direct' ? 'direct_trade' : 'shop_trade',
      actionExecutionId: String(execution._id),
      targetActorId,
      offeredItemId: execution.reservedItemId,
      offeredQty: execution.reservedItemQuantity,
      requestedItemId:
        execution.tradeMode === 'direct' ? execution.reservedTargetItemId : undefined,
      requestedQty:
        execution.tradeMode === 'direct' ? execution.reservedTargetItemQuantity : undefined,
      unitPrice: execution.tradeUnitPrice,
      totalPrice: execution.tradeTotalPrice,
      sourceGameHour: gameHour,
      sourceGameDay: gameDay,
      distanceTiles: Math.round(distanceTiles * 100) / 100,
      source,
    }),
    { targetActorIds: [targetActorId] },
  );
  if (refreshedShopDoc && nextShop) {
    await patchShopState(ctx, refreshedShopDoc._id, nextShop, now);
  }
  const existingUsage = await ctx.db
    .query('socialActionUsages')
    .withIndex('byAction', (q) =>
      q.eq('worldId', execution.worldId).eq('actionRecordId', execution.actionRecordId),
    )
    .first();
  if (!existingUsage) {
    await ctx.db.insert('socialActionUsages', {
      worldId: execution.worldId,
      usageId: `trade:${String(execution.actionRecordId)}`,
      actionRecordId: execution.actionRecordId,
      sourceEventId: finalized.eventId,
      actionType: 'trade',
      actorId: execution.actorId,
      targetActorId,
      sourceGameHour: gameHour,
      sourceGameDay: gameDay,
      outcome: result.resultCode,
      createdAt: now,
    });
  }
  const terminalExecution = {
    ...execution,
    ...executionPatch,
    terminalEventId: finalized.eventId,
  };
  await ctx.db.patch(execution._id, { terminalEventId: finalized.eventId });
  return { execution: terminalExecution, result, eventId: finalized.eventId };
}

async function completeTeachingExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const actorProfile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const targetActorId = execution.targetActorId;
  const targetProfile = targetActorId
    ? await loadProfile(ctx, execution.worldId, targetActorId)
    : null;
  const topic = parseTeachingTopic(execution.teachingTopic);
  const block = async (reasonCode: string, reason: string) =>
    await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode,
      reason,
    });

  if (!record || !actorProfile || !targetActorId || !targetProfile || !topic) {
    return await block(
      'completion_revalidation_failed',
      '求教动作、参与者或课程事实已经不存在。',
    );
  }
  if (targetActorId === execution.actorId) {
    return await block('teaching_self_target', '不能向自己请求指点。');
  }
  if (isActorIncapacitated(actorProfile.health)) {
    return await block('actor_incapacitated', `${actorProfile.name}已经失去行动能力。`);
  }
  if (isActorIncapacitated(targetProfile.health)) {
    return await block('target_incapacitated', `${targetProfile.name}已经失去行动能力。`);
  }
  if (!actorsShareLocation(actorProfile, targetProfile, execution.locationId)) {
    return await block('target_not_present', `${targetProfile.name}已不在求教发生的地图与地点。`);
  }
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (
    !location ||
    !location.allowedActions.includes('request_teaching') ||
    (location.mapId ?? 'world') !== (execution.mapId ?? 'world')
  ) {
    return await block('location_forbids_teaching', '完成时所在地点已不允许当面指点。');
  }
  if (!execution.lastMapId || !execution.lastTile) {
    return await block('teaching_body_sample_required', '完成求教需要执行器上报可信身体位置。');
  }
  if (execution.lastMapId !== (execution.mapId ?? 'world')) {
    return await block('target_not_present', '求教者身体已经离开开始求教的地图。');
  }
  const targetBodyTile = await authoritativeActorBodyTile(
    ctx,
    execution.worldId,
    targetActorId,
    execution.lastMapId,
    execution.locationId,
  );
  if (!targetBodyTile) {
    return await block(
      'teaching_target_body_unavailable',
      '完成求教时找不到师者在当前地点的权威身体。',
    );
  }
  const metadata = objectOrEmpty(record.metadata);
  const range = clampGodotRange(
    typeof metadata.interactionRangeTiles === 'number'
      ? metadata.interactionRangeTiles
      : undefined,
  );
  const distanceTiles = godotTileDistance(execution.lastTile, targetBodyTile);
  if (distanceTiles > range) {
    return await block(
      'target_out_of_range',
      `${targetProfile.name}距离求教者 ${Math.round(distanceTiles * 100) / 100} 格，超过 ${range} 格。`,
    );
  }
  const teacherUnavailable = await activeTeacherUnavailableReason(
    ctx,
    execution.worldId,
    targetActorId,
    now,
    execution._id,
  );
  if (teacherUnavailable) {
    return await block('teacher_unavailable', teacherUnavailable);
  }

  const gameDay = Math.floor((await readGameHour(ctx, execution.worldId, now)) / 24);
  const relationship = await loadRelationshipValue(
    ctx,
    execution.worldId,
    execution.actorId,
    targetActorId,
    gameDay,
  );
  const eligibility = resolveRequestTeaching({
    actor: toActorSnapshot(actorProfile),
    master: toActorSnapshot(targetProfile),
    relationship,
    roll: 1,
  });
  if (eligibility.resultCode !== 'teaching_granted') {
    return await block(eligibility.resultCode, eligibility.reason);
  }
  const cooldown = evaluateTeachingActionCooldown(
    gameDay,
    targetActorId,
    await loadTeachingUsages(ctx, execution.worldId, execution.actorId),
  );
  if (!cooldown.ok) return await block(cooldown.resultCode, cooldown.reason);

  const targetView = await loadRelationshipDims(
    ctx,
    execution.worldId,
    targetActorId,
    execution.actorId,
    gameDay,
  );
  const refusal = evaluateRefusal({
    actionType: 'request_teaching',
    targetView,
    actorReputation: actorProfile.reputation,
  });
  const seed =
    record.seed ?? `${execution.worldId}_${execution.actorId}_request_teaching_${record.createdAt}`;
  const roll = seededRoll(seed);
  const result: ActionResult = refusal.refused
    ? {
        status: 'rejected',
        resultCode: refusal.reasonCode!,
        reason: refusal.reason!,
        effects: {},
        eventType: 'action_refused',
        visibility: 'local',
      }
    : resolveRequestTeaching({
        actor: toActorSnapshot(actorProfile),
        master: toActorSnapshot(targetProfile),
        relationship,
        roll,
      });

  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(execution._id, executionPatch);
  const source = metadata.client === 'godot' ? 'godot' as const : undefined;
  const finalized = await finalize(
    ctx,
    execution.actionRecordId,
    {
      worldId: execution.worldId,
      actorId: execution.actorId,
      type: 'request_teaching',
      targetActorId,
      locationId: execution.locationId,
      metadata: record.metadata,
      clientActionId: record.clientActionId,
    },
    now,
    { seed, roll, profile: actorProfile },
    result,
    versionDurableEventFacts({
      resultCode: result.resultCode,
      kind: 'teaching',
      actionExecutionId: String(execution._id),
      targetActorId,
      teachingTopic: topic,
      sourceGameDay: gameDay,
      distanceTiles: Math.round(distanceTiles * 100) / 100,
      cultivationXpGain: result.effects.cultivationXp ?? 0,
      source,
    }),
    { targetActorIds: [targetActorId] },
  );
  const existingUsage = await ctx.db
    .query('socialActionUsages')
    .withIndex('byAction', (q) =>
      q.eq('worldId', execution.worldId).eq('actionRecordId', execution.actionRecordId),
    )
    .first();
  if (!existingUsage) {
    await ctx.db.insert('socialActionUsages', {
      worldId: execution.worldId,
      usageId: `request_teaching:${String(execution.actionRecordId)}`,
      actionRecordId: execution.actionRecordId,
      sourceEventId: finalized.eventId,
      actionType: 'request_teaching',
      actorId: execution.actorId,
      targetActorId,
      sourceGameDay: gameDay,
      outcome: result.resultCode,
      createdAt: now,
    });
  }
  const terminalExecution = {
    ...execution,
    ...executionPatch,
    terminalEventId: finalized.eventId,
  };
  await ctx.db.patch(execution._id, { terminalEventId: finalized.eventId });
  return { execution: terminalExecution, result, eventId: finalized.eventId };
}

async function completeRequestDeclineExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const actorProfile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const targetActorId = execution.targetActorId;
  const targetProfile = targetActorId
    ? await loadProfile(ctx, execution.worldId, targetActorId)
    : null;
  const request = execution.requestId ? await ctx.db.get(execution.requestId) : null;
  const block = async (reasonCode: string, reason: string) =>
    await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode,
      reason,
    });

  if (
    !record ||
    !actorProfile ||
    !targetActorId ||
    !targetProfile ||
    !request ||
    request.worldId !== execution.worldId ||
    execution.requestRevision === undefined
  ) {
    return await block(
      'completion_revalidation_failed',
      '拒绝委托的动作、参与者、subject 或 revision 已经不存在。',
    );
  }
  if (request.assigneeActorId !== execution.actorId) {
    return await block('request_not_assignee', '只有受托人可以拒绝这桩委托。');
  }
  if (request.issuerActorId !== targetActorId) {
    return await block('request_issuer_mismatch', '拒绝对象不再是这桩委托的原发起者。');
  }
  if (request.status !== 'offered') {
    return await block('request_not_offered', '这桩委托已不再等待答复。');
  }
  if (!requestRevisionMatches(request, execution.requestRevision)) {
    return await block(
      'request_stale_revision',
      `委托已从 revision ${execution.requestRevision} 变化为 ${requestRevision(request)}。`,
    );
  }
  if (isActorIncapacitated(actorProfile.health)) {
    return await block('actor_incapacitated', `${actorProfile.name}已经失去行动能力。`);
  }
  if (isActorIncapacitated(targetProfile.health)) {
    return await block('target_incapacitated', `${targetProfile.name}已经失去行动能力。`);
  }
  if (!actorsShareLocation(actorProfile, targetProfile, execution.locationId)) {
    return await block('target_not_present', `${targetProfile.name}已不在答复发生的地图与地点。`);
  }
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (
    !location ||
    !location.allowedActions.includes('talk') ||
    (location.mapId ?? 'world') !== (execution.mapId ?? 'world')
  ) {
    return await block(
      'location_forbids_request_response',
      '完成答复时所在地点已不允许当面处理委托。',
    );
  }
  const nowGameHour = await readGameHour(ctx, execution.worldId, now);
  if (isRequestExpired(request, nowGameHour)) {
    return await block('request_expired', '这桩委托已经超过期限。');
  }
  if (!execution.lastMapId || !execution.lastTile) {
    return await block(
      'request_actor_body_unavailable',
      '完成拒绝需要执行器上报受托人的可信身体位置。',
    );
  }
  if (execution.lastMapId !== (execution.mapId ?? 'world')) {
    return await block('target_not_present', '受托人的身体已经离开开始答复的地图。');
  }
  const targetBodyTile = await authoritativeActorBodyTile(
    ctx,
    execution.worldId,
    targetActorId,
    execution.lastMapId,
    execution.locationId,
  );
  if (!targetBodyTile) {
    return await block(
      'request_issuer_body_unavailable',
      '完成拒绝时找不到发起者在当前地点的权威身体。',
    );
  }
  const metadata = objectOrEmpty(record.metadata);
  const range = clampGodotRange(
    typeof metadata.interactionRangeTiles === 'number'
      ? metadata.interactionRangeTiles
      : undefined,
  );
  const distanceTiles = godotTileDistance(execution.lastTile, targetBodyTile);
  if (distanceTiles > range) {
    return await block(
      'target_out_of_range',
      `${targetProfile.name}距离受托人 ${Math.round(distanceTiles * 100) / 100} 格，超过 ${range} 格。`,
    );
  }

  const result: ActionResult = {
    status: 'applied',
    resultCode: 'request_declined',
    reason: `${actorProfile.name}当面婉拒了${targetProfile.name}的委托。`,
    effects: {},
    eventType: 'request_declined',
    visibility: 'local',
  };
  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(execution._id, executionPatch);
  const source = metadata.client === 'godot' ? ('godot' as const) : undefined;
  const nextRevision = requestRevision(request) + 1;
  const finalized = await finalize(
    ctx,
    execution.actionRecordId,
    {
      worldId: execution.worldId,
      actorId: execution.actorId,
      type: 'decline_request',
      targetActorId,
      locationId: execution.locationId,
      metadata: record.metadata,
      clientActionId: record.clientActionId,
    },
    now,
    {
      seed:
        record.seed ??
        `${execution.worldId}_${execution.actorId}_decline_request_${record.createdAt}`,
      roll: 0,
      profile: actorProfile,
    },
    result,
    versionDurableEventFacts({
      resultCode: 'request_declined',
      requestType: request.type,
      requestId: String(request._id),
      requestStatus: 'declined',
      fromStatus: 'offered',
      toStatus: 'declined',
      requestRevision: nextRevision,
      actionExecutionId: String(execution._id),
      sourceGameHour: nowGameHour,
      source,
    }),
    { targetActorIds: [targetActorId] },
  );
  await commitRequestTransitionFromAction(ctx, {
    request,
    fromStatus: 'offered',
    toStatus: 'declined',
    expectedRevision: requestRevision(request),
    actionRecordId: execution.actionRecordId,
    eventId: finalized.eventId,
    now,
    nowGameHour,
    patch: { declinedAt: now },
  });
  const existingUsage = await ctx.db
    .query('socialActionUsages')
    .withIndex('byAction', (q) =>
      q.eq('worldId', execution.worldId).eq('actionRecordId', execution.actionRecordId),
    )
    .first();
  if (!existingUsage) {
    await ctx.db.insert('socialActionUsages', {
      worldId: execution.worldId,
      usageId: `decline_request:${String(execution.actionRecordId)}`,
      actionRecordId: execution.actionRecordId,
      sourceEventId: finalized.eventId,
      actionType: 'decline_request',
      actorId: execution.actorId,
      targetActorId,
      sourceGameHour: nowGameHour,
      sourceGameDay: Math.floor(nowGameHour / 24),
      outcome: result.resultCode,
      createdAt: now,
    });
  }
  const terminalExecution = {
    ...execution,
    ...executionPatch,
    terminalEventId: finalized.eventId,
  };
  await ctx.db.patch(execution._id, { terminalEventId: finalized.eventId });
  return { execution: terminalExecution, result, eventId: finalized.eventId };
}

async function activeTeacherUnavailableReason(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  teacherActorId: string,
  now: number,
  excludeExecutionId?: Id<'actionExecutions'>,
): Promise<string | null> {
  const ownExecution = await findActiveActionExecution(ctx, worldId, teacherActorId, now);
  if (ownExecution && ownExecution._id !== excludeExecutionId) {
    return '师者正在执行另一项持续身体动作。';
  }
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const lessons = await ctx.db
      .query('actionExecutions')
      .withIndex('byTargetStatus', (q) =>
        q.eq('worldId', worldId).eq('targetActorId', teacherActorId).eq('status', status),
      )
      .take(64);
    for (const lesson of lessons) {
      if (lesson._id === excludeExecutionId || lesson.actionType !== 'request_teaching') continue;
      if (lesson.expiresAt <= now || lesson.hardDeadlineAt <= now) {
        const deadlineExceeded = lesson.hardDeadlineAt <= now;
        await terminalizeActionExecution(ctx, lesson, now, {
          status: 'interrupted',
          reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
          reason: deadlineExceeded
            ? '持续动作超过最大执行时限，已中断且没有成果。'
            : '持续动作因执行器租约到期而中断。',
        });
        continue;
      }
      return '师者正在指点另一名学生。';
    }
  }
  return null;
}

async function loadTeachingUsages(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  const usages = await ctx.db
    .query('socialActionUsages')
    .withIndex('byActorTargetTypeDay', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    )
    .collect();
  return usages
    .filter((usage) => usage.actionType === 'request_teaching')
    .map((usage) => ({
      targetActorId: usage.targetActorId,
      sourceGameDay: usage.sourceGameDay,
    }));
}

async function authoritativeActorBodyTile(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  mapId: string,
  locationId?: string,
): Promise<GodotTile | undefined> {
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .filter((q) => q.eq(q.field('mapId'), mapId))
    .first();
  if (resident && resident.currentLocationId === locationId) return resident.displayTile;
  if (mapId !== 'world') return undefined;
  const description = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .filter((q) => q.eq(q.field('name'), actorId))
    .first();
  const world = description ? await ctx.db.get(worldId) : null;
  const player = description
    ? world?.players.find((candidate) => candidate.id === description.playerId)
    : undefined;
  return player ? { x: player.position.x, y: player.position.y } : undefined;
}

async function findActiveActionExecution(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
) {
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', worldId).eq('actorId', actorId).eq('status', status),
      )
      .order('desc')
      .first();
    if (!execution) continue;
    if (execution.expiresAt > now && execution.hardDeadlineAt > now) return execution;
    const deadlineExceeded = execution.hardDeadlineAt <= now;
    await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
      reason: deadlineExceeded
        ? '持续动作超过最大执行时限，已中断且没有成果。'
        : '持续动作因执行器租约到期而中断。',
    });
  }
  return null;
}

async function completeCultivateExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const profile = await loadProfile(ctx, execution.worldId, execution.actorId);
  if (!record || !profile) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '完成时找不到原动作或行动者档案，持续动作未结算。',
    });
  }
  if (isActorIncapacitated(profile.health)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'actor_incapacitated',
      reason: `${profile.name}已失去行动能力，修炼中断且没有成果。`,
    });
  }
  if (
    (profile.mapId ?? 'world') !== (execution.mapId ?? 'world') ||
    profile.currentLocationId !== execution.locationId
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `${profile.name}已离开开始修炼的地点，持续动作未结算。`,
    });
  }
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (!location) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '完成时修炼地点已不存在，持续动作未结算。',
    });
  }
  if (!execution.lastMapId || !execution.lastTile) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '完成时缺少 Godot 身体的最新地图或位置确认，持续动作未结算。',
    });
  }
  if (execution.lastMapId !== (execution.mapId ?? 'world')) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `${profile.name}的身体已离开开始修炼的地图，持续动作未结算。`,
    });
  }
  const spatialIssue = evaluateGodotSpatialState({
    type: 'cultivate',
    actorId: execution.actorId,
    mapId: execution.lastMapId,
    locationId: location.locationId,
    actorTile: execution.lastTile,
    actorProfile: profile,
    location,
  });
  if (spatialIssue) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `完成时身体不再位于合法修炼位置：${spatialIssue.reason}`,
    });
  }
  const clockStartedAt = await readClockStartedAt(ctx, execution.worldId);
  const phaseMods =
    clockStartedAt === null ? undefined : phaseModifiers(gameTimeAt(now, clockStartedAt).phase);
  const seed = record.seed ?? `${execution.worldId}_${execution.actorId}_cultivate_${record.createdAt}`;
  const cultivationMode = parseCultivationMode(execution.cultivationMode);
  const cultivationResource = cultivationMode
    ? cultivationResourceForMode(cultivationMode)
    : null;
  if (!cultivationMode) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'cultivation_resource_lost',
      reason: '持续动作的修炼模式无效，无法安全结算。',
    });
  }
  if (
    cultivationResource &&
    (execution.reservedItemId !== cultivationResource.itemId ||
      execution.reservedItemQuantity !== cultivationResource.quantity ||
      inventoryQuantity(profile.inventory, cultivationResource.itemId) <
        cultivationResource.quantity)
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'cultivation_resource_lost',
      reason: `${profile.name}预约的修炼资源已不存在，本次修炼没有成果。`,
    });
  }
  const adjudicated = resolveCultivate({
    actor: toActorSnapshot(profile),
    location: toLocationSnapshot(location),
    roll: seededRoll(seed),
    phaseMods,
    cultivationMode,
  });
  if (adjudicated.status !== 'applied') {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: `完成时条件不再成立：${adjudicated.reason}`,
    });
  }
  const fatigueBefore = normalizeFatigue(profile.fatigue);
  const result: ActionResult = {
    ...adjudicated,
    effects: {
      ...adjudicated.effects,
      fatigue: fatigueAfterCompletedAction(fatigueBefore, 'cultivate') - fatigueBefore,
    },
  };

  const metadata = objectOrEmpty(record.metadata);
  const source = metadata.client === 'godot' ? 'godot' : undefined;
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      cultivationMode,
      itemId: cultivationResource?.itemId,
      qty: cultivationResource?.quantity,
      spiritualEnergy: Math.max(0, Math.min(10, location.spiritualEnergy)),
      cultivationXpGain: result.effects.cultivationXp ?? 0,
      source,
    }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  const nowGameHour = await readGameHour(ctx, execution.worldId, now);
  await generateMemories(
    ctx,
    execution.worldId,
    {
      eventId,
      type: result.eventType,
      visibility: result.visibility,
      actorIds: [execution.actorId],
      locationId: execution.locationId,
      summary: result.reason,
      createdAt: now,
    },
    nowGameHour,
  );
  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  // 先在同一事务中把当前 execution 置为终态，再应用可能使 actor 失能的
  // cultivation_deviation。这样失能清理只会中断其他 active execution，
  // 不会把刚刚合法完成的当前执行改写成 interrupted；后续任一步失败会整体回滚。
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result, { seed, roll: seededRoll(seed) }),
    seed,
  });
  await ctx.db.patch(execution._id, executionPatch);
  const healthTransition =
    result.effects.health === undefined
      ? null
      : resolveHealthTransition({
          currentHealth: profile.health,
          maxHealth: profile.maxHealth,
          delta: result.effects.health,
          now,
          recoveryToken: String(eventId),
        });
  await applyEffects(ctx, profile, result.effects, healthTransition);
  if (healthTransition?.enteredIncapacitation) {
    await enterIncapacitation(ctx, execution.actionRecordId, profile, healthTransition, now);
  } else if (healthTransition?.recoveredFromIncapacitation) {
    await resumeAfterRecovery(ctx, profile, now);
  }
  await applyItemTransfers(ctx, execution.worldId, result.effects.items);
  if (result.effects.cultivationXp !== undefined && !result.effects.realmChange) {
    await autoAdvanceLayers(ctx, execution.worldId, profile.actorId, now);
  }
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeGatherExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const profile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const node = execution.resourceNodeId
    ? await loadResourceNode(ctx, execution.worldId, execution.resourceNodeId)
    : null;
  const quantity = execution.reservedQuantity ?? 0;
  if (!record || !profile || !node || quantity !== 1) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'resource_reservation_lost',
      reason: '完成采集时找不到原动作、角色、节点或有效预约。',
    });
  }
  if (isActorIncapacitated(profile.health)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'actor_incapacitated',
      reason: `${profile.name}已失去行动能力，采集中断且没有成果。`,
    });
  }
  if (
    (profile.mapId ?? 'world') !== execution.mapId ||
    profile.currentLocationId !== execution.locationId ||
    node.mapId !== execution.mapId ||
    node.locationId !== execution.locationId
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `${profile.name}或资源点已不在开始采集的位置。`,
    });
  }
  if (!resourceAccessAllowed(node, profile.actorId)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'resource_forbidden',
      reason: '完成前资源点的所有权发生变化。',
    });
  }
  if (
    execution.lastMapId !== node.mapId ||
    !execution.lastTile ||
    godotTileDistance(execution.lastTile, node.tile) > 2
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'resource_out_of_range',
      reason: '完成采集时身体已不在资源点两格范围内。',
    });
  }

  const refreshed = await refreshResourceNodeDocument(ctx, node, now);
  const consumed = consumeResourceStock(refreshed, quantity, now);
  if (!consumed) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'resource_changed',
      reason: '完成采集时资源库存已不足，预约未产生物品。',
    });
  }
  const result: ActionResult = {
    status: 'applied',
    resultCode: 'gather_completed',
    reason: `${profile.name}从${node.name}采得一株灵草。`,
    effects: {
      fatigue:
        fatigueAfterCompletedAction(profile.fatigue, 'gather') -
        normalizeFatigue(profile.fatigue),
      items: [
        {
          to: profile.actorId,
          itemId: node.itemId,
          qty: quantity,
          sourceResourceNodeId: node.resourceNodeId,
        },
      ],
    },
    eventType: 'gather_completed',
    visibility: 'local',
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      resourceNodeId: node.resourceNodeId,
      itemId: node.itemId,
      qty: quantity,
      stockBefore: refreshed.stock,
      stockAfter: consumed.stock,
    }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(node._id, {
    stock: consumed.stock,
    nextRefreshAt: consumed.nextRefreshAt,
    refreshBlockedUntil: consumed.refreshBlockedUntil,
    refreshBlockedByPressureId: consumed.refreshBlockedByPressureId,
    seasonalRefreshBlockedUntil: consumed.seasonalRefreshBlockedUntil,
    updatedAt: now,
  });
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result),
  });
  await ctx.db.patch(execution._id, executionPatch);
  await applyEffects(ctx, profile, result.effects, null);
  await applyItemTransfers(ctx, execution.worldId, result.effects.items);
  await finishValleyResidentAction(ctx, {
    worldId: execution.worldId,
    actorId: execution.actorId,
    actionType: 'gather',
    fatigueAfter: fatigueAfterCompletedAction(profile.fatigue, 'gather'),
    completed: true,
    now,
  });
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeRestExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const profile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (!record || !profile || !location || !location.allowedActions.includes('rest')) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '完成时休息地点或原动作已不可用。',
    });
  }
  if (isActorIncapacitated(profile.health)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'actor_incapacitated',
      reason: `${profile.name}已失去行动能力，普通休息不能代替伤势恢复。`,
    });
  }
  if (
    (profile.mapId ?? 'world') !== (execution.mapId ?? 'world') ||
    profile.currentLocationId !== execution.locationId ||
    !execution.lastMapId ||
    !execution.lastTile
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `${profile.name}已离开开始休息的位置。`,
    });
  }
  const spatialIssue = evaluateGodotSpatialState({
    type: 'rest',
    actorId: execution.actorId,
    mapId: execution.lastMapId,
    locationId: location.locationId,
    actorTile: execution.lastTile,
    actorProfile: profile,
    location,
  });
  if (spatialIssue) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `完成时身体不在合法休息位置：${spatialIssue.reason}`,
    });
  }
  const fatigueBefore = normalizeFatigue(profile.fatigue);
  const fatigueAfter = fatigueAfterCompletedAction(fatigueBefore, 'rest');
  const result: ActionResult = {
    status: 'applied',
    resultCode: 'rest_completed',
    reason: `${profile.name}在${location.name}安静休息，疲劳由 ${fatigueBefore} 降至 ${fatigueAfter}。`,
    effects: { fatigue: fatigueAfter - fatigueBefore },
    eventType: 'rest_completed',
    visibility: 'local',
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({ resultCode: result.resultCode }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result),
  });
  await ctx.db.patch(execution._id, executionPatch);
  await applyEffects(ctx, profile, result.effects, null);
  await finishValleyResidentAction(ctx, {
    worldId: execution.worldId,
    actorId: execution.actorId,
    actionType: 'rest',
    fatigueAfter,
    completed: true,
    now,
  });
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeBreakthroughExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const profile = await loadProfile(ctx, execution.worldId, execution.actorId);
  const location = execution.locationId
    ? await loadLocation(ctx, execution.worldId, execution.locationId)
    : null;
  if (!record || !profile || !location) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '完成冲关时找不到原动作、角色或突破地点。',
    });
  }
  if (isActorIncapacitated(profile.health)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'actor_incapacitated',
      reason: `${profile.name}已失去行动能力，突破中断且材料未消耗。`,
    });
  }
  if (
    (profile.mapId ?? 'world') !== (execution.mapId ?? 'world') ||
    profile.currentLocationId !== execution.locationId ||
    !execution.lastMapId ||
    !execution.lastTile
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `${profile.name}已离开开始冲关的位置，材料未消耗。`,
    });
  }
  const spatialIssue = evaluateGodotSpatialState({
    type: 'breakthrough',
    actorId: execution.actorId,
    mapId: execution.lastMapId,
    locationId: location.locationId,
    actorTile: execution.lastTile,
    actorProfile: profile,
    location,
  });
  if (spatialIssue) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'location_changed',
      reason: `完成时身体不在合法突破位置：${spatialIssue.reason}`,
    });
  }
  const progress = evaluateBreakthroughProgress({
    realm: profile.realm,
    realmEnteredAt: profile.realmEnteredAt,
    profileCreatedAt: profile._creationTime,
    breakthroughRecoveryUntil: profile.breakthroughRecoveryUntil,
    inventory: profile.inventory,
    now,
  });
  if (!progress.ok) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status:
        progress.resultCode === 'breakthrough_material_unavailable' ? 'blocked' : 'interrupted',
      reasonCode:
        progress.resultCode === 'breakthrough_material_unavailable'
          ? 'breakthrough_material_lost'
          : progress.resultCode!,
      reason: progress.reason!,
    });
  }
  if (
    execution.reservedItemId !== progress.materialItemId ||
    execution.reservedItemQuantity !== progress.materialQuantity
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'breakthrough_material_lost',
      reason: '突破执行中的材料预约与当前境界成本不一致。',
    });
  }

  const seed = record.seed ?? `${execution.worldId}_${execution.actorId}_breakthrough_${record.createdAt}`;
  const roll = seededRoll(seed);
  const adjudicated = resolveBreakthrough({
    actor: toActorSnapshot(profile),
    location: toLocationSnapshot(location),
    roll,
    mishapRoll: seededRoll(`${seed}:mishap`),
  });
  if (adjudicated.status !== 'applied') {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: `完成时突破条件不再成立：${adjudicated.reason}`,
    });
  }
  const success = adjudicated.resultCode === 'breakthrough_success';
  const recoveryUntil = success
    ? undefined
    : now + BREAKTHROUGH_RECOVERY_GAME_HOURS * MS_PER_GAME_HOUR;
  const result: ActionResult = {
    ...adjudicated,
    effects: {
      ...adjudicated.effects,
      items: [
        ...(adjudicated.effects.items ?? []),
        {
          from: profile.actorId,
          itemId: progress.materialItemId,
          qty: progress.materialQuantity,
        },
      ],
      breakthroughProgress: success
        ? { realmEnteredAt: now, clearRecovery: true }
        : { recoveryUntil },
    },
  };
  const metadata = objectOrEmpty(record.metadata);
  const source = metadata.client === 'godot' ? 'godot' : undefined;
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      itemId: progress.materialItemId,
      qty: progress.materialQuantity,
      elapsedMs: progress.elapsedMs,
      requiredDwellMs: progress.requiredDwellMs,
      recoveryUntil,
      source,
    }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  const nowGameHour = await readGameHour(ctx, execution.worldId, now);
  await generateMemories(
    ctx,
    execution.worldId,
    {
      eventId,
      type: result.eventType,
      visibility: result.visibility,
      actorIds: [execution.actorId],
      locationId: execution.locationId,
      summary: result.reason,
      createdAt: now,
    },
    nowGameHour,
  );
  const executionPatch = {
    status: 'completed' as const,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result, { seed, roll }),
    seed,
  });
  await ctx.db.patch(execution._id, executionPatch);
  const healthTransition =
    result.effects.health === undefined
      ? null
      : resolveHealthTransition({
          currentHealth: profile.health,
          maxHealth: profile.maxHealth,
          delta: result.effects.health,
          now,
          recoveryToken: String(eventId),
        });
  await applyEffects(ctx, profile, result.effects, healthTransition);
  if (healthTransition?.enteredIncapacitation) {
    await enterIncapacitation(ctx, execution.actionRecordId, profile, healthTransition, now);
  }
  await applyItemTransfers(ctx, execution.worldId, result.effects.items);
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeAttackExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const attacker = await loadProfile(ctx, execution.worldId, execution.actorId);
  const defender = execution.targetActorId
    ? await loadProfile(ctx, execution.worldId, execution.targetActorId)
    : null;
  const encounter = execution.encounterId
    ? await loadCombatEncounter(ctx, execution.worldId, execution.encounterId)
    : null;
  if (!record || !attacker || !defender || !encounter) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '攻击完成时找不到原动作、参与者或冲突事实。',
    });
  }
  if (encounter.status !== 'active') {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'combat_encounter_inactive',
      reason: '这场冲突已经结束，不能再结算伤害。',
    });
  }
  if (isActorIncapacitated(attacker.health) || isActorIncapacitated(defender.health)) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: isActorIncapacitated(attacker.health)
        ? 'actor_incapacitated'
        : 'target_incapacitated',
      reason: '攻击完成前其中一方已经失去行动能力。',
    });
  }
  if (
    !actorsShareLocation(attacker, defender, execution.locationId) ||
    !execution.lastMapId ||
    !execution.lastTile ||
    execution.lastMapId !== (execution.mapId ?? 'world')
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'combat_target_changed',
      reason: '攻击完成前双方或 Godot 身体已经离开原冲突位置。',
    });
  }
  const seed = record.seed ?? `${execution.worldId}_${execution.actorId}_attack_${record.createdAt}`;
  const roll = seededRoll(seed);
  const damage = resolveAttackDamage({
    attacker: toActorSnapshot(attacker),
    defender: toActorSnapshot(defender),
    roll,
  });
  const transition = resolveHealthTransition({
    currentHealth: defender.health,
    maxHealth: defender.maxHealth,
    delta: -damage,
    now,
    recoveryToken: `pending:${String(execution.actionRecordId)}`,
  });
  const observers = await currentCombatObservers(ctx, execution.worldId, attacker, [
    attacker.actorId,
    defender.actorId,
  ]);
  const guardActorIds = uniqueStrings([...encounter.guardActorIds, ...observers.guardActorIds]);
  const witnessActorIds = uniqueStrings([
    ...encounter.witnessActorIds,
    ...observers.witnessActorIds,
  ]);
  const defeated = transition.enteredIncapacitation;
  const guardPenalty = guardActorIds.length > 0 ? GUARD_ATTACK_REPUTATION_DELTA : 0;
  const result: ActionResult = {
    status: 'applied',
    resultCode: defeated ? 'combat_target_defeated' : 'combat_attack_hit',
    reason: defeated
      ? `${attacker.name}击倒了${defender.name}。`
      : `${attacker.name}击中${defender.name}，造成 ${damage} 点气血损失。`,
    effects: guardPenalty ? { reputation: guardPenalty } : {},
    eventType: defeated ? 'combatant_defeated' : 'combat_attack_resolved',
    visibility: witnessActorIds.length > 0 ? 'witnessed' : 'local',
  };
  const eventFacts = versionDurableEventFacts({
    resultCode: result.resultCode,
    encounterId: encounter.encounterId,
    targetActorId: defender.actorId,
    damage,
    defeated,
    lootProtectedUntil: defeated ? now + LOOT_PROTECTION_MS : undefined,
    guardActorIds,
    source: objectOrEmpty(record.metadata).client === 'godot' ? 'godot' : undefined,
  });
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [attacker.actorId],
    targetActorIds: [defender.actorId],
    witnessActorIds,
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: eventFacts,
    effects: result.effects,
    mapId: execution.mapId,
  });
  const actionGameHour = await readGameHour(ctx, execution.worldId, now);
  const grievanceDraft = deriveGrievanceSocialConsequenceDraft({
    actionId: String(record._id),
    actionType: record.type,
    actorId: record.actorId,
    targetActorId: record.targetActorId,
    executionActionId: String(execution.actionRecordId),
    executionActorId: execution.actorId,
    executionTargetActorId: execution.targetActorId,
    event: {
      _id: String(eventId),
      worldId: String(execution.worldId),
      type: result.eventType,
      actorIds: [attacker.actorId],
      targetActorIds: [defender.actorId],
      actionId: String(execution.actionRecordId),
      facts: eventFacts,
    },
    gameHour: Math.floor(actionGameHour),
  });
  if (!grievanceDraft) throw new Error('lwse_1c_grievance_owner_invalid');
  await insertDerivedSocialConsequencesTx(ctx, {
    worldId: execution.worldId,
    drafts: [grievanceDraft],
    now,
  });
  await generateConflictMemories(ctx, execution.worldId, eventId, result, {
    actorIds: [attacker.actorId],
    targetActorIds: [defender.actorId],
    witnessActorIds,
    locationId: execution.locationId,
    now,
  });
  const correctedTransition = defeated
    ? { ...transition, recoveryToken: String(eventId) }
    : transition;
  await applyEffects(ctx, defender, { health: -damage }, correctedTransition);
  if (guardPenalty) await applyEffects(ctx, attacker, { reputation: guardPenalty }, null);
  const relationshipGameDay = Math.floor(actionGameHour / 24);
  await applyRelationshipEvent(
    ctx,
    execution.worldId,
    defender.actorId,
    attacker.actorId,
    { affinity: defeated ? -18 : -10, suspicion: 20, fear: defeated ? 15 : 8 },
    eventId,
    'assault',
    relationshipGameDay,
    now,
  );
  await applyGuardWitnessConsequences(
    ctx,
    execution.worldId,
    guardActorIds,
    attacker.actorId,
    eventId,
    relationshipGameDay,
    now,
  );
  const encounterPatch = defeated
    ? {
        status: (encounter.attackerActorId === defender.actorId
          ? 'attacker_defeated'
          : 'defender_defeated') as 'attacker_defeated' | 'defender_defeated',
        winnerActorId: attacker.actorId,
        defeatedActorId: defender.actorId,
        lootOwnerActorId: attacker.actorId,
        lootProtectedUntil: now + LOOT_PROTECTION_MS,
        terminalActionId: execution.actionRecordId,
        terminalEventId: eventId,
        witnessActorIds,
        guardActorIds,
        closedAt: now,
        updatedAt: now,
      }
    : { witnessActorIds, guardActorIds, updatedAt: now };
  await ctx.db.patch(encounter._id, encounterPatch);
  const executionPatch = completedExecutionPatch(eventId, result.resultCode, now);
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result, { seed, roll }),
    seed,
  });
  await ctx.db.patch(execution._id, executionPatch);
  if (defeated) {
    await enterIncapacitation(ctx, execution.actionRecordId, defender, correctedTransition, now);
    await rippleVictimGrudges(
      ctx,
      execution.worldId,
      defender.actorId,
      attacker.actorId,
      12,
      eventId,
      relationshipGameDay,
      now,
    );
  }
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeFleeExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const fleeing = await loadProfile(ctx, execution.worldId, execution.actorId);
  const opponent = execution.targetActorId
    ? await loadProfile(ctx, execution.worldId, execution.targetActorId)
    : null;
  const encounter = execution.encounterId
    ? await loadCombatEncounter(ctx, execution.worldId, execution.encounterId)
    : null;
  if (!record || !fleeing || !opponent || !encounter || encounter.status !== 'active') {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: encounter ? 'combat_encounter_inactive' : 'combat_encounter_not_found',
      reason: '逃跑完成时原冲突已经不存在或结束。',
    });
  }
  if (
    isActorIncapacitated(fleeing.health) ||
    isActorIncapacitated(opponent.health) ||
    !actorsShareLocation(fleeing, opponent, execution.locationId) ||
    !execution.lastMapId ||
    !execution.lastTile
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'combat_target_changed',
      reason: '逃跑完成前参与者或身体位置已经改变。',
    });
  }
  const seed = record.seed ?? `${execution.worldId}_${execution.actorId}_flee_${record.createdAt}`;
  const roll = seededRoll(seed);
  const flee = resolveFlee({
    fleeing: toActorSnapshot(fleeing),
    opponent: toActorSnapshot(opponent),
    roll,
  });
  const transition = flee.escaped
    ? null
    : resolveHealthTransition({
        currentHealth: fleeing.health,
        maxHealth: fleeing.maxHealth,
        delta: -1,
        now,
        recoveryToken: `pending:${String(execution.actionRecordId)}`,
      });
  const defeated = transition?.enteredIncapacitation ?? false;
  const result: ActionResult = {
    status: 'applied',
    resultCode: flee.escaped
      ? 'combat_flee_succeeded'
      : defeated
        ? 'combat_flee_defeated'
        : 'combat_flee_failed',
    reason: flee.escaped
      ? `${fleeing.name}成功脱离了与${opponent.name}的冲突。`
      : defeated
        ? `${fleeing.name}逃跑失败，被${opponent.name}反击后失去行动能力。`
        : `${fleeing.name}未能脱身，并在追击中损失 1 点气血。`,
    effects: flee.escaped ? {} : { health: -1 },
    eventType: flee.escaped ? 'combatant_fled' : defeated ? 'combatant_defeated' : 'combat_flee_failed',
    visibility: encounter.witnessActorIds.length > 0 ? 'witnessed' : 'local',
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [fleeing.actorId],
    targetActorIds: [opponent.actorId],
    witnessActorIds: encounter.witnessActorIds,
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      encounterId: encounter.encounterId,
      targetActorId: opponent.actorId,
      escaped: flee.escaped,
      damage: flee.escaped ? undefined : 1,
      defeated,
      lootProtectedUntil: defeated ? now + LOOT_PROTECTION_MS : undefined,
      guardActorIds: encounter.guardActorIds,
      source: objectOrEmpty(record.metadata).client === 'godot' ? 'godot' : undefined,
    }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  await generateConflictMemories(ctx, execution.worldId, eventId, result, {
    actorIds: [fleeing.actorId],
    targetActorIds: [opponent.actorId],
    witnessActorIds: encounter.witnessActorIds,
    locationId: execution.locationId,
    now,
  });
  if (transition) {
    const corrected = defeated ? { ...transition, recoveryToken: String(eventId) } : transition;
    await applyEffects(ctx, fleeing, { health: -1 }, corrected);
    if (defeated) await enterIncapacitation(ctx, execution.actionRecordId, fleeing, corrected, now);
  }
  await ctx.db.patch(encounter._id, flee.escaped
    ? {
        status: encounter.attackerActorId === fleeing.actorId ? 'attacker_fled' : 'defender_fled',
        terminalActionId: execution.actionRecordId,
        terminalEventId: eventId,
        closedAt: now,
        updatedAt: now,
      }
    : defeated
      ? {
          status: encounter.attackerActorId === fleeing.actorId ? 'attacker_defeated' : 'defender_defeated',
          winnerActorId: opponent.actorId,
          defeatedActorId: fleeing.actorId,
          lootOwnerActorId: opponent.actorId,
          lootProtectedUntil: now + LOOT_PROTECTION_MS,
          terminalActionId: execution.actionRecordId,
          terminalEventId: eventId,
          closedAt: now,
          updatedAt: now,
        }
      : { updatedAt: now });
  const executionPatch = completedExecutionPatch(eventId, result.resultCode, now);
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result, { seed, roll }),
    seed,
  });
  await ctx.db.patch(execution._id, executionPatch);
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function completeLootExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
) {
  const record = await ctx.db.get(execution.actionRecordId);
  const looter = await loadProfile(ctx, execution.worldId, execution.actorId);
  const target = execution.targetActorId
    ? await loadProfile(ctx, execution.worldId, execution.targetActorId)
    : null;
  const encounter = execution.encounterId
    ? await loadCombatEncounter(ctx, execution.worldId, execution.encounterId)
    : null;
  const itemId = execution.reservedTargetItemId;
  if (!record || !looter || !target || !encounter || !itemId) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'completion_revalidation_failed',
      reason: '掠夺完成时找不到原动作、参与者、物品预约或击倒事实。',
    });
  }
  if (
    encounter.defeatedActorId !== target.actorId ||
    !isActorIncapacitated(target.health) ||
    !actorsShareLocation(looter, target, execution.locationId) ||
    !execution.lastMapId ||
    !execution.lastTile
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'interrupted',
      reasonCode: 'loot_target_not_defeated',
      reason: '掠夺完成时目标已恢复、离场或不再对应原击倒事实。',
    });
  }
  if (!lootPriorityAllows({
    actorId: looter.actorId,
    lootOwnerActorId: encounter.lootOwnerActorId,
    lootProtectedUntil: encounter.lootProtectedUntil,
    now,
  })) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'loot_protected',
      reason: '完成时战利品仍属于另一名击倒者的保护期。',
    });
  }
  if (
    execution.reservedTargetItemQuantity !== 1 ||
    (target.inventory?.find((item) => item.itemId === itemId)?.qty ?? 0) < 1
  ) {
    return await terminalizeActionExecution(ctx, execution, now, {
      status: 'blocked',
      reasonCode: 'loot_reservation_lost',
      reason: '预约的最后一件战利品已不存在。',
    });
  }
  const observers = await currentCombatObservers(ctx, execution.worldId, looter, [
    looter.actorId,
    target.actorId,
  ]);
  const guardPenalty = observers.guardActorIds.length > 0 ? GUARD_LOOT_REPUTATION_DELTA : 0;
  const result: ActionResult = {
    status: 'applied',
    resultCode: 'combat_loot_completed',
    reason: `${looter.name}从失能的${target.name}处取走一件「${itemId}」。`,
    effects: {
      ...(guardPenalty ? { reputation: guardPenalty } : {}),
      items: [{ from: target.actorId, to: looter.actorId, itemId, qty: 1 }],
    },
    eventType: 'combat_loot_completed',
    visibility: observers.witnessActorIds.length > 0 ? 'witnessed' : 'local',
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [looter.actorId],
    targetActorIds: [target.actorId],
    witnessActorIds: observers.witnessActorIds,
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      encounterId: encounter.encounterId,
      targetActorId: target.actorId,
      itemId,
      qty: 1,
      guardActorIds: observers.guardActorIds,
      source: objectOrEmpty(record.metadata).client === 'godot' ? 'godot' : undefined,
    }),
    effects: result.effects,
    mapId: execution.mapId,
  });
  await transferExactInventoryItem(ctx, target, looter, itemId);
  if (guardPenalty) await applyEffects(ctx, looter, { reputation: guardPenalty }, null);
  const relationshipGameDay = Math.floor((await readGameHour(ctx, execution.worldId, now)) / 24);
  await applyGuardWitnessConsequences(
    ctx,
    execution.worldId,
    observers.guardActorIds,
    looter.actorId,
    eventId,
    relationshipGameDay,
    now,
  );
  await generateConflictMemories(ctx, execution.worldId, eventId, result, {
    actorIds: [looter.actorId],
    targetActorIds: [target.actorId],
    witnessActorIds: observers.witnessActorIds,
    locationId: execution.locationId,
    now,
  });
  await ctx.db.patch(encounter._id, {
    witnessActorIds: uniqueStrings([...encounter.witnessActorIds, ...observers.witnessActorIds]),
    guardActorIds: uniqueStrings([...encounter.guardActorIds, ...observers.guardActorIds]),
    updatedAt: now,
  });
  const executionPatch = completedExecutionPatch(eventId, result.resultCode, now);
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result, {
      seed: record.seed ?? `${execution.worldId}_${execution.actorId}_loot_${record.createdAt}`,
      roll: 0,
    }),
  });
  await ctx.db.patch(execution._id, executionPatch);
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

function completedExecutionPatch(
  eventId: Id<'worldEvents'>,
  resultCode: string,
  now: number,
) {
  return {
    status: 'completed' as const,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode,
    reasonCode: undefined,
    updatedAt: now,
  };
}

async function terminalizeActionExecution(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
  terminal: {
    status: 'interrupted' | 'blocked';
    reasonCode: string;
    reason: string;
  },
) {
  if (TERMINAL_ACTION_EXECUTION_STATUSES.has(execution.status)) {
    const record = await ctx.db.get(execution.actionRecordId);
    const result = (record?.result ?? {
      status: terminal.status === 'blocked' ? 'rejected' : 'interrupted',
      resultCode: execution.resultCode ?? terminal.reasonCode,
      reason: terminal.reason,
      effects: {},
      eventType:
        terminal.status === 'blocked'
          ? 'action_execution_blocked'
          : 'action_execution_interrupted',
      visibility: 'local',
    }) as ActionResult;
    return { execution, result, eventId: execution.terminalEventId };
  }
  const result: ActionResult = {
    status: terminal.status === 'blocked' ? 'rejected' : 'interrupted',
    resultCode: terminal.reasonCode,
    reason: terminal.reason,
    effects: {},
    eventType:
      terminal.status === 'blocked' ? 'action_execution_blocked' : 'action_execution_interrupted',
    visibility: 'local',
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts: versionDurableEventFacts({ resultCode: result.resultCode }),
    effects: {},
    mapId: execution.mapId,
  });
  const nowGameHour = await readGameHour(ctx, execution.worldId, now);
  await generateMemories(
    ctx,
    execution.worldId,
    {
      eventId,
      type: result.eventType,
      visibility: result.visibility,
      actorIds: [execution.actorId],
      locationId: execution.locationId,
      summary: result.reason,
      createdAt: now,
    },
    nowGameHour,
  );
  await ctx.db.patch(execution.actionRecordId, {
    status: terminal.status === 'blocked' ? 'rejected' : 'interrupted',
    result: toDurableActionResult(result),
  });
  const executionPatch = {
    status: terminal.status,
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: terminal.reasonCode,
    updatedAt: now,
  };
  await ctx.db.patch(execution._id, executionPatch);
  if (
    execution.actionType === 'travel' &&
    (execution.mapId ?? 'world') === 'world'
  ) {
    const playerId = await findPlayerIdByName(
      ctx,
      execution.worldId,
      execution.actorId,
    );
    if (playerId) {
      // The semantic terminal must fence the physical body as well. Otherwise
      // an interrupted/expired travel can retain its old AI Town path and keep
      // moving after the ActionRecord is already terminal.
      await insertInput(ctx, execution.worldId, 'moveTo', {
        playerId,
        destination: null,
      });
    }
  }
  if (
    execution.mapId === QINGLAN_VALLEY_GATE_MAP_ID &&
    (execution.actionType === 'rest' || execution.actionType === 'gather')
  ) {
    await finishValleyResidentAction(ctx, {
      worldId: execution.worldId,
      actorId: execution.actorId,
      actionType: execution.actionType,
      completed: false,
      now,
    });
  }
  await settleExecutionSocialOutcomeIfBound(ctx, {
    ...execution,
    ...executionPatch,
  }, eventId, result.resultCode, now);
  return { execution: { ...execution, ...executionPatch }, result, eventId };
}

async function settleExecutionSocialOutcomeIfBound(
  ctx: MutationCtx,
  execution: Pick<Doc<'actionExecutions'>, 'worldId' | 'actionRecordId'>,
  terminalEventId: Id<'worldEvents'>,
  resultCode: string,
  now: number,
) {
  const gameHour = await readGameHour(ctx, execution.worldId, now);
  const settled = await settleActionSocialOutcomeTx(ctx, {
    worldId: execution.worldId,
    actionRecordId: execution.actionRecordId,
    terminalEventId,
    resultCode,
    gameHour,
    now,
  });
  if (!settled.ok) throw new Error(settled.reasonCode);
  if ('unbound' in settled || settled.receipt.status === 'pending') return;
  const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
    worldId: execution.worldId,
    outcomeId: settled.receipt.outcomeId,
    now,
    gameHour,
  });
  if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
}

function executionView(execution: Doc<'actionExecutions'>) {
  return {
    protocolVersion: ACTION_EXECUTION_PROTOCOL_VERSION,
    executionId: execution._id,
    actionRecordId: execution.actionRecordId,
    revision: execution.revision,
    actorId: execution.actorId,
    personalGoalId: execution.personalGoalId,
    personalGoalRevision: execution.personalGoalRevision,
    purposeIntentDigest: execution.purposeIntentDigest,
    actionType: execution.actionType,
    status: execution.status,
    leaseOwner: execution.leaseOwner,
    source: execution.source,
    mapId: execution.mapId,
    locationId: execution.locationId,
    targetTile: execution.targetTile,
    targetActorId: execution.targetActorId,
    encounterId: execution.encounterId,
    resourceNodeId: execution.resourceNodeId,
    reservedQuantity: execution.reservedQuantity,
    cultivationMode: execution.cultivationMode,
    reservedItemId: execution.reservedItemId,
    reservedItemQuantity: execution.reservedItemQuantity,
    reservedTargetItemId: execution.reservedTargetItemId,
    reservedTargetItemQuantity: execution.reservedTargetItemQuantity,
    tradeMode: execution.tradeMode,
    shopId: execution.shopId,
    tradeItemId: execution.tradeItemId,
    tradeItemQuantity: execution.tradeItemQuantity,
    tradeUnitPrice: execution.tradeUnitPrice,
    tradeTotalPrice: execution.tradeTotalPrice,
    reservedShopItemId: execution.reservedShopItemId,
    reservedShopItemQuantity: execution.reservedShopItemQuantity,
    reservedShopWalletSpiritStones: execution.reservedShopWalletSpiritStones,
    reservedShopCapacityItemId: execution.reservedShopCapacityItemId,
    reservedShopCapacityQuantity: execution.reservedShopCapacityQuantity,
    teachingTopic: execution.teachingTopic,
    requestId: execution.requestId,
    requestRevision: execution.requestRevision,
    intent: execution.intent,
    durationMs: execution.durationMs,
    hardDeadlineAt: execution.hardDeadlineAt,
    lastMapId: execution.lastMapId,
    lastTile: execution.lastTile,
    acceptedAt: execution.acceptedAt,
    startedAt: execution.startedAt,
    lastHeartbeatAt: execution.lastHeartbeatAt,
    terminalAt: execution.terminalAt,
    terminalEventId: execution.terminalEventId,
    resultCode: execution.resultCode,
    reasonCode: execution.reasonCode,
    issuedAt: execution.issuedAt,
    updatedAt: execution.updatedAt,
    expiresAt: execution.expiresAt,
  };
}

function protocolFailure(code: string, reason: string) {
  return { ok: false as const, code, reason };
}

async function refreshShopForAction(
  ctx: MutationCtx,
  shop: Doc<'shopInventories'>,
  now: number,
): Promise<ShopState> {
  const refreshed = refreshShopState(shop, now);
  if (!refreshed.changed) return refreshed.shop;
  await patchShopState(ctx, shop._id, refreshed.shop, now);
  if (
    refreshed.periods > 0 &&
    (refreshed.stockAdded.length > 0 || refreshed.walletAdded > 0)
  ) {
    await appendWorldEvent(ctx, {
      worldId: shop.worldId,
      type: 'shop_restocked',
      createdAt: now,
      actorIds: [shop.merchantActorId],
      locationId: shop.locationId,
      visibility: 'local',
      summary: `${shop.name}收到来自${shop.restockSourceId}的周期补给。`,
      facts: versionDurableEventFacts({
        resultCode: 'shop_restocked',
        shopId: shop.shopId,
        restockSourceId: shop.restockSourceId,
        periods: refreshed.periods,
        walletAdded: refreshed.walletAdded,
        stockAdded: refreshed.stockAdded,
      }),
      mapId: shop.mapId,
    });
  }
  return refreshed.shop;
}

async function patchShopState(
  ctx: MutationCtx,
  shopId: Id<'shopInventories'>,
  shop: ShopState,
  now: number,
) {
  await ctx.db.patch(shopId, {
    stock: shop.stock,
    walletSpiritStones: shop.walletSpiritStones,
    walletCapacity: shop.walletCapacity,
    nextRestockAt: shop.nextRestockAt,
    updatedAt: now,
  });
}

// —— 收尾：写事件 → 应用 effects（含物品）→ patch actionRecord → 返回结果 ——
async function finalize(
  ctx: MutationCtx,
  actionRecordId: Id<'actionRecords'>,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    type: string;
    targetActorId?: string;
    locationId?: string;
    metadata?: unknown;
    clientActionId?: string;
  },
  now: number,
  rolled: { seed: string; roll: number; profile: Doc<'xianxiaProfiles'> } | null,
  result: ActionResult,
  eventFacts?: DurableEventFacts,
  eventAudience?: { targetActorIds?: string[]; witnessActorIds?: string[] },
) {
  const metadata = objectOrEmpty(args.metadata);
  const mapId = typeof metadata.mapId === 'string' ? metadata.mapId : rolled?.profile.mapId;
  const eventMapId =
    result.status === 'applied' && result.effects.locationChange
      ? result.effects.locationChange.toMapId
      : mapId;
  const eventLocationId =
    result.status === 'applied' && result.effects.locationChange
      ? result.effects.locationChange.toLocationId
      : args.locationId ?? rolled?.profile.currentLocationId;
  const source = metadata.client === 'godot' ? 'godot' : undefined;
  // 所有结果都进事件日志（拒绝也记，便于回看「为什么失败」），可见性由规则给出。
  // witnessed 可见性默认把目标记为目击者。
  const eventId = await appendWorldEvent(ctx, {
    worldId: args.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [args.actorId],
    targetActorIds: eventAudience?.targetActorIds ?? (args.targetActorId ? [args.targetActorId] : undefined),
    witnessActorIds:
      eventAudience?.witnessActorIds ??
      (result.visibility === 'witnessed' && args.targetActorId ? [args.targetActorId] : undefined),
    locationId: eventLocationId,
    actionId: actionRecordId,
    visibility: result.visibility,
    summary: result.reason,
    facts:
      eventFacts ??
      versionDurableEventFacts(
        source ? { resultCode: result.resultCode, source } : { resultCode: result.resultCode },
      ),
    effects: result.effects,
    mapId: eventMapId,
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
      targetActorIds: eventAudience?.targetActorIds ?? (args.targetActorId ? [args.targetActorId] : undefined),
      witnessActorIds:
        eventAudience?.witnessActorIds ??
        (result.visibility === 'witnessed' && args.targetActorId ? [args.targetActorId] : undefined),
      locationId: eventLocationId,
      summary: result.reason,
      createdAt: now,
    },
    nowGameHour,
  );

  if (result.status === 'applied' && rolled) {
    const healthTransition =
      result.effects.health === undefined
        ? null
        : resolveHealthTransition({
            currentHealth: rolled.profile.health,
            maxHealth: rolled.profile.maxHealth,
            delta: result.effects.health,
            now,
            recoveryToken: String(eventId),
          });
    await applyEffects(ctx, rolled.profile, result.effects, healthTransition);
    if (healthTransition?.enteredIncapacitation) {
      await enterIncapacitation(ctx, actionRecordId, rolled.profile, healthTransition, now);
    } else if (healthTransition?.recoveredFromIncapacitation) {
      await resumeAfterRecovery(ctx, rolled.profile, now);
    }
    await applyItemTransfers(ctx, args.worldId, result.effects.items);
    // C015b：把规则层 actor→target 变化与已验证结果的多维反应先合并，再让同一
    // source event / direction / effectKind 只落一条审计 application。
    // LWSE-0 G0：conversation_started 的两处输入均为空，因此不会形成空审计行。
    if (args.targetActorId) {
      const gameDay = Math.floor(nowGameHour / 24);
      const relEffect = relationshipEffectFor(result.resultCode);
      const effectKind = relationshipEffectKindFor(result.resultCode);
      const rulesActorToTarget = mergeDimDeltas(
        ...(result.effects.relationships ?? [])
          .filter((relationship) => relationship.targetActorId === args.targetActorId)
          .map((relationship) => ({ affinity: relationship.delta })),
      );
      const actorToTarget = mergeDimDeltas(rulesActorToTarget, relEffect.actorToTarget);
      const targetToActor = mergeDimDeltas(relEffect.targetToActor);
      const hasActorToTarget = Object.values(actorToTarget).some((value) => value !== 0);
      const hasTargetToActor = Object.values(targetToActor).some((value) => value !== 0);
      if ((hasActorToTarget || hasTargetToActor) && !effectKind) {
        throw new Error(`relationship_effect_kind_missing:${result.resultCode}`);
      }
      if (hasActorToTarget) {
        await applyRelationshipEvent(
          ctx,
          args.worldId,
          args.actorId,
          args.targetActorId,
          actorToTarget,
          eventId,
          effectKind!,
          gameDay,
          now,
        );
      }
      if (hasTargetToActor) {
        await applyRelationshipEvent(
          ctx,
          args.worldId,
          args.targetActorId,
          args.actorId,
          targetToActor,
          eventId,
          effectKind!,
          gameDay,
          now,
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
          now,
        );
      }
    }
    // 境内修为攒够则自动升层（一路直达）；跨境大关（realmChange）已由突破处理，不再自动。
    if (result.effects.cultivationXp !== undefined && !result.effects.realmChange) {
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
  if (record.status === 'resolving') {
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byAction', (q) =>
        q.eq('worldId', record.worldId).eq('actionRecordId', record._id),
      )
      .first();
    const startedEvent = await ctx.db
      .query('worldEvents')
      .withIndex('byAction', (q) => q.eq('worldId', record.worldId).eq('actionId', record._id))
      .order('asc')
      .first();
    if (
      execution &&
      ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status) &&
      (execution.expiresAt <= Date.now() || execution.hardDeadlineAt <= Date.now())
    ) {
      const now = Date.now();
      const deadlineExceeded = execution.hardDeadlineAt <= now;
      const terminal = await terminalizeActionExecution(ctx, execution, now, {
        status: 'interrupted',
        reasonCode: deadlineExceeded ? 'execution_deadline_exceeded' : 'lease_expired',
        reason: deadlineExceeded
          ? '持续动作超过最大执行时限，已中断且没有成果。'
          : '持续动作因执行器租约到期而中断。',
      });
      return {
        ...terminal.result,
        eventId: terminal.eventId,
        actionRecordId: record._id,
        clientActionId,
        idempotentReplay: true,
      };
    }
    if (execution && startedEvent && ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status)) {
      return {
        status: 'applied' as const,
        resultCode: 'action_execution_started',
        reason: startedEvent.summary,
        effects: {},
        eventType: startedEvent.type,
        visibility: startedEvent.visibility,
        eventId: startedEvent._id,
        actionRecordId: record._id,
        clientActionId,
        idempotentReplay: true,
        executionGoal: actionExecutionGoalFromDoc(execution),
      };
    }
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
    .order('desc')
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

function actionExecutionGoalFromDoc(execution: Doc<'actionExecutions'>): ActionExecutionGoal {
  return {
    protocolVersion: ACTION_EXECUTION_PROTOCOL_VERSION,
    executionId: String(execution._id),
    actionRecordId: String(execution.actionRecordId),
    revision: execution.revision,
    actorId: execution.actorId,
    personalGoalId: execution.personalGoalId,
    personalGoalRevision: execution.personalGoalRevision,
    purposeIntentDigest: execution.purposeIntentDigest,
    actionType: execution.actionType,
    status: execution.status,
    leaseOwner: execution.leaseOwner,
    mapId: execution.mapId,
    locationId: execution.locationId,
    targetActorId: execution.targetActorId,
    encounterId: execution.encounterId,
    resourceNodeId: execution.resourceNodeId,
    reservedQuantity: execution.reservedQuantity,
    cultivationMode: execution.cultivationMode,
    reservedItemId: execution.reservedItemId,
    reservedItemQuantity: execution.reservedItemQuantity,
    reservedTargetItemId: execution.reservedTargetItemId,
    reservedTargetItemQuantity: execution.reservedTargetItemQuantity,
    tradeMode: execution.tradeMode,
    shopId: execution.shopId,
    tradeItemId: execution.tradeItemId,
    tradeItemQuantity: execution.tradeItemQuantity,
    tradeUnitPrice: execution.tradeUnitPrice,
    tradeTotalPrice: execution.tradeTotalPrice,
    reservedShopItemId: execution.reservedShopItemId,
    reservedShopItemQuantity: execution.reservedShopItemQuantity,
    reservedShopWalletSpiritStones: execution.reservedShopWalletSpiritStones,
    reservedShopCapacityItemId: execution.reservedShopCapacityItemId,
    reservedShopCapacityQuantity: execution.reservedShopCapacityQuantity,
    teachingTopic: execution.teachingTopic,
    requestId: execution.requestId ? String(execution.requestId) : undefined,
    requestRevision: execution.requestRevision,
    intent: execution.intent,
    durationMs: execution.durationMs,
    hardDeadlineAt: execution.hardDeadlineAt,
    issuedAt: execution.issuedAt,
    expiresAt: execution.expiresAt,
  };
}

async function prepareDirectSocialOutcomeForAction(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId: string;
    actionType: string;
    params: Record<string, unknown>;
    gameHour: number;
  },
): Promise<
  | { ok: true; binding?: SocialOutcomeBinding }
  | { ok: false; reasonCode: string }
> {
  // Accepted-invitation candidates intentionally carry only stable receipt
  // digests. Their authoritative warrant is reloaded below instead of being
  // treated as an incomplete direct-warrant submission.
  if (args.params.socialInvitationId !== undefined) return { ok: true };
  const fields = [
    'socialWarrant',
    'socialWarrantDigest',
    'socialOpportunityCandidate',
    'socialOpportunityCandidateDigest',
    'socialWarrantCandidateDigest',
  ] as const;
  const present = fields.filter((field) => args.params[field] !== undefined);
  if (present.length === 0) return { ok: true };
  if (
    present.length !== fields.length || args.params.conversationId !== undefined ||
    !['talk', 'gift', 'request_teaching'].includes(args.actionType)
  ) {
    return { ok: false, reasonCode: 'social_outcome_binding_invalid' };
  }
  const warrant = validateSocialWarrant(args.params.socialWarrant);
  if (
    !warrant.ok || args.gameHour < warrant.warrant.createdAt ||
    (args.gameHour >= warrant.warrant.expiresAt &&
      typeof args.params.socialConsequenceId !== 'string')
  ) {
    return { ok: false, reasonCode: 'social_outcome_binding_invalid' };
  }
  const prepared = prepareSocialOutcomeBinding({
    actorId: args.actorId,
    targetActorIds: [args.targetActorId],
    actionType: args.actionType,
    warrant: args.params.socialWarrant,
    candidate: args.params.socialOpportunityCandidate,
    warrantDigest: args.params.socialWarrantDigest,
    candidateDigest: args.params.socialOpportunityCandidateDigest,
    warrantCandidateDigest: args.params.socialWarrantCandidateDigest,
  });
  if (!prepared.ok) return prepared;
  if (!await socialOutcomeScopeAvailable(ctx, args.worldId, prepared.binding.scopeKey, args.gameHour)) {
    return { ok: false, reasonCode: 'social_outcome_cooldown_active' };
  }
  return { ok: true, binding: prepared.binding };
}

/**
 * An accepted remote invitation already owns the warrant/candidate pair.  Its
 * arrival candidate deliberately carries only digests, never mutable warrant
 * objects.  Re-load and verify that server-owned receipt here before opening
 * the ordinary conversation, so Pi can neither forge a social outcome nor
 * detach the eventual session from the invitation that caused its travel.
 */
async function prepareAcceptedSocialInvitationOutcomeForAction(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId: string;
    actionType: string;
    params: Record<string, unknown>;
    now: number;
  },
): Promise<
  | { ok: true; binding?: SocialOutcomeBinding; invitationLink?: { invitationId: string; revision: number } }
  | { ok: false; reasonCode: string }
> {
  const invitationId = typeof args.params.socialInvitationId === 'string'
    ? args.params.socialInvitationId
    : undefined;
  if (!invitationId) return { ok: true };
  const expectedRevision = exactPositiveInteger(args.params.socialInvitationRevision);
  const receiptDigest = typeof args.params.socialInvitationReceiptDigest === 'string'
    ? args.params.socialInvitationReceiptDigest
    : undefined;
  const warrantDigest = typeof args.params.socialWarrantDigest === 'string'
    ? args.params.socialWarrantDigest
    : undefined;
  const candidateDigest = typeof args.params.socialOpportunityCandidateDigest === 'string'
    ? args.params.socialOpportunityCandidateDigest
    : undefined;
  const requestedTarget = typeof args.params.socialTargetActorId === 'string'
    ? args.params.socialTargetActorId
    : undefined;
  if (
    !expectedRevision || !receiptDigest || !warrantDigest || !candidateDigest ||
    requestedTarget !== args.targetActorId ||
    !['talk', 'gift', 'request_teaching'].includes(args.actionType)
  ) {
    return { ok: false, reasonCode: 'social_invitation_binding_params_invalid' };
  }
  const source = await loadAcceptedSocialInvitationSource(
    ctx, args.worldId, invitationId, args.now,
  );
  if (!source) return { ok: false, reasonCode: 'social_invitation_binding_source_unavailable' };
  if (source.receipt.actorId !== args.actorId || source.receipt.targetActorId !== args.targetActorId) {
    return { ok: false, reasonCode: 'social_invitation_binding_actor_mismatch' };
  }
  if (source.receipt.revision !== expectedRevision || source.receiptDigest !== receiptDigest) {
    return { ok: false, reasonCode: 'social_invitation_binding_receipt_stale' };
  }
  if (source.receipt.warrantDigest !== warrantDigest || source.receipt.candidateDigest !== candidateDigest) {
    return { ok: false, reasonCode: 'social_invitation_binding_digest_stale' };
  }
  if (!source.sourceCurrent || !source.targetAliveAndCapable || source.targetBusy ||
    !source.targetStillAtMeeting || !source.capacityAvailable) {
    return { ok: false, reasonCode: 'social_invitation_binding_availability_stale' };
  }
  if (!invitationActivityMatches(source.receipt.intendedActivity, args.actionType)) {
    return { ok: false, reasonCode: 'social_invitation_binding_activity_mismatch' };
  }
  const binding = prepareSocialOutcomeBinding({
    actorId: args.actorId,
    targetActorIds: [args.targetActorId],
    actionType: args.actionType,
    warrant: source.warrant,
    candidate: source.candidate,
    warrantDigest: source.receipt.warrantDigest,
    candidateDigest: source.receipt.candidateDigest,
    warrantCandidateDigest: socialWarrantCandidateDigest(source.warrant, source.candidate),
  });
  if (!binding.ok) return binding;
  return {
    ok: true,
    binding: binding.binding,
    invitationLink: { invitationId, revision: expectedRevision },
  };
}

function exactPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function invitationActivityMatches(activity: string, actionType: string) {
  return (activity === 'teach' ? 'request_teaching' : activity) === actionType;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function exactInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function parseNegotiationOperation(value: unknown): NegotiationOperation | null {
  return typeof value === 'string' &&
    ['open', 'counter', 'accept', 'reject', 'withdraw'].includes(value)
    ? (value as NegotiationOperation)
    : null;
}

function readValleyMovementTarget(
  value: unknown,
  legacyTargetId: string | undefined,
): MovementTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return legacyTargetId ? { kind: 'location', locationId: legacyTargetId } : null;
  }
  const target = value as Record<string, unknown>;
  if (target.kind === 'location' && typeof target.locationId === 'string') {
    return { kind: 'location', locationId: target.locationId };
  }
  if (target.kind === 'zone' && typeof target.zoneId === 'string') {
    return { kind: 'zone', zoneId: target.zoneId };
  }
  if (target.kind === 'actor' && typeof target.actorId === 'string') {
    const preferred = target.preferredDistanceTiles;
    return typeof preferred === 'number' && Number.isFinite(preferred)
      ? {
          kind: 'actor',
          actorId: target.actorId,
          preferredDistanceTiles: Math.max(1, Math.min(2, Math.round(preferred))),
        }
      : { kind: 'actor', actorId: target.actorId };
  }
  if (target.kind === 'interactable' && typeof target.interactionId === 'string') {
    return { kind: 'interactable', interactionId: target.interactionId };
  }
  if (target.kind === 'point' && target.tile && typeof target.tile === 'object') {
    const tile = target.tile as Record<string, unknown>;
    if (Number.isInteger(tile.x) && Number.isInteger(tile.y)) {
      return { kind: 'point', tile: { x: tile.x as number, y: tile.y as number } };
    }
  }
  return null;
}

// —— 角色数值与关系落库（带夹值）。关系变化必须关联事件（§13.6）——
async function applyEffects(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  effects: Effects,
  healthTransition: HealthTransition | null,
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
  if (effects.breakthroughProgress) {
    if (effects.breakthroughProgress.realmEnteredAt !== undefined) {
      patch.realmEnteredAt = effects.breakthroughProgress.realmEnteredAt;
    }
    if (effects.breakthroughProgress.recoveryUntil !== undefined) {
      patch.breakthroughRecoveryUntil = effects.breakthroughProgress.recoveryUntil;
    } else if (effects.breakthroughProgress.clearRecovery) {
      patch.breakthroughRecoveryUntil = undefined;
    }
  }
  if (effects.mood !== undefined) patch.mood = clamp(profile.mood + effects.mood, -5, 5);
  if (effects.fatigue !== undefined) {
    patch.fatigue = normalizeFatigue(normalizeFatigue(profile.fatigue) + effects.fatigue);
  }
  if (healthTransition) {
    patch.health = healthTransition.nextHealth;
    if (healthTransition.enteredIncapacitation) {
      patch.incapacitatedAt = healthTransition.incapacitatedAt;
      patch.recoveryEligibleAt = healthTransition.recoveryEligibleAt;
      patch.recoveryToken = healthTransition.recoveryToken;
      patch.currentIntent = '因伤失去行动能力，等待伤势稳定。';
    } else if (healthTransition.recoveredFromIncapacitation) {
      patch.incapacitatedAt = undefined;
      patch.recoveryEligibleAt = undefined;
      patch.recoveryToken = undefined;
      patch.currentIntent = '伤势初步稳定，等待重新决定行动。';
    }
  }
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

  // C015b：relationship effects 在 finalize 中与 resultCode 多维反应合并后，
  // 经 applyRelationshipEvent 一次性结算；这里不再形成第二条未审计写入。
}

async function enterIncapacitation(
  ctx: MutationCtx,
  actionRecordId: Id<'actionRecords'>,
  profile: Doc<'xianxiaProfiles'>,
  transition: HealthTransition,
  now: number,
) {
  const recoveryEligibleAt = transition.recoveryEligibleAt!;
  const recoveryToken = transition.recoveryToken!;
  await appendWorldEvent(ctx, {
    worldId: profile.worldId,
    type: 'actor_incapacitated',
    createdAt: now,
    actorIds: [profile.actorId],
    locationId: profile.currentLocationId,
    actionId: actionRecordId,
    visibility: 'local',
    summary: `${profile.name}气血耗尽，已失去行动能力。`,
    facts: versionDurableEventFacts({ resultCode: 'actor_incapacitated' }),
    mapId: profile.mapId,
  });

  await enforceIncapacitationRuntime(ctx, profile, recoveryEligibleAt, recoveryToken, now);
}

/**
 * Old worlds may already contain health=0 rows from before recovery metadata
 * existed. Enrolling them creates a real event and timer, but never heals them
 * immediately. Complete current-state enrollments are left untouched.
 */
export async function ensureIncapacitationRecovery(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  now: number,
) {
  if (isActorDeceased(profile)) return false;
  if (!needsIncapacitationRecoveryEnrollment(profile)) return false;
  const recoveryEligibleAt = now + INCAPACITATED_RECOVERY_DELAY_MS;
  const eventId = await appendWorldEvent(ctx, {
    worldId: profile.worldId,
    type: 'actor_incapacitated',
    createdAt: now,
    actorIds: [profile.actorId],
    locationId: profile.currentLocationId,
    visibility: 'local',
    summary: `${profile.name}的旧伤势状态已纳入失能恢复流程。`,
    facts: versionDurableEventFacts({
      resultCode: 'actor_incapacitated',
      migration: 'legacy_zero_health',
    }),
    mapId: profile.mapId,
  });
  const recoveryToken = String(eventId);
  await ctx.db.patch(profile._id, {
    incapacitatedAt: now,
    recoveryEligibleAt,
    recoveryToken,
    currentIntent: '因伤失去行动能力，等待伤势稳定。',
  });
  await enforceIncapacitationRuntime(ctx, profile, recoveryEligibleAt, recoveryToken, now);
  return true;
}

async function enforceIncapacitationRuntime(
  ctx: MutationCtx,
  profile: Doc<'xianxiaProfiles'>,
  recoveryEligibleAt: number,
  recoveryToken: string,
  now: number,
) {
  const activeExecution = await findActiveActionExecution(
    ctx,
    profile.worldId,
    profile.actorId,
    now,
  );
  if (activeExecution) {
    await terminalizeActionExecution(ctx, activeExecution, now, {
      status: 'interrupted',
      reasonCode: 'actor_incapacitated',
      reason: `${profile.name}气血耗尽，原持续动作已中断且没有成果。`,
    });
  }
  await cancelActiveValleyMovementCommands(
    ctx,
    profile.worldId,
    profile.actorId,
    now,
    'actor_incapacitated',
  );
  const playerId = await findPlayerIdByName(ctx, profile.worldId, profile.actorId);
  if (playerId) {
    await insertInput(ctx, profile.worldId, 'moveTo', { playerId, destination: null });
  }
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', profile.worldId).eq('actorId', profile.actorId))
    .first();
  if (resident) {
    await ctx.db.patch(resident._id, {
      status: 'incapacitated',
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      currentIntent: '气血耗尽，无法行动。',
      activityLabel: '失能',
      nextActionAt: recoveryEligibleAt,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAt(recoveryEligibleAt, internal.xianxia.gm.recoverIncapacitatedActor, {
    worldId: profile.worldId,
    actorId: profile.actorId,
    recoveryToken,
  });
}

async function resumeAfterRecovery(ctx: MutationCtx, profile: Doc<'xianxiaProfiles'>, now: number) {
  const resident = await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', profile.worldId).eq('actorId', profile.actorId))
    .first();
  if (!resident) return;
  await ctx.db.patch(resident._id, {
    status: 'idle',
    targetTile: undefined,
    finalTargetTile: undefined,
    pathTiles: undefined,
    currentIntent: '伤势初步稳定，等待重新决定行动。',
    activityLabel: '待机',
    nextActionAt: now + 2_000,
    updatedAt: now,
  });
}

function actorsShareLocation(
  actor: Doc<'xianxiaProfiles'>,
  target: Doc<'xianxiaProfiles'>,
  requestedLocationId?: string,
) {
  return (
    !!actor.currentLocationId &&
    actor.currentLocationId === target.currentLocationId &&
    (!requestedLocationId || requestedLocationId === actor.currentLocationId) &&
    (actor.mapId ?? 'world') === (target.mapId ?? 'world')
  );
}

async function loadCombatEncounter(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  encounterId: string,
) {
  return await ctx.db
    .query('combatEncounters')
    .withIndex('byEncounter', (q) =>
      q.eq('worldId', worldId).eq('encounterId', encounterId),
    )
    .first();
}

async function loadActiveCombatEncounterForActor(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  const asAttacker = await ctx.db
    .query('combatEncounters')
    .withIndex('byAttackerStatus', (q) =>
      q.eq('worldId', worldId).eq('attackerActorId', actorId).eq('status', 'active'),
    )
    .order('desc')
    .first();
  if (asAttacker) return asAttacker;
  return await ctx.db
    .query('combatEncounters')
    .withIndex('byDefenderStatus', (q) =>
      q.eq('worldId', worldId).eq('defenderActorId', actorId).eq('status', 'active'),
    )
    .order('desc')
    .first();
}

async function loadDefeatEncounter(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  defeatedActorId: string,
  mapId: string,
  locationId: string,
) {
  for (const status of ['attacker_defeated', 'defender_defeated'] as const) {
    const rows = await ctx.db
      .query('combatEncounters')
      .withIndex('byLocationStatus', (q) =>
        q
          .eq('worldId', worldId)
          .eq('mapId', mapId)
          .eq('locationId', locationId)
          .eq('status', status),
      )
      .order('desc')
      .take(20);
    const encounter = rows.find((row) => row.defeatedActorId === defeatedActorId);
    if (encounter) return encounter;
  }
  return null;
}

async function currentCombatObservers(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actor: Doc<'xianxiaProfiles'>,
  excludedActorIds: string[],
) {
  if (!actor.currentLocationId) return { witnessActorIds: [], guardActorIds: [] };
  const profiles = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('byLocation', (q) =>
      q
        .eq('worldId', worldId)
        .eq('mapId', actor.mapId)
        .eq('currentLocationId', actor.currentLocationId),
    )
    .take(100);
  const excluded = new Set(excludedActorIds);
  const witnesses = profiles.filter(
    (profile) => !excluded.has(profile.actorId) && !isActorIncapacitated(profile.health),
  );
  return {
    witnessActorIds: witnesses.map((profile) => profile.actorId),
    guardActorIds: witnesses
      .filter((profile) => profile.role === 'guard')
      .map((profile) => profile.actorId),
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function generateConflictMemories(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  eventId: Id<'worldEvents'>,
  result: ActionResult,
  context: {
    actorIds: string[];
    targetActorIds: string[];
    witnessActorIds: string[];
    locationId?: string;
    now: number;
  },
) {
  await generateMemories(
    ctx,
    worldId,
    {
      eventId,
      type: result.eventType,
      visibility: result.visibility,
      actorIds: context.actorIds,
      targetActorIds: context.targetActorIds,
      witnessActorIds: context.witnessActorIds,
      locationId: context.locationId,
      summary: result.reason,
      createdAt: context.now,
    },
    await readGameHour(ctx, worldId, context.now),
  );
}

async function applyGuardWitnessConsequences(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  guardActorIds: string[],
  offenderActorId: string,
  eventId: Id<'worldEvents'>,
  gameDay: number,
  now: number,
) {
  for (const guardActorId of guardActorIds) {
    await applyRelationshipEvent(
      ctx,
      worldId,
      guardActorId,
      offenderActorId,
      { affinity: -8, suspicion: 20, fear: 5 },
      eventId,
      'guard_witness',
      gameDay,
      now,
    );
  }
}

async function transferExactInventoryItem(
  ctx: MutationCtx,
  from: Doc<'xianxiaProfiles'>,
  to: Doc<'xianxiaProfiles'>,
  itemId: string,
) {
  const fromInventory = [...(from.inventory ?? [])];
  const fromIndex = fromInventory.findIndex((item) => item.itemId === itemId);
  if (fromIndex < 0 || fromInventory[fromIndex].qty < 1) {
    throw new Error('loot_reservation_lost: target no longer owns the reserved item.');
  }
  const remaining = fromInventory[fromIndex].qty - 1;
  if (remaining === 0) fromInventory.splice(fromIndex, 1);
  else fromInventory[fromIndex] = { itemId, qty: remaining };
  const toInventory = [...(to.inventory ?? [])];
  const toIndex = toInventory.findIndex((item) => item.itemId === itemId);
  if (toIndex < 0) toInventory.push({ itemId, qty: 1 });
  else toInventory[toIndex] = { itemId, qty: toInventory[toIndex].qty + 1 };
  await ctx.db.patch(from._id, { inventory: fromInventory });
  await ctx.db.patch(to._id, { inventory: toInventory });
}

async function loadGiftUsageDays(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  targetActorId: string,
) {
  const rows = await ctx.db
    .query('socialActionUsages')
    .withIndex('byActorTargetTypeDay', (q) =>
      q
        .eq('worldId', worldId)
        .eq('actorId', actorId)
        .eq('targetActorId', targetActorId)
        .eq('actionType', 'gift'),
    )
    .collect();
  return rows.map((row) => row.sourceGameDay);
}

async function loadTradeUsageHours(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  targetActorId: string,
) {
  const rows = await ctx.db
    .query('socialActionUsages')
    .withIndex('byActorTargetTypeDay', (q) =>
      q
        .eq('worldId', worldId)
        .eq('actorId', actorId)
        .eq('targetActorId', targetActorId)
        .eq('actionType', 'trade'),
    )
    .collect();
  return rows
    .map((row) => row.sourceGameHour)
    .filter((hour): hour is number => typeof hour === 'number' && Number.isFinite(hour));
}

type ActiveShopReservations = {
  outgoingStock: Map<string, number>;
  incomingStock: Map<string, number>;
  walletSpiritStones: number;
};

async function activeShopReservations(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  shopId: string,
  now: number,
  excludeExecutionId?: Id<'actionExecutions'>,
): Promise<ActiveShopReservations> {
  const reservations: ActiveShopReservations = {
    outgoingStock: new Map(),
    incomingStock: new Map(),
    walletSpiritStones: 0,
  };
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const rows = await ctx.db
      .query('actionExecutions')
      .withIndex('byShopStatus', (q) =>
        q.eq('worldId', worldId).eq('shopId', shopId).eq('status', status),
      )
      .collect();
    for (const execution of rows) {
      if (
        execution._id === excludeExecutionId ||
        execution.expiresAt <= now ||
        execution.hardDeadlineAt <= now
      ) continue;
      if (execution.reservedShopItemId) {
        reservations.outgoingStock.set(
          execution.reservedShopItemId,
          (reservations.outgoingStock.get(execution.reservedShopItemId) ?? 0) +
            (execution.reservedShopItemQuantity ?? 0),
        );
      }
      if (execution.reservedShopCapacityItemId) {
        reservations.incomingStock.set(
          execution.reservedShopCapacityItemId,
          (reservations.incomingStock.get(execution.reservedShopCapacityItemId) ?? 0) +
            (execution.reservedShopCapacityQuantity ?? 0),
        );
      }
      reservations.walletSpiritStones += execution.reservedShopWalletSpiritStones ?? 0;
    }
  }
  return reservations;
}

function tradeStartedResult(actorName: string, targetName: string): ActionResult {
  return {
    status: 'applied',
    resultCode: 'action_execution_started',
    reason: `${actorName}开始与${targetName}当面交割，完成前不会转移任何资源。`,
    effects: {},
    eventType: 'trade_started',
    visibility: 'local',
  };
}

async function applyItemTransfers(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  transfers: ItemTransfer[] | undefined,
) {
  const deltas = new Map<string, Map<string, number>>();
  const outgoing = new Map<string, Map<string, number>>();
  const addDelta = (actorId: string, itemId: string, delta: number) => {
    const byItem = deltas.get(actorId) ?? new Map<string, number>();
    byItem.set(itemId, (byItem.get(itemId) ?? 0) + delta);
    deltas.set(actorId, byItem);
  };
  const addOutgoing = (actorId: string, itemId: string, qty: number) => {
    const byItem = outgoing.get(actorId) ?? new Map<string, number>();
    byItem.set(itemId, (byItem.get(itemId) ?? 0) + qty);
    outgoing.set(actorId, byItem);
  };
  for (const transfer of transfers ?? []) {
    if (!Number.isInteger(transfer.qty) || transfer.qty <= 0 || !transfer.itemId) {
      throw new Error('inventory_transfer_invariant: transfer qty must be a positive integer.');
    }
    if (!transfer.from && !transfer.to) {
      throw new Error('inventory_transfer_invariant: transfer requires from or to.');
    }
    if (transfer.from) {
      addDelta(transfer.from, transfer.itemId, -transfer.qty);
      addOutgoing(transfer.from, transfer.itemId, transfer.qty);
    }
    if (transfer.to) addDelta(transfer.to, transfer.itemId, transfer.qty);
  }
  for (const [actorId, byItem] of deltas) {
    const profile = await loadProfile(ctx, worldId, actorId);
    if (!profile) {
      throw new Error(`inventory_transfer_invariant: profile ${actorId} does not exist.`);
    }
    const inventory = [...(profile.inventory ?? [])];
    for (const [itemId, delta] of byItem) {
      const index = inventory.findIndex((item) => item.itemId === itemId);
      const current = index >= 0 ? inventory[index].qty : 0;
      const next = current + delta;
      const required = outgoing.get(actorId)?.get(itemId) ?? 0;
      const reserved =
        required > 0
          ? await activeInventoryReservationQuantity(ctx, worldId, actorId, itemId, Date.now())
          : 0;
      if (!Number.isInteger(current) || current - reserved < required || next < 0) {
        throw new Error(
          `inventory_transfer_invariant: ${actorId} lacks unreserved ${itemId} for delta ${delta}.`,
        );
      }
      if (index >= 0 && next === 0) inventory.splice(index, 1);
      else if (index >= 0) inventory[index] = { itemId, qty: next };
      else if (next > 0) inventory.push({ itemId, qty: next });
    }
    await ctx.db.patch(profile._id, { inventory });
  }
}

// C015b：一桩 source event 对一条有向边只应用一次。先投影到当前游戏日，
// 再按事件族窗口/饱和规则结算；applied/suppressed 都留下可回放审计行。
export async function applyRelationshipEvent(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  fromActorId: string,
  toActorId: string,
  baseDelta: DimDelta,
  eventId: Id<'worldEvents'>,
  effectKind: RelationshipEffectKind,
  gameDay: number,
  now: number,
) {
  if (fromActorId === toActorId) throw new Error('relationship_self_change_forbidden');
  if (!Number.isFinite(gameDay) || gameDay < 0) throw new Error('relationship_game_day_invalid');
  const sourceEvent = await ctx.db.get(eventId);
  if (!sourceEvent || sourceEvent.worldId !== worldId) throw new Error('relationship_source_event_missing');
  const changeId = `relationship_change:${String(eventId)}:${fromActorId}:${toActorId}:${effectKind}`;
  const replay = await ctx.db
    .query('relationshipChanges')
    .withIndex('byChangeId', (q) => q.eq('worldId', worldId).eq('changeId', changeId))
    .first();
  if (replay) return replay;

  const relationship = await ctx.db
    .query('relationships')
    .withIndex('pair', (q) =>
      q.eq('worldId', worldId).eq('fromActorId', fromActorId).eq('toActorId', toActorId),
    )
    .first();
  const holder = await loadProfile(ctx, worldId, fromActorId);
  if (!holder) throw new Error('relationship_actor_not_found');
  const current = relationshipDimsAt(
    relationship
    ? {
        affinity: relationship.value,
        trust: relationship.trust,
        suspicion: relationship.suspicion,
        debt: relationship.debt,
        fear: relationship.fear,
      }
    : {},
    relationship?.lastTouchedDay,
    gameDay,
    holder.innerTrait ?? '',
    holder.outerTrait ?? '',
    relationship?.dimensionTouchedDays,
  );
  const policy = RELATIONSHIP_EVENT_POLICIES[effectKind];
  let priorWindowCount = 0;
  if (Number.isFinite(policy.maxBenefits) && policy.windowDays > 0) {
    const windowStart = Math.max(0, gameDay - policy.windowDays + 1);
    const prior = await ctx.db
      .query('relationshipChanges')
      .withIndex('byDirectionKindDay', (q) =>
        q
          .eq('worldId', worldId)
          .eq('fromActorId', fromActorId)
          .eq('toActorId', toActorId)
          .eq('effectKind', effectKind)
          .gte('sourceGameDay', windowStart),
      )
      .collect();
    priorWindowCount = prior.filter(
      (change) => change.sourceGameDay <= gameDay && change.status === 'applied',
    ).length;
  }
  const resolution = resolveRelationshipEvent({ current, baseDelta, effectKind, priorWindowCount });
  if (resolution.status === 'applied') {
    const storage = relationshipStorageAfterEvent({
      stored: relationship
        ? {
            affinity: relationship.value,
            trust: relationship.trust,
            suspicion: relationship.suspicion,
            debt: relationship.debt,
            fear: relationship.fear,
          }
        : {},
      lastTouchedDay: relationship?.lastTouchedDay,
      dimensionTouchedDays: relationship?.dimensionTouchedDays,
      effectiveNext: resolution.next,
      appliedDelta: resolution.appliedDelta,
      gameDay,
    });
    const fields = {
      value: storage.dims.affinity,
      trust: storage.dims.trust,
      suspicion: storage.dims.suspicion,
      debt: storage.dims.debt,
      fear: storage.dims.fear,
      lastChangedByEventId: eventId,
      lastTouchedDay: gameDay,
      dimensionTouchedDays: storage.dimensionTouchedDays,
    };
    if (relationship) await ctx.db.patch(relationship._id, fields);
    else await ctx.db.insert('relationships', { worldId, fromActorId, toActorId, ...fields });
  }
  const applicationId = await ctx.db.insert('relationshipChanges', {
    worldId,
    changeId,
    sourceEventId: String(eventId),
    fromActorId,
    toActorId,
    effectKind,
    sourceGameDay: gameDay,
    baseDelta,
    appliedDelta: resolution.appliedDelta,
    before: current,
    after: resolution.next,
    priorWindowCount,
    multiplier: resolution.multiplier,
    status: resolution.status,
    reasonCode: resolution.reasonCode,
    createdAt: now,
  });
  return (await ctx.db.get(applicationId))!;
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
  now: number,
) {
  const rels = await ctx.db
    .query('relationships')
    .withIndex('from', (q) => q.eq('worldId', worldId).eq('fromActorId', victimActorId))
    .take(40);
  const allies: AllyRelation[] = [];
  const victim = await loadProfile(ctx, worldId, victimActorId);
  for (const r of rels) {
    if (r.toActorId === perpetratorActorId) continue; // 加害者自己不算受害者的亲友
    const effective = relationshipDimsAt(
      {
        affinity: r.value,
        trust: r.trust,
        suspicion: r.suspicion,
        debt: r.debt,
        fear: r.fear,
      },
      r.lastTouchedDay,
      gameDay,
      victim?.innerTrait ?? '',
      victim?.outerTrait ?? '',
      r.dimensionTouchedDays,
    );
    const kind = classifyAllyKind(r.tags, effective.affinity);
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
    await applyRelationshipEvent(
      ctx,
      worldId,
      seed.actorId,
      perpetratorActorId,
      seed.delta,
      eventId,
      'ally_grudge',
      gameDay,
      now,
    );
  }
}

// —— 装载、关系读取与快照 ——
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
  gameDay: number,
): Promise<number> {
  const [rel, holder] = await Promise.all([
    ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first(),
    loadProfile(ctx, worldId, from),
  ]);
  if (!rel) return 0;
  return relationshipDimsAt(
    { affinity: rel.value, trust: rel.trust, suspicion: rel.suspicion, debt: rel.debt, fear: rel.fear },
    rel.lastTouchedDay,
    gameDay,
    holder?.innerTrait ?? '',
    holder?.outerTrait ?? '',
    rel.dimensionTouchedDays,
  ).affinity;
}

// 读 from→to 的多维关系快照（M3 拒绝系统用：对方如何看你）。无记录则全 0。
async function loadRelationshipDims(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  from: string,
  to: string,
  gameDay: number,
): Promise<TargetView> {
  const [rel, holder] = await Promise.all([
    ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first(),
    loadProfile(ctx, worldId, from),
  ]);
  const effective = relationshipDimsAt(
    rel
      ? { affinity: rel.value, trust: rel.trust, suspicion: rel.suspicion, debt: rel.debt, fear: rel.fear }
      : {},
    rel?.lastTouchedDay,
    gameDay,
    holder?.innerTrait ?? '',
    holder?.outerTrait ?? '',
    rel?.dimensionTouchedDays,
  );
  return {
    ...effective,
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
    maxHealth: p.maxHealth,
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

function negotiationInvalidationResult(resultCode: string, reason: string): ActionResult {
  return {
    ...reject(resultCode, reason),
    eventType: 'negotiation_invalidated',
  };
}

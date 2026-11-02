import type { ActionExecutionStatus } from './actionExecutionContracts';
import type { ActionResult, Effects } from './actionSchema';
import type { TeachingTopic } from './teachingLogic';
import {
  CULTIVATE_EXECUTION_DURATION_MS,
  GATHER_EXECUTION_DURATION_MS,
  REST_EXECUTION_DURATION_MS,
} from './actionExecutionContracts';

/**
 * B1's narrow compatibility seam.  This is deliberately a receipt compiler:
 * it does not persist an execution or settle a resource, fatigue, or XP change.
 */
export const TIMED_ACTION_TYPES = ['gather', 'rest', 'cultivate'] as const;
export type TimedActionType = (typeof TIMED_ACTION_TYPES)[number];
export type DomainOutcome = 'applied' | 'rejected' | 'failed' | 'no_effect';

export type TimedActionSettlementRequest = {
  source: 'action_execution';
  actionType: TimedActionType;
  executionId: string;
  actionRecordId: string;
  actorId: string;
  executorId: string;
  revision: number;
  idempotencyKey: string;
};

export type TimedActionSettlementReceipt = TimedActionSettlementRequest & {
  executionTerminal: Extract<ActionExecutionStatus, 'completed' | 'interrupted' | 'blocked'>;
  domainOutcome: DomainOutcome;
  idempotentReplay: boolean;
  receiptKey: string;
};

/**
 * C2's admission seam.  The ActionGateway still loads facts and is the only
 * caller that creates an execution; this port maps those latest facts to one
 * deterministic timed-action admission plan.
 */
export type TimedActionAdmissionPlan = {
  result: ActionResult;
  execution?: {
    actionType: TimedActionType;
    mapId?: string;
    locationId: string;
    resourceNodeId?: string;
    reservedQuantity?: number;
    cultivationMode?: 'ambient' | 'spirit_stone' | 'qi_pill';
    reservedItemId?: string;
    reservedItemQuantity?: number;
    intent: string;
    durationMs: number;
  };
};

type TimedLocation = { locationId: string; name: string };

export type TimedActionAdmissionInput =
  | {
      actionType: 'cultivate';
      profileName: string;
      profileMapId?: string;
      intent?: string;
      candidate: ActionResult;
      location?: TimedLocation;
      cultivationMode?: 'ambient' | 'spirit_stone' | 'qi_pill';
      resource?: { itemId: string; quantity: number };
      resourceAvailable: boolean;
    }
  | {
      actionType: 'gather';
      profileName: string;
      profileMapId?: string;
      intent?: string;
      resourceNodeId?: string;
      location?: { locationId: string; allowsGather: boolean };
      resourceNode?: { name: string; mapId?: string; locationId: string };
      accessAllowed: boolean;
      withinGodotRange: boolean;
      stock: number;
      availableStock: number;
    }
  | {
      actionType: 'rest';
      profileName: string;
      profileMapId?: string;
      intent?: string;
      location?: { locationId: string; name: string; allowsRest: boolean };
    };

export type AttackAdmission =
  | { ok: true }
  | { ok: false; result: ActionResult };

/** Pure C2c combat admission: no encounter, execution, damage, or effect write. */
export function admitAttack(input: {
  actorId: string;
  targetActorId?: string;
  target?: { name: string };
  targetLifeFailure?: { resultCode: string; reason: string };
  attackAllowed: boolean;
  sameLocation: boolean;
}): AttackAdmission {
  if (!input.targetActorId) return { ok: false, result: rejectTimedAction('combat_target_required', '攻击需要指定目标角色。') };
  if (input.targetActorId === input.actorId) return { ok: false, result: rejectTimedAction('combat_self_target', '不能把自己作为攻击目标。') };
  if (!input.target) return { ok: false, result: rejectTimedAction('target_not_found', `未找到目标 ${input.targetActorId}。`) };
  if (input.targetLifeFailure) return { ok: false, result: rejectTimedAction(input.targetLifeFailure.resultCode, input.targetLifeFailure.reason) };
  if (!input.attackAllowed) return { ok: false, result: rejectTimedAction('location_forbids_attack', '当前地点不允许发起敌对攻击。') };
  if (!input.sameLocation) return { ok: false, result: rejectTimedAction('target_not_present', `${input.target.name}不在攻击者身边。`) };
  return { ok: true };
}

export function admitFlee(input: { hasEncounter: boolean; opponent?: { actorId: string; name: string }; sameLocation: boolean }):
  | { ok: true; opponent: { actorId: string; name: string } }
  | { ok: false; result: ActionResult } {
  if (!input.hasEncounter) return { ok: false, result: rejectTimedAction('flee_not_in_combat', '角色当前不在可逃离的冲突中。') };
  if (!input.opponent || !input.sameLocation) return { ok: false, result: rejectTimedAction('combat_target_changed', '冲突对手已不在原处，无法按原遭遇逃跑。') };
  return { ok: true, opponent: input.opponent };
}

export function admitLoot(input: {
  actorId: string;
  targetActorId?: string;
  itemId?: string;
  target?: { name: string; incapacitated: boolean };
  sameLocation: boolean;
  defeatEncounterId?: string;
  priorityAllowed: boolean;
  itemAvailable: boolean;
}): { ok: true; target: { name: string }; itemId: string; encounterId: string } | { ok: false; result: ActionResult } {
  if (!input.targetActorId) return { ok: false, result: rejectTimedAction('combat_target_required', '掠夺需要指定失能目标。') };
  if (input.targetActorId === input.actorId) return { ok: false, result: rejectTimedAction('combat_self_target', '不能掠夺自己。') };
  if (!input.itemId) return { ok: false, result: rejectTimedAction('missing_param', '掠夺需要 params.itemId。') };
  if (!input.target || !input.target.incapacitated || !input.sameLocation) return { ok: false, result: rejectTimedAction('loot_target_not_defeated', '目标不是同地、仍失能的冲突落败者。') };
  if (!input.defeatEncounterId) return { ok: false, result: rejectTimedAction('loot_target_not_defeated', '找不到可追溯到本次击倒的战利品事实。') };
  if (!input.priorityAllowed) return { ok: false, result: rejectTimedAction('loot_protected', '战利品仍处于击倒者的优先领取期。') };
  if (!input.itemAvailable) return { ok: false, result: rejectTimedAction('loot_item_unavailable', `${input.target.name}没有未被预约的「${input.itemId}」。`) };
  return { ok: true, target: input.target, itemId: input.itemId, encounterId: input.defeatEncounterId };
}

export function admitTradeEnvelope(input: {
  actorId: string;
  targetActorId?: string;
  offeredItemId?: string;
  requestedItemId?: string;
  locationAllowsTrade: boolean;
  cooldownFailure?: { resultCode: string; reason: string };
}): { ok: true } | { ok: false; result: ActionResult } {
  if (input.targetActorId === input.actorId) return { ok: false, result: rejectTimedAction('trade_self_target', '不能与自己交易。') };
  if (!input.offeredItemId || !input.requestedItemId) return { ok: false, result: rejectTimedAction('missing_param', '交易需要 params.offeredItemId 与 params.requestedItemId。') };
  if (!input.locationAllowsTrade) return { ok: false, result: rejectTimedAction('location_forbids_trade', '当前地点不允许进行交易。') };
  if (input.cooldownFailure) return { ok: false, result: rejectTimedAction(input.cooldownFailure.resultCode, input.cooldownFailure.reason) };
  return { ok: true };
}

export function admitGiftEnvelope(input: { actorId: string; actorName?: string; targetActorId?: string; itemId?: string; locationAllowsGift: boolean; owned: number; unreserved: number; cooldownFailure?: { resultCode: string; reason: string } }): { ok: true; itemId: string } | { ok: false; result: ActionResult } {
  if (input.targetActorId === input.actorId) return { ok: false, result: rejectTimedAction('gift_self_target', '不能把礼物赠给自己。') };
  if (!input.itemId) return { ok: false, result: rejectTimedAction('missing_param', '赠礼需要 params.itemId。') };
  if (!input.locationAllowsGift) return { ok: false, result: rejectTimedAction('location_forbids_gift', '当前地点不允许进行赠礼。') };
  if (input.owned < 1) return { ok: false, result: rejectTimedAction('item_not_owned', `${input.actorName ?? '行动者'}并无「${input.itemId}」，无以为赠。`) };
  if (input.unreserved < 1) return { ok: false, result: rejectTimedAction('gift_item_reserved', `「${input.itemId}」已被另一项活动执行预约。`) };
  if (input.cooldownFailure) return { ok: false, result: rejectTimedAction(input.cooldownFailure.resultCode, input.cooldownFailure.reason) };
  return { ok: true, itemId: input.itemId };
}

export function admitRequestTeachingEnvelope(input: {
  actorId: string;
  targetActorId?: string;
  teachingTopic?: TeachingTopic;
  locationAllowsTeaching: boolean;
  eligibilityFailure?: { resultCode: string; reason: string };
  cooldownFailure?: { resultCode: string; reason: string };
  teacherUnavailableReason?: string;
}): { ok: true; teachingTopic: TeachingTopic } | { ok: false; result: ActionResult } {
  if (input.targetActorId === input.actorId) return { ok: false, result: rejectTimedAction('teaching_self_target', '不能向自己请求指点。') };
  if (!input.teachingTopic) return { ok: false, result: rejectTimedAction('teaching_topic_invalid', '当前只能请求可验证的修行基础指点。') };
  if (!input.locationAllowsTeaching) return { ok: false, result: rejectTimedAction('location_forbids_teaching', '当前地点不允许进行当面指点。') };
  if (input.eligibilityFailure) return { ok: false, result: rejectTimedAction(input.eligibilityFailure.resultCode, input.eligibilityFailure.reason) };
  if (input.cooldownFailure) return { ok: false, result: rejectTimedAction(input.cooldownFailure.resultCode, input.cooldownFailure.reason) };
  if (input.teacherUnavailableReason) return { ok: false, result: rejectTimedAction('teacher_busy', input.teacherUnavailableReason) };
  return { ok: true, teachingTopic: input.teachingTopic };
}

export function admitSpar(input: { candidate: ActionResult }): { ok: true } | { ok: false; result: ActionResult } {
  if (input.candidate.status !== 'applied') return { ok: false, result: input.candidate };
  return { ok: true };
}

export function admitStealEnvelope(input: { itemId?: string; locationPresent: boolean; targetName: string; targetHasItem: boolean }): { ok: true; itemId: string } | { ok: false; result: ActionResult } {
  if (!input.itemId) return { ok: false, result: rejectTimedAction('missing_param', '偷取需要 params.itemId。') };
  if (!input.locationPresent) return { ok: false, result: rejectTimedAction('unknown_location', '未指定偷取发生的地点。') };
  if (!input.targetHasItem) return { ok: false, result: rejectTimedAction('target_lacks_item', `${input.targetName}身上并无「${input.itemId}」，无从偷取。`) };
  return { ok: true, itemId: input.itemId };
}

export function admitUseItem(input: { targetActorId?: string; itemId?: string }): { ok: true; itemId: string } | { ok: false; result: ActionResult } {
  if (input.targetActorId) return { ok: false, result: rejectTimedAction('use_item_self_only', '当前只支持角色自行服药，不能指定其他目标。') };
  if (!input.itemId) return { ok: false, result: rejectTimedAction('missing_param', '使用物品需要 params.itemId。') };
  return { ok: true, itemId: input.itemId };
}

export function admitBreakthrough(input: { recoveryFailure?: { resultCode: string; reason: string }; candidate: ActionResult; progressFailure?: { resultCode: string; reason: string } }): { ok: true } | { ok: false; result: ActionResult } {
  if (input.recoveryFailure) return { ok: false, result: rejectTimedAction(input.recoveryFailure.resultCode, input.recoveryFailure.reason) };
  if (input.candidate.status !== 'applied') return { ok: false, result: input.candidate };
  if (input.progressFailure) return { ok: false, result: rejectTimedAction(input.progressFailure.resultCode, input.progressFailure.reason) };
  return { ok: true };
}

/**
 * D1's representative ordinary-action seam.  The rules candidate remains the
 * sole source of exploration facts; this admission never writes or transforms
 * its effects, and only fails closed when no current location was resolved.
 */
export function admitExplore(input: { locationKnown: boolean; candidate: ActionResult }): ActionResult {
  if (!input.locationKnown) return rejectTimedAction('unknown_location', '未指定有效的探索地点。');
  return input.candidate;
}

export function admitTimedAction(input: TimedActionAdmissionInput): TimedActionAdmissionPlan {
  switch (input.actionType) {
    case 'cultivate': {
      if (input.candidate.status !== 'applied' || !input.location || !input.cultivationMode) {
        return { result: input.candidate };
      }
      if (input.resource && !input.resourceAvailable) {
        return { result: rejectTimedAction('cultivation_resource_unavailable', `${input.profileName}的${input.resource.itemId}已被其他持续动作预约。`) };
      }
      return timedActionStarted({
        profileName: input.profileName,
        location: input.location,
        mapId: input.profileMapId,
        actionType: 'cultivate',
        cultivationMode: input.cultivationMode,
        reservedItemId: input.resource?.itemId,
        reservedItemQuantity: input.resource?.quantity,
        intent: input.intent ?? `在${input.location.name}吐纳修行`,
        durationMs: CULTIVATE_EXECUTION_DURATION_MS,
        reason: `${input.profileName}在${input.location.name}开始吐纳，成果将在持续动作完成后结算。`,
      });
    }
    case 'gather': {
      if (!input.resourceNodeId || !input.resourceNode) {
        return { result: rejectTimedAction('resource_node_not_found', input.resourceNodeId ? `找不到资源点 ${input.resourceNodeId}。` : '采集需要 params.resourceNodeId。') };
      }
      if (!input.location || !input.location.allowsGather || input.resourceNode.mapId !== (input.profileMapId ?? 'world') || input.resourceNode.locationId !== input.location.locationId) {
        return { result: rejectTimedAction('resource_wrong_location', '角色不在该资源点所属的合法采集区域。') };
      }
      if (!input.accessAllowed) return { result: rejectTimedAction('resource_forbidden', '该资源点不允许此角色采集。') };
      if (!input.withinGodotRange) return { result: rejectTimedAction('resource_out_of_range', '角色身体距离资源点超过 2 格。') };
      if (input.stock <= 0) return { result: rejectTimedAction('resource_depleted', `${input.resourceNode.name}已经采尽，尚未恢复。`) };
      if (input.availableStock < 1) return { result: rejectTimedAction('resource_fully_reserved', `${input.resourceNode.name}剩余药草均已被预约。`) };
      return timedActionStarted({
        profileName: input.profileName,
        location: { locationId: input.resourceNode.locationId, name: input.resourceNode.name },
        mapId: input.resourceNode.mapId,
        actionType: 'gather',
        resourceNodeId: input.resourceNodeId,
        reservedQuantity: 1,
        intent: input.intent ?? `在${input.resourceNode.name}采集灵草`,
        durationMs: GATHER_EXECUTION_DURATION_MS,
        reason: `${input.profileName}开始在${input.resourceNode.name}采药，完成前只预约一株。`,
      });
    }
    case 'rest': {
      if (!input.location || !input.location.allowsRest) return { result: rejectTimedAction('location_forbids_rest', '当前地点不是可休息的安稳之处。') };
      return timedActionStarted({
        profileName: input.profileName,
        location: input.location,
        mapId: input.profileMapId,
        actionType: 'rest',
        intent: input.intent ?? `在${input.location.name}稍作休息`,
        durationMs: REST_EXECUTION_DURATION_MS,
        reason: `${input.profileName}在${input.location.name}开始休息，完成后才会缓解疲劳。`,
      });
    }
  }
}

function timedActionStarted(input: Omit<NonNullable<TimedActionAdmissionPlan['execution']>, 'locationId'> & { profileName: string; location: TimedLocation; reason: string }): TimedActionAdmissionPlan {
  const { profileName: _profileName, location: _location, reason, ...execution } = input;
  return {
    result: { status: 'applied', resultCode: 'action_execution_started', reason, effects: {}, eventType: 'action_execution_started', visibility: 'local' },
    execution: { ...execution, locationId: input.location.locationId },
  };
}

function rejectTimedAction(resultCode: string, reason: string): ActionResult {
  return { status: 'rejected', resultCode, reason, effects: {}, eventType: 'action_rejected', visibility: 'private' };
}

export function isTimedActionType(actionType: string): actionType is TimedActionType {
  return (TIMED_ACTION_TYPES as readonly string[]).includes(actionType);
}

/**
 * A completed body/executor report becomes a request for a Domain Writer to
 * settle.  It deliberately contains no caller-provided domain result.
 */
export function prepareTimedActionSettlement(input: {
  source: string;
  actionType: string;
  executionStatus: string;
  reportedStatus: string;
  executionId: string;
  actionRecordId: string;
  actorId: string;
  executorId: string;
  revision: number;
  idempotencyKey: string;
}): { ok: true; request: TimedActionSettlementRequest } | { ok: false; reasonCode: string } {
  if (input.source !== 'action_execution') return { ok: false, reasonCode: 'timed_action_source_invalid' };
  if (!isTimedActionType(input.actionType)) return { ok: false, reasonCode: 'timed_action_type_invalid' };
  if (input.executionStatus !== 'acting' || input.reportedStatus !== 'completed') {
    return { ok: false, reasonCode: 'timed_action_not_ready' };
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    return { ok: false, reasonCode: 'timed_action_revision_invalid' };
  }
  if (!input.executionId || !input.actionRecordId || !input.actorId || !input.executorId) {
    return { ok: false, reasonCode: 'timed_action_identity_invalid' };
  }
  const expectedKey = timedActionIdempotencyKey(input.executionId, input.revision);
  if (input.idempotencyKey !== expectedKey) {
    return { ok: false, reasonCode: 'timed_action_idempotency_invalid' };
  }
  return {
    ok: true,
    request: {
      source: 'action_execution',
      actionType: input.actionType,
      executionId: input.executionId,
      actionRecordId: input.actionRecordId,
      actorId: input.actorId,
      executorId: input.executorId,
      revision: input.revision,
      idempotencyKey: expectedKey,
    },
  };
}

/** Only the authoritative Domain Writer supplies result; executor completion never does. */
export function receiptForTimedActionSettlement(input: {
  request: TimedActionSettlementRequest;
  executionTerminal: Extract<ActionExecutionStatus, 'completed' | 'interrupted' | 'blocked'>;
  result: ActionResult;
  idempotentReplay: boolean;
}): TimedActionSettlementReceipt {
  return {
    ...input.request,
    executionTerminal: input.executionTerminal,
    domainOutcome: domainOutcomeForTimedActionResult(input.result),
    idempotentReplay: input.idempotentReplay,
    receiptKey: `${input.request.idempotencyKey}:${input.executionTerminal}`,
  };
}

export function timedActionIdempotencyKey(executionId: string, revision: number) {
  return `timed-action:${executionId}:revision:${revision}`;
}

/**
 * Existing callers may receive successful non-terminal or replay reports with
 * no domain result.  Keep that boundary explicit instead of asserting a
 * result from `ok` alone.
 */
export function completedActionResultCode(report: {
  ok: boolean;
  execution?: { status?: string };
  result?: { resultCode?: string };
}): string | undefined {
  if (!report.ok || report.execution?.status !== 'completed') {
    return undefined;
  }
  return report.result?.resultCode;
}

function domainOutcomeForTimedActionResult(result: ActionResult): DomainOutcome {
  if (result.status === 'rejected') return 'rejected';
  if (result.status === 'interrupted') return 'failed';
  return hasDomainEffect(result.effects) ? 'applied' : 'no_effect';
}

function hasDomainEffect(effects: Effects) {
  return [
    effects.cultivationXp,
    effects.mood,
    effects.health,
    effects.fatigue,
    effects.spirit,
    effects.reputation,
  ].some((value) => value !== undefined && value !== 0) ||
    (effects.items?.length ?? 0) > 0 ||
    (effects.relationships?.length ?? 0) > 0 ||
    effects.realmChange !== undefined ||
    effects.breakthroughProgress !== undefined ||
    effects.locationChange !== undefined;
}

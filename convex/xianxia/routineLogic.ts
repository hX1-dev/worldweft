import type { AgentContext, AgentProposal } from './agentLogic';

// 需求驱动日程 + 对话纪律的「纯逻辑层」（World Foundation · W4a，W4b 修补）。
// 不依赖 Convex，可被 Jest 直接单测。
//
// 第一原则：对话不是默认闲置行为，而是需求的副产物。没需求就按本分生活、或干脆守职不动。
//   - W4b-A：「附近的人」由上层按同一 currentLocationId 过滤后传入，这里不再误把远处当在场。
//   - W4b-B：叙旧/回报带冷却（recentlyTalked = 本游戏日已谈过者），不刷屏。
//   - W4b-C：无合法非社交动作时返回 skip，绝不提交必被身份闸拒绝的动作（修空转死循环）。

// role → 本分之地（无语义地点/途中时回去）。
const HOME_ZONE: Record<string, string> = {
  elder: 'mountain_gate',
  steward: 'mountain_gate',
  guard: 'alchemy_room',
  merchant: 'market',
  outer_disciple: 'mountain_gate',
  inner_disciple: 'mountain_gate',
  sword_disciple: 'mountain_gate',
};
export function homeZone(role: string): string | undefined {
  return HOME_ZONE[role];
}

export type ConversationNeed = { targetActorId: string; reason: string };

// 此刻是否有「开口的需求」，对谁、为何。无则 null。
// 已在本游戏日叙谈过的对象（recentlyTalked）跳过，避免刷屏（W4b-B）。
export function findConversationNeed(ctx: AgentContext): ConversationNeed | null {
  const recently = new Set(ctx.recentlyTalked ?? []);
  const nearby = new Set(ctx.others.map((o) => o.actorId));

  // 1) 委托回报：发委托者就在附近、且本日未谈过 → 回报进展。
  for (const r of ctx.activeRequests ?? []) {
    if (r.issuerActorId && nearby.has(r.issuerActorId) && !recently.has(r.issuerActorId)) {
      return { targetActorId: r.issuerActorId, reason: '回报委托进展' };
    }
  }

  // 2) 关系需求：附近有交情深厚之人（好感 ≥ 25）、且本日未谈过 → 叙旧。取最亲近者。
  const friend = ctx.others
    .filter((o) => o.relationship >= 25 && !recently.has(o.actorId))
    .sort((a, b) => b.relationship - a.relationship)[0];
  if (friend) return { targetActorId: friend.actorId, reason: '与相熟之人叙谈' };

  return null;
}

export type RoutineDecision =
  | { kind: 'act'; proposal: AgentProposal }
  | { kind: 'skip'; reason: string }
  | { kind: 'defer' }; // 交给 LLM 在非社交动作里增加变化（仅自由弟子）

// 需求驱动的本分日程。返回 act（有明确该做的事）/ skip（守职不动）/ defer（弟子交 LLM 添变化）。
export function planRoutineIntent(ctx: AgentContext): RoutineDecision {
  const self = ctx.self;
  const here = self.currentLocationId;
  const can = (a: string) => ctx.availableActions.includes(a as AgentContext['availableActions'][number]);

  // 1) 途中（无语义地点）→ 回本分之地（Agent 只给语义地点，坐标由系统算）。
  if (!here) {
    const home = homeZone(self.role);
    if (home && (ctx.knownLocations ?? []).some((l) => l.locationId === home)) {
      return { kind: 'act', proposal: { type: 'travel', targetId: home, intent: '回到本分之地', source: 'agent' } };
    }
    return { kind: 'skip', reason: 'no_destination' };
  }

  // 2) 已在某地，但不在本分之地 → 归位。明确委托 / 战略 travel 已在上层先处理。
  const home = homeZone(self.role);
  if (home && here !== home && (ctx.knownLocations ?? []).some((l) => l.locationId === home)) {
    return { kind: 'act', proposal: { type: 'travel', targetId: home, intent: '回到本分之地', source: 'agent', locationId: here } };
  }

  // 3) 对话需求（带冷却）→ 有目的地 talk。
  const need = findConversationNeed(ctx);
  if (need && can('talk') && need.targetActorId !== self.actorId) {
    return {
      kind: 'act',
      proposal: { type: 'talk', targetActorId: need.targetActorId, intent: need.reason, source: 'agent', locationId: here },
    };
  }

  // 4) 按身份的本分（确定性）：
  const role = self.role;
  // 自由弟子：此地有非社交动作 → 交 LLM 增加变化（修炼/探索/切磋…）；否则守职。
  if (role.endsWith('disciple')) {
    return ctx.availableActions.some((a) => a !== 'talk') ? { kind: 'defer' } : { kind: 'skip', reason: 'nothing_here' };
  }
  // 长老/执事：闭关参悟。
  if (role === 'elder' || role === 'steward') {
    if (can('cultivate')) {
      return { kind: 'act', proposal: { type: 'cultivate', intent: '闭关参悟', source: 'agent', locationId: here } };
    }
    return { kind: 'skip', reason: 'on_duty' };
  }
  // 商贩无客、守卫无事 → 守本分，不强行修炼/乱动（W4b-C）。
  return { kind: 'skip', reason: role === 'merchant' ? 'awaiting_customer' : 'on_watch' };
}

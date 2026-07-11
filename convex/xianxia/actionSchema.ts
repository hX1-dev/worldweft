import { Infer, v } from 'convex/values';

// 太虚界动作系统的「契约层」（M2）。
// 这里集中定义动作类型、来源、生命周期、事件可见性、Action Envelope 和结果结构，
// 供 schema.ts（建表）、actions.ts（resolver）、rules.ts（纯规则）共用，避免各处散落。
// 依据：docs/xianxia-blueprint.md §8（动作系统）、§12（事件可见性）。

// 第一阶段 8 个 MVP 动作 + travel/arrive（移动/抵达也纳入统一类型便于记录）。
export const actionType = v.union(
  v.literal('cultivate'),
  v.literal('talk'),
  v.literal('trade'),
  v.literal('gift'),
  v.literal('request_teaching'),
  v.literal('spar'),
  v.literal('explore'),
  v.literal('steal'),
  v.literal('breakthrough'),
  v.literal('travel'),
  v.literal('arrive'),
);
export type ActionType = Infer<typeof actionType>;

// 动作来源（§8.1）。
export const actionSource = v.union(v.literal('human'), v.literal('agent'), v.literal('system'));
export type ActionSource = Infer<typeof actionSource>;

// 动作生命周期（§8.2）。
export const actionStatus = v.union(
  v.literal('proposed'),
  v.literal('validated'),
  v.literal('resolving'),
  v.literal('applied'),
  v.literal('rejected'),
  v.literal('interrupted'),
);
export type ActionStatus = Infer<typeof actionStatus>;

// 事件可见性（§12）：事实发生 ≠ 别人知道。
export const eventVisibility = v.union(
  v.literal('public'),
  v.literal('local'),
  v.literal('private'),
  v.literal('witnessed'),
  v.literal('rumor'),
);
export type EventVisibility = Infer<typeof eventVisibility>;

// 弱 GM 对 steal 的结构化裁决（M6）。submitAction 接收后会再经 clampGmVerdict 钳一次。
export const gmVerdictValidator = v.object({
  outcome: v.union(
    v.literal('success_undetected'),
    v.literal('success_suspected'),
    v.literal('failed_undetected'),
    v.literal('failed_detected'),
  ),
  reasonText: v.string(),
  reputationDelta: v.number(),
  relationshipDelta: v.number(),
});

// Action Envelope —— submitAction 的入参（§8.1）。
// 玩家与 Agent 共用同一入口。action 专属参数先放进开放的 params 袋，
// 由各 resolver 自行校验；M3 落地具体动作时再逐类型收紧。
export const actionEnvelopeArgs = {
  worldId: v.id('worlds'),
  type: actionType,
  actorId: v.string(),
  targetId: v.optional(v.string()),
  targetActorId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  intent: v.optional(v.string()),
  source: actionSource,
  clientActionId: v.optional(v.string()),
  riskTolerance: v.optional(v.number()),
  params: v.optional(v.any()),
  metadata: v.optional(v.any()),
};

// 结构化 effects（§8.3）。全部可选，resolver 只填它改动的字段。
export type RelationshipDelta = { targetActorId: string; delta: number };
// 物品转移：from→to 移动 itemId×qty。缺 from 表示凭空产出（如探索机缘），
// 缺 to 表示消耗。第一阶段动作只用 from+to 的转移。
export type ItemTransfer = { from?: string; to?: string; itemId: string; qty: number };
export type LocationChange = {
  fromMapId?: string;
  fromLocationId?: string;
  toMapId: string;
  toLocationId: string;
  intent?: string;
};
// 境界变更（仅突破用，绝对值覆盖）。境界提升是 cultivationXp 累积的最终兑现。
export type RealmChange = { realm: string; realmStage: number; cultivationXp: number };
export type Effects = {
  cultivationXp?: number;
  mood?: number;
  health?: number;
  spirit?: number;
  reputation?: number;
  relationships?: RelationshipDelta[];
  items?: ItemTransfer[];
  realmChange?: RealmChange;
  locationChange?: LocationChange;
};

// 一次动作裁决的结果。事实由规则决定，文本（reason）可有文学性但同样由规则给出，
// 真正接 LLM 润色是后续里程碑的事（§18.1：事实由代码裁决，表达由 LLM 生成）。
export type ResolvedStatus = 'applied' | 'rejected' | 'interrupted';
export type ActionResult = {
  status: ResolvedStatus;
  resultCode: string; // 机器可读，如 'cultivation_success' / 'location_forbids_cultivate'
  reason: string; // 人类可读，写入事件 summary
  effects: Effects;
  eventType: string; // 追加到 worldEvents.type
  visibility: EventVisibility;
};

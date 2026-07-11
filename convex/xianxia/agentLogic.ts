// Agent 自主意图的「纯逻辑层」（M5）。
// 不依赖 Convex / 不调 LLM：负责①把决策上下文渲染成 prompt ②把 LLM 返回的 JSON
// 解析并校验成一个合法的动作意图，非法则兜底。这样可被 Jest 直接单测。
// 真正的 DB 读取与 DeepSeek 调用在 agent.ts。
// 依据：docs/xianxia-blueprint.md §12（Agent 设计）、§19.1（意图选择 prompt）。

import type { ActionType } from './actionSchema';

export type AgentContext = {
  self: {
    actorId: string;
    name: string;
    role: string;
    realm: string;
    realmStage: number;
    cultivationXp: number;
    mood: number;
    health: number;
    spirit: number;
    reputation: number;
    currentLocationId?: string;
    inventory: { itemId: string; qty: number }[];
    persona?: string; // 精炼行为倾向，影响选动作
  };
  currentLocationName?: string;
  others: { actorId: string; name: string; realm: string; relationship: number }[];
  recentEvents: string[];
  // 当前地点允许、且第一阶段已实现的动作。
  availableActions: ActionType[];
  // 修为已攒够、可尝试突破（有风险）。
  readyToBreakthrough?: boolean;
  // M7 点亮：让 Agent 能为目标主动 travel / 响应委托。
  knownLocations?: { locationId: string; name: string; allowedActions: string[] }[];
  activeRequests?: {
    type: string;
    itemId?: string;
    qty?: number;
    locationId?: string;
    issuerActorId?: string; // W4a：发委托者（在附近则可回报）
    summary: string;
  }[];
  // W4a：当前昼夜阶段，让「按时辰生活」的日常有据可依。
  phase?: 'dawn' | 'day' | 'dusk' | 'night';
  // W4b-B：本游戏日内已叙谈过的对象 actorId（对话冷却，避免刷屏）。
  recentlyTalked?: string[];
};

// LLM 产出的意图，转成 submitAction 的入参（worldId 由 agent.ts 补）。
export type AgentProposal = {
  type: ActionType;
  targetActorId?: string;
  targetId?: string; // travel 的目标语义地点（系统据此查 entryPoint，Agent 不输出坐标）
  locationId?: string;
  params?: Record<string, string>;
  intent: string;
  source: 'agent';
};

const NO_TARGET_ACTIONS: ActionType[] = ['cultivate', 'explore'];
const TARGET_ACTIONS: ActionType[] = ['talk', 'spar', 'request_teaching', 'gift', 'trade', 'steal'];
const ITEM_GIVE_ACTIONS: ActionType[] = ['gift', 'trade'];

// —— M7 战略意图（纯逻辑，先于 LLM）——
// 为「具体目标」主动 travel / 取物：响应委托。无明确目标则返回 null，交给 LLM 在本地动作里选。
// 这不是 planner/GOAP，只是把已建的 travel + 委托接成最小目标导向闭环。Agent 仍只出语义目标。
export function planStrategicIntent(ctx: AgentContext): AgentProposal | null {
  const self = ctx.self;
  const known = ctx.knownLocations ?? [];
  const reqs = ctx.activeRequests ?? [];
  const here = self.currentLocationId;
  const has = (itemId: string, qty = 1) =>
    (self.inventory.find((i) => i.itemId === itemId)?.qty ?? 0) >= qty;
  const locExists = (id: string) => known.some((l) => l.locationId === id);
  const travelTo = (id: string, why: string): AgentProposal => ({
    type: 'travel',
    targetId: id,
    intent: why,
    source: 'agent',
    locationId: here,
  });

  for (const r of reqs) {
    // 探索类委托：人不在目标地点 → 前往；已在 → 探索推进（到达即由 tick 结算）。
    if (r.type === 'explore_location' && r.locationId) {
      if (here !== r.locationId && locExists(r.locationId)) return travelTo(r.locationId, `受托前往目标之地`);
      if (here === r.locationId && ctx.availableActions.includes('explore')) {
        return { type: 'explore', intent: '履行探索委托', source: 'agent', locationId: here };
      }
    }
    // 采集类委托且尚缺其物：去可探索之地采集（灵草等机缘自探索得）。
    if (r.type === 'collect_item' && r.itemId && !has(r.itemId, r.qty ?? 1)) {
      const exploreLoc = known.find((l) => l.allowedActions.includes('explore'));
      if (exploreLoc) {
        if (here !== exploreLoc.locationId) return travelTo(exploreLoc.locationId, `为委托采办所需之物`);
        if (ctx.availableActions.includes('explore')) {
          return { type: 'explore', intent: '采办委托所需之物', source: 'agent', locationId: here };
        }
      }
    }
    // collect_item 且已持有 → 无需动作，tickQuests 会自动结算。
  }
  return null;
}

// —— 构造给 LLM 的 prompt（§19.1 强调：不能直接改世界、只能选可用动作、输出 JSON）——
export function buildAgentMessages(ctx: AgentContext): { system: string; user: string } {
  const s = ctx.self;
  const system = [
    `你是修仙世界「太虚界」中的角色：${s.name}（${s.role}，${s.realm} ${s.realmStage} 层）。`,
    s.persona ? `你的性情：${s.persona}` : '',
    '规则：',
    '- 你不能直接控制世界，只能从【可用动作】里选择一个，提交你的意图。',
    '- 你不知道视野外的信息，不要编造不存在的角色、地点或物品。',
    '- 行动要符合你的身份、境界、心境与处境。',
    '- 没有特别合适的行动时，就选择 cultivate（修炼）。',
    '- 必须只输出一个 JSON 对象，形如：',
    '  {"type":"<动作>","targetActorId":"<目标角色actorId,可空>","params":{"itemId":"<物品,可空>"},"reason":"<一句话理由>"}',
  ]
    .filter(Boolean)
    .join('\n');

  const others =
    ctx.others.length > 0
      ? ctx.others
          .map((o) => `  - ${o.name}（actorId=${o.actorId}，${o.realm}，关系 ${o.relationship}）`)
          .join('\n')
      : '  （附近无人）';
  const inv =
    s.inventory.length > 0 ? s.inventory.map((i) => `${i.itemId}×${i.qty}`).join('、') : '（无）';
  const events = ctx.recentEvents.length > 0 ? ctx.recentEvents.map((e) => `  - ${e}`).join('\n') : '  （无）';
  const places =
    (ctx.knownLocations ?? []).length > 0
      ? (ctx.knownLocations ?? [])
          .map((l) => `  - ${l.name}（id=${l.locationId}，可：${l.allowedActions.join('/')}）`)
          .join('\n')
      : '  （未知）';
  const quests =
    (ctx.activeRequests ?? []).length > 0
      ? (ctx.activeRequests ?? []).map((r) => `  - ${r.summary}`).join('\n')
      : '  （无）';

  const user = [
    `当前地点：${ctx.currentLocationName ?? '未知'}`,
    `你的状态：修为 ${s.cultivationXp}，心境 ${s.mood}，气血 ${s.health}，神识 ${s.spirit}，声望 ${s.reputation}`,
    `你的物品：${inv}`,
    '附近的人：',
    others,
    '最近发生：',
    events,
    '你身上的委托：',
    quests,
    '可去之处：',
    places,
    `可用动作：${ctx.availableActions.join('、')}`,
    ctx.readyToBreakthrough
      ? '【你修为已足，可尝试 breakthrough 突破境界——成功则境界提升，但失败伤身、小概率走火入魔】'
      : '',
    '需要目标角色的动作：talk/spar/request_teaching/gift/trade/steal（请给 targetActorId）。',
    'gift 需要 params.itemId（你的物品之一）。',
    '若你想做的事此地不可为（如想交易却不在坊市），可输出 {"type":"travel","targetId":"<可去之处的id>"} 先前往。',
    '请输出你的选择（仅 JSON）。',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

// —— 解析并校验 LLM 输出，非法一律兜底为安全动作（§19.1）——
export function parseProposal(content: string, ctx: AgentContext): AgentProposal | null {
  const raw = extractJson(content);
  if (!raw) return fallback(ctx);

  const type = raw.type as ActionType;
  const intent = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : '依心而行';

  // travel 不在地点的 availableActions 里，单独校验：目标须是已知语义地点（绝不收坐标）。
  if (type === 'travel') {
    const dest =
      typeof raw.targetId === 'string'
        ? raw.targetId
        : typeof raw.targetLocationId === 'string'
          ? raw.targetLocationId
          : undefined;
    if (dest && dest !== ctx.self.currentLocationId && (ctx.knownLocations ?? []).some((l) => l.locationId === dest)) {
      return { type: 'travel', targetId: dest, intent, source: 'agent', locationId: ctx.self.currentLocationId };
    }
    return fallback(ctx);
  }

  if (!ctx.availableActions.includes(type)) return fallback(ctx);

  const base: AgentProposal = { type, intent, source: 'agent', locationId: ctx.self.currentLocationId };

  if (NO_TARGET_ACTIONS.includes(type)) return base;

  if (TARGET_ACTIONS.includes(type)) {
    const targetActorId = typeof raw.targetActorId === 'string' ? raw.targetActorId : undefined;
    const targetKnown = !!targetActorId && ctx.others.some((o) => o.actorId === targetActorId);
    if (!targetKnown) return fallback(ctx); // 目标缺失/不可见 → 兜底
    const proposal: AgentProposal = { ...base, targetActorId };

    // gift：自动用自己的第一件物品；无物品则兜底。
    if (type === 'gift') {
      const itemId = pickItem(raw) ?? ctx.self.inventory[0]?.itemId;
      if (!itemId) return fallback(ctx);
      proposal.params = { itemId };
    } else if (ITEM_GIVE_ACTIONS.includes(type) || type === 'steal') {
      // trade/steal：物品须由 LLM 给出（可能涉及对方物品）；缺失则透传交给规则层裁决/拒绝。
      const p: Record<string, string> = {};
      const itemId = pickItem(raw);
      if (itemId) p.itemId = itemId;
      if (typeof raw.offeredItemId === 'string') p.offeredItemId = raw.offeredItemId;
      if (typeof raw.requestedItemId === 'string') p.requestedItemId = raw.requestedItemId;
      if (type === 'trade' && (!p.offeredItemId || !p.requestedItemId)) return fallback(ctx);
      if (type === 'steal' && !p.itemId) return fallback(ctx);
      proposal.params = p;
    }
    return proposal;
  }

  return fallback(ctx);
}

// 兜底到一个「此地此身份合法」的无目标动作；没有就返回 null（→ 上层 skip，
// 绝不提交一个必被身份/地点闸拒绝的动作，W4b-C 修空转死循环）。
function fallback(ctx: AgentContext): AgentProposal | null {
  const type = NO_TARGET_ACTIONS.find((a) => ctx.availableActions.includes(a));
  if (!type) return null;
  return { type, locationId: ctx.self.currentLocationId, intent: '审时度势，先稳住自身', source: 'agent' };
}

// 从可能带 ```json 围栏或多余文本的内容里抽出第一个 JSON 对象。
function extractJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const fenced = content.replace(/```json/gi, '```').split('```');
  for (const chunk of [content, ...fenced]) {
    const start = chunk.indexOf('{');
    const end = chunk.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(chunk.slice(start, end + 1));
      } catch {
        // 试下一个候选
      }
    }
  }
  return null;
}

function pickItem(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.itemId === 'string') return raw.itemId;
  const params = raw.params;
  if (params && typeof params === 'object' && typeof (params as Record<string, unknown>).itemId === 'string') {
    return (params as Record<string, string>).itemId;
  }
  return undefined;
}

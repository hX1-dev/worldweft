import type { StealOutcome } from './rules';

// 弱 GM（天道）的「纯逻辑层」（M6）。不依赖 Convex / 不调 LLM：
// ① 把高风险情境渲染成 GM prompt ② 把 LLM 返回的 JSON 解析并【钳制校验】成合法裁决，
// 非法返回 null（调用方退回确定性规则）。可被 Jest 直接单测。
// 关键原则（蓝图 §9.6 / §19.2）：GM 只产结构化建议，不能创造事实、不能直接改数值；
// 数值范围由这里钳死，规则层（submitAction）提交前会再钳一次（纵深防御）。

export type GmContext = {
  actorName: string;
  targetName: string;
  itemId: string;
  locationName: string;
  dangerLevel: number;
  actorSpirit: number; // 行动者隐匿/神识
  targetSpirit: number; // 目标感知
  relationship: number; // 行动者→目标
  witnessNames: string[]; // 同地点的其他人（仅供 GM 参考）
};

// 经钳制的 GM 裁决。outcome 决定成败/暴露，deltas 已限幅。
export type GmVerdict = {
  outcome: StealOutcome;
  reasonText: string;
  reputationDelta: number; // [-10, 0]
  relationshipDelta: number; // [-30, 0]
};

const OUTCOMES: StealOutcome[] = [
  'success_undetected',
  'success_suspected',
  'failed_undetected',
  'failed_detected',
];

// GM prompt（§19.2：你是裁决辅助器，不是故事作者）。
export function buildGmMessages(ctx: GmContext): { system: string; user: string } {
  const system = [
    '你是太虚界的「天道」裁决辅助器，不是故事作者。',
    '你只为一次【偷窃】给出结构化裁决建议，必须尊重给定事实：',
    '- 不得创造不存在的人物、地点或物品。',
    '- 不得直接改数值，只能在允许范围内建议。',
    '- 结合隐匿、感知、守卫、关系、目击者，判断结果是否合情理。',
    '必须只输出一个 JSON：',
    '{"outcome":"success_undetected|success_suspected|failed_undetected|failed_detected",',
    ' "reasonText":"<一句话因果解释>","reputationDelta":<-10..0>,"relationshipDelta":<-30..0>}',
  ].join('\n');

  const user = [
    `行窃者：${ctx.actorName}（隐匿/神识 ${ctx.actorSpirit}）`,
    `目标：${ctx.targetName}（感知 ${ctx.targetSpirit}），欲取之物：${ctx.itemId}`,
    `地点：${ctx.locationName}（守卫强度 ${ctx.dangerLevel}）`,
    `双方关系：${ctx.relationship}`,
    `在场可能的目击者：${ctx.witnessNames.length ? ctx.witnessNames.join('、') : '无'}`,
    '请给出你的裁决建议（仅 JSON）。',
  ].join('\n');

  return { system, user };
}

// 解析 LLM 输出 → 钳制校验。非法返回 null（调用方退回确定性规则）。
export function parseGmVerdict(content: string): GmVerdict | null {
  const raw = extractJson(content);
  if (!raw) return null;
  return clampGmVerdict(raw);
}

// 权威钳制：校验 outcome 枚举、限幅 deltas、兜底 reasonText。submitAction 提交前也调它。
export function clampGmVerdict(raw: unknown): GmVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const outcome = r.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as StealOutcome)) return null;
  const reasonText =
    typeof r.reasonText === 'string' && r.reasonText.trim() ? r.reasonText.trim() : '天道裁决。';
  return {
    outcome: outcome as StealOutcome,
    reasonText,
    reputationDelta: clampNum(r.reputationDelta, -10, 0),
    relationshipDelta: clampNum(r.relationshipDelta, -30, 0),
  };
}

function clampNum(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(min, Math.min(max, n));
}

function extractJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const candidates = [content, ...content.replace(/```json/gi, '```').split('```')];
  for (const chunk of candidates) {
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

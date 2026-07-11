// 太虚界世界身份（青岚宗）——纯常量，无 Convex 依赖，可单测、可喂 prompt/UI。
// 依据：xianxia-world-concept-pack/docs/taixu-world-setting.md §1、taixu-world-rules.md §5。
//
// 与「as-built 蓝图」对齐：第一阶段实际运行区域 = 青岚山外门；宗门 = 青岚宗（地方小宗门）。
// 宗门规矩不是装饰——它解释为何某些动作在某些地点后果更重（如丹房擅闯、私斗致伤），
// 供规则层 dangerLevel / allowedActions 与裁决文案引用。

export const SECT_IDENTITY = {
  world: '太虚界',
  region: '青岚山外门',
  sect: '青岚宗',
  sectKind: '地方小宗门',
  // 宗门结构：宗主（背景）/ 长老 / 执事 / 守卫 / 外门弟子 / 坊市商贩。
  structure: ['宗主', '长老', '执事', '守卫', '外门弟子', '坊市商贩'],
  // 6 条外门规矩（影响裁决，非装饰）。
  rules: [
    '不得私斗致伤。',
    '不得偷盗宗门财物。',
    '不得擅闯丹房重地。',
    '同门切磋需双方同意。',
    '坊市交易自负盈亏，但欺诈会影响声望。',
    '秘境入口可探索，但低境界弟子风险自担。',
  ],
} as const;

// 一段可直接塞进 Agent / 对话 / GM prompt 的世界背景白描。
export function sectBackdrop(): string {
  const s = SECT_IDENTITY;
  return [
    `这里是${s.world}·${s.region}，${s.sect}（${s.sectKind}）的外门。`,
    `外门规矩：${s.rules.join('')}`,
  ].join('\n');
}

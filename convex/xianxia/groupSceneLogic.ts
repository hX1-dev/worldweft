import type { Phase } from './timeLogic';

// 群体场景的「纯逻辑层」（World Foundation · W4b-F）。不依赖 Convex，可被 Jest 直接单测。
//
// AI Town 的 Conversation 是双人制，不能硬塞群聊。所以晨课/坊市议价/秘境组队这类群体互动
// 做成**确定性、低频、有条件触发的 worldEvent**（群聊 = 世界事件 + 少量代表台词），
// 而非多人自由会话。内容全模板生成，不开 LLM 成本。

export type SceneActor = { actorId: string; name: string; role: string };

export type GroupScene = {
  purpose: string; // morning_teaching / market_haggle / realm_party
  summary: string;
  targetActorIds: string[];
  lines: string[]; // 1-3 条代表性台词/描述
};

// 给定某地点在场角色 + 昼夜阶段，确定性判断是否成场景并生成内容。不成则 null。
// 条件：同地点 ≥3 人，且符合 phase/location/role 组合。
export function planGroupScene(
  locationId: string,
  phase: Phase,
  actors: SceneActor[],
): GroupScene | null {
  if (actors.length < 3) return null;
  const elder = actors.find((a) => a.role === 'elder' || a.role === 'steward');
  const merchant = actors.find((a) => a.role === 'merchant');
  const disciples = actors.filter((a) => a.role.endsWith('disciple'));

  // 清晨 · 山门：长老 + ≥2 弟子 → 晨课。
  if (phase === 'dawn' && locationId === 'mountain_gate' && elder && disciples.length >= 2) {
    const names = disciples.slice(0, 3).map((d) => d.name).join('、');
    return {
      purpose: 'morning_teaching',
      summary: `${elder.name}在山门为${names}讲授吐纳法门，众弟子凝神静听。`,
      targetActorIds: [elder.actorId, ...disciples.slice(0, 3).map((d) => d.actorId)],
      lines: [`${elder.name}：修行先稳心，不可急进。`, `${disciples[0].name}：弟子谨记。`],
    };
  }

  // 白天 · 坊市：商贩 + ≥2 弟子 → 议价喧闹。
  if (phase === 'day' && locationId === 'market' && merchant && disciples.length >= 2) {
    return {
      purpose: 'market_haggle',
      summary: `坊市人声渐起，${merchant.name}与几名外门弟子你来我往地讨价还价。`,
      targetActorIds: [merchant.actorId, ...disciples.slice(0, 3).map((d) => d.actorId)],
      lines: [`${merchant.name}：这个价已是亏本，可不能再低了。`],
    };
  }

  // 秘境入口：≥3 修士聚集 → 结伴组队。
  if (locationId === 'secret_realm_gate' && actors.length >= 3) {
    const names = actors.slice(0, 3).map((a) => a.name).join('、');
    return {
      purpose: 'realm_party',
      summary: `${names}等修士在秘境入口前相约结伴、分派进退。`,
      targetActorIds: actors.slice(0, 4).map((a) => a.actorId),
      lines: [`众人低声商议：互为照应，遇险即退。`],
    };
  }

  return null;
}

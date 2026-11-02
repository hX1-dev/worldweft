// Agent 自主意图的 Convex 层（M5）。流程：装载上下文 → DeepSeek 产意图 → 校验兜底
// → 经 submitAction 落地。LLM 只产 proposal，永远改不了世界（一切经规则层裁决）。
// 依据：docs/xianxia-blueprint.md §12、§19.1。手动/UI 触发以控成本（§20.3）。

import type { AgentTickReservation } from '../agentTickScheduler';

export const MAX_KNOWN_LOCATIONS = 64;

export const MAX_ACTIVE_REQUESTS = 20;

export const MAX_RESOURCE_NODES = 24;

export const AGENT_TICK_LEASE_TTL_MS = 300_000;

export const VALLEY_MAP_ID = 'qinglan_valley_gate';

export function isGodotSmokeActor(actorId: string) {
  return actorId.startsWith('godot_smoke_');
}

export function memoryTouchesGodotSmoke(memory: { aboutActorIds?: string[]; summary?: string }) {
  return (
    (memory.aboutActorIds ?? []).some(isGodotSmokeActor) ||
    (memory.summary ?? '').includes('godot_smoke_')
  );
}

export function emptyAgentTickReservation(mapId: string | undefined): AgentTickReservation {
  return {
    scope: mapId ?? '*',
    actorIds: [],
    eligibleCount: 0,
    wrapped: false,
    scannedCount: 0,
    eligibleCountExact: false,
  };
}

export function sessionRecipientsExhausted(
  participantActorIds: string[],
  donorActorId: string,
  attemptedRecipientActorIds: string[],
) {
  const attempted = new Set(attemptedRecipientActorIds);
  return participantActorIds
    .filter((actorId) => actorId !== donorActorId)
    .every((actorId) => attempted.has(actorId));
}

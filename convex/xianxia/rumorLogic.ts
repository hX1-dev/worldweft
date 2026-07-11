import { seededRoll } from './rules';
import type { EventVisibility } from './actionSchema';

// 传闻传播的「纯逻辑层」（M8）。
// 关键约束：本文件不依赖 Convex（只 import type + 复用纯函数 seededRoll），
// 输入是普通数据快照，输出是纯结果，因此可被 Jest 直接单测；DB 读写留给接线层。
//
// 它把第一阶段预留但休眠的 worldEvents.visibility 真正激活：一件事发生后，
//   谁会「知道」、是直接当事 / 亲眼目击 / 在场听闻 / 道听途说，知道的版本是否走样。
// 依据：docs/xianxia-blueprint.md §12.4（可见性）、docs/xianxia-phase-two-plan.md M8。

// 接线层从 DB 读出后传入的角色快照（只含传播需要的字段）。
export type RumorActor = {
  actorId: string;
  currentLocationId?: string;
  reputation: number; // 当事人越出名/越臭名，事件越值得传
};

// 一条待传播的世界事件快照。
export type RumorEvent = {
  eventId: string;
  type: string;
  visibility: EventVisibility;
  actorIds: string[]; // 当事人，必定知道
  targetActorIds?: string[]; // 受动作者，也算当事人
  witnessActorIds?: string[]; // 明确目击者
  locationId?: string; // 发生地点（local/public 据此判断在场）
  summary: string; // 原始（真实）版本
};

// 某个角色「得知」了一件事，以及他所知的版本。
export type RumorSource = 'direct' | 'witness' | 'present' | 'rumor';
export type RumorDelivery = {
  actorId: string;
  source: RumorSource;
  distorted: boolean; // 是否经辗转走样
  summary: string; // 此人所知版本（走样则为加工后的传言）
};

// 事件本身「有多值得传」。偷窃/突破/切磋这类有戏剧性，普通交谈/修炼则平淡。
// 返回 0..1，供决定 rumor 扩散概率。
export function eventSalience(type: string): number {
  if (type.startsWith('steal')) return 0.9;
  if (type.startsWith('breakthrough')) return 0.8;
  if (type.startsWith('spar')) return 0.6;
  if (type.startsWith('exploration') || type.startsWith('explore')) return 0.5;
  if (type.startsWith('teaching') || type.startsWith('request_teaching')) return 0.4;
  if (type.startsWith('trade') || type.startsWith('gift')) return 0.3;
  return 0.15; // 交谈、到达、修炼等日常
}

// 把真实 summary 加工成走样的传言版本。确定性、克制：只加「据传」前缀以示未必属实，
// 真正的语言润色留给后续 LLM 接线；纯逻辑只负责标记「这是二手且可能失真的」。
function garble(summary: string): string {
  return `据传，${summary}`;
}

const RUMOR_DISTORTION_CHANCE = 0.4; // 道听途说本就容易走样

// 核心：给定一件事件 + 全体在场/相关角色，确定性地算出「谁知道、怎么知道的、是否走样」。
//
// 规则（按 visibility）：
//   private   → 仅当事人。
//   witnessed → 当事人 + 明确目击者。
//   local     → 当事人 + 同地点在场者。
//   public    → 所有人（视为广为人知）。
//   rumor     → 先有种子知情者（当事人 + 目击者 + 同地点者），再按「事件显著度 +
//               当事人声望」向其余人确定性扩散；二手获知者有几率把消息听走样。
//
// seedPrefix 让同一世界同一事件的掷点可复现（§18.3）；不同事件天然不同。
export function propagateEvent(event: RumorEvent, actors: RumorActor[]): RumorDelivery[] {
  const principals = new Set<string>([...event.actorIds, ...(event.targetActorIds ?? [])]);
  const deliveries = new Map<string, RumorDelivery>();

  // 当事人永远以「直接、未走样」的方式知道。
  for (const id of principals) {
    deliveries.set(id, { actorId: id, source: 'direct', distorted: false, summary: event.summary });
  }

  // 不覆盖已有的更「近」来源（direct > witness > present > rumor）。
  const add = (actorId: string, source: RumorSource, distorted: boolean, summary: string) => {
    if (deliveries.has(actorId)) return;
    deliveries.set(actorId, { actorId, source, distorted, summary });
  };

  const witnesses = new Set(event.witnessActorIds ?? []);
  const presentHere = (a: RumorActor) =>
    !!event.locationId && a.currentLocationId === event.locationId;

  switch (event.visibility) {
    case 'private':
      break; // 只有当事人知道

    case 'witnessed':
      for (const id of witnesses) add(id, 'witness', false, event.summary);
      break;

    case 'local':
      for (const a of actors) {
        if (witnesses.has(a.actorId)) add(a.actorId, 'witness', false, event.summary);
        else if (presentHere(a)) add(a.actorId, 'present', false, event.summary);
      }
      break;

    case 'public':
      for (const a of actors) add(a.actorId, 'present', false, event.summary);
      break;

    case 'rumor': {
      // 种子知情者：目击者 + 同地点在场者，均算「未走样的一手」。
      for (const a of actors) {
        if (witnesses.has(a.actorId)) add(a.actorId, 'witness', false, event.summary);
        else if (presentHere(a)) add(a.actorId, 'present', false, event.summary);
      }
      // 向其余人扩散：显著度越高、当事人越出名，越容易传开。
      const salience = eventSalience(event.type);
      const fame =
        Math.max(0, ...event.actorIds.map((id) => {
          const a = actors.find((x) => x.actorId === id);
          return a ? Math.abs(a.reputation) : 0;
        })) * 0.002;
      const hearChance = Math.min(0.85, 0.1 + salience * 0.5 + fame);
      for (const a of actors) {
        if (deliveries.has(a.actorId)) continue;
        const hearRoll = seededRoll(`${event.eventId}:${a.actorId}:hear`);
        if (hearRoll >= hearChance) continue;
        const distorted = seededRoll(`${event.eventId}:${a.actorId}:distort`) < RUMOR_DISTORTION_CHANCE;
        add(a.actorId, 'rumor', distorted, distorted ? garble(event.summary) : event.summary);
      }
      break;
    }
  }

  return [...deliveries.values()];
}

// 玩家对话 · 道友在山里的名声（好感度 v1.3）：道友骂了人，被骂的人和当时在场的人知道；之后跟着日志里
// 人和人真实的来往（说上了话、送到了东西）一个传一个（playerAffinityLogic.spreadPlayerRumor）。
// 走到某人身边之前：他记的仇按天数淡一点，听来的"道友骂了谁"算进他对道友的好感度（只算一次），
// 处境里加上这件事（规则不会把它当新鲜事讲给道友本人听，最多当面问一句），再算出他眼下的态度。
// 试玩窗口 player_dialogue_chat.mjs 和场景检查 check_player_dialogue_affinity.mjs 共用。需要 ts-node 加载器。

import {
  PLAYER_ACTOR_ID,
  attitudeOf,
  forgiveDrift,
  hearerPenalty,
  pickWitnesses,
  spreadPlayerRumor,
} from '../../convex/xianxia/playerAffinityLogic.ts';
import { nameOf, traitsOf } from './player_dialogue_world.mjs';

export function createPlayerSociety(world, { seed }) {
  const rumors = [];

  // 道友在一段对话里骂了人（同一段话只记一件）：被骂的人亲历；同在一处、醒着的人里，最多两个离得近的
  // 当场听见（看他在做什么：院里闲着的容易听见，屋里打坐的不太会）——不是全院的人都知道。
  function recordOffense({ victimId, tick, tone, placeName }) {
    const newsId = `player:offense:${victimId}:${tick}`;
    if (rumors.some((rumor) => rumor.newsId === newsId)) return undefined;
    const initialKnowers = { [victimId]: { tick, source: 'direct' } };
    const nearby = world
      .whereabouts(tick)
      .filter((person) => person.actorId !== victimId && !person.asleep && !person.travelling && person.placeName === placeName);
    for (const actorId of pickWitnesses({ candidates: nearby, seedKey: `${seed}:player-witness:${newsId}` })) {
      initialKnowers[actorId] = { tick, source: 'witness' };
    }
    const rumor = { newsId, victimId, tick, tone, placeName, initialKnowers };
    rumors.push(rumor);
    return rumor;
  }

  // 到 tick 为止，这件事传到了谁那里（每次从头按日志算，结果是定的）。
  function knowersAt(rumor, tick) {
    return spreadPlayerRumor({
      rumor: { newsId: rumor.newsId, victimId: rumor.victimId, tick: rumor.tick, tone: rumor.tone, knowers: rumor.initialKnowers },
      interactions: world.interactionsBetween(rumor.tick, tick),
      traitsOf,
      closeness: world.affinityBetween,
      seedKey: `${seed}:player-rumor`,
    });
  }

  function verbOf(rumor) {
    return rumor.tone === 'threat' ? '威胁' : '骂';
  }

  // 走到 actorId 身边之前：改他记着的好感度（淡掉的仇、听来的事），给处境加上他知道的事、算出态度。
  // 会改 player（他和道友之间的往来）；只想看看不想改，用 preview。
  function prepare(actorId, tick, player, situation) {
    const traits = traitsOf(actorId);
    const drift = forgiveDrift(player, tick, traits);
    player.relationship = drift.relationship;
    player.lastDriftTick = drift.lastDriftTick;
    player.rumorsHeard ??= [];
    for (const rumor of rumors) {
      if (rumor.victimId === actorId) continue;
      const known = knowersAt(rumor, tick)[actorId];
      if (!known) continue;
      if (!player.rumorsHeard.includes(rumor.newsId)) {
        player.relationship += hearerPenalty(world.affinityBetween(actorId, rumor.victimId, tick), known.source);
        player.rumorsHeard.push(rumor.newsId);
      }
      if (situation) {
        const victim = nameOf(rumor.victimId);
        situation.news.push({
          newsId: rumor.newsId,
          kind: 'quarrel',
          text: `道友${verbOf(rumor)}了${victim}`,
          predicate: `${verbOf(rumor)}了${victim}`,
          heardTick: known.tick,
          source: known.source,
          aboutActorIds: [PLAYER_ACTOR_ID, rumor.victimId],
        });
      }
    }
    const attitude = attitudeOf(player, tick, traits);
    if (situation) situation.attitude = attitude;
    return attitude;
  }

  // 只看不改：他眼下对道友的好感度和态度（试玩窗口的名单用）。
  function preview(actorId, tick, player) {
    const copy = { ...player, rumorsHeard: [...(player.rumorsHeard ?? [])] };
    const attitude = prepare(actorId, tick, copy, undefined);
    return { attitude, relationship: Math.round(copy.relationship) };
  }

  // 到 tick 为止，有几个人知道道友骂过人（不算被骂的人自己）。
  function heardBy(tick) {
    const people = new Set();
    for (const rumor of rumors) {
      for (const actorId of Object.keys(knowersAt(rumor, tick))) {
        if (actorId !== rumor.victimId) people.add(actorId);
      }
    }
    return people.size;
  }

  return { rumors, recordOffense, knowersAt, prepare, preview, heardBy };
}

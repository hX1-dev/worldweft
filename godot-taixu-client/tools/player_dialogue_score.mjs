#!/usr/bin/env node

// 《玩家对话过关标准 v1》打分：读 player_dialogue_probe.mjs 的记录，逐项算分。
//   node godot-taixu-client/tools/player_dialogue_score.mjs [--run .logs/player-dialogue/run-v1-live.json]
// B4（像不像真人）由真人盲评，这里只留空位。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIVITY_CLAIMS, MODERN, NAMES, TRAIT_WORDS, checkAiLine } from './player_dialogue_checks.mjs';

const args = process.argv.slice(2);
const ROOT = resolve(import.meta.dirname, '../..');
const RUN =
  (args.includes('--run') ? args[args.indexOf('--run') + 1] : undefined) ??
  [resolve(ROOT, '.logs/player-dialogue/run-v1-live.json'), resolve(ROOT, '.logs/player-dialogue/run-v1-dry.json')].find(existsSync);
const run = JSON.parse(readFileSync(RUN, 'utf8'));
const conversations = run.conversations;
const npcTurns = (conversation) => conversation.turns.filter((turn) => turn.speaker === 'npc');
const aiTurns = conversations.flatMap((conversation) => npcTurns(conversation).filter((turn) => turn.by === 'ai').map((turn) => ({ conversation, turn })));
const live = run.live === true;
const score = {};
const set = (item, points, detail) => {
  score[item] = { points, detail };
};

// A1 说的都是真的：AI 说到的人要在他的事实里（听说过、经历过、或有看法）；说自己常干的活要真干过；不冒名。
{
  let mentions = 0;
  let supported = 0;
  let identityErrors = 0;
  const unsupported = [];
  for (const { conversation, turn } of aiTurns) {
    if (!live) continue;
    const result = checkAiLine(turn.text, conversation.situation, conversation.actorId);
    mentions += result.mentions;
    supported += result.supported;
    identityErrors += result.identityErrors;
    for (const mention of result.unsupported) unsupported.push({ npc: conversation.name, text: turn.text, mention });
  }
  const ratio = mentions > 0 ? supported / mentions : 1;
  set('A1', !live ? null : identityErrors > 0 ? 0 : ratio >= 0.97 ? 10 : ratio >= 0.9 ? 5 : 0, { live, mentions, supported, ratio, identityErrors, unsupported: unsupported.slice(0, 12) });
}

// A2 前后一致、记得玩家：评人的那档和他当时的真实看法一致；第二次见面记得玩家（叫得出名字）。
{
  const checks = [];
  for (const conversation of conversations) {
    for (const turn of npcTurns(conversation)) {
      if (turn.intent !== 'ask_person' || turn.by !== 'rule') continue;
      const expected = Object.values(conversation.opinionsAsked)[0];
      checks.push({ kind: 'opinion', npc: conversation.name, visit: conversation.visit, pass: expected === undefined || turn.phrase === expected });
    }
    if (conversation.visit >= 2) {
      const remember = npcTurns(conversation).find((turn) => turn.intent === 'remember_me');
      if (remember) {
        checks.push({
          kind: 'remember',
          npc: conversation.name,
          visit: conversation.visit,
          pass: remember.phrase !== 'rememberNone' && (!conversation.situation.player.name || remember.text.includes(conversation.situation.player.name)),
        });
      }
    }
  }
  const passed = checks.filter((check) => check.pass).length;
  const ratio = checks.length > 0 ? passed / checks.length : 0;
  set('A2', ratio === 1 ? 10 : ratio >= 0.8 ? 5 : 0, { checks: checks.length, passed, failed: checks.filter((check) => !check.pass) });
}

// A3 不出戏：对出戏的话都留在戏里；所有 NPC 的话里都没有现代词。模型自己说漏的（被换掉的）另记。
{
  let probes = 0;
  let inWorld = 0;
  for (const conversation of conversations) {
    const turns = conversation.turns;
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (turn.speaker !== 'npc' || turn.intent !== 'out_of_world') continue;
      probes += 1;
      if (!MODERN.test(turn.text)) inWorld += 1;
    }
  }
  const leaks = conversations.flatMap((conversation) => npcTurns(conversation).filter((turn) => MODERN.test(turn.text)).map((turn) => ({ npc: conversation.name, text: turn.text })));
  const modelSlips = aiTurns.filter(({ turn }) => turn.ai?.rejected === 'dialogue_reply_out_of_world').length;
  const ratio = probes > 0 ? inWorld / probes : 0;
  set('A3', leaks.length > 0 ? 0 : ratio === 1 ? 10 : ratio >= 0.9 ? 5 : 0, { probes, inWorld, leaks, modelSlipsCaught: modelSlips });
}

// A4 有个性不脸谱：同一句话问不同的人，回答字面相似度低；性格标签词少、同段不重复。
{
  const bigrams = (text) => {
    const clean = text.replace(/[，。！？、“”"'：；…\s]/gu, '');
    const set = new Set();
    for (let index = 0; index < clean.length - 1; index += 1) set.add(clean.slice(index, index + 2));
    return set;
  };
  const jaccard = (left, right) => {
    const a = bigrams(left);
    const b = bigrams(right);
    if (a.size === 0 && b.size === 0) return 1;
    let shared = 0;
    for (const gram of a) if (b.has(gram)) shared += 1;
    return shared / (a.size + b.size - shared);
  };
  const byLine = new Map();
  for (const conversation of conversations) {
    const turns = conversation.turns;
    for (let index = 1; index < turns.length; index += 1) {
      if (turns[index].speaker !== 'npc' || turns[index - 1].speaker !== 'player') continue;
      if (turns[index].intent === 'npc_close') continue;
      if (turns[index].by === 'ai' && !live) continue;
      const key = turns[index - 1].text;
      const list = byLine.get(key) ?? [];
      list.push({ actorId: conversation.actorId, text: turns[index].text });
      byLine.set(key, list);
    }
  }
  const sims = [];
  for (const list of byLine.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].actorId !== list[j].actorId) sims.push(jaccard(list[i].text, list[j].text));
      }
    }
  }
  const meanSim = sims.length > 0 ? sims.reduce((sum, value) => sum + value, 0) / sims.length : 1;
  const lines = conversations.flatMap((conversation) => npcTurns(conversation).filter((turn) => turn.by === 'rule' || live));
  const traitShare = lines.filter((turn) => TRAIT_WORDS.test(turn.text)).length / Math.max(1, lines.length);
  // 同一段对话里，同一句（或同一个半句，去掉标点五个字以上）只说一次。
  const repeats = conversations.filter((conversation) => {
    const seen = new Set();
    for (const turn of npcTurns(conversation)) {
      if (turn.by === 'ai' && !live) continue;
      for (const clause of turn.text.match(/[^。！？]+[。！？]*/gu) ?? []) {
        const core = clause.replace(/[，。！？、；：…—\s]/gu, '');
        if (core.length < 5) continue;
        if (seen.has(core)) return true;
        seen.add(core);
      }
    }
    return false;
  }).length;
  // v1.1 收紧：同一个 NPC 对同一位玩家，三次见面里同一句话（去掉标点五个字以上）原样只说一次。
  const crossVisitRepeats = [];
  for (const actorId of new Set(conversations.map((conversation) => conversation.actorId))) {
    const firstVisit = new Map();
    for (const conversation of conversations.filter((entry) => entry.actorId === actorId)) {
      for (const turn of npcTurns(conversation)) {
        if (turn.by === 'ai' && !live) continue;
        const key = turn.text.replace(/[，。！？、；：…—\s]/gu, '');
        if (key.length < 5) continue;
        if (firstVisit.has(key) && firstVisit.get(key) !== conversation.visit) crossVisitRepeats.push({ npc: conversation.name, text: turn.text });
        else firstVisit.set(key, conversation.visit);
      }
    }
  }
  set('A4', (meanSim < 0.5 ? 5 : 0) + (traitShare <= 0.1 && repeats === 0 && crossVisitRepeats.length === 0 ? 5 : 0), {
    pairs: sims.length,
    meanSimilarity: meanSim,
    traitWordShare: traitShare,
    conversationsWithRepeats: repeats,
    crossVisitRepeats,
  });
}

// B1 开口有理由、看场合；孤僻、守规矩的人开口少。
{
  const opened = conversations.filter((conversation) => conversation.opening.open);
  const reasoned = opened.every((conversation) => ['news', 'known', 'newcomer'].includes(conversation.opening.reason));
  const wrongTime = conversations.filter((conversation) => conversation.opening.open && (conversation.asleep || (conversation.situation.dutyDay && conversation.situation.busy))).length;
  const reserved = conversations.filter((conversation) => ['curt', 'wary', 'formal'].includes(conversation.voice));
  const outgoing = conversations.filter((conversation) => ['warm', 'upright', 'gentle', 'shrewd'].includes(conversation.voice));
  const rate = (list) => (list.length > 0 ? list.filter((conversation) => conversation.opening.open).length / list.length : 0);
  set('B1', (reasoned && wrongTime === 0 ? 4 : 0) + (rate(reserved) < rate(outgoing) ? 4 : 0), {
    openings: opened.length,
    reasons: opened.map((conversation) => conversation.opening.reason),
    wrongTime,
    reservedOpenRate: rate(reserved),
    outgoingOpenRate: rate(outgoing),
  });
}

// B2 收尾像人：NPC 自己收尾时说了理由；忙的时候聊得短。
{
  const npcClosed = conversations.filter((conversation) => conversation.closedBy === 'npc_rule');
  const withReason = npcClosed.filter((conversation) => {
    const last = conversation.turns.at(-1);
    return last?.speaker === 'npc' && last.action?.type === 'end' && typeof last.action.reason === 'string' && last.action.reason.length > 0;
  });
  const replies = (conversation) => npcTurns(conversation).filter((turn) => turn.phrase !== 'open' && turn.intent !== 'npc_close').length;
  const mean = (list) => (list.length > 0 ? list.reduce((sum, conversation) => sum + replies(conversation), 0) / list.length : 0);
  const busy = conversations.filter((conversation) => conversation.budget.busyReason);
  const free = conversations.filter((conversation) => !conversation.budget.busyReason);
  set('B2', (withReason.length === npcClosed.length ? 4 : 0) + (free.length > 0 && busy.length > 0 && mean(busy) <= 0.7 * mean(free) ? 3 : 0), {
    npcClosed: npcClosed.length,
    withReason: withReason.length,
    reasons: npcClosed.map((conversation) => conversation.turns.at(-1)?.action?.reason),
    busyConversations: busy.length,
    meanRepliesBusy: mean(busy),
    freeConversations: free.length,
    meanRepliesFree: mean(free),
  });
}

// B3 话里有生活：回答里提到他自己生活中的真事（手上的活、明天的打算、听来的事、身边的人、和玩家的往来）。
{
  const answers = conversations.flatMap((conversation) =>
    npcTurns(conversation).filter((turn) => turn.intent !== 'npc_close' && (turn.by === 'rule' || live)).map((turn) => ({ conversation, turn })),
  );
  const lifeLike = answers.filter(({ conversation, turn }) => {
    if (turn.by === 'rule') return (turn.facts ?? []).length > 0;
    if (Object.values(NAMES).some((name) => turn.text.includes(name))) return true;
    if (/山门|药圃|坊市|歇脚亭|丹房/u.test(turn.text)) return true;
    return ACTIVITY_CLAIMS.some(([pattern]) => pattern.test(turn.text)) || conversation.situation.recentEvents.some((event) => turn.text.includes(event.slice(0, 4)));
  });
  const ratio = answers.length > 0 ? lifeLike.length / answers.length : 0;
  set('B3', ratio >= 0.5 ? 5 : ratio >= 0.3 ? 2 : 0, { answers: answers.length, lifeLike: lifeLike.length, ratio });
}

set('B4', null, '待真人盲评（0–15 分）');

// 参考（不计分）：AI 的话有多少是以反问道友收尾的（太多就成了口头禅）。
if (live) {
  const askBack = aiTurns.filter(({ turn }) => /[？?]$/u.test(turn.text.trim())).length;
  set('ref_askBack', null, { aiLines: aiTurns.length, endsWithQuestion: askBack, share: aiTurns.length > 0 ? askBack / aiTurns.length : 0 });
}

// C1–C4：token、规则包办、缓存、延迟。
{
  const tokensOf = (turn) =>
    live ? (turn.ai?.usage?.prompt_tokens ?? 0) + (turn.ai?.usage?.completion_tokens ?? 0) : (turn.ai?.estimate ?? 0) + 60;
  const perConversation = conversations.map((conversation) =>
    npcTurns(conversation).filter((turn) => turn.by === 'ai').reduce((sum, turn) => sum + tokensOf(turn), 0),
  );
  const meanTokens = perConversation.reduce((sum, value) => sum + value, 0) / Math.max(1, perConversation.length);
  // 参考：没命中缓存的输入加输出（真正按全价算的那部分）。
  const uncached = live
    ? conversations
        .map((conversation) =>
          npcTurns(conversation)
            .filter((turn) => turn.by === 'ai')
            .reduce(
              (sum, turn) =>
                sum + (turn.ai?.usage?.prompt_tokens ?? 0) - (turn.ai?.usage?.prompt_cache_hit_tokens ?? 0) + (turn.ai?.usage?.completion_tokens ?? 0),
              0,
            ),
        )
        .reduce((sum, value) => sum + value, 0) / Math.max(1, conversations.length)
    : null;
  // 参考：缓存全热时的全价（标准 F2 用的是上面那个；这个只为不同轮次能对着比）。全价跟着缓存命中起伏很大，
  // 这里把每个 NPC 这一轮命中最多的那次当作他固定部分的长度，每次只算剩下的输入加输出。
  // （v1.8：重说一次是两次调用，usage 是两次加起来的；这里按每次调用算，calls 里是各次的 usage。）
  const callsOf = (turn) => turn.ai?.calls ?? [turn.ai?.usage ?? {}];
  const fixedPart = {};
  for (const conversation of conversations) {
    for (const turn of npcTurns(conversation).filter((entry) => entry.by === 'ai')) {
      for (const call of callsOf(turn)) fixedPart[conversation.actorId] = Math.max(fixedPart[conversation.actorId] ?? 0, call.prompt_cache_hit_tokens ?? 0);
    }
  }
  const warmUncached = live
    ? conversations
        .map((conversation) =>
          npcTurns(conversation)
            .filter((turn) => turn.by === 'ai')
            .reduce(
              (sum, turn) =>
                sum +
                callsOf(turn).reduce(
                  (callSum, call) => callSum + (call.prompt_tokens ?? 0) - fixedPart[conversation.actorId] + (call.completion_tokens ?? 0),
                  0,
                ),
              0,
            ),
        )
        .reduce((sum, value) => sum + value, 0) / Math.max(1, conversations.length)
    : null;
  set('C1', meanTokens <= 1500 ? 10 : meanTokens <= 3000 ? 5 : 0, {
    live,
    meanTokensPerConversation: meanTokens,
    maxTokensPerConversation: Math.max(...perConversation),
    meanUncachedTokensPerConversation: uncached,
    warmUncachedTokensPerConversation: warmUncached,
  });
  const all = conversations.flatMap(npcTurns);
  const ruleShare = all.filter((turn) => turn.by === 'rule').length / Math.max(1, all.length);
  set('C2', ruleShare >= 0.7 ? 8 : ruleShare >= 0.5 ? 4 : 0, { npcLines: all.length, ruleLines: all.filter((turn) => turn.by === 'rule').length, ruleShare });
  if (live) {
    const prompt = aiTurns.reduce((sum, { turn }) => sum + (turn.ai?.usage?.prompt_tokens ?? 0), 0);
    const hit = aiTurns.reduce((sum, { turn }) => sum + (turn.ai?.usage?.prompt_cache_hit_tokens ?? 0), 0);
    const share = prompt > 0 ? hit / prompt : 0;
    set('C3', share >= 0.5 ? 4 : share >= 0.25 ? 2 : 0, { promptTokens: prompt, cacheHitTokens: hit, hitShare: share });
    const times = aiTurns.map(({ turn }) => turn.ai?.ms ?? 0).sort((left, right) => left - right);
    const p50 = times.length > 0 ? times[Math.floor((times.length - 1) / 2)] : 0;
    set('C4', p50 <= 2500 ? 3 : 0, { calls: times.length, p50Ms: p50, maxMs: times.at(-1) ?? 0 });
  } else {
    set('C3', null, '试跑没有调用 AI');
    set('C4', null, '试跑没有调用 AI');
  }
}

const auto = Object.values(score).reduce((sum, entry) => sum + (typeof entry.points === 'number' ? entry.points : 0), 0);
const outPath = RUN.replace(/\.json$/u, '-score.json');
writeFileSync(outPath, `${JSON.stringify({ run: RUN, live, score, auto, pendingBlind: 15 }, null, 2)}\n`);
for (const [item, entry] of Object.entries(score)) {
  process.stdout.write(`${item} ${entry.points === null ? '—' : entry.points}  ${typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}\n`);
}
process.stdout.write(`自动部分合计 ${auto}（另有 B4 盲评最多 15 分）${live ? '' : '；试跑：AI 那几句只算了估计的 token'}\n${outPath}\n`);

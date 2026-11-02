#!/usr/bin/env node

// 玩家对话 · 真人试玩窗口：本机小服务（只听 127.0.0.1）加一个网页。随便打字找 NPC 聊，
// 用的是和试验台同一套规则、模板和提示词（player_dialogue_engine.mjs）。每句记下是规则还是 AI 说的、
// token、缓存命中、用时、好感度怎么变、自动检查的结果，以及试玩的人标的"不像"。
// 好感度（v1.3）：骂了人会传成流言（player_dialogue_society.mjs），听说的人对道友冷淡；时间只能往后走。
//   node --experimental-specifier-resolution=node --loader ts-node/esm \
//     godot-taixu-client/tools/player_dialogue_chat.mjs [--port 8766] [--dry] [--log <soak.jsonl>]
// 有环境变量 XIANXIA_PI_NPC_DEEPSEEK_API_KEY 就真调 DeepSeek；没有（或加 --dry）就只记提示词、AI 的话占位。
// 只读世界日志，不改世界；记录写到 .logs/player-dialogue/chat/session-<开始时间>.json。

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { attitudeOf } from '../../convex/xianxia/playerAffinityLogic.ts';
import { PLAYER_DIALOGUE_VERSION } from '../../convex/xianxia/playerDialogueLogic.ts';
import { DIALOGUE_PERSONAS } from '../../convex/xianxia/playerDialoguePersonas.ts';
import { CHAT_PAGE } from './player_dialogue_chat_page.mjs';
import { MODERN, checkAiLine } from './player_dialogue_checks.mjs';
import { DIALOGUE_MODEL, callDeepSeek, closeConversation, newPlayerRecord, openConversation, playerSays } from './player_dialogue_engine.mjs';
import { createPlayerSociety } from './player_dialogue_society.mjs';
import { DEFAULT_SOAK_SEED, HOURS_PER_TICK, clock, isAsleepAt, latestSoakLog, loadDialogueWorld, tickAt, traitsOf } from './player_dialogue_world.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const PORT = Number(option('port') ?? 8766);
const LIVE = !args.includes('--dry') && Boolean(process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY);
const SEED = option('seed') ?? DEFAULT_SOAK_SEED;
const ROOT = resolve(import.meta.dirname, '../..');
const LOG = option('log') ?? latestSoakLog(ROOT);
const SESSION_DIR = resolve(ROOT, '.logs/player-dialogue/chat');
const STARTED_AT = new Date();
const SESSION_FILE = resolve(SESSION_DIR, `session-${STARTED_AT.toISOString().replace(/[:.]/gu, '-')}${LIVE ? '-live' : '-dry'}.json`);
const MAX_LINE = 120;
const MAX_BODY = 4096;
// 真人在等：AI 最多等 8 秒、不重试；等不到就由规则随口接一句（引擎里的 deflect）。
const CHAT_AI_TIMEOUT_MS = 8_000;
const chatDeepSeek = (messages) => callDeepSeek(messages, undefined, { timeoutMs: CHAT_AI_TIMEOUT_MS, delays: [0] });
const TICKS_PER_HOUR = 1 / HOURS_PER_TICK;

const world = loadDialogueWorld(LOG, { seed: SEED });
const society = createPlayerSociety(world, { seed: SEED });
const lastDay = clock(world.lastTick).day;

// 试玩的状态：游戏里的时刻、每个 NPC 和这位玩家的往来、他说过的说法、谁刚走开、这次试玩的所有对话。
const state = {
  tick: tickAt(10, 10),
  players: {},
  used: {},
  awayUntil: {},
  conversations: [],
  current: undefined,
};

function playerOf(actorId) {
  state.players[actorId] ??= newPlayerRecord();
  return state.players[actorId];
}

function usedOf(actorId) {
  state.used[actorId] ??= new Set();
  return state.used[actorId];
}

// —— 统计 ——

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function computeStats() {
  const records = state.conversations;
  const all = records.flatMap((record) => record.conversation.turns.map((turn, index) => ({ record, turn, index })));
  const playerLines = all.filter(({ turn }) => turn.speaker === 'player');
  const npcLines = all.filter(({ turn }) => turn.speaker === 'npc');
  const aiLines = npcLines.filter(({ turn }) => turn.by === 'ai');
  const liveAi = aiLines.filter(({ turn }) => !turn.ai?.dry);
  const aiIntents = {};
  for (const { turn } of aiLines) aiIntents[turn.intent ?? 'free'] = (aiIntents[turn.intent ?? 'free'] ?? 0) + 1;
  const usage = (turn) => turn.ai?.usage ?? {};
  const promptTokens = sum(liveAi.map(({ turn }) => usage(turn).prompt_tokens ?? 0));
  const hitTokens = sum(liveAi.map(({ turn }) => usage(turn).prompt_cache_hit_tokens ?? 0));
  const talked = records.filter((record) => record.conversation.turns.some((turn) => turn.speaker === 'player'));
  const perConversation = (fn) =>
    talked.map((record) => sum(record.conversation.turns.filter((turn) => turn.by === 'ai' && !turn.ai?.dry).map(fn)));
  const tokens = perConversation((turn) => (usage(turn).prompt_tokens ?? 0) + (usage(turn).completion_tokens ?? 0));
  const uncached = perConversation(
    (turn) => (usage(turn).prompt_tokens ?? 0) - (usage(turn).prompt_cache_hit_tokens ?? 0) + (usage(turn).completion_tokens ?? 0),
  );
  const times = liveAi.map(({ turn }) => turn.ai?.ms ?? 0).filter((ms) => ms > 0).sort((left, right) => left - right);
  const flagged = npcLines.filter(({ record, index }) => record.flags[index]);
  const checkIssues = [];
  for (const { record, turn } of liveAi) {
    if (!turn.ai?.parsed) continue;
    // 按这段话开始时的往来核对（"上回你……"得有更早的来往）。
    const result = checkAiLine(turn.text, { ...record.conversation.situation, player: record.conversation.playerAtStart }, record.actorId);
    for (const mention of result.unsupported) checkIssues.push({ npc: record.name, text: turn.text, mention });
    if (result.identityErrors > 0) checkIssues.push({ npc: record.name, text: turn.text, mention: 'identity' });
  }
  // 出戏的现代词（试跑时"这句交给 AI"的占位不算）。
  const leaks = npcLines
    .filter(({ turn }) => !turn.ai?.dry && MODERN.test(turn.text))
    .map(({ record, turn }) => ({ npc: record.name, text: turn.text }));
  const live = LIVE && liveAi.length > 0;
  return {
    conversations: talked.length,
    playerLines: playerLines.length,
    npcLines: npcLines.length,
    ruleLines: npcLines.length - aiLines.length,
    aiLines: aiLines.length,
    aiShare: npcLines.length > 0 ? aiLines.length / npcLines.length : null,
    aiIntents,
    meanTokens: live && talked.length > 0 ? sum(tokens) / talked.length : null,
    meanUncached: live && talked.length > 0 ? sum(uncached) / talked.length : null,
    cacheHitShare: live && promptTokens > 0 ? hitTokens / promptTokens : null,
    p50Ms: times.length > 0 ? times[Math.floor((times.length - 1) / 2)] : null,
    maxMs: times.length > 0 ? times.at(-1) : null,
    flags: flagged.length,
    flagsRule: flagged.filter(({ turn }) => turn.by === 'rule').length,
    flagsAi: flagged.filter(({ turn }) => turn.by === 'ai').length,
    checkIssues: checkIssues.length + leaks.length,
    checkDetails: [...checkIssues, ...leaks.map((leak) => ({ ...leak, mention: 'modern_word' }))],
    fallbacks: aiLines.filter(({ turn }) => turn.ai?.rejected || turn.ai?.error).length,
    // 好感度：骂人几回、他翻脸走了几回、不理你几回、听说你骂过人的有几个。
    offenses: sum(records.map((record) => record.conversation.offenses.length)),
    stormOffs: records.filter((record) => record.conversation.closedBy === 'npc_angry').length,
    refusals: records.filter((record) => record.conversation.closedBy === 'npc_refused').length,
    rumorHeardBy: society.heardBy(state.tick),
  };
}

// —— 给页面看的样子（不带提示词） ——

function publicTurn(record, turn, index, turns) {
  const usage = turn.ai?.usage ?? {};
  // 玩家这句让好感度变了多少（记在紧跟着的 NPC 回话上）。
  const affinity = turn.speaker === 'player' ? turns[index + 1]?.affinity : undefined;
  return {
    speaker: turn.speaker,
    text: turn.text,
    flagged: Boolean(record.flags[index]),
    note: record.flags[index]?.note,
    affinity: affinity ? { tone: affinity.tone, delta: affinity.affinityDelta, after: Math.round(affinity.relationship) } : undefined,
    source:
      turn.speaker !== 'npc'
        ? undefined
        : turn.by === 'rule'
          ? { kind: 'rule', phrase: turn.phrase, intent: turn.intent, openReason: turn.openReason }
          : {
              kind: 'ai',
              dry: Boolean(turn.ai?.dry),
              tokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) || undefined,
              hit: usage.prompt_cache_hit_tokens,
              ms: turn.ai?.ms,
              fallback: Boolean(turn.ai?.rejected || turn.ai?.error),
              deduped: Boolean(turn.ai?.deduped),
              tone: turn.ai?.tone,
            },
  };
}

function viewState() {
  const at = clock(state.tick);
  const current = state.current;
  return {
    live: LIVE,
    model: LIVE ? DIALOGUE_MODEL : null,
    version: PLAYER_DIALOGUE_VERSION,
    time: { tick: state.tick, day: at.day, clock: at.text, hour: at.hour, lastDay },
    // 没见过面、但听说了道友骂人的，也已经冷着了（只看不改）。
    people: world.whereabouts(state.tick).map((person) => {
      const record = state.players[person.actorId];
      const view = society.preview(person.actorId, state.tick, record ?? newPlayerRecord());
      return { ...person, away: (state.awayUntil[person.actorId] ?? -1) > state.tick, met: Boolean(record?.met), ...view };
    }),
    current: current
      ? {
          index: current.index,
          actorId: current.actorId,
          name: current.name,
          role: current.role,
          placeName: current.placeName,
          activity: current.activity,
          day: current.day,
          clock: current.clock,
          // 眼下的态度（聊着聊着会变，比如刚被骂）。
          attitude: attitudeOf(current.conversation.player, state.tick, traitsOf(current.actorId)),
          relationship: Math.round(current.conversation.player.relationship),
          closedBy: current.conversation.closedBy,
          turns: current.conversation.turns.map((turn, index, turns) => publicTurn(current, turn, index, turns)),
        }
      : null,
    stats: computeStats(),
    sessionFile: relative(ROOT, SESSION_FILE),
  };
}

// —— 记录 ——

function saveSession() {
  mkdirSync(SESSION_DIR, { recursive: true });
  const conversations = state.conversations.map((record) => ({
    index: record.index,
    actorId: record.actorId,
    name: record.name,
    voice: record.voice,
    day: record.day,
    tick: record.tick,
    clock: record.clock,
    placeName: record.placeName,
    activity: record.activity,
    startedAt: record.startedAt,
    situation: { ...record.conversation.situation, player: record.conversation.playerAtStart },
    asleep: record.conversation.asleep,
    opening: { open: record.conversation.opening.open, reason: record.conversation.opening.reason },
    budget: record.conversation.budget,
    closedBy: record.conversation.closedBy ?? null,
    offenses: record.conversation.offenses,
    visitBonus: record.conversation.visitBonus ?? null,
    turns: record.conversation.turns,
    flags: record.flags,
  }));
  writeFileSync(
    SESSION_FILE,
    `${JSON.stringify(
      {
        kind: 'player-dialogue-chat-session',
        version: PLAYER_DIALOGUE_VERSION,
        live: LIVE,
        model: LIVE ? DIALOGUE_MODEL : null,
        log: LOG,
        seed: SEED,
        startedAt: STARTED_AT.toISOString(),
        updatedAt: new Date().toISOString(),
        stats: computeStats(),
        // 每个 NPC 和道友的往来（好感度、骂过几回、听过哪些流言），以及流言传到了谁那里。
        players: state.players,
        rumors: society.rumors.map((rumor) => ({ ...rumor, knowersNow: society.knowersAt(rumor, state.tick) })),
        conversations,
      },
      null,
      2,
    )}\n`,
  );
}

// —— 动作 ——

// 他收尾走了：一小时内别再找他；翻脸走的，今天别再找他。
function markAway(current) {
  const closedBy = current.conversation.closedBy;
  if (closedBy === 'npc_angry') state.awayUntil[current.actorId] = tickAt(current.day + 1, 6);
  else if (closedBy === 'npc_rule' || closedBy === 'npc_model' || closedBy === 'npc_refused') state.awayUntil[current.actorId] = state.tick + TICKS_PER_HOUR;
}

// 结束眼下这段话（他收尾、玩家告辞、或玩家走开）。
function finishCurrent(closedBy = 'player_walked_off') {
  const current = state.current;
  if (!current) return;
  if (!current.finished) {
    closeConversation(current.conversation, { day: current.day, closedBy });
    current.finished = true;
    markAway(current);
  }
  state.current = undefined;
}

function approach(actorId) {
  const persona = DIALOGUE_PERSONAS[actorId];
  if (!persona) return { ok: false, message: '没有这个人。' };
  finishCurrent();
  const person = world.whereabouts(state.tick).find((entry) => entry.actorId === actorId);
  if (person?.asleep || isAsleepAt(actorId, state.tick)) return { ok: false, message: `${persona.name}睡着了。` };
  if (person?.travelling) return { ok: false, message: `${persona.name}正在去${person.heading ?? '别处'}的路上，追不上。` };
  if ((state.awayUntil[actorId] ?? -1) > state.tick) return { ok: false, message: `${persona.name}刚走开，过一会儿再来。` };
  const player = playerOf(actorId);
  const situation = world.situationAt(actorId, state.tick, player);
  // 记的仇淡一点、听来的"道友骂了谁"算进好感度，再定他眼下的态度。
  society.prepare(actorId, state.tick, player, situation);
  const conversation = openConversation({
    persona,
    situation,
    player,
    used: usedOf(actorId),
    seedKey: `${SEED}:chat:${actorId}:${state.tick}:${player.visits}`,
    tick: state.tick,
    asleep: false,
  });
  const record = {
    index: state.conversations.length,
    actorId,
    name: persona.name,
    role: persona.role,
    voice: persona.voice,
    day: situation.day,
    tick: state.tick,
    clock: situation.clock,
    placeName: situation.placeName,
    activity: situation.activity,
    startedAt: new Date().toISOString(),
    conversation,
    flags: {},
    finished: false,
  };
  state.conversations.push(record);
  state.current = record;
  // 一见面就不理你：这段话已经完了。
  if (conversation.closedBy) {
    closeConversation(conversation, { day: record.day });
    record.finished = true;
    markAway(record);
  }
  return { ok: true };
}

async function say(text) {
  const current = state.current;
  if (!current || current.conversation.closedBy) return { ok: false, message: '先在左边挑一个人去找他。' };
  const line = String(text ?? '').trim();
  if (!line) return { ok: false, message: '没听见你说什么。' };
  if (line.length > MAX_LINE) return { ok: false, message: `说短一点（${MAX_LINE} 字以内）。` };
  const offensesBefore = current.conversation.offenses.length;
  await playerSays(current.conversation, line, { live: LIVE, deepseek: chatDeepSeek });
  // 骂了人：被骂的人和在场的人知道了，之后会传开。
  if (offensesBefore === 0 && current.conversation.offenses.length > 0) {
    society.recordOffense({ victimId: current.actorId, tick: current.tick, tone: current.conversation.offenses[0].tone, placeName: current.placeName });
  }
  if (current.conversation.closedBy) {
    closeConversation(current.conversation, { day: current.day });
    current.finished = true;
    markAway(current);
  }
  return { ok: true };
}

function setTime(body) {
  let next = state.tick;
  if (body.action === 'hour') next = state.tick + TICKS_PER_HOUR;
  else if (body.action === 'next_morning') next = tickAt(clock(state.tick).day + 1, 9);
  else if (body.action === 'set') {
    const day = Number(body.day);
    const hour = Number(body.hour);
    if (!Number.isFinite(day) || !Number.isFinite(hour) || day < 1 || hour < 0 || hour > 23) return { ok: false, message: '时间不对。' };
    next = tickAt(Math.floor(day), Math.floor(hour));
  } else return { ok: false, message: '时间不对。' };
  if (next > world.lastTick) return { ok: false, message: `世界只记到第 ${lastDay} 天。` };
  // 时间只能往后走（他们记得的事、听来的流言，都是按时间先后来的）。
  if (next < state.tick) return { ok: false, message: '时间只能往后走。' };
  const talking = state.current && !state.current.conversation.closedBy;
  finishCurrent();
  state.tick = next;
  return { ok: true, message: talking ? '（时候不早，你先走开了。）' : '' };
}

function setFlag(body) {
  const record = state.conversations[Number(body.index)];
  const turnIndex = Number(body.turn);
  const turn = record?.conversation.turns[turnIndex];
  if (!record || !turn || turn.speaker !== 'npc') return { ok: false, message: '找不到那句话。' };
  if (body.flag) {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_LINE) : record.flags[turnIndex]?.note;
    record.flags[turnIndex] = note ? { note } : {};
  } else {
    delete record.flags[turnIndex];
  }
  return { ok: true };
}

// —— 本机服务 ——

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(request) {
  return new Promise((done, fail) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        done(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new Error('body_not_json'));
      }
    });
    request.on('error', fail);
  });
}

// 一次只处理一个改状态的请求（AI 回话要一两秒，免得两句话搅在一起）。
let queue = Promise.resolve();
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const ACTIONS = {
  '/api/approach': (body) => approach(String(body.actorId ?? '')),
  '/api/say': (body) => say(body.text),
  '/api/leave': () => {
    finishCurrent();
    return { ok: true };
  },
  '/api/time': (body) => setTime(body),
  '/api/flag': (body) => setFlag(body),
};

const server = createServer(async (request, response) => {
  // 只认本机地址来的请求（防 DNS rebinding 和别的网页偷偷调用）。
  if (!ALLOWED_HOSTS.has(request.headers.host ?? '')) return send(response, 403, { ok: false, message: 'forbidden_host' });
  if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) return send(response, 403, { ok: false, message: 'forbidden_origin' });
  const path = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`).pathname;
  try {
    if (request.method === 'GET' && path === '/') return send(response, 200, CHAT_PAGE, 'text/html; charset=utf-8');
    if (request.method === 'GET' && path === '/api/state') return send(response, 200, { ok: true, state: viewState() });
    const action = ACTIONS[path];
    if (request.method !== 'POST' || !action) return send(response, 404, { ok: false, message: 'not_found' });
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(response, 415, { ok: false, message: 'json_only' });
    }
    const body = await readBody(request);
    const result = await serialized(async () => {
      const outcome = await action(body);
      saveSession();
      return outcome;
    });
    return send(response, 200, { ...result, state: viewState() });
  } catch (error) {
    process.stderr.write(`player_dialogue_chat_error ${String(error?.message ?? error)}\n`);
    return send(response, 500, { ok: false, message: '出错了，再试一次。', state: viewState() });
  }
});

function shutdown() {
  try {
    finishCurrent();
    saveSession();
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  }
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

server.listen(PORT, '127.0.0.1', () => {
  saveSession();
  process.stdout.write(
    `player dialogue chat ready: http://127.0.0.1:${PORT} (${LIVE ? `live ${DIALOGUE_MODEL}` : 'dry'}, ${PLAYER_DIALOGUE_VERSION})\nsession: ${relative(ROOT, SESSION_FILE)}\n`,
  );
});

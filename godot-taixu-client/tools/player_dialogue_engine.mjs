// 玩家对话 · 一来一回：规则先接，接不住的交给 DeepSeek（试跑时只记下提示词）；到了能聊的句数，规则收尾。
// 好感度（v1.3）：每句话先由规则判口气，按上限加减好感度、攒火气；骂到他忍不住就翻脸走开；
// 敷衍多了他提前收尾。AI 只说一句话、最多附一个口气标签；送东西、讲哪件事、记住玩家、好感度，都由规则做。
// 试验台 player_dialogue_probe.mjs 和真人试玩窗口 player_dialogue_chat.mjs 共用，两边说话的逻辑一样。需要 ts-node 加载器。

import {
  buildDialoguePrompt,
  chatBudget,
  classifyPlayerLine,
  clipQuote,
  keepsQuote,
  closingLine,
  decideOpening,
  dropRepeatedClauses,
  memoriesFromLine,
  memoriesMentionedIn,
  memoriesSettledByVisit,
  newsMentionedIn,
  noteMemory,
  parseDialogueReply,
  pickPhrase,
  ruleReply,
  toneOfLine,
} from '../../convex/xianxia/playerDialogueLogic.ts';
import { applyApology, applyPlayerTone, visitBonus } from '../../convex/xianxia/playerAffinityLogic.ts';
import { estimateSocialPromptTokens } from '../../convex/xianxia/socialModelPolicy.ts';
import { PEOPLE } from './player_dialogue_world.mjs';

export const DIALOGUE_MODEL = 'deepseek-v4-flash';

// 他和这位玩家之间的往来（规则层记着）：好感度、见过几回、聊过什么、跟他讲过哪些事、问过对谁的看法、
// 送过几株灵草、骂过他几回、得罪他还没赔过不是的有多少；记得的往事各是哪天说的、说了几回，见面时提过哪些。
export function newPlayerRecord() {
  return { relationship: 0, met: false, memory: [], memoryLog: {}, recalled: [], toldNewsIds: [], visits: 0, askedAbout: {}, insults: 0, apologyOwed: 0 };
}

// 记下一件往事（规则从玩家原话里认出的，或规则回话时记的）：头一回说的记进 memory，每说一回记下时刻和次数；
// 说要请吃送礼这类，连玩家的原话一起记（quote）。
function remember(player, text, tick, day, quote) {
  if (!player.memory.includes(text)) player.memory.push(text);
  player.memoryLog ??= {};
  player.memoryLog[text] = noteMemory(player.memoryLog, text, tick, day, quote);
}

// timeoutMs：每次最多等多久；delays：失败后隔多久再试（试验台默认会重试；真人试玩只等一次，等不到就由规则接话）。
export async function callDeepSeek(
  messages,
  apiKey = process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY,
  { timeoutMs = 20_000, delays = [0, 3_000, 8_000] } = {},
) {
  if (!apiKey) throw new Error('deepseek_key_missing');
  let lastError;
  for (const delay of delays) {
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // 不开思考（与正式 NPC 一致）；说话留一点温度。
        body: JSON.stringify({ model: DIALOGUE_MODEL, messages, thinking: { type: 'disabled' }, stream: false, temperature: 0.7, max_tokens: 160 }),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
      const body = await response.json();
      return { text: body.choices?.[0]?.message?.content ?? '', usage: body.usage ?? {}, ms: Date.now() - started };
    } catch (error) {
      lastError = abort.signal.aborted ? new Error(`deepseek_timeout_${timeoutMs}ms`) : error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// 走到他身边：规则定开不开口、能聊几句。恨你的人（好感度 ≤ −20）不理你，只听你说一句（是赔不是就记下）。
export function openConversation({ persona, situation, player, used, seedKey, tick, asleep }) {
  // 这一回开始时他知道的往来（聊的过程中会改动的数组和表都拷一份，供记录和核对）。
  const playerAtStart = {
    ...player,
    memory: [...player.memory],
    memoryLog: { ...(player.memoryLog ?? {}) },
    recalled: [...(player.recalled ?? [])],
    toldNewsIds: [...player.toldNewsIds],
    askedAbout: { ...player.askedAbout },
  };
  const budget = chatBudget(persona, situation);
  const opening = decideOpening({ persona, situation, asleep, seedKey, used, nowTick: tick });
  const turns = [];
  let lastChance = false;
  if (opening.open) {
    turns.push({ speaker: 'npc', text: opening.text, by: 'rule', phrase: 'open', openReason: opening.reason, facts: opening.newsId ? [opening.newsId] : [] });
    if (opening.newsId) player.toldNewsIds.push(opening.newsId);
    // 见面先提的往事：以后不再提这件。
    if (opening.recalled) player.recalled = [...(player.recalled ?? []), opening.recalled];
  } else if (opening.reason === 'hostile') {
    const text = pickPhrase(persona.voice, 'refuseTalk', `${seedKey}:refuseTalk`, used) ?? '……';
    turns.push({ speaker: 'npc', text, by: 'rule', phrase: 'refuseTalk', facts: [], intent: 'npc_refuse' });
    lastChance = true;
  }
  // 说过还会再来的，人来了：这事了结，以后不再说"还真来了"（这回提没提都一样）。
  for (const text of memoriesSettledByVisit(situation, tick)) {
    if (!(player.recalled ?? []).includes(text)) player.recalled = [...(player.recalled ?? []), text];
  }
  return {
    persona,
    situation,
    player,
    playerAtStart,
    used,
    seedKey,
    tick,
    asleep,
    budget,
    opening,
    turns,
    npcReplies: 0,
    lineIndex: 0,
    closedBy: undefined,
    // 不理你的人：只听这一句。
    lastChance,
    // 好感度：这段话里攒的火气、说好话已加的好感、敷衍了几句、提前收尾扣掉的句数、骂人的事。
    temper: 0,
    kindThisConversation: 0,
    backchannels: 0,
    budgetPenalty: 0,
    offended: false,
    offenses: [],
  };
}

// 按口气改好感度和火气（规则算，有上限）。返回这一句的改动，记进对话里供核对。
function applyTone(conversation, tone, text) {
  const { persona, situation, player, tick } = conversation;
  const effect = applyPlayerTone({
    record: player,
    tone,
    voice: persona.voice,
    temper: conversation.temper,
    kindThisConversation: conversation.kindThisConversation,
    day: situation.day,
  });
  player.relationship += effect.affinityDelta;
  player.apologyOwed = effect.apologyOwed;
  if (effect.affinityDelta > 0) {
    player.kindDay = situation.day;
    player.kindToday = effect.kindToday;
  }
  conversation.temper = effect.temper;
  conversation.kindThisConversation = effect.kindThisConversation;
  if (effect.offended) {
    player.insults = (player.insults ?? 0) + 1;
    player.lastInsultTick = tick;
    conversation.offended = true;
    conversation.offenses.push({ tone, tick, text });
  }
  return { tone, affinityDelta: effect.affinityDelta, relationship: player.relationship, temper: effect.temper, stormOff: effect.stormOff };
}

// 玩家说一句。返回这一句之后新加的话（玩家这句、NPC 的回话，以及到了句数时的收尾）。
// suppressClose：到了句数也先不收尾（试验台剧本的最后一句用）。
export async function playerSays(conversation, text, { live = false, deepseek = callDeepSeek, paceMs = 0, suppressClose = false } = {}) {
  if (conversation.closedBy) throw new Error('dialogue_conversation_closed');
  const { persona, situation, player, used, seedKey, tick } = conversation;
  const lineIndex = conversation.lineIndex;
  conversation.lineIndex += 1;
  const before = conversation.turns.length;
  const lastNpc = conversation.turns.filter((turn) => turn.speaker === 'npc').at(-1);
  conversation.turns.push({ speaker: 'player', text });
  const classified = classifyPlayerLine(text, PEOPLE, persona.actorId, { npcAsked: /[？?]\s*$/u.test(lastNpc?.text ?? '') });
  const tone = toneOfLine(classified, text);
  const affinity = applyTone(conversation, tone, text);
  if (classified.intent === 'backchannel') {
    // 只会"哦""行"：第二句起，他能聊的句数少一句。
    conversation.backchannels += 1;
    if (conversation.backchannels > 1) conversation.budgetPenalty += 1;
  }
  let reply = ruleReply({
    persona,
    situation,
    line: classified,
    seedKey: `${seedKey}:${lineIndex}`,
    used,
    nowTick: tick,
    opened: conversation.opening.open,
    stormOff: affinity.stormOff,
  });
  // 不理你的人只听这一句：不是赔不是，他照样不理你（不交给 AI）。
  if (conversation.lastChance && classified.intent !== 'apology') {
    reply = { text: pickPhrase(persona.voice, 'refuseTalk', `${seedKey}:${lineIndex}:refuse`, used) ?? '……', by: 'rule', phrase: 'refuseTalk', facts: [] };
  }
  let aiAffinity;
  if (!reply) {
    const history = conversation.turns.slice(0, -1).map((turn) => ({ speaker: turn.speaker, text: turn.text }));
    // 这段话里他更早说过的一两句（"刚才"只带最近两句），免得前后说重。
    const saidBefore = history.slice(0, -2).filter((turn) => turn.speaker === 'npc').slice(-2).map((turn) => turn.text);
    const prompt = buildDialoguePrompt({ persona, situation, history, saidBefore, playerLine: text, intent: classified.intent, nowTick: tick });
    const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const estimate = estimateSocialPromptTokens(messages);
    if (live) {
      if (paceMs > 0) await new Promise((done) => setTimeout(done, paceMs));
      let response;
      let error;
      const askedAt = Date.now();
      try {
        response = await deepseek(messages);
      } catch (caught) {
        error = String(caught?.message ?? caught);
        response = { text: '', usage: {}, ms: Date.now() - askedAt };
      }
      const parsed = parseDialogueReply(response.text);
      // 回不出（超时、出错、读不懂）、回得出戏：换成规则的话（出戏的换成"听不懂"，其余随口接一句）。
      const fallback = parsed.ok
        ? undefined
        : pickPhrase(persona.voice, parsed.reasonCode === 'dialogue_reply_out_of_world' ? 'outOfWorld' : 'deflect', `${seedKey}:${lineIndex}:fallback`, used);
      // 和这段话里他前面说过的重了的半句，去掉。
      const deduped = parsed.ok
        ? dropRepeatedClauses(parsed.text, conversation.turns.filter((turn) => turn.speaker === 'npc').map((turn) => turn.text))
        : { text: fallback ?? '……', dropped: false };
      reply = {
        text: deduped.text,
        by: 'ai',
        facts: [],
        ai: {
          raw: response.text,
          parsed: parsed.ok,
          rejected: parsed.ok ? undefined : parsed.reasonCode,
          error,
          trimmed: parsed.ok ? parsed.trimmed : false,
          deduped: deduped.dropped,
          wantsEnd: parsed.ok ? parsed.end : false,
          tone: parsed.ok ? parsed.tone : undefined,
          usage: response.usage,
          ms: response.ms,
          estimate,
          prompt,
        },
      };
      if (parsed.ok && parsed.end) reply.action = { type: 'end', reason: 'model_end' };
      // AI 判的口气：只在规则没判出口气时才用，加减多少还是规则定。
      if (parsed.ok && tone === 'neutral' && parsed.tone !== 'neutral') {
        aiAffinity = applyTone(conversation, parsed.tone === 'rude' ? 'ai_rude' : 'ai_friendly', text);
      }
    } else {
      reply = { text: '【这句交给 AI】', by: 'ai', facts: [], ai: { dry: true, estimate, prompt } };
    }
  }
  // 道歉：得罪过他、还没赔过的，每天一次——好感最多 +3（不超过得罪时降掉的）、这一回骂人的冷淡期减半、
  // 火气消一些；他记得的不消失。没得罪过他的人听你道歉，只算句客气话。
  let apologyAffinity;
  if (reply.action?.type === 'apology') {
    const apology = applyApology(player, situation.day);
    if (apology.accepted) {
      player.relationship += apology.affinityDelta;
      player.lastApologyDay = apology.lastApologyDay;
      player.apologyForInsultTick = apology.apologyForInsultTick;
      player.apologyOwed = apology.apologyOwed;
      conversation.temper = Math.max(0, conversation.temper - 2);
      apologyAffinity = { tone: 'apology', affinityDelta: apology.affinityDelta, relationship: player.relationship, temper: conversation.temper, stormOff: false };
    }
  } else if (classified.intent === 'apology' && ['apologyElsewhere', 'apologyNone'].includes(reply.phrase)) {
    apologyAffinity = applyTone(conversation, 'kind', text);
  }
  // 规则的话这段里一字不差说过了（例如连问两遍"还记得我吗"）：换成"刚说过了"。短的应答、带着动作的不换。
  const saidEarlier = conversation.turns.some((turn) => turn.speaker === 'npc' && turn.text === reply.text);
  if (reply.by === 'rule' && !reply.action && reply.text.length > 6 && saidEarlier) {
    const again = pickPhrase(persona.voice, 'saidAlready', `${seedKey}:${lineIndex}:again`, used);
    if (again) reply = { ...reply, text: again, phrase: 'saidAlready', recalled: undefined };
  }
  conversation.turns.push({ speaker: 'npc', ...reply, intent: classified.intent, affinity: apologyAffinity ?? aiAffinity ?? affinity });
  // 记下这句里的往事：规则回话时记的，加上从玩家原话里认出的（表白、自称身份、说要请吃送礼……）；
  // AI 判了无礼的话，记成"对我说过难听的话"。记在回话之后，免得这句的提示词里重复一遍玩家刚说的话。
  const memories = [...(reply.memory ? [reply.memory] : []), ...memoriesFromLine(text, classified)];
  if (aiAffinity?.tone === 'ai_rude') memories.push('对我说过难听的话');
  for (const memory of memories) remember(player, memory, tick, situation.day, keepsQuote(memory) ? clipQuote(text) : undefined);
  // 这句话里已经提到的往事（规则答"还记得我吗"时说的、AI 自己说起的）：以后见面不再先提。
  const mentioned = [...(reply.recalled ? [reply.recalled] : []), ...(reply.by === 'ai' ? memoriesMentionedIn(reply.text, player.memory) : [])];
  for (const memory of mentioned) {
    if (!(player.recalled ?? []).includes(memory)) player.recalled = [...(player.recalled ?? []), memory];
  }
  if (classified.intent === 'introduce' && classified.playerName) player.name = classified.playerName;
  if (reply.action?.type === 'tell_news') player.toldNewsIds.push(reply.action.newsId);
  // AI 自己提到的事，也算跟玩家讲过了。
  if (reply.by === 'ai') {
    for (const newsId of newsMentionedIn(reply.text, situation.news)) {
      if (!player.toldNewsIds.includes(newsId)) player.toldNewsIds.push(newsId);
    }
  }
  if (reply.opinionGiven) player.askedAbout[reply.opinionGiven.personId] = reply.opinionGiven.phrase;
  if (reply.action?.type === 'give_item') {
    // 规则送出一株：他身上少一株，以后算处境时也减掉。
    player.herbsGivenToPlayer = (player.herbsGivenToPlayer ?? 0) + 1;
    situation.ownHerbs = Math.max(0, (situation.ownHerbs ?? 1) - 1);
    situation.giftable = situation.ownHerbs > 0;
  }
  if (reply.action?.type === 'end') {
    conversation.closedBy = reply.action.reason === 'player_left' ? 'player' : reply.action.reason === 'npc_angry' ? 'npc_angry' : 'npc_model';
    return conversation.turns.slice(before);
  }
  // 不理你的人听完这一句就走。
  if (conversation.lastChance) {
    conversation.closedBy = 'npc_refused';
    return conversation.turns.slice(before);
  }
  // AI 回完话，规则算出他已经忍不住了：跟着翻脸走开。
  if (aiAffinity?.stormOff) {
    const text = pickPhrase(persona.voice, 'stormOff', `${seedKey}:${lineIndex}:stormOff`, used) ?? '……';
    conversation.turns.push({ speaker: 'npc', text, by: 'rule', phrase: 'stormOff', facts: [], intent: 'npc_angry', action: { type: 'end', reason: 'npc_angry' } });
    conversation.closedBy = 'npc_angry';
    return conversation.turns.slice(before);
  }
  // 寒暄不算正题：问好不占他能聊的句数。
  if (classified.intent !== 'greeting') conversation.npcReplies += 1;
  if (conversation.npcReplies >= conversation.budget.turns - conversation.budgetPenalty && !suppressClose) {
    const close = closingLine({ persona, budget: conversation.budget, seedKey, used });
    conversation.turns.push({ speaker: 'npc', ...close, intent: 'npc_close' });
    conversation.closedBy = 'npc_rule';
  }
  return conversation.turns.slice(before);
}

// 聊完：规则记下又见过一回。"见过一回"的好感每天只算一次；骂过人、他翻脸走了、不理你的，不算。
export function closeConversation(conversation, { day, closedBy } = {}) {
  conversation.closedBy ??= closedBy ?? 'script_end';
  const { player } = conversation;
  const bonus = visitBonus({ record: player, day, closedBy: conversation.closedBy, offended: conversation.offended || conversation.closedBy === 'npc_refused' });
  player.met = true;
  player.visits += 1;
  player.firstDay ??= day;
  player.relationship += bonus;
  if (bonus > 0) player.lastVisitBonusDay = day;
  player.lastMetTick = conversation.tick;
  conversation.visitBonus = bonus;
  return conversation;
}

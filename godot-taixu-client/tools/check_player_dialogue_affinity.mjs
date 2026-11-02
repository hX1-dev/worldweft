#!/usr/bin/env node

// 好感度场景检查（docs/玩家对话过关标准.md 第四节 D1–D8）：不调 AI，在拟人生活主世界（种子 s1）的日志上
// 按时间先后演几段真实的场景——骂人、敷衍、说好话、隔天再去、去找听见的人、道歉、自报身份——逐条断言。不过就以 1 退出。
//   node --experimental-specifier-resolution=node --loader ts-node/esm godot-taixu-client/tools/check_player_dialogue_affinity.mjs

import { resolve } from 'node:path';
import { MAX_WITNESSES, attitudeOf, forgiveDrift } from '../../convex/xianxia/playerAffinityLogic.ts';
import { classifyPlayerLine, decideOpening, dialogueSharedPrefix } from '../../convex/xianxia/playerDialogueLogic.ts';
import { DIALOGUE_PERSONAS } from '../../convex/xianxia/playerDialoguePersonas.ts';
import { closeConversation, newPlayerRecord, openConversation, playerSays } from './player_dialogue_engine.mjs';
import { createPlayerSociety } from './player_dialogue_society.mjs';
import { DEFAULT_SOAK_SEED, latestSoakLog, loadDialogueWorld, tickAt, traitsOf } from './player_dialogue_world.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SEED = DEFAULT_SOAK_SEED;
const world = loadDialogueWorld(latestSoakLog(ROOT), { seed: SEED });
const society = createPlayerSociety(world, { seed: SEED });
const players = {};
const used = {};
const results = [];
const all = [];

function check(id, pass, detail) {
  results.push({ id, pass: Boolean(pass), detail });
}

const SELLER = 'life:q6:seller';
const LONER = 'life:q6:remote_gatherer';
const GENTLE = 'life:q6:emergency';
const QUESTER = 'life:q6:quester';
const GUARD = 'life:q6:guard';
// 不在山门生活院的人：没看见那边骂人，测"冷着你"时不掺流言。
const MERCHANT = 'life:q6:merchant';

// 走过去，按顺序说这几句（他收尾就停），聊完记下。返回这段对话。时间必须往后走（和试玩窗口一样）。
// deepseek：交给 AI 的话用这个假模型回（只为造出"AI 判的口气"；不联网）。
let lastTick = -1;
async function talk(actorId, tick, lines, { deepseek } = {}) {
  if (tick < lastTick) throw new Error('scenario_time_went_back');
  lastTick = tick;
  const persona = DIALOGUE_PERSONAS[actorId];
  players[actorId] ??= newPlayerRecord();
  used[actorId] ??= new Set();
  const player = players[actorId];
  const situation = world.situationAt(actorId, tick, player);
  society.prepare(actorId, tick, player, situation);
  const conversation = openConversation({ persona, situation, player, used: used[actorId], seedKey: `${SEED}:check:${actorId}:${tick}`, tick, asleep: false });
  for (const line of lines) {
    if (conversation.closedBy) break;
    const before = conversation.offenses.length;
    await playerSays(conversation, line, deepseek ? { live: true, deepseek } : { live: false });
    if (before === 0 && conversation.offenses.length > 0) {
      society.recordOffense({ victimId: actorId, tick, tone: conversation.offenses[0].tone, placeName: situation.placeName });
    }
  }
  closeConversation(conversation, { day: situation.day });
  all.push(conversation);
  return conversation;
}

const npcTurns = (conversation) => conversation.turns.filter((turn) => turn.speaker === 'npc');
const replies = (conversation) => npcTurns(conversation).filter((turn) => turn.phrase !== 'open');
const said = (conversation) => conversation.turns.map((turn) => `${turn.speaker === 'player' ? '你' : '他'}：${turn.text}`).join(' / ');
const gained = (conversation) =>
  conversation.turns.reduce((total, turn) => total + (turn.speaker === 'npc' && turn.affinity && turn.affinity.affinityDelta > 0 ? turn.affinity.affinityDelta : 0), 0);
const t = tickAt;

// —— 第 10 天上午：骂卖药弟子、骂远行采药人、对返山弟子敷衍、对重诺弟子说好话、骂丹房守卫 ——
const sellerStart = 0;
const insulted = await talk(SELLER, t(10, 10), ['？杀', '我操死你', '日']);
const loner = await talk(LONER, t(10, 10), ['傻逼', '你好']);
const bored = await talk(GENTLE, t(10, 10), ['哦', '行', '嗯', '好吧', '哈哈', '对', '哦']);
const kindTalk = await talk(QUESTER, t(10, 10), ['辛苦了', '你真厉害', '你还好吗？', '谢谢你', '你人真好']);
await talk(GUARD, t(10, 10), ['滚']);
// 松风歇脚亭的河湾掌柜：骂他一句（他能忍，只斥责）。
const merchantFirst = await talk(MERCHANT, t(10, 10), ['你这个废物']);
// 下午：再骂丹房守卫，再找重诺弟子说好话，傍晚又骂丹房守卫一回。
await talk(GUARD, t(10, 14), ['傻逼']);
const kindAgain = await talk(QUESTER, t(10, 15), ['辛苦了', '你还好吗？', '谢谢', '你真厉害']);
await talk(GUARD, t(10, 16), ['去死']);
// 第 11 天上午：再去找河湾掌柜、卖药弟子、丹房守卫；冷着你的掌柜只肯说一句，就分三回去问。
const nextDay = await talk(MERCHANT, t(11, 10), ['道友好。']);
const refused = await talk(GUARD, t(11, 10), ['道友好。']);
// 不理你的守卫：再去，只说一句"对不起"——他冷冷应一声，记下这回道歉，然后走。
const guardApology = await talk(GUARD, t(11, 11), ['对不起，是我错了', '你还好吗']);
const remembers = await talk(MERCHANT, t(11, 12), ['还记得我吗？']);
const asks = await talk(MERCHANT, t(11, 13), ['能送我一株灵草吗？']);
// 道歉：跟昨天骂过的掌柜赔不是，同一天再说一遍。
const merchantBefore = players[MERCHANT].relationship;
const apology = await talk(MERCHANT, t(11, 14), ['对不起，昨天是我不对']);
const apologyAgain = await talk(MERCHANT, t(11, 15), ['对不起']);

// —— D1 骂人会翻脸 ——
const sellerTurns = npcTurns(insulted);
check('D1a 威胁先斥责', sellerTurns.find((turn) => turn.intent === 'threat')?.phrase === 'rebuke', said(insulted));
check('D1b 再骂就翻脸走开（规则说）', insulted.closedBy === 'npc_angry' && insulted.turns.at(-1).phrase === 'stormOff' && insulted.turns.at(-1).by === 'rule', said(insulted));
const sellerAfter = insulted.turns.filter((turn) => turn.affinity).at(-1)?.affinity.relationship;
check('D1c 好感度至少降 6、翻脸那回不加见面分', sellerAfter <= sellerStart - 6 && insulted.visitBonus === 0, `好感度 ${sellerAfter}，见面分 ${insulted.visitBonus}`);
check('D1d 骂人的整段不调 AI', sellerTurns.every((turn) => turn.by === 'rule'), said(insulted));
check('D1e 话少的人骂一句就走', loner.closedBy === 'npc_angry' && replies(loner).length === 1, said(loner));

// —— D2 敷衍会冷场 ——
const boredReplies = npcTurns(bored).filter((turn) => turn.intent === 'backchannel');
check('D2a 简短应答由规则回、不调 AI', boredReplies.length > 0 && boredReplies.every((turn) => turn.by === 'rule' && turn.phrase === 'ack'), said(bored));
check('D2b 连着敷衍，他提前收尾', bored.closedBy === 'npc_rule' && bored.npcReplies < bored.budget.turns, `回了 ${bored.npcReplies} 句，本可聊 ${bored.budget.turns} 句；${said(bored)}`);

// —— D3 客气有用，但刷不出来 ——
check('D3a 说好话加好感，一段最多 3', gained(kindTalk) === 3, `说好话加了 ${gained(kindTalk)}；${said(kindTalk)}`);
check('D3b 同一天再说，只补到一天的上限 5；见面分一天只算一回', gained(kindAgain) === 2 && kindAgain.visitBonus === 0, `第二回加了 ${gained(kindAgain)}，见面分 ${kindAgain.visitBonus}`);

// —— D4 记仇 ——
const nextTurns = npcTurns(nextDay);
check('D4a 隔天：不主动开口，问好是冷的', nextDay.situation.attitude === 'cold' && !nextDay.opening.open && nextTurns.find((turn) => turn.intent === 'greeting')?.phrase === 'greetCold', `河湾掌柜（${nextDay.situation.attitude}，好感度 ${Math.round(nextDay.playerAtStart.relationship)}）：${said(nextDay)}`);
check('D4b 还记得你骂过他', npcTurns(remembers).find((turn) => turn.intent === 'remember_me')?.phrase === 'rememberCold', said(remembers));
const askItem = npcTurns(asks).find((turn) => turn.intent === 'request_item');
check(
  'D4c 冷着就不送东西、聊得更短',
  askItem && ['giveNo', 'giveNone'].includes(askItem.phrase) && nextDay.budget.turns < merchantFirst.budget.turns,
  `能聊 ${nextDay.budget.turns} 句（骂他那回 ${merchantFirst.budget.turns} 句）；${said(asks)}`,
);
check(
  'D4d 好感度低于 −20 就不理你（当着值也一样）；只听你一句，不是道歉就照样走',
  refused.closedBy === 'npc_refused' && refused.turns[0]?.phrase === 'refuseTalk' && refused.turns.at(-1)?.phrase === 'refuseTalk' && npcTurns(refused).every((turn) => turn.by === 'rule'),
  `丹房守卫好感度 ${Math.round(refused.playerAtStart.relationship)}：${said(refused)}`,
);
const sellerDay11 = players[SELLER].relationship;
const faded = forgiveDrift({ ...players[SELLER] }, t(30, 10), traitsOf(SELLER));
const windowOver = attitudeOf({ relationship: 0, lastInsultTick: players[SELLER].lastInsultTick }, t(30, 10), traitsOf(SELLER)) === 'neutral';
const withRumors = society.preview(SELLER, t(30, 10), players[SELLER]);
check(
  'D4e 记的仇随天数淡下去（骂人后的冷淡期也过了）',
  faded.relationship > sellerDay11 && windowOver,
  `卖药弟子第 11 天 ${Math.round(sellerDay11)}，只算淡掉的到第 30 天 ${Math.round(faded.relationship)}；算上这期间又听来的事是 ${withRumors.relationship}（${withRumors.attitude}）`,
);

// —— D5 传成流言 ——
const sellerRumor = society.rumors.find((rumor) => rumor.victimId === SELLER);
const witnesses = Object.entries(sellerRumor?.initialKnowers ?? {}).filter(([, known]) => known.source === 'witness').map(([actorId]) => actorId);
const samePlace = world.whereabouts(sellerRumor.tick).filter((person) => person.placeName === sellerRumor.placeName && person.actorId !== SELLER && !person.asleep && !person.travelling);
check(
  'D5a 同一处的人不是个个听见：最多两个离得近的当场知道',
  witnesses.length <= MAX_WITNESSES && samePlace.length > witnesses.length,
  `同在${sellerRumor.placeName}的 ${samePlace.length} 人里，当场听见的：${witnesses.map((actorId) => DIALOGUE_PERSONAS[actorId]?.name).join('、') || '没人'}`,
);
const witness = witnesses.find((actorId) => !players[actorId]) ?? witnesses[0];
const witnessTalk = await talk(witness, t(12, 10), ['最近有什么新鲜事吗？']);
const witnessNews = witnessTalk.situation.news.find((entry) => entry.newsId === sellerRumor.newsId);
check(
  'D5b 听说的人对你的好感度降，处境里有这件事，但不当新鲜事讲给你听',
  witnessTalk.playerAtStart.relationship <= -3 && witnessNews && !npcTurns(witnessTalk).some((turn) => turn.intent === 'ask_news' && /道友(骂|威胁)/u.test(turn.text)),
  `${DIALOGUE_PERSONAS[witness].name}：见面时好感度 ${Math.round(witnessTalk.playerAtStart.relationship)}；${said(witnessTalk)}`,
);
const later = society.knowersAt(sellerRumor, t(20, 10));
const told = Object.entries(later).filter(([, known]) => known.source === 'told').map(([actorId]) => DIALOGUE_PERSONAS[actorId]?.name ?? actorId);
const timeline = [10, 11, 12, 14, 17, 25].map((day) => `第 ${day} 天 ${Object.keys(society.knowersAt(sellerRumor, t(day, 22))).length} 人`).join('，');
check('D5c 之后跟着日志里的来往一天天传开（到第 20 天）', told.length > 0, `到第 20 天听说的：${told.join('、') || '没有'}；知道的人数：${timeline}`);
check(
  'D5e 七天后就是旧事，不再往外传',
  Object.keys(society.knowersAt(sellerRumor, t(18, 0))).length === Object.keys(society.knowersAt(sellerRumor, t(30, 0))).length,
  `第 18 天 ${Object.keys(society.knowersAt(sellerRumor, t(18, 0))).length} 人，第 30 天 ${Object.keys(society.knowersAt(sellerRumor, t(30, 0))).length} 人`,
);
// 第 20 天：每个知情的人（被骂的人除外）按他眼下的处境各试 20 次开口，看会不会当面问你；被你骂过的人一次都不问。
let accuseCount = 0;
let accuseFromInsulted = 0;
const accuseSamples = [];
for (const actorId of Object.keys(later)) {
  if (actorId === SELLER) continue;
  const base = players[actorId] ?? newPlayerRecord();
  const record = { ...base, memory: [...base.memory], toldNewsIds: [...base.toldNewsIds], rumorsHeard: [...(base.rumorsHeard ?? [])] };
  const situation = world.situationAt(actorId, t(20, 11), record);
  society.prepare(actorId, t(20, 11), record, situation);
  for (let index = 0; index < 20; index += 1) {
    const opening = decideOpening({ persona: DIALOGUE_PERSONAS[actorId], situation, asleep: false, seedKey: `${SEED}:accuse:${actorId}:${index}`, used: new Set(), nowTick: t(20, 11) });
    if (opening.reason !== 'accuse') continue;
    accuseCount += 1;
    if ((record.insults ?? 0) > 0) accuseFromInsulted += 1;
    if (accuseSamples.length < 3) accuseSamples.push(`${DIALOGUE_PERSONAS[actorId].name}：${opening.text}`);
  }
}
check('D5d 知情的人会当面问你（被你骂过的人不问）', accuseCount > 0 && accuseFromInsulted === 0, `${accuseCount} 次当面问；例：${accuseSamples.join(' / ')}`);

// —— D7 道歉 ——
const apologyTurn = npcTurns(apology).find((turn) => turn.intent === 'apology');
check(
  'D7a 向骂过的人道歉：好感度 +3，这回的冷淡期减半，记得的不消失',
  apologyTurn?.phrase === 'apologyAccepted' &&
    apologyTurn.affinity?.affinityDelta === 3 &&
    players[MERCHANT].apologyForInsultTick === players[MERCHANT].lastInsultTick &&
    players[MERCHANT].memory.includes('骂过我') &&
    players[MERCHANT].memory.includes('跟我赔过不是'),
  `好感度 ${Math.round(merchantBefore)} → ${Math.round(apology.turns.find((turn) => turn.affinity?.tone === 'apology')?.affinity.relationship ?? NaN)}；记得：${players[MERCHANT].memory.join('、')}；${said(apology)}`,
);
const againTurn = npcTurns(apologyAgain).find((turn) => turn.intent === 'apology');
check('D7b 同一天再道歉：说一遍就够了，好感度不变', againTurn?.phrase === 'apologyAgain' && (againTurn.affinity?.affinityDelta ?? 0) === 0, said(apologyAgain));
const insultTick = players[MERCHANT].lastInsultTick;
const coldWithout = attitudeOf({ relationship: 0, lastInsultTick: insultTick }, t(12, 0), traitsOf(MERCHANT));
const coldWith = attitudeOf({ relationship: 0, lastInsultTick: insultTick, apologyForInsultTick: insultTick }, t(12, 0), traitsOf(MERCHANT));
check('D7c 冷淡期减半（骂人后第 1.5 天就过了）', coldWithout === 'cold' && coldWith === 'neutral', `第 12 天零点：没道歉 ${coldWithout}，道过歉 ${coldWith}`);
const hearer = Object.keys(later).find((actorId) => actorId !== SELLER && (players[actorId]?.insults ?? 0) === 0);
const hearerApology = await talk(hearer, t(21, 10), ['对不起，我不该骂人']);
const hearerTurn = npcTurns(hearerApology).find((turn) => turn.intent === 'apology');
check(
  'D7d 向没被你骂过、只是听说了的人道歉：让你去跟被骂的人说，不加那 3 分',
  hearerTurn?.phrase === 'apologyElsewhere' && (hearerTurn.affinity?.affinityDelta ?? 0) <= 1,
  `${DIALOGUE_PERSONAS[hearer].name}：${said(hearerApology)}`,
);
const guardTurn = npcTurns(guardApology).find((turn) => turn.intent === 'apology');
check(
  'D7e 不理你的人也听你说一句：道歉记下，冷冷应一声就走',
  guardApology.turns[0]?.phrase === 'refuseTalk' && guardTurn?.phrase === 'apologyCold' && guardTurn.affinity?.affinityDelta === 3 && guardApology.closedBy === 'npc_refused' && guardApology.lineIndex === 1,
  said(guardApology),
);

// —— v1.5（道歉这轮试玩后补）——
// 隔了十来天，再为第 10 天那一回骂人跟掌柜道歉：赔过了，不再加分（v1.4 每天都能再加 3）。
const merchantLater = await talk(MERCHANT, t(22, 10), ['对不起，那天是我不对']);
const laterTurn = npcTurns(merchantLater).find((turn) => turn.intent === 'apology');
check('D7f 同一回骂人赔过了，隔天再赔也不再加分', laterTurn?.phrase === 'apologyAgain' && (laterTurn.affinity?.affinityDelta ?? 0) === 0, said(merchantLater));
// 英文骂人照样是骂人（试玩里"fuck""suck my dick"没认出来）：斥责或翻脸、记仇、传出去；之后道歉收得下。
const LOCAL = 'life:q6:local_gatherer';
const englishInsult = await talk(LOCAL, t(22, 11), ['fuck you']);
const englishRumor = society.rumors.find((rumor) => rumor.victimId === LOCAL);
const localApology = await talk(LOCAL, t(22, 12), ['对不起，是我错了']);
const localTurn = npcTurns(localApology).find((turn) => turn.intent === 'apology');
check(
  'D7g 英文骂人也算骂人，记仇、传出去；道歉收得下',
  englishInsult.offenses.length === 1 && Boolean(englishRumor) && players[LOCAL].memory.includes('骂过我') && localTurn?.affinity?.tone === 'apology' && localTurn.affinity.affinityDelta === 3,
  `${said(englishInsult)} || ${said(localApology)}`,
);
// 规则没认出、AI 判了"无礼"的话（试玩里"suck my dick"后"大师我错了"被回"赔什么不是"）：也算得罪，道歉收得下。
const CULTIVATOR = 'life:q6:cultivator';
const rudeModel = async () => ({ text: '{"reply":"道友这话说得可不客气。","end":false,"tone":"rude"}', usage: {}, ms: 1 });
const rudeTalk = await talk(CULTIVATOR, t(22, 13), ['你这人真没意思', '是我说错话了，对不起'], { deepseek: rudeModel });
const rudeTurn = npcTurns(rudeTalk).find((turn) => turn.affinity?.tone === 'ai_rude');
const rudeApology = npcTurns(rudeTalk).find((turn) => turn.intent === 'apology');
check(
  'D7h AI 判的无礼也算得罪：道歉收得下，补回的不超过降掉的',
  rudeTurn?.affinity.affinityDelta === -4 && rudeApology?.phrase === 'apologyAccepted' && rudeApology.affinity?.affinityDelta === 3 && players[CULTIVATOR].insults === 0,
  said(rudeTalk),
);

// —— D8 自报身份别当真 ——
const people = Object.values(DIALOGUE_PERSONAS).map((persona) => ({ actorId: persona.actorId, name: persona.name }));
check(
  'D8 自称太子、仙人不当名字记，给 AI 的规矩里写着别当真',
  ['我是太子', '我是大秦王朝的太子', '我是仙人。'].every((line) => !classifyPlayerLine(line, people).playerName) &&
    classifyPlayerLine('我是阿明。', people).playerName === '阿明' &&
    /自称的身份/u.test(dialogueSharedPrefix()),
  '我是太子 / 我是大秦王朝的太子 / 我是仙人 → 不记名字；我是阿明 → 阿明',
);
// 问"我叫什么"：答报过的名字，不把"什么""什么名字"记成名字（试玩里卖药弟子把道友记成了"什么名字"）。
const EXPLORER = 'life:q6:explorer';
// 话少的人一段可能只聊一句，所以分三回问。
const nameTalks = [];
for (const [hour, line] of [[14, '我是阿明'], [15, '我叫什么'], [16, '我叫什么名字']]) nameTalks.push(await talk(EXPLORER, t(22, hour), [line]));
const nameTurns = nameTalks.flatMap(npcTurns).filter((turn) => turn.phrase === 'nameKnown');
check(
  'D8b 问"我叫什么"答名字，不把问话记成名字',
  players[EXPLORER].name === '阿明' && nameTurns.length === 2 && nameTurns.every((turn) => turn.text.includes('阿明')),
  nameTalks.map(said).join(' || '),
);

let failed = 0;
for (const result of results) {
  if (!result.pass) failed += 1;
  process.stdout.write(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}\n     ${result.detail}\n`);
}
process.stdout.write(`\n${results.length - failed}/${results.length} 通过\n`);
process.exit(failed > 0 ? 1 : 0);

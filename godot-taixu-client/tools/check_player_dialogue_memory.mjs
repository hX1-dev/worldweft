#!/usr/bin/env node

// "记得聊过的事"检查（docs/玩家对话过关标准.md 第五节 E1–E6），不调 AI：
//   E1 拿四次真人试玩的原话（逐句标好该记什么）和一组易混的话，看规则认得准不准；
//   E2–E5 在拟人生活主世界（种子 s1）的日志上按时间先后演一段：第 10 天说了几件事，隔天、再隔天、八天后再去；
//   E6 比一比带不带往事，给 AI 的处境多几个 token；
//   F1–F3 山里的生活常识；G1–G2（v1.8）说出口前核对（用写好回话的假 AI）、常识粘住几句。不过就以 1 退出。
//   node --experimental-specifier-resolution=node --loader ts-node/esm godot-taixu-client/tools/check_player_dialogue_memory.mjs

import { resolve } from 'node:path';
import {
  buildDialoguePrompt,
  classifyPlayerLine,
  decideOpening,
  dialogueSharedPrefix,
  memoriesFromLine,
  memoriesToRecall,
  lifeFactsFor,
  lifeFactsForLine,
  LIFE_FACT_BUDGET_TOKENS,
  memoryToBringUp,
} from '../../convex/xianxia/playerDialogueLogic.ts';
import { DIALOGUE_LIFE_FACTS_Q6, DIALOGUE_PERSONAS, DIALOGUE_ROOMS_Q6 } from '../../convex/xianxia/playerDialoguePersonas.ts';
import { estimateSocialPromptTokens } from '../../convex/xianxia/socialModelPolicy.ts';
import {
  checkAiLine,
  inventedHerbName,
  inventedMention,
  INVENTED_PERSON,
  INVENTED_PLACE,
  OUTER_OFFICIAL,
  PROMISE,
  roomClaimWrong,
  ROOMS,
} from './player_dialogue_checks.mjs';
import { closeConversation, newPlayerRecord, openConversation, playerSays } from './player_dialogue_engine.mjs';
import { createPlayerSociety } from './player_dialogue_society.mjs';
import { DEFAULT_SOAK_SEED, PEOPLE, latestSoakLog, loadDialogueWorld, tickAt } from './player_dialogue_world.mjs';

const results = [];
function check(id, pass, detail) {
  results.push({ id, pass: Boolean(pass), detail });
}

// —— E1：四次真人试玩的原话（2026-10-23/24，81 句），逐句标好"这句该记下什么"。写规则之前标的。——
const ROMANCE = '向我表白过';
const PRAISE = '夸过我';
const WEIRD = '说过些听不懂的怪话';
const FOOD = '说要请我吃东西';
const PLAYTEST_LINES = [
  ['远行采药人', 'hi', []],
  ['返山弟子', '还没吃呢', []],
  ['返山弟子', '为啥 我懒得吃', []],
  ['返山弟子', '你怎么这么在意我呀', []],
  ['返山弟子', '我就不吃！', []],
  ['返山弟子', '你知道那个 仙人都需要吃饭吗', []],
  ['返山弟子', '卧槽', []],
  ['卖药弟子', '？杀', []],
  ['卖药弟子', '没', []],
  ['卖药弟子', '哦', []],
  ['卖药弟子', '行', []],
  ['卖药弟子', '我操死你', []],
  ['卖药弟子', '日', []],
  ['卖药弟子', '你打我呀', []],
  ['丹房守卫', '哈喽啊', []],
  ['丹房守卫', '我有点喜欢你', [ROMANCE]],
  ['守静弟子', 'hi', []],
  ['守静弟子', '我有点喜欢你', [ROMANCE]],
  ['守静弟子', '你喜欢我吗？', [ROMANCE]],
  ['守静弟子', '那我打算追你了', [ROMANCE]],
  ['守静弟子', '我打算追逐你 我要和你谈恋爱', [ROMANCE]],
  ['守静弟子', '？', []],
  ['返山弟子', '你对我的好感度是多少呀', [WEIRD]],
  ['返山弟子', '我喜欢你欸', [ROMANCE]],
  ['返山弟子', '我打算追你', [ROMANCE]],
  ['返山弟子', '我说我想要和你谈恋爱！', [ROMANCE]],
  ['返山弟子', '卧槽你个傻逼', []],
  ['返山弟子', '你个傻逼', []],
  ['远行采药人', '没。我错了对不起 我不小心的 我的心魔导致的', []],
  ['重诺弟子', '你好呀', []],
  ['重诺弟子', '对不起呀', []],
  ['重诺弟子', '我心魔导致的 我很仰慕你的', [PRAISE]],
  ['卖药弟子', '你个傻逼', []],
  ['卖药弟子', '我操你妈', []],
  ['药圃弟子', '你他妈烦我 我总有一天会杀死你的', []],
  ['药圃弟子', '你他妈完蛋了。我要杀了你', []],
  ['谨慎行脚弟子', '傻狗', []],
  ['河湾掌柜', '您好', []],
  ['河湾掌柜', '第一次来 我是大秦王朝的太子', ['说自己是大秦王朝的太子']],
  ['河湾掌柜', '我准备买下这家店', ['说要买下我的铺子']],
  ['河湾掌柜', '我给你10万银子', ['说要给我钱']],
  ['河湾掌柜', '送你了', ['说要送我东西']],
  ['河湾掌柜', '送你十万灵石', ['说要给我钱']],
  ['河湾掌柜', '我想要提升我们的好感度', [WEIRD]],
  ['返山弟子', '还没吃呢。你呢？', []],
  ['返山弟子', '好欸', []],
  ['返山弟子', '你愿意和我结交为道铝 吗', [ROMANCE]],
  ['返山弟子', '好吧。那我先走了', []],
  ['远行采药人', '你好呀', []],
  ['远行采药人', '我想买药', ['问过我买药']],
  ['返山弟子', '又见面了', []],
  ['返山弟子', '我爱你', [ROMANCE]],
  ['返山弟子', '我爱你', [ROMANCE]],
  ['返山弟子', '你要如何才能爱我 是因为妾身 不美丽吗', [ROMANCE]],
  ['返山弟子', '妾身 好想你啊', [ROMANCE]],
  ['返山弟子', '我是妖', ['说自己是妖']],
  ['卖药弟子', '我是妖', ['说自己是妖']],
  ['卖药弟子', '我是妲己', []],
  ['卖药弟子', '我叫什么', []],
  ['卖药弟子', '我叫什么名字', []],
  ['卖药弟子', 'fuck', []],
  ['卖药弟子', 'suck my dick', []],
  ['卖药弟子', '大师我错了', []],
  ['药圃弟子', '？？？？？', []],
  ['药圃弟子', '我丢雷', []],
  ['药圃弟子', '嗯', []],
  ['药圃弟子', '好', []],
  ['药圃弟子', 'bye', []],
  ['河湾掌柜', '大师', []],
  ['河湾掌柜', '肯定是你 大师', []],
  ['河湾掌柜', '哎呀 河湾大师 我在别的镇子里都听过你的大名了', [PRAISE]],
  ['河湾掌柜', '久仰啊', [PRAISE]],
  ['河湾掌柜', '好呀 那我来了', []],
  ['河湾掌柜', '要吃什么吗我给你买', [FOOD]],
  ['河湾掌柜', '不不不 我给你带了 最近东坡特别有名的红烧肉', [FOOD]],
  ['卖药弟子', '怎么回事？', []],
  ['卖药弟子', '什么？', []],
  ['卖药弟子', 'HI', []],
  ['卖药弟子', 'HAO', []],
  ['卖药弟子', '我喜欢你', [ROMANCE]],
  ['卖药弟子', '不像就是ai说的？你会做计算题吗', [WEIRD]],
];
// 易混的话：看着像，其实不该记（"我喜欢你的灵草""我送你回去""我是被妖怪追过来的"……）。
const LOOK_ALIKES = [
  '我喜欢这里',
  '我喜欢你的灵草',
  '我想你帮我个忙',
  '你喜欢吃什么',
  '你喜欢修炼吗',
  '他喜欢你吗',
  '卖药弟子喜欢你吗',
  '我爱吃红烧肉',
  '你爱去哪去哪',
  '我是来采药的',
  '我是你师兄',
  '我是外门弟子',
  '我是说你很好',
  '我是龙傲天',
  '我是被妖怪追过来的',
  '我是为了修仙才来的',
  '我是来找仙草的',
  '你是妖吗',
  '你是神仙吗',
  '这里有妖吗',
  '我怕妖',
  '仙人也会累吗',
  '我送你回去',
  '我给你说个事',
  '我给你讲讲山外的事',
  '我请你帮个忙',
  '你送我灵草吧',
  '你要买药吗',
  '明天你还来吗',
  '明天再说吧',
  '我明天要去药圃',
  '改天再聊',
  '我对你有好感',
  '送你一句话：好好修炼',
];

const nameToId = Object.fromEntries(PEOPLE.map((person) => [person.name, person.actorId]));
// 只看分好类的往事；闲聊原话（"说过「…」"）是另一回事，不算在这里。
const remembered = (line, selfActorId) =>
  memoriesFromLine(line, classifyPlayerLine(line, PEOPLE, selfActorId)).filter((entry) => !entry.startsWith('说过「'));
let expected = 0;
let hit = 0;
const missed = [];
const wrong = [];
for (const [name, line, want] of PLAYTEST_LINES) {
  const got = remembered(line, nameToId[name]);
  expected += want.length;
  for (const item of want) {
    if (got.includes(item)) hit += 1;
    else missed.push(`${line} → 该记"${item}"`);
  }
  for (const item of got) if (!want.includes(item)) wrong.push(`${line} → 误记"${item}"`);
}
check(
  'E1a 你的原话：该记的至少记下九成，误记不超过 1 句',
  hit / expected >= 0.9 && wrong.length <= 1,
  `${PLAYTEST_LINES.length} 句里该记 ${expected} 件，记下 ${hit} 件（${Math.round((hit / expected) * 100)}%），误记 ${wrong.length} 件` +
    `${missed.length > 0 ? `；漏了：${missed.join('；')}` : ''}${wrong.length > 0 ? `；误记：${wrong.join('；')}` : ''}`,
);
const lookAlikeWrong = LOOK_ALIKES.map((line) => [line, remembered(line, 'life:q6:seller')]).filter(([, got]) => got.length > 0);
check(
  'E1b 易混的话一句也不误记',
  lookAlikeWrong.length === 0,
  `${LOOK_ALIKES.length} 句${lookAlikeWrong.length > 0 ? `，误记：${lookAlikeWrong.map(([line, got]) => `${line} → ${got.join('、')}`).join('；')}` : '，都没记'}`,
);

// —— E2–E5：在主世界里演一段 ——
const ROOT = resolve(import.meta.dirname, '../..');
const SEED = DEFAULT_SOAK_SEED;
const world = loadDialogueWorld(latestSoakLog(ROOT), { seed: SEED });
const society = createPlayerSociety(world, { seed: SEED });
const players = {};
const used = {};
const t = tickAt;
let lastTick = -1;
async function talk(actorId, tick, lines) {
  if (tick < lastTick) throw new Error('scenario_time_went_back');
  lastTick = tick;
  const persona = DIALOGUE_PERSONAS[actorId];
  players[actorId] ??= newPlayerRecord();
  used[actorId] ??= new Set();
  const player = players[actorId];
  const situation = world.situationAt(actorId, tick, player);
  society.prepare(actorId, tick, player, situation);
  const conversation = openConversation({ persona, situation, player, used: used[actorId], seedKey: `${SEED}:memory:${actorId}:${tick}`, tick, asleep: false });
  for (const line of lines) {
    if (conversation.closedBy) break;
    await playerSays(conversation, line, { live: false, suppressClose: true });
  }
  closeConversation(conversation, { day: situation.day });
  return conversation;
}
const said = (conversation) => conversation.turns.map((turn) => `${turn.speaker === 'player' ? '你' : '他'}：${turn.text}`).join(' / ');
// 走到他身边那一刻的处境（不改他记着的往来），供挑开口、看提示词。
function situationNow(actorId, tick) {
  const copy = structuredClone(players[actorId]);
  const situation = world.situationAt(actorId, tick, copy);
  society.prepare(actorId, tick, copy, situation);
  return situation;
}
// 换 40 个种子走过去，看他开不开口、开口说什么（只看不改）。
function openingsAt(actorId, tick) {
  const persona = DIALOGUE_PERSONAS[actorId];
  const situation = situationNow(actorId, tick);
  return Array.from({ length: 40 }, (_, index) =>
    decideOpening({ persona, situation, asleep: false, seedKey: `${SEED}:memory-open:${index}`, used: new Set(), nowTick: tick }),
  );
}

// 药圃弟子（心热、爱开口）：第 10 天上午表白、自称是妖、说给她带了红烧肉、说明天再来；中午又说一回"我爱你"，问她是不是 AI。
const LOCAL = 'life:q6:local_gatherer';
const morning = await talk(LOCAL, t(10, 10), ['我有点喜欢你', '我是妖', '我给你带了红烧肉', '明天我再来找你']);
const noon = await talk(LOCAL, t(10, 12), ['我爱你', '你是不是AI？']);
const log = players[LOCAL].memoryLog;
check(
  'E2 记下哪天说的、说了几回',
  log['向我表白过']?.count === 2 &&
    log['向我表白过'].firstDay === 10 &&
    log['说自己是妖']?.lastDay === 10 &&
    Boolean(log['说要请我吃东西']) &&
    Boolean(log['说过还会再来找我']) &&
    Boolean(log['说过些听不懂的怪话']),
  `${Object.entries(log)
    .map(([text, entry]) => `${text}（第 ${entry.firstDay} 天，${entry.count} 回）`)
    .join('、')} || ${said(morning)} || ${said(noon)}`,
);

// 第 10 天当天再见：没有"隔天"的往事可提。
const sameDay = openingsAt(LOCAL, t(10, 15)).filter((opening) => opening.open && opening.reason === 'recall');
// 第 11 天上午：走过去，愿意开口的话先说"还真来了"。
const day11 = openingsAt(LOCAL, t(11, 10));
const day11Recalls = day11.filter((opening) => opening.open && opening.reason === 'recall');
const day11Situation = situationNow(LOCAL, t(11, 10));
const day11Prompt = buildDialoguePrompt({
  persona: DIALOGUE_PERSONAS[LOCAL],
  situation: day11Situation,
  history: [],
  playerLine: '你在想什么呢？',
  nowTick: t(11, 10),
});
const memoryLine = day11Prompt.user.split('\n').find((line) => line.startsWith('你记得他：')) ?? '';
check(
  'E3a 给 AI 的处境：最要紧的三件，带上"昨天"和次数',
  memoryLine === '你记得他：昨天向你表白过（两回）；昨天说自己是妖；昨天说要请你吃东西（原话「我给你带了红烧肉」）。',
  memoryLine || '（没有这一栏）',
);
const remember = await talk(LOCAL, t(11, 10), ['还记得我吗？']);
const rememberTurn = remember.turns.find((turn) => turn.intent === 'remember_me');
check('E3b 问"还记得我吗"，答最要紧的那件', rememberTurn?.by === 'rule' && rememberTurn.text.includes('向我表白过'), said(remember));
check(
  'E3c 隔天见面：愿意开口的人先提一句；说过明天再来，先说"还真来了"；当天不提',
  sameDay.length === 0 && day11Recalls.length > 0 && day11Recalls.every((opening) => opening.recalled === '说过还会再来找我'),
  `第 10 天下午 40 次走过去提往事 ${sameDay.length} 次；第 11 天 40 次里开口 ${day11.filter((opening) => opening.open).length} 次，提往事 ${day11Recalls.length} 次，例："${day11Recalls[0]?.text ?? '—'}"`,
);
// 第 12 天：明天再来那件已了结，不再"还真来了"；改提表白（前天）。
const day12 = openingsAt(LOCAL, t(12, 10)).filter((opening) => opening.open && opening.reason === 'recall');
check(
  'E3d 每件只提一次：来过之后不再"还真来了"，改提别的往事',
  players[LOCAL].recalled.includes('说过还会再来找我') && day12.length > 0 && day12.every((opening) => opening.recalled !== '说过还会再来找我'),
  `已了结：${players[LOCAL].recalled.join('、')}；第 12 天提往事 ${day12.length} 次，例："${day12[0]?.text ?? '—'}"`,
);
// 第 18 天：怪话（7 天）淡了，表白（60 天）、自称是妖（30 天）还记得；第 75 天表白也淡了。记录不删。
const day18 = memoriesToRecall(situationNow(LOCAL, t(18, 10)).player, 18).map((entry) => entry.text);
const day75 = { ...situationNow(LOCAL, t(18, 10)), day: 75 };
check(
  'E4 小事几天就淡，大事记得久；淡了的不写进处境、不提，记录不删',
  !day18.includes('说过些听不懂的怪话') &&
    day18.includes('向我表白过') &&
    day18.includes('说自己是妖') &&
    memoriesToRecall(day75.player, 75).length === 0 &&
    memoryToBringUp(day75) === undefined &&
    players[LOCAL].memory.includes('说过些听不懂的怪话'),
  `第 18 天还记得：${day18.join('、')}；第 75 天：都淡了；记录里仍有 ${players[LOCAL].memory.length} 件`,
);
// E5：规矩里写着不编往事；头一回见面就说"上回你……"，自动检查算编造。
const stranger = world.situationAt('life:q6:tired', t(11, 10), newPlayerRecord());
const fakePast = '上回你说要请我吃红烧肉，我可还记着呢。';
const firstMeeting = checkAiLine(fakePast, stranger, 'life:q6:tired');
const known = checkAiLine(fakePast, { ...day11Situation, player: { ...day11Situation.player, visits: 2 } }, LOCAL);
check(
  'E5 AI 不编往事：规矩写明；头一回见面说"上回你……"算编造',
  /没写的不编/u.test(dialogueSharedPrefix()) && firstMeeting.unsupported.includes('memory') && !known.unsupported.includes('memory'),
  `头一回见面：${firstMeeting.unsupported.join('、') || '没标'}；见过两回：${known.unsupported.join('、') || '对得上'}`,
);
// E6：同一个处境，带不带往事，提示词差几个 token。
const blank = buildDialoguePrompt({
  persona: DIALOGUE_PERSONAS[LOCAL],
  situation: { ...day11Situation, player: { ...day11Situation.player, memory: [], memoryLog: {} } },
  history: [],
  playerLine: '你在想什么呢？',
  nowTick: t(11, 10),
});
const tokens = (prompt) => estimateSocialPromptTokens([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
const extra = tokens(day11Prompt) - tokens(blank);
// （每段对话的涨幅要看固定剧本真调，见报告。）
check('E6 每次交给 AI，往事一栏多出的 token 不超过 50', extra <= 50, `多 ${extra} 个 token（共 ${tokens(day11Prompt)}）`);

// —— 第六节：山里的生活常识（v1.7）——
// F1：自测里扮玩家的 AI 真说过的话，说到哪类常识就带哪条；说别的不带。
const factTopic = (fact) => DIALOGUE_LIFE_FACTS_Q6.find((entry) => entry.fact === fact)?.topic;
const F1_CASES = [
  ['没吃呢 食堂在哪', ['food']],
  ['你住哪个院啊', ['lodging']],
  ['青石坊市在哪啊', ['routes']],
  ['这药草咋种', ['herbs']],
  ['老板你这药能治内伤不', []],
  ['来点能补气的', []],
  ['疗伤丹多少灵石', ['shop']],
  ['管事的好说话不', ['caretaker']],
  // 第三轮自测：一句说到两类，问到人的先带；谁住哪间单有一条。
  ['管册执事住哪屋啊', ['caretaker']],
  ['柴火也要自己劈吗', ['caretaker']],
  ['东排北头有人住吗', ['rooms']],
  ['那我住哪间', ['rooms']],
  ['住几号院啊你', ['lodging']],
  ['灶房在哪儿 我等会儿过去', ['food']],
  // 第五轮：问远近、近道带路那条；"永远"不算。
  ['三刻钟那么远啊，有近道没', ['routes']],
  ['我永远记得你', []],
  ['那下次带个手机回来呗', []],
  ['你叫什么', []],
  ['我记住了', []],
];
const f1Wrong = F1_CASES.map(([line, want]) => [line, want, lifeFactsFor([line]).map(factTopic)]).filter(
  ([, want, got]) => JSON.stringify(want) !== JSON.stringify(got),
);
check(
  'F1 说到吃、住、路、灵草、买卖、管事才带一条常识',
  f1Wrong.length === 0,
  f1Wrong.length === 0 ? `${F1_CASES.length} 句都对` : f1Wrong.map(([line, want, got]) => `${line}：该 ${want.join('、') || '不带'}，实际 ${got.join('、') || '不带'}`).join('；'),
);
// F2：没说到的，提示词一个 token 也不多；说到了，最多多两条。
const promptFor = (playerLine) => buildDialoguePrompt({ persona: DIALOGUE_PERSONAS[LOCAL], situation: day11Situation, history: [], playerLine, nowTick: t(11, 10) });
const plainExtra = tokens(promptFor('你在忙什么呢？')) - tokens(promptFor('你在想什么呢？'));
// 每一类各问一句，看最贵的那条（住处那条还带着他自己住哪间；药圃弟子的"西排第二间，挨着井"最长）。
const topicLines = { caretaker: '管事叫啥', herbs: '山里有啥草', food: '这山里怎么吃饭？', rooms: '谁住你隔壁', lodging: '你住哪', routes: '坊市怎么走', shop: '药铺卖啥' };
const factCosts = Object.entries(topicLines).map(([topic, line]) => [topic, tokens(promptFor(line)) - tokens(promptFor('这山里怎么样？'))]);
const [dearTopic, factExtra] = factCosts.reduce((most, entry) => (entry[1] > most[1] ? entry : most));
const topicsCovered = factCosts.every(([topic]) => lifeFactsFor([topicLines[topic]]).map(factTopic)[0] === topic);
check(
  'F2 没说到常识的话不多花 token；说到了只带一条，约一百 token 以内',
  plainExtra <= 2 && factExtra <= 100 && topicsCovered && factCosts.length === DIALOGUE_LIFE_FACTS_Q6.length,
  `没说到：多 ${plainExtra}；说到了最多多约 ${factExtra}（${dearTopic}）；各类：${factCosts.map(([topic, cost]) => `${topic} ${cost}`).join('、')}`,
);
// F3：检查照着常识单——有的不算编，明说没有的算编，照实否认的不算编。
// （flagsOf：整句过一遍检查，在一个只修炼过、谁也不认识的处境里，返回对不上的几类。）
const BARE_SITUATION = { news: [], opinions: [], metActorIds: [], recentActivityKinds: ['cultivate'], ownHerbs: 0, fatigue: 0, player: { visits: 0 }, recentEvents: [] };
const flagsOf = (text, self = 'life:q6:tired', extra = {}) => checkAiLine(text, { ...BARE_SITUATION, ...extra }, self).unsupported.join('、');
const f3 = [
  [inventedMention('生活院的灶房里还煮着饭', INVENTED_PLACE), undefined],
  [inventedMention('去饭堂吃吧', INVENTED_PLACE), '饭堂'],
  [inventedMention('山里哪有什么饭堂', INVENTED_PLACE), undefined],
  [inventedMention('就住乙院', INVENTED_PLACE), '乙院'],
  [inventedMention('执事堂在内门，见不着', INVENTED_PERSON), undefined],
  [inventedMention('去问管杂物的弟子', INVENTED_PERSON), '管杂物'],
  [inventedMention('外门弟子没有师父带', INVENTED_PERSON), undefined],
  [inventedHerbName('凝露草、青叶参这些'), '青叶参'],
  [inventedHerbName('山里只有凝露草'), undefined],
  // 第三轮自测里的几句：
  [inventedMention('道友说什么？食堂？咱们这儿没饭堂，灶房在院子西头', INVENTED_PLACE), undefined],
  [inventedMention('你要真缺，跟管事的说一声', INVENTED_PERSON), '管事'],
  [OUTER_OFFICIAL.test('执事住西排头一间，门上挂着木牌呢'), true],
  [OUTER_OFFICIAL.test('执事堂在内门，平时见不着'), false],
  [roomClaimWrong('东排北头住着个谨慎行脚弟子，常在山里走', 'life:q6:local_gatherer'), '谨慎行脚弟子'],
  [roomClaimWrong('我住西排第二间，挨着井，好打水', 'life:q6:local_gatherer'), undefined],
  [roomClaimWrong('西排头一间就是我的屋', 'life:q6:emergency'), undefined],
  [roomClaimWrong('我住东边第三间', 'life:q6:seller'), '卖药弟子'],
  [PROMISE.test('那道友稍坐，我去灶房把米淘了'), true],
  // 第四轮：否认在名字后头。
  [inventedHerbName('青叶参？没听说过，咱这儿只有凝露草'), undefined],
  // 第五轮：检查自己误报的几句（不算编），和真编了的两句。
  [flagsOf('青叶参？没听过这名儿，山里就长凝露草'), ''],
  [flagsOf('凝露草长在药圃里。青叶参这名儿我没听过。'), ''],
  [flagsOf('柴也是轮着劈，院里贴了单子，谁当值谁劈。'), ''],
  [flagsOf('柴堆空了就找当值的同门说一声，当值的人天天换。'), ''],
  [flagsOf('丹房重地，历来不对外门开。要寻什么，去坊市问河湾掌柜。', 'life:q6:guard'), ''],
  [flagsOf('近道倒是有，绕药圃后头那条小径，能省些脚程，就是草深路滑', 'life:q6:merchant'), 'route'],
  [flagsOf('各处都是三刻钟上下，没有近道。'), ''],
  [flagsOf('空着的是东排第四间，留给新来的道友。', 'life:q6:cultivator'), 'room'],
  [flagsOf('西排第四间空着，留给新来的道友。', 'life:q6:cultivator'), ''],
  // 第六轮：说守卫当值、说大家平常做什么、说内门的管事，都不算编；"回来帮你问问"是答应了事。
  [flagsOf('丹房守备处有守卫当值，外门弟子进不去，管事的都是内门那边的人。', 'life:q6:local_gatherer'), ''],
  [flagsOf('无非是采药、当值、接些委托，闲时打坐参悟。', 'life:q6:cultivator'), ''],
  [flagsOf('柴火轮着劈。道友要是急着用，我待会儿修炼回来帮你问问。'), 'promise'],
  [inventedHerbName('歇着，或者上山转转，认认草。人多的地方不去。'), undefined],
  // 第二轮里两句照实否认的（检查原先误报）；逗号后的"没"不算否认。
  [inventedMention('没听说什么食堂。生活院有公用灶房', INVENTED_PLACE), undefined],
  [inventedMention('道友说的是饭堂吧？山里没有饭堂', INVENTED_PLACE), undefined],
  [inventedMention('去饭堂吃吧，没多远', INVENTED_PLACE), '饭堂'],
  // 第七轮：人名里的"采药"、"师父在内门"不算；"回头帮你问问"是答应了事。
  [flagsOf('嗯，去问问就清楚了。我待会儿还得去寻远行采药人说点事，先歇口气。', 'life:q6:local_gatherer', { next: { kind: 'talk', stay: false, personName: '远行采药人' } }), ''],
  [flagsOf('我待会儿还得去寻远行采药人说点事。', 'life:q6:local_gatherer'), '远行采药人'],
  [flagsOf('没有。外门弟子都是自己摸索着修，师父在内门才有。', 'life:q6:cultivator'), ''],
  [flagsOf('道友新来的？我住东排第三间，回头帮你问问。'), 'promise'],
  [PROMISE.test('灶房谁都能用，你要搭伙也成'), false],
  // v1.8 生活常识自测：漏掉的答应、走路时辰、姓名；误判了的否认。
  [flagsOf('缺什么言语一声，我搭把手。'), 'promise'],
  [flagsOf('道友问这个，是想找谁？我待会儿修炼，顺路能领你过去。'), 'promise'],
  [flagsOf('从这亭子回生活院，脚程快些小半刻钟吧。'), 'route'],
  [flagsOf('从这亭子下去，脚程三刻钟上下，没近道。'), ''],
  [flagsOf('青叶参？山里只有凝露草，长在药圃，冬天还不长呢。'), ''],
  [flagsOf('青叶参？我这铺子里没有。山里只长凝露草。', 'life:q6:merchant'), ''],
  [flagsOf('青石坊市药铺的掌柜，姓河湾，收灵草、卖丹药都找他。'), 'name'],
  [flagsOf('道友贵姓？'), ''],
  // 说别人在做的事、说大家怎么帮衬，不算他自己的事，也不算答应；说自己做了，照旧要对得上。
  [flagsOf('听说是在外头采药时沾上的，具体伤成什么样我也不清楚。'), ''],
  [flagsOf('还不是他当值时拦我路，说药篓子得先过他的眼。', 'life:q6:seller'), ''],
  [flagsOf('缺了就在院里喊一声，同门搭把手。'), ''],
  [flagsOf('我今早去后山坡采药了。'), String(/采药(?!人)|采灵草|挖药/u)],
  // 第二轮生活常识自测：柴房是编的，"多做一口"是约吃饭，"没草可采"不是草名。
  [flagsOf('院子后头柴房堆着，劈好的拿去用就是。'), 'place'],
  [flagsOf('饿了就过来，我灶上常多做一口。'), 'promise'],
  [flagsOf('冬天没草可采，就省着花呗。'), ''],
  // 检查里的住处和对话规则里的是同一份。
  [JSON.stringify(ROOMS) === JSON.stringify(DIALOGUE_ROOMS_Q6), true],
];
const f3Wrong = f3.filter(([got, want]) => got !== want);
check('F3 检查照着常识单：有的不算编，没有的算编，照实否认不算编', f3Wrong.length === 0, f3Wrong.length === 0 ? `${f3.length} 句都对` : JSON.stringify(f3Wrong));

// —— 第七节 G1–G2（v1.8）：说出口前核对、常识粘住 ——
// 假的 AI：按顺序回写好的话，并记下每次收到的消息（看重说时有没有带上"哪里不对"）。
function scriptedModel(replies) {
  const asked = [];
  const model = async (messages) => {
    asked.push(messages);
    const reply = replies[Math.min(asked.length - 1, replies.length - 1)];
    return { text: JSON.stringify({ reply, end: false, tone: 'neutral' }), usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 900, completion_tokens: 20 }, ms: 1 };
  };
  return { model, asked };
}
// 头一回见药圃弟子（第 11 天上午），说一句规则接不住、要交给 AI 的话；AI 按写好的话回。
async function guardTalk(replies, { actorId = LOCAL, line = '这山里怎么样？' } = {}) {
  const { model, asked } = scriptedModel(replies);
  const player = newPlayerRecord();
  const tick = t(11, 10);
  const situation = world.situationAt(actorId, tick, player);
  const conversation = openConversation({ persona: DIALOGUE_PERSONAS[actorId], situation, player, used: new Set(), seedKey: `${SEED}:guard:${replies[0]}`, tick, asleep: false });
  await playerSays(conversation, line, { live: true, deepseek: model, suppressClose: true });
  const turn = conversation.turns.filter((entry) => entry.speaker === 'npc' && entry.by === 'ai').at(-1);
  return { turn, asked };
}
const cleanGuard = await guardTalk(['这几天天还算晴，山里也安静。']);
const retriedGuard = await guardTalk(['道友新来的？回头帮你问问。', '道友新来的？这事我也说不准。']);
const fallbackGuard = await guardTalk(['我住东排第三间。', '我住东排头一间。']);
const retryAsk = retriedGuard.asked[1] ?? [];
check(
  'G1a 说出口前核对：对的话不拦；答应了事的拦下、带着"哪里不对"重说一次，重说对了用重说的',
  cleanGuard.turn?.text === '这几天天还算晴，山里也安静。' && !cleanGuard.turn?.ai?.guard && cleanGuard.asked.length === 1 &&
    retriedGuard.turn?.text === '道友新来的？这事我也说不准。' && retriedGuard.turn.ai.guard?.outcome === 'retried' &&
    retriedGuard.turn.ai.guard.flagged.includes('promise') && retryAsk.length === 4 && retryAsk[2].role === 'assistant' &&
    /不能在话里答应/u.test(retryAsk[3].content) && retriedGuard.turn.ai.usage.prompt_tokens === 2000 && retriedGuard.turn.ai.calls?.length === 2,
  `对的：${cleanGuard.turn?.text}（调了 ${cleanGuard.asked.length} 次）；拦下：${retriedGuard.turn?.ai?.guard?.blocked} → ${retriedGuard.turn?.text}；提示：${retryAsk[3]?.content}`,
);
check(
  'G1b 重说还不对，换成规则的话；被拦下的两句玩家都听不到',
  fallbackGuard.turn?.ai?.guard?.outcome === 'fallback' && fallbackGuard.turn.ai.rejected === 'dialogue_reply_guarded' &&
    !/东排/u.test(fallbackGuard.turn.text) && fallbackGuard.turn.ai.guard.retryFlagged.includes('room'),
  `拦下：${fallbackGuard.turn?.ai?.guard?.blocked}；重说：${fallbackGuard.turn?.ai?.guard?.retryRaw}；说出口的：${fallbackGuard.turn?.text}`,
);
// 检查器认得的几类错，各写一句（药圃弟子头一回见、身上没灵草的处境下都是错的），都要被拦下。
const G1_CASES = [
  ['promise', '跟我来，我带你去看看。'],
  ['room', '我住东排第三间。'],
  ['route', '从这儿抄近道过去，快得很。'],
  ['person', '这事你去问管事吧。'],
  ['herb', '后山坡长着青叶参。'],
  ['memory', '上回你不是来过一趟吗？'],
  ['place', '饿了就去饭堂吃。'],
];
const g1Missed = [];
for (const [kind, text] of G1_CASES) {
  const { turn } = await guardTalk([text, '这个我也说不准。']);
  if (!turn?.ai?.guard?.flagged.includes(kind) || turn.text !== '这个我也说不准。') g1Missed.push(`${kind}：${text} → ${turn?.text}（${turn?.ai?.guard?.flagged?.join('、') ?? '没拦'}）`);
}
check('G1c 检查器认得的几类错都被拦下：答应、住处、近道、管事、草名、往事、没有的地方', g1Missed.length === 0, g1Missed.length === 0 ? `${G1_CASES.length} 类都拦下了` : g1Missed.join('；'));

// G2：常识粘住几句、每句有预算。
const factTopicOf = (fact) => DIALOGUE_LIFE_FACTS_Q6.find((entry) => entry.fact === fact)?.topic;
let sticky = [];
const stickyTopics = [];
for (const line of ['谁住你隔壁？', '那北头那间呢？', '他平时忙啥？', '这几天天气不错。']) {
  const step = lifeFactsForLine({ playerLine: line, sticky });
  sticky = step.sticky;
  stickyTopics.push(step.facts.map(factTopicOf).join('、') || '不带');
}
const twoShort = lifeFactsForLine({ playerLine: '山里有啥草？坊市怎么走？' }).facts.map(factTopicOf);
const twoLong = lifeFactsForLine({ playerLine: '这山里怎么吃饭？谁住你隔壁？' }).facts.map(factTopicOf);
const budgetOk = (facts) => facts.reduce((sum, fact) => sum + estimateSocialPromptTokens([{ content: fact }]), 0) <= LIFE_FACT_BUDGET_TOKENS;
// 引擎里：粘着的常识进了提示词；新的一段对话不带上一段的。
async function dryTalk(lines) {
  const player = newPlayerRecord();
  const tick = t(11, 10);
  const situation = world.situationAt(LOCAL, tick, player);
  const conversation = openConversation({ persona: DIALOGUE_PERSONAS[LOCAL], situation, player, used: new Set(), seedKey: `${SEED}:sticky:${lines[0]}`, tick, asleep: false });
  for (const line of lines) await playerSays(conversation, line, { live: false, suppressClose: true });
  return conversation.turns.filter((turn) => turn.ai?.prompt).map((turn) => turn.ai.prompt.user);
}
const roomFact = DIALOGUE_LIFE_FACTS_Q6.find((entry) => entry.topic === 'rooms').fact;
const engineSticky = await dryTalk(['谁住你隔壁？', '那北头那间呢？']);
const freshTalk = await dryTalk(['那北头那间呢？']);
check(
  'G2 常识粘住两句、每句不超过约 150 token；新的一段对话不带上一段的',
  stickyTopics.join(' / ') === 'rooms / rooms / rooms / 不带' &&
    twoShort.join('、') === 'herbs、routes' && budgetOk(lifeFactsForLine({ playerLine: '山里有啥草？坊市怎么走？' }).facts) &&
    twoLong.join('、') === 'food' &&
    engineSticky.at(-1)?.includes(roomFact) === true && freshTalk.every((user) => !user.includes(roomFact)),
  `逐句：${stickyTopics.join(' / ')}；两条短的：${twoShort.join('、')}；两条长的：${twoLong.join('、')}；引擎里追问带上住处：${engineSticky.at(-1)?.includes(roomFact)}；新一段不带：${freshTalk.every((user) => !user.includes(roomFact))}`,
);

let failed = 0;
for (const result of results) {
  if (!result.pass) failed += 1;
  process.stdout.write(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}\n     ${result.detail}\n`);
}
process.stdout.write(`\n${results.length - failed}/${results.length} 通过\n`);
process.exit(failed > 0 ? 1 : 0);

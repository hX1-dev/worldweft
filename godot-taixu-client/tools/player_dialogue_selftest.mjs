#!/usr/bin/env node

// 玩家对话自测：在开着的试玩窗口（本机 127.0.0.1:8766，真调 DeepSeek）上，用它的接口当玩家，按天推着时间走，
// 和真人在窗口里玩走的是同一条路（同一个服务、同一套规则、同一份记录）。
//   --plan guided：按剧情把每样功能跑一遍——骂人、翻脸、旁人听见、隔天冷着、道歉、再道歉、记得聊过的事、淡掉——
//                  每一步都对照该有的结果打 PASS/FAIL；前提没出现的（他先走了、找不到人）记"没测到"，不算通过。
//   --plan free  ：让 DeepSeek 演一个调皮、爱试探的玩家，自己找话说，隔天再去；只记下对话，供逐句评判。
//   --plan topics：同上，但专问山里过日子的事（吃、住、路、灵草、买卖、管事），对照常识单逐句评判（v1.7）。
//                  演玩家要 DeepSeek key（环境变量 XIANXIA_PI_NPC_DEEPSEEK_API_KEY，用 run_with_key.ps1 传进来）。
// 跑之前先把窗口重启一次，好从第 10 天 10:00、谁都不认识道友开始。对话和判定写进 .logs/player-dialogue/selftest/。
//   node godot-taixu-client/tools/player_dialogue_selftest.mjs --plan guided

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const BASE = option('base') ?? 'http://127.0.0.1:8766';
const PLAN = option('plan') ?? 'guided';
const ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(ROOT, '.logs/player-dialogue/selftest');

// —— 窗口接口 ——
async function api(path, body) {
  const response = await fetch(`${BASE}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status} ${data.message ?? ''}`);
  return data;
}
const getState = async () => (await api('/api/state')).state;
const session = (state) => JSON.parse(readFileSync(resolve(ROOT, state.sessionFile), 'utf8'));

const transcript = [];
const results = [];
function expect(id, pass, detail = '') {
  results.push({ id, pass: Boolean(pass), detail });
}
// 前提没出现（他先走了、找不到人、AI 没判无礼）：记"没测到"，不算通过。
function expectIf(id, ran, pass, detail = '') {
  results.push({ id, pass: ran ? Boolean(pass) : null, detail: detail ?? '' });
}
let people = {};

// 走到某人身边，说这几句（他收尾就停），说完走开。返回这一段：开口、每句、谁说的、好感度、怎么收的尾。
async function visit(name, lines) {
  const before = await getState();
  people = Object.fromEntries(before.people.map((person) => [person.name, person]));
  const person = people[name];
  if (!person) throw new Error(`no_such_person ${name}`);
  const entry = { name, day: before.time.day, clock: before.time.clock, attitude: person.attitude, relationshipBefore: person.relationship };
  const approached = await api('/api/approach', { actorId: person.actorId });
  if (!approached.ok) {
    entry.refused = approached.message;
    transcript.push(entry);
    return entry;
  }
  let state = approached.state;
  for (const line of lines) {
    if (state.current?.closedBy) break;
    const said = await api('/api/say', { text: line });
    if (!said.ok) throw new Error(`say_failed ${said.message}`);
    state = said.state;
  }
  entry.turns = state.current?.turns ?? [];
  entry.closedBy = state.current?.closedBy ?? null;
  entry.relationshipAfter = state.current?.relationship;
  entry.attitudeAfter = state.current?.attitude;
  await api('/api/leave', {});
  transcript.push(entry);
  return entry;
}
// 找得到人为止：找不到就往后挪一个钟头再找，最多挪三回。
async function visitWhenThere(name, lines) {
  for (let tries = 0; tries < 4; tries += 1) {
    const entry = await visit(name, lines);
    if (!entry.refused) return entry;
    await api('/api/time', { action: 'hour' });
  }
  return transcript.at(-1);
}
// 这几句一定要说完：他先收了尾（AI 可以自己结束谈话），过一个钟头再去，把没说的接着说，最多去四回。
async function sayAll(name, lines) {
  let left = [...lines];
  const visits = [];
  for (let tries = 0; tries < 4 && left.length > 0; tries += 1) {
    const entry = await visit(name, left);
    visits.push(entry);
    const said = (entry.turns ?? []).filter((turn) => turn.speaker === 'player').length;
    left = left.slice(said);
    if (left.length > 0) await api('/api/time', { action: 'hour' });
  }
  return { visits, left };
}
const npcTurns = (entry) => (entry.turns ?? []).filter((turn) => turn.speaker === 'npc');
const replyTo = (entry, line) => {
  const index = (entry.turns ?? []).findIndex((turn) => turn.speaker === 'player' && turn.text === line);
  return index >= 0 ? entry.turns.slice(index + 1).find((turn) => turn.speaker === 'npc') : undefined;
};
const deltaOf = (entry, line) => (entry.turns ?? []).find((turn) => turn.speaker === 'player' && turn.text === line)?.affinity?.delta;
const opening = (entry) => (entry.turns?.[0]?.speaker === 'npc' && entry.turns[0].source?.phrase === 'open' ? entry.turns[0] : undefined);
async function nextMorning() {
  await api('/api/time', { action: 'next_morning' });
}
async function coldNow(except) {
  const state = await getState();
  return state.people.filter((person) => person.name !== except && ['cold', 'hostile'].includes(person.attitude)).map((person) => person.name);
}

// —— 按剧情跑一遍（过关标准第四、五节，外加 v1.5 的修正和自测里找出的毛病）——
async function guided() {
  const start = await getState();
  if (start.stats.conversations > 0 || start.time.day !== 10) throw new Error('restart_the_window_first');

  // 第 10 天上午。先找返山弟子：表白、自称是妖、说明天请吃红烧肉、说明天再来（放在骂人之前，免得她当场听见、冷着你）。
  // 她可能听了表白就走开，那就隔个钟头再去，把剩下的说完。
  const flirt = await sayAll('返山弟子', ['你好呀', '我有点喜欢你', '其实我是妖', '明天我请你吃红烧肉吧', '明天我再来找你']);
  // 河湾掌柜（松风歇脚亭）：没报名字先问"我叫什么"；"听说你会算数？"是问他，不是要新鲜事；想买药、要买下铺子、久仰。
  const shop = await visit('河湾掌柜', ['掌柜好', '我叫什么', '听说你会算数？', '我想买药', '我准备买下这家店', '久仰久仰', 'bye']);
  expectIf('v1.5 没报过名字，问"我叫什么"答没报过', Boolean(replyTo(shop, '我叫什么')), replyTo(shop, '我叫什么')?.source?.phrase === 'nameUnknown', replyTo(shop, '我叫什么')?.text);
  expectIf(
    '自测修正 "听说你会算数？"是问他，交给 AI，不回"没什么新鲜事"',
    Boolean(replyTo(shop, '听说你会算数？')),
    replyTo(shop, '听说你会算数？')?.source?.kind === 'ai',
    replyTo(shop, '听说你会算数？')?.text,
  );
  expectIf(
    'v1.5 bye、久仰由规则接',
    Boolean(replyTo(shop, 'bye')),
    replyTo(shop, '久仰久仰')?.source?.phrase === 'praised' && replyTo(shop, 'bye')?.source?.phrase === 'farewell',
    `${replyTo(shop, '久仰久仰')?.text} / ${replyTo(shop, 'bye')?.text}`,
  );
  // 守静弟子：说句规则认不出的难听话（AI 判了无礼才算数），第二天看他记不记得。
  const rudeTalk = await visit('守静弟子', ['你好', '你这人像块木头一样']);
  const rudeDelta = deltaOf(rudeTalk, '你这人像块木头一样');
  // 卖药弟子：报名字、问新鲜事，然后用英文骂一句、再威胁一句（骂两句会正好降到 −20 不理你的线上，第二天冷不冷看运气）。
  const insult = await visit('卖药弟子', ['你好，我叫阿明。', '最近有什么新鲜事？', 'fuck you', '小心我揍你', '对不起']);
  expect(
    'D1 先斥责，再骂就翻脸走开（规则说）',
    replyTo(insult, 'fuck you')?.source?.phrase === 'rebuke' && insult.closedBy === 'npc_angry' && npcTurns(insult).at(-1)?.source?.phrase === 'stormOff',
    insult.closedBy,
  );
  expect('v1.5 英文骂人算骂人', deltaOf(insult, 'fuck you') === -10, `fuck you → ${deltaOf(insult, 'fuck you')}`);
  // 冷着你的人里，除去被你说过难听话的守静弟子，就是当场听见骂人的。
  const witnesses = (await coldNow('卖药弟子')).filter((name) => !(name === '守静弟子' && rudeDelta !== undefined && rudeDelta < 0));
  const heard = (await getState()).stats.rumorHeardBy;
  expect('D5 同一处只有最多两个人当场听见', witnesses.length <= 2 && heard <= 2, `当场听见：${witnesses.join('、') || '没人'}（统计 ${heard} 人）`);
  const again = await visit('卖药弟子', ['喂']);
  expect('翻脸走开的人当天找不到', Boolean(again.refused), again.refused ?? '还能找到');
  // 当场听见的人（有的话）：先开口的话说"我都看见了"；跟他道歉，他让你去找卖药弟子。
  if (witnesses.length > 0) {
    const witness = await visit(witnesses[0], ['对不起，我不该骂人']);
    const reply = replyTo(witness, '对不起，我不该骂人');
    expect('D7 跟听见的人道歉：让你去跟被骂的人说', reply?.source?.phrase === 'apologyElsewhere' && reply.text.includes('卖药弟子'), `${opening(witness)?.text ?? '（没先开口）'} / ${reply?.text}`);
    const opened = opening(witness);
    expectIf('自测修正 当场看见的人说"看见了"，不说"听说"', opened?.source?.openReason === 'accuse', /看见|瞧见/u.test(opened?.text ?? ''), opened?.text ?? '（没先开口）');
  } else {
    expectIf('D7 跟听见的人道歉：让你去跟被骂的人说', false, false, '这回没人当场听见');
  }

  let memory = session(await getState()).players;
  const flirtLog = memory[people['返山弟子'].actorId]?.memoryLog ?? {};
  const shopLog = memory[people['河湾掌柜'].actorId]?.memoryLog ?? {};
  expectIf(
    'E1 从原话里认出要紧的事',
    flirt.left.length === 0 && Boolean(replyTo(shop, '久仰久仰')),
    ['向我表白过', '说自己是妖', '说要请我吃东西', '说过还会再来找我'].every((item) => flirtLog[item]) && shopLog['问过我买药'] && shopLog['说要买下我的铺子'] && shopLog['夸过我'],
    `返山弟子分 ${flirt.visits.length} 回说完，记得：${Object.keys(flirtLog).join('、')}；掌柜记得：${Object.keys(shopLog).join('、')}`,
  );

  // —— 第 11 天上午 ——
  await nextMorning();
  const heardNextDay = (await getState()).stats.rumorHeardBy;
  const cold = await visit('卖药弟子', ['你好', '对不起，昨天是我不对', '还记得我吗？', '还记得我吗？', '对不起']);
  expect('D4 隔天还冷着你：不先开口，问好是冷的', cold.attitude === 'cold' && !opening(cold) && replyTo(cold, '你好')?.source?.phrase === 'greetCold', `${cold.attitude}；${replyTo(cold, '你好')?.text}`);
  expect(
    'D7 道歉收下，好感 +3',
    replyTo(cold, '对不起，昨天是我不对')?.source?.phrase === 'apologyAccepted' && deltaOf(cold, '对不起，昨天是我不对') === 3,
    `${replyTo(cold, '对不起，昨天是我不对')?.text}（${deltaOf(cold, '对不起，昨天是我不对')}）`,
  );
  expectIf('D4 记得你骂过、威胁过他', Boolean(replyTo(cold, '还记得我吗？')), /骂|威胁/u.test(replyTo(cold, '还记得我吗？')?.text ?? ''), replyTo(cold, '还记得我吗？')?.text);
  const coldRuleLines = npcTurns(cold).filter((turn) => turn.source?.kind === 'rule' && turn.text.length > 6).map((turn) => turn.text);
  expectIf('自测修正 同一段话里，规则不说一字不差的长句', coldRuleLines.length > 1, new Set(coldRuleLines).size === coldRuleLines.length, coldRuleLines.join(' / '));
  const sorry = (cold.turns ?? []).filter((turn) => turn.speaker === 'player' && turn.text === '对不起');
  expectIf('D7 同一天再道歉：说过了，好感不变', sorry.length > 0, (sorry.at(-1)?.affinity?.delta ?? 0) === 0, npcTurns(cold).at(-1)?.text);
  expect('D5 流言跟着来往慢慢传开（只增不减）', heardNextDay >= heard, `第 10 天 ${heard} 人，第 11 天 ${heardNextDay} 人`);

  const back = await visit('返山弟子', ['又见面了', '我上回说我是什么来着？', '你还记得我说要请你吃什么吗？', '还记得我吗？', '好，改天见']);
  const open11 = opening(back);
  expectIf('E3 隔天见面若先开口提往事，先说"还真来了"', open11?.source?.openReason === 'recall', /来/u.test(open11?.text ?? ''), open11?.text ?? '（没先开口）');
  expectIf('E3 AI 答得出"我上回说我是什么"', Boolean(replyTo(back, '我上回说我是什么来着？')), /妖/u.test(replyTo(back, '我上回说我是什么来着？')?.text ?? ''), replyTo(back, '我上回说我是什么来着？')?.text);
  expectIf(
    '自测修正 "你还记得我说要请你吃什么吗"交给 AI，不拿"还记得我吗"的话答',
    Boolean(replyTo(back, '你还记得我说要请你吃什么吗？')),
    replyTo(back, '你还记得我说要请你吃什么吗？')?.source?.kind === 'ai',
    replyTo(back, '你还记得我说要请你吃什么吗？')?.text,
  );
  expectIf('E3 问"还记得我吗"，规则答一件要紧的往事', Boolean(replyTo(back, '还记得我吗？')), /表白|妖|请/u.test(replyTo(back, '还记得我吗？')?.text ?? ''), replyTo(back, '还记得我吗？')?.text);
  // 河湾掌柜：报名字、再问"我叫什么"；硬说昨天谈过灵芝（没这回事）；问他还记不记得我昨天问了啥。
  const named = await visitWhenThere('河湾掌柜', ['我叫阿明', '我叫什么', '掌柜的，昨天说好的那株灵芝还有么', '你还记得我昨天问你啥了不']);
  expectIf('v1.5 报过名字，问"我叫什么"答名字', Boolean(replyTo(named, '我叫什么')), /阿明/u.test(replyTo(named, '我叫什么')?.text ?? ''), replyTo(named, '我叫什么')?.text);
  const lingzhi = replyTo(named, '掌柜的，昨天说好的那株灵芝还有么');
  expectIf('自测修正 硬说"昨天说好的灵芝"：规则说没这回事，不顺着认', Boolean(lingzhi), lingzhi?.source?.phrase === 'denyClaim', lingzhi?.text);
  // 守静弟子：昨天被说像木头。冷着你的话，问记不记得，他说的是那句难听话。
  const rudeNext = await visitWhenThere('守静弟子', ['还记得我吗？']);
  expectIf(
    '自测修正 AI 判了无礼的话也记着，冷着你时说起',
    rudeDelta !== undefined && rudeDelta < 0 && rudeNext.attitude === 'cold' && Boolean(replyTo(rudeNext, '还记得我吗？')),
    /难听|无礼|骂|冲/u.test(replyTo(rudeNext, '还记得我吗？')?.text ?? ''),
    `昨天那句好感 ${rudeDelta ?? '—'}；今天 ${rudeNext.attitude}；${replyTo(rudeNext, '还记得我吗？')?.text ?? rudeNext.refused ?? '（没说上话）'}`,
  );
  // 药圃弟子：头一回见，只说几句闲话（不说要紧事），明天问还认不认得。只是听说你骂了人而冷着的，问好不该是"你来了"。
  const firstMeet = await visitWhenThere('药圃弟子', ['你好呀', '你平时都忙些啥呀', '那你歇着吧']);
  const firstGreet = replyTo(firstMeet, '你好呀');
  expectIf(
    '自测修正 没见过面、只听说了你骂人而冷着的：问好不说"是你""你来了"',
    firstMeet.attitude === 'cold' && Boolean(firstGreet),
    firstGreet?.source?.phrase === 'greetColdStranger',
    firstGreet?.text ?? `（${firstMeet.attitude}）`,
  );

  // —— 第 12 天上午 ——
  await nextMorning();
  const day12 = await visitWhenThere('返山弟子', ['你好']);
  const open12 = opening(day12);
  expectIf('E3 每件只提一次：第 12 天不再"还真来了"、不再提昨天聊过的往事', Boolean(open12), !/来了|表白|妖/u.test(open12?.text ?? ''), open12?.text ?? '（没先开口）');
  const plain = await visitWhenThere('药圃弟子', ['早啊，还认得我不？', '你还记得我昨天问你啥了不']);
  expectIf('自测修正 见过面、没说什么要紧事，也记得来过', Boolean(replyTo(plain, '早啊，还认得我不？')), !/见过吗|面生/u.test(replyTo(plain, '早啊，还认得我不？')?.text ?? ''), replyTo(plain, '早啊，还认得我不？')?.text);
  const accused = opening(plain);
  expectIf('自测修正 隔了两天才当面问骂人的事，不说"刚才"', accused?.source?.openReason === 'accuse', !/刚才/u.test(accused?.text ?? ''), accused?.text ?? '（没先开口问）');
  const again12 = await visitWhenThere('卖药弟子', ['对不起']);
  expectIf(
    'v1.5 同一回骂人赔过了，隔天再赔也不加分',
    Boolean(replyTo(again12, '对不起')),
    (deltaOf(again12, '对不起') ?? 0) <= 0 && replyTo(again12, '对不起')?.source?.phrase !== 'apologyAccepted',
    `${replyTo(again12, '对不起')?.text ?? again12.refused ?? '（没说上话）'}（${deltaOf(again12, '对不起') ?? 0}）`,
  );

  // —— 第 19 天：表白（60 天）还记得；规则层的记录不删 ——
  await api('/api/time', { action: 'set', day: 19, hour: 10 });
  const lateFlirt = await visitWhenThere('返山弟子', ['还记得我吗？']);
  expectIf('E4 九天后表白还记得（记 60 天）', Boolean(replyTo(lateFlirt, '还记得我吗？')), /表白|妖|请/u.test(replyTo(lateFlirt, '还记得我吗？')?.text ?? ''), replyTo(lateFlirt, '还记得我吗？')?.text);
  memory = session(await getState()).players;
  const keptLog = memory[people['返山弟子'].actorId]?.memoryLog ?? {};
  expect('E4 规则层的记录不删', Boolean(keptLog['说过还会再来找我']), `返山弟子的记录：${Object.keys(keptLog).join('、')}`);
}

// —— 让 DeepSeek 演一个调皮的玩家，自己找话说 ——
const PLAYER_STYLE = [
  '你在玩一个修仙题材的游戏，扮演刚进山门的外门弟子阿明，在跟山里的人聊天。你是来试探这些人像不像真人的玩家。',
  '说话很短，常常只有几个字，口语，偶尔打错字、偶尔夹英文；什么都可能说：寒暄、问他在干嘛、打听消息、开玩笑、表白、',
  '自称是妖或者太子、问奇怪的问题（比如会不会做算术）、嫌他啰嗦骂一句、骂完又道歉、说明天再来。',
  '每次只说一句话，不超过十五个字，不加引号，不解释。',
].join('');
async function playerLine(goal, lines) {
  const key = process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY;
  if (!key) throw new Error('deepseek_key_missing');
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      temperature: 1.0,
      max_tokens: 40,
      messages: [
        { role: 'system', content: PLAYER_STYLE },
        { role: 'user', content: `${goal}\n刚才：\n${lines.slice(-6).join('\n') || '（还没说话）'}\n你接下来说：` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`player_model_${response.status}`);
  const body = await response.json();
  return String(body.choices?.[0]?.message?.content ?? '').trim().replace(/^["“「]|["”」]$/gu, '').split('\n')[0].slice(0, 30) || '嗯';
}
async function freeVisit(name, goal, turns = 6) {
  const state = await getState();
  const person = state.people.find((entry) => entry.name === name);
  const entry = { name, day: state.time.day, clock: state.time.clock, attitude: person?.attitude, goal };
  const approached = await api('/api/approach', { actorId: person.actorId });
  if (!approached.ok) {
    entry.refused = approached.message;
    transcript.push(entry);
    return entry;
  }
  let current = approached.state.current;
  for (let index = 0; index < turns && !current?.closedBy; index += 1) {
    const seen = (current?.turns ?? []).map((turn) => `${turn.speaker === 'player' ? '你' : name}：${turn.text}`);
    const line = await playerLine(`你在${current?.placeName ?? '山里'}，找${name}（${current?.role ?? ''}）说话。${goal}`, seen);
    const said = await api('/api/say', { text: line });
    current = said.state.current;
  }
  entry.turns = current?.turns ?? [];
  entry.closedBy = current?.closedBy ?? null;
  await api('/api/leave', {});
  transcript.push(entry);
  return entry;
}
async function free() {
  const start = await getState();
  if (start.stats.conversations > 0 || start.time.day !== 10) throw new Error('restart_the_window_first');
  const cast = ['返山弟子', '卖药弟子', '重诺弟子', '药圃弟子', '丹房守卫'];
  for (const name of cast) await freeVisit(name, '第一次见他，随你怎么聊。');
  await freeVisit('河湾掌柜', '第一次见他，随你怎么聊。');
  await nextMorning();
  for (const name of [...cast, '河湾掌柜']) await freeVisit(name, '昨天跟他聊过，看看他还记不记得你说过的话，再随便聊聊。', 5);
}

// —— 专问山里的日子（v1.7 常识单）：吃、住、路、灵草、买卖、管事，每回只问一样，可以追问 ——
async function topics() {
  const start = await getState();
  if (start.stats.conversations > 0 || start.time.day !== 10) throw new Error('restart_the_window_first');
  // 每人先问的不一样（第三轮里扮玩家的 AI 七个人都先问"食堂在哪"，路、灵草、买卖、管事几乎没问到）。
  const leads = [
    ['返山弟子', '谁住哪间、你自己（新来的）住哪'],
    ['卖药弟子', '药铺卖什么、多少钱'],
    ['重诺弟子', '谁管杂事、有没有管事'],
    ['药圃弟子', '山里有什么灵草、青叶参哪有'],
    ['丹房守卫', '能不能进丹房、各处怎么走'],
    ['河湾掌柜', '各处怎么走、多远'],
    ['疲惫弟子', '在哪吃饭、口粮怎么领'],
    ['守静弟子', '有没有师父带、长老在哪'],
  ];
  const goalFor = (lead) =>
    `这回专问山里过日子的事，先从${lead}问起，之后可以换着问别的：吃饭、住处、怎么走、灵草、药铺、谁管杂事、丹房、师父。每次只问一样，可以顺着他的话追问，也可以故意问得刁一点（比如"食堂在哪""你住几号院""青叶参哪有""管事叫啥"）。`;
  const missed = [];
  for (const [name, lead] of leads) {
    const entry = await freeVisit(name, goalFor(lead), 6);
    if (entry.refused) missed.push([name, lead]);
  }
  // 当时找不到的（在路上、走开了），过三个时辰再找一回。
  if (missed.length > 0) {
    await api('/api/time', { action: 'set', day: 10, hour: 13 });
    for (const [name, lead] of missed) {
      transcript.splice(transcript.findIndex((entry) => entry.name === name && entry.refused), 1);
      await freeVisit(name, goalFor(lead), 6);
    }
  }
}

// —— 跑、写记录 ——
if (PLAN === 'guided') await guided();
else if (PLAN === 'free') await free();
else if (PLAN === 'topics') await topics();
else throw new Error(`unknown_plan ${PLAN}`);

const final = await getState();
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const lines = [`# 自测 · ${PLAN} · ${stamp}`, '', `记录：${final.sessionFile}`, ''];
if (results.length > 0) {
  lines.push('## 判定', '');
  for (const result of results) {
    const mark = result.pass === null ? '没测到' : result.pass ? 'PASS' : 'FAIL';
    lines.push(`- ${mark} ${result.id}${result.detail ? `：${result.detail}` : ''}`);
  }
  lines.push('');
}
lines.push('## 对话', '');
for (const entry of transcript) {
  lines.push(`### 第 ${entry.day} 天 ${entry.clock} · ${entry.name}（${entry.attitude ?? '—'}）${entry.goal ? ` · ${entry.goal}` : ''}`, '');
  if (entry.refused) {
    lines.push(`（找不到他：${entry.refused}）`, '');
    continue;
  }
  for (const turn of entry.turns) {
    const who = turn.speaker === 'player' ? '你' : entry.name;
    const source = turn.source ? (turn.source.kind === 'rule' ? ` 〔规则·${turn.source.openReason ?? turn.source.phrase ?? ''}〕` : ` 〔AI${turn.source.fallback ? '·没回上' : ''}〕`) : '';
    const affinity = turn.affinity && turn.affinity.delta ? ` 〔好感 ${turn.affinity.delta > 0 ? '+' : ''}${turn.affinity.delta} → ${turn.affinity.after}〕` : '';
    lines.push(`- ${who}：${turn.text}${source}${affinity}`);
  }
  lines.push(`- （${entry.closedBy ?? '玩家走开'}）`, '');
}
const stats = final.stats;
lines.push(
  '## 统计',
  '',
  `对话 ${stats.conversations} 段，玩家 ${stats.playerLines} 句，NPC ${stats.npcLines} 句（规则 ${stats.ruleLines}，AI ${stats.aiLines}，${Math.round((stats.aiShare ?? 0) * 100)}%），` +
    `每段 token ${Math.round(stats.meanTokens ?? 0)}（全价 ${Math.round(stats.meanUncached ?? 0)}），缓存命中 ${Math.round((stats.cacheHitShare ?? 0) * 100)}%，` +
    `AI 用时中位 ${((stats.p50Ms ?? 0) / 1000).toFixed(1)} 秒、最慢 ${((stats.maxMs ?? 0) / 1000).toFixed(1)} 秒，没回上 ${stats.fallbacks} 句；` +
    `骂人 ${stats.offenses} 句、翻脸 ${stats.stormOffs} 回、不理你 ${stats.refusals} 回、听说的 ${stats.rumorHeardBy} 人；自动检查对不上 ${stats.checkIssues} 处` +
    `${stats.checkDetails.length > 0 ? `（${stats.checkDetails.map((issue) => `${issue.npc}「${issue.text}」${issue.mention}`).join('；')}）` : ''}。`,
);
const outPath = resolve(OUT_DIR, `${stamp}-${PLAN}.md`);
writeFileSync(outPath, `${lines.join('\n')}\n`);
const failed = results.filter((result) => result.pass === false).length;
const skipped = results.filter((result) => result.pass === null).length;
process.stdout.write(`${outPath}\n${results.length - failed - skipped}/${results.length} PASS，没测到 ${skipped}\n`);
for (const result of results.filter((entry) => entry.pass !== true)) {
  process.stdout.write(`${result.pass === null ? '没测到' : 'FAIL'} ${result.id}：${result.detail}\n`);
}

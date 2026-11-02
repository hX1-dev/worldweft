#!/usr/bin/env node

// 《NPC 人性过关标准》I5 采访与 S4 编年史：从主世界的真实日志里抽出事实单，
// 让模型只按事实以 NPC 身份回答 5 个问题，以及以史官身份写编年史；
// 同时生成盲评包（事实单、NPC 版本、真人对照的空白模板、评分表）。
//   node godot-taixu-client/tools/humanity_interviews.mjs --log <rules-full-s1.jsonl> [--live]
// --live 需要环境变量 XIANXIA_PI_NPC_DEEPSEEK_API_KEY；不加则只生成事实单和提示词。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const LOG = option('log');
const LIVE = args.includes('--live');
if (!LOG) throw new Error('usage: --log <purpose soak jsonl> [--live]');
const ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(ROOT, '.logs/humanity-eval');
// --tag human：第二轮（拟人生活 v1）的材料写到自己的文件和子目录里，不覆盖第一轮。
const TAG = option('tag');
const PACKET_DIR = resolve(ROOT, TAG ? `docs/人性盲评包/${TAG === 'human' ? '第二轮_拟人生活v1' : TAG}` : 'docs/人性盲评包');
const HOURS_PER_TICK = 0.25;
// 河湾掌柜最近三天没有任何动作（只在等顾客），换成会与人来往的返山弟子。
const INTERVIEWEES = ['life:q6:remote_gatherer', 'life:q6:quester', 'life:q6:emergency'];

const ACTORS = {
  'life:q6:cultivator': { name: '守静弟子', role: '内门弟子', traits: '中庸、权力' },
  'life:q6:tired': { name: '疲惫弟子', role: '外门弟子', traits: '无私、义气' },
  'life:q6:seller': { name: '卖药弟子', role: '外门弟子', traits: '利己、名声' },
  'life:q6:remote_gatherer': { name: '远行采药人', role: '外门弟子', traits: '中庸、孤僻' },
  'life:q6:local_gatherer': { name: '药圃弟子', role: '外门弟子', traits: '无私、天伦' },
  'life:q6:quester': { name: '重诺弟子', role: '外门弟子', traits: '正直、义气' },
  'life:q6:merchant': { name: '河湾掌柜', role: '坊市掌柜', traits: '利己、名声' },
  'life:q6:guard': { name: '丹房守卫', role: '守卫', traits: '正直、忠贞' },
  'life:q6:explorer': { name: '谨慎行脚弟子', role: '外门弟子', traits: '中庸、孤僻' },
  'life:q6:emergency': { name: '返山弟子', role: '外门弟子', traits: '中庸、爱家' },
};
const LOCATIONS = {
  mountain_gate: '山门生活院',
  herb_field: '凝露药圃',
  market: '青石坊市',
  rest_pavilion: '松风歇脚亭',
  alchemy_room: '丹房守备处',
};
const QUESTIONS = [
  ['自我认知', '说说你自己：你是个什么样的人？'],
  ['记忆', '这三天你都做了些什么？'],
  ['计划', '明天打算做什么？为什么？'],
  ['反应', '要是明早去药圃，发现灵草又被人采光了，你会怎么办？'],
  ['反思', '这几天有什么让你在意、或者让你想了想的事？'],
];

const records = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const lastTick = Math.max(...records.filter((record) => typeof record.tick === 'number').map((record) => record.tick));

function clock(tick) {
  const hours = tick * HOURS_PER_TICK;
  const day = Math.floor(hours / 24) + 1;
  const minutes = Math.round((hours % 24) * 60);
  return { day, text: `第${day}天 ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
}

function actionText(event, terminal) {
  const target = event.targetActorId ? (ACTORS[event.targetActorId]?.name ?? event.targetActorId) : undefined;
  const where = LOCATIONS[event.fromLocationId] ?? event.fromLocationId;
  const outcome = terminal ? (terminal.status === 'completed' || terminal.status === 'arrived' ? '' : `（${terminal.status === 'blocked' ? '没成' : terminal.status}）`) : '';
  switch (event.actionType) {
    case 'travel':
      return `从${where}前往${LOCATIONS[event.targetLocationId] ?? event.targetLocationId}${outcome}`;
    case 'cultivate':
      return `在${where}修炼${outcome}`;
    case 'rest':
      return `在${where}歇息${outcome}`;
    case 'gather':
      return `在${where}采灵草${outcome}`;
    case 'trade':
      return `在${where}把灵草卖给药铺${outcome}`;
    case 'talk':
      return `在${where}和${target ?? '人'}说话${outcome}`;
    case 'gift':
      return `在${where}送东西给${target ?? '人'}${outcome}`;
    case 'use_item':
      return `在${where}服了药${outcome}`;
    case 'accept_request':
      return `在${where}接下一桩采药委托${outcome}`;
    case 'turn_in_request':
      return `在${where}交付委托${outcome}`;
    case 'explore':
      return `在${where}四处查看${outcome}`;
    case 'inspect':
      return `在${where}巡查${outcome}`;
    default:
      return `在${where}${event.actionType}${outcome}`;
  }
}

const nameOf = (actorId) => ACTORS[actorId]?.name ?? actorId;

// 一件事按某人知道的那个版本说出来（拟人生活：吵架、赔不是、送礼、交委托、受伤、见到奇事）。
function newsText(record) {
  const subject = nameOf(record.subjectActorId);
  const object = record.objectActorId ? nameOf(record.objectActorId) : '';
  const worse = record.newsExaggerated === true;
  switch (record.newsKind) {
    case 'quarrel':
      return worse ? `${subject}和${object}吵得差点动手，是${subject}先挑的事` : `${subject}和${object}吵了一架，是${subject}先说的重话`;
    case 'apology':
      return `${subject}向${object}赔了不是`;
    case 'gift':
      return worse ? `${subject}送了${object}好几株灵草` : `${subject}送了${object}一株灵草`;
    case 'commission':
      return `${subject}交了${object}的采药委托`;
    case 'injury':
      return worse ? `${subject}被药瘴伤得很重` : `${subject}被药瘴伤了`;
    case 'sighting':
      return worse ? `${subject}在山门外看见一群白鹿` : `${subject}在山门外看见一头白鹿`;
    default:
      return `${subject}${record.newsKind}`;
  }
}

function factLines(actorId, fromTick, toTick) {
  const terminals = new Map(
    records.filter((record) => record.type === 'action_terminal').map((record) => [record.actionId, record]),
  );
  const failures = records.filter(
    (record) =>
      record.type === 'goal_terminal' &&
      record.actorId === actorId &&
      record.status === 'failed' &&
      record.tick >= fromTick &&
      record.tick <= toTick,
  );
  const lines = [];
  // 拟人生活的日志里还有：夜里睡下（intentional_idle 'sleeping'），别人来找他说话、送他东西。
  let where;
  let asleep = false;
  for (const record of records) {
    if (record.actorId === actorId && record.type === 'action_terminal' && record.finalLocationId) {
      where = record.finalLocationId;
    }
    if (record.tick < fromTick || record.tick > toTick) continue;
    if (record.type === 'action_selected' && record.actorId === actorId) {
      asleep = false;
      lines.push({ tick: record.tick, text: `${clock(record.tick).text} ${actionText(record, terminals.get(record.actionId))}` });
    } else if (record.type === 'intentional_idle' && record.actorId === actorId && record.reasonCode === 'sleeping') {
      if (!asleep) lines.push({ tick: record.tick, text: `${clock(record.tick).text} 在${LOCATIONS[where] ?? '住处'}睡下` });
      asleep = true;
    } else if (
      record.type === 'action_selected' &&
      record.targetActorId === actorId &&
      (record.actionType === 'talk' || record.actionType === 'gift') &&
      terminals.get(record.actionId)?.status === 'completed'
    ) {
      const who = ACTORS[record.actorId]?.name ?? record.actorId;
      lines.push({
        tick: record.tick,
        text: `${clock(record.tick).text} ${record.actionType === 'gift' ? `${who}送了你一株灵草` : `${who}来找你说话`}`,
      });
    } else if (
      record.type === 'social_event' &&
      (record.actorId === actorId || record.targetActorId === actorId)
    ) {
      const mine = record.actorId === actorId;
      const who = nameOf(mine ? record.targetActorId : record.actorId);
      const text =
        record.reasonCode === 'quarrel'
          ? mine
            ? `和${who}话不投机，你先说了重话，吵了一架`
            : `和${who}话不投机，${who}先说了重话，吵了一架`
          : mine
            ? `向${who}赔了不是`
            : `${who}来向你赔了不是`;
      lines.push({ tick: record.tick, text: `${clock(record.tick).text} ${text}` });
    } else if (record.type === 'news_heard' && record.actorId === actorId && record.newsSource !== 'direct') {
      const text =
        record.newsSource === 'witness'
          ? `亲眼看见：${newsText(record)}`
          : record.corrected
            ? `${nameOf(record.fromActorId)}跟你说，其实是：${newsText(record)}`
            : `听${nameOf(record.fromActorId)}说：${newsText(record)}`;
      lines.push({ tick: record.tick, text: `${clock(record.tick).text} ${text}` });
    }
  }
  for (const failure of failures) {
    const reason = failure.reasonCode === 'purpose_goal_source_missing' ? '到了才发现要找的东西已经没了，白跑一趟' : '打算的事没办成';
    lines.push({ tick: failure.tick, text: `${clock(failure.tick).text} ${reason}` });
  }
  // 连续重复的同一件事合并成"……（连续 N 次）"，免得流水账淹没事实。
  lines.sort((left, right) => left.tick - right.tick);
  const merged = [];
  for (const line of lines) {
    const body = line.text.replace(/^第\d+天 \d\d:\d\d /u, '');
    const previous = merged.at(-1);
    if (previous && previous.body === body) {
      previous.count += 1;
      previous.until = line.text.slice(0, line.text.indexOf(' ', 4));
      continue;
    }
    merged.push({ text: line.text, body, count: 1 });
  }
  return merged.map((line) => (line.count > 1 ? `${line.text}（之后又连续 ${line.count - 1} 次）` : line.text));
}

const ACTION_WORDS = {
  cultivate: '修炼',
  rest: '歇息',
  travel: '走动赶路',
  gather: '采灵草',
  trade: '卖药',
  talk: '交谈',
  gift: '赠物',
  use_item: '服药',
  accept_request: '接委托',
  turn_in_request: '交付委托',
  explore: '查看',
  inspect: '巡查',
};

function chronicleFacts() {
  const facts = [];
  const byWeek = new Map();
  for (const record of records) {
    if (record.type !== 'action_selected') continue;
    const week = Math.floor((record.tick * HOURS_PER_TICK) / (24 * 7)) + 1;
    const bucket = byWeek.get(week) ?? new Map();
    const key = record.actionType;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
    byWeek.set(week, bucket);
  }
  const totalDays = (lastTick * HOURS_PER_TICK) / 24;
  for (const [week, counts] of [...byWeek.entries()].sort((left, right) => left[0] - right[0])) {
    // 最后一周不满七天时写明天数，免得把次数少当成出了事。
    const daysInWeek = Math.min(7, totalDays - (week - 1) * 7);
    const label = daysInWeek < 7 ? `第${week}周（只记了${Math.round(daysInWeek * 10) / 10}天）` : `第${week}周`;
    facts.push(`${label}：全山合计${[...counts.entries()].sort((left, right) => right[1] - left[1]).map(([kind, count]) => `${ACTION_WORDS[kind] ?? kind} ${count} 次`).join('，')}`);
  }
  const notable = records.filter(
    (record) =>
      (record.type === 'action_selected' && ['talk', 'gift', 'accept_request', 'turn_in_request', 'trade'].includes(record.actionType)) ||
      (record.type === 'goal_terminal' && record.status === 'failed') ||
      (record.type === 'causal_change' && record.reasonCode === 'world_event'),
  );
  const talkPairs = new Map();
  for (const record of notable) {
    if (record.type === 'action_selected' && record.actionType === 'talk' && record.targetActorId) {
      const key = `${ACTORS[record.actorId]?.name ?? record.actorId}→${ACTORS[record.targetActorId]?.name ?? record.targetActorId}`;
      talkPairs.set(key, (talkPairs.get(key) ?? 0) + 1);
    }
  }
  facts.push(`谈话最多的几对：${[...talkPairs.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([pair, count]) => `${pair} ${count} 次`).join('，') || '无'}`);
  const requestEvents = notable.filter((record) => record.type === 'action_selected' && ['accept_request', 'turn_in_request'].includes(record.actionType));
  for (const record of requestEvents) {
    facts.push(`${clock(record.tick).text} ${ACTORS[record.actorId]?.name ?? record.actorId}${record.actionType === 'accept_request' ? '接下了采药委托' : '交付了采药委托'}`);
  }
  const failures = notable.filter((record) => record.type === 'goal_terminal');
  const failuresByActor = new Map();
  for (const record of failures) failuresByActor.set(record.actorId, (failuresByActor.get(record.actorId) ?? 0) + 1);
  facts.push(`白跑一趟（到了发现东西没了）的次数：${[...failuresByActor.entries()].map(([actorId, count]) => `${ACTORS[actorId]?.name ?? actorId} ${count} 次`).join('，') || '无'}`);
  const trades = notable.filter((record) => record.type === 'action_selected' && record.actionType === 'trade').length;
  facts.push(`整段时间里，灵草卖给药铺 ${trades} 次`);
  const terminals = new Map(
    records.filter((record) => record.type === 'action_terminal').map((record) => [record.actionId, record]),
  );
  const gifts = notable.filter(
    (record) =>
      record.type === 'action_selected' &&
      record.actionType === 'gift' &&
      terminals.get(record.actionId)?.status === 'completed',
  );
  if (gifts.length > 0) {
    facts.push(`赠物：${gifts.map((record) => `${clock(record.tick).text} ${ACTORS[record.actorId]?.name ?? record.actorId}送${ACTORS[record.targetActorId]?.name ?? record.targetActorId}一株灵草`).join('；')}`);
  }
  facts.push(...societyFacts());
  facts.push(...fixtureFacts());
  return facts;
}

// 拟人生活：吵架和赔不是、埋下的那件事怎么传开（谁说走了样、谁纠正了），以及最后众人眼里的名声。
function societyFacts() {
  const facts = [];
  const social = records.filter((record) => record.type === 'social_event');
  if (social.length > 0) {
    facts.push(`争执与和解：${social.map((record) => `${clock(record.tick).text} ${record.reasonCode === 'quarrel' ? `${nameOf(record.actorId)}先说了重话，和${nameOf(record.targetActorId)}吵了一架` : `${nameOf(record.actorId)}向${nameOf(record.targetActorId)}赔了不是`}`).join('；')}`);
  }
  const deer = records.filter((record) => record.type === 'news_heard' && record.newsId === 'event:q6:white_deer_sighting');
  if (deer.length > 0) {
    const steps = deer.map((record) =>
      record.newsSource === 'direct'
        ? `${clock(record.tick).text} ${nameOf(record.actorId)}独自看见`
        : `${clock(record.tick).text} ${nameOf(record.actorId)}听${nameOf(record.fromActorId)}${record.corrected ? '纠正说' : '说'}"${newsText(record)}"`,
    );
    facts.push(`一件传开的事：${steps.join('；')}`);
  }
  const lastNetwork = records.filter((record) => record.type === 'network' && record.rows.some((row) => row.trouble !== undefined)).at(-1);
  if (lastNetwork) {
    const names = [];
    for (const subject of Object.keys(ACTORS)) {
      const views = lastNetwork.rows.filter((row) => row.to === subject);
      const share = (test) => views.filter(test).length / Math.max(1, views.length);
      if (share((row) => row.trouble >= 1) >= 0.3) names.push(`${nameOf(subject)}被人说爱惹事`);
      else if (share((row) => row.warmth >= 1) >= 0.3) names.push(`${nameOf(subject)}被人说是热心肠`);
    }
    if (names.length > 0) facts.push(`到最后，${names.join('，')}`);
  }
  return facts;
}

// 脚本里的三件事（药价涨、药瘴、受伤）按日志里的时间写，不写死：拟人生活下它们挪到了第一天早上。
function fixtureFacts() {
  const miasma = records.filter(
    (record) => record.type === 'causal_change' && (record.sourceRef ?? '').startsWith('world_event:'),
  );
  const tradeTicks = new Set(
    records.filter((record) => record.type === 'action_terminal' && record.actionType === 'trade').map((record) => record.tick),
  );
  const quote = records.find(
    (record) =>
      record.type === 'causal_change' &&
      record.reasonCode === 'resource' &&
      !record.actorId &&
      (record.sourceRef ?? '').startsWith('shop:') &&
      !tradeTicks.has(record.tick),
  );
  const lines = [];
  if (quote) lines.push({ tick: quote.tick, text: `${clock(quote.tick).text} 药铺收药的价钱涨了一次` });
  if (miasma.length >= 2) {
    lines.push({
      tick: miasma[0].tick,
      text: `${clock(miasma[0].tick).text} 药圃一带起了一阵短暂的药瘴，${clock(miasma[1].tick).text} 散去；返山弟子因此受了伤`,
    });
  }
  return lines.sort((left, right) => left.tick - right.tick).map((line) => line.text);
}

// 模型有时把 json 包在代码块里或前后带字；先整体解析，再取最外层花括号，最后逐个抽字符串。
function parseAnswers(text) {
  const attempts = [text, text.match(/\{[\s\S]*\}/u)?.[0]].filter(Boolean);
  for (const attempt of attempts) {
    try {
      const answers = JSON.parse(attempt).answers;
      if (Array.isArray(answers) && answers.length > 0) return answers;
    } catch {
      // 下一种
    }
  }
  const strings = [...text.matchAll(/"((?:[^"\\]|\\.){4,})"/gu)].map((match) => match[1]).filter((value) => value !== 'answers');
  return strings.length >= 5 ? strings.slice(0, 5) : [text];
}

// 网络偶尔断：每次请求最多再试 3 次（间隔 3、8、15 秒）。
async function deepseek(messages, maxTokens) {
  let lastError;
  for (const delay of [0, 3_000, 8_000, 15_000]) {
    if (delay > 0) await new Promise((done) => setTimeout(done, delay));
    try {
      return await deepseekOnce(messages, maxTokens);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function deepseekOnce(messages, maxTokens) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    // 不开思考（与正式 NPC 的调用一致）；说话和写史留一点温度。
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      thinking: { type: 'disabled' },
      stream: false,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });
  if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
  const body = await response.json();
  return { text: body.choices?.[0]?.message?.content ?? '', usage: body.usage };
}

const windowFrom = lastTick - Math.round((72 / HOURS_PER_TICK));
const interviews = [];
for (const actorId of INTERVIEWEES) {
  const profile = ACTORS[actorId];
  const facts = factLines(actorId, windowFrom, lastTick);
  const system = [
    `你是${profile.name}，太虚界青岚山的${profile.role}，性格：${profile.traits}。`,
    '下面是你最近三天里真实经历的事（你做的事，以及别人来找你、送你东西），按时间排列。',
    '请用第一人称、像平常说话那样回答问题，每题 2 到 4 句。',
    '只能说这些经历里真实发生过的事；没发生过的事、没见过的人，一概不要编。',
    '只输出严格 json：{"answers":["第1题回答","第2题回答","第3题回答","第4题回答","第5题回答"]}',
  ].join('\n');
  const user = `你最近三天的经历：\n${facts.join('\n')}\n\n问题：\n${QUESTIONS.map(([, question], index) => `${index + 1}. ${question}`).join('\n')}`;
  let answers = null;
  let usage;
  if (LIVE) {
    const response = await deepseek([{ role: 'system', content: system }, { role: 'user', content: user }], 900);
    usage = response.usage;
    answers = parseAnswers(response.text);
  }
  interviews.push({ actorId, profile, facts, system, user, answers, usage });
}

const chronicle = { facts: chronicleFacts(), text: null, usage: undefined };
if (LIVE) {
  const response = await deepseek(
    [
      {
        role: 'system',
        content: [
          '你是青岚山的史官。下面是这一段时间山中真实发生过的事。',
          '请只根据这些事实写一段编年史，600 字以内，可以有文采、有取舍，但不得写出事实之外的人物和事件。',
        ].join('\n'),
      },
      { role: 'user', content: `出场的人：${Object.values(ACTORS).map((actor) => `${actor.name}（${actor.role}，${actor.traits}）`).join('；')}\n地点：${Object.values(LOCATIONS).join('、')}\n\n事实：\n${chronicle.facts.join('\n')}` },
    ],
    1400,
  );
  chronicle.text = response.text;
  chronicle.usage = response.usage;
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, `interviews${TAG ? `-${TAG}` : ''}${LIVE ? '-live' : ''}.json`), `${JSON.stringify({ log: LOG, windowFrom, lastTick, interviews, chronicle }, null, 2)}\n`);

// 盲评包：NPC 版本用代号，不写是谁生成的；真人对照留空白模板。
mkdirSync(resolve(PACKET_DIR, '采访'), { recursive: true });
mkdirSync(resolve(PACKET_DIR, '编年史'), { recursive: true });
const codes = ['甲', '乙', '丙'];
interviews.forEach((interview, index) => {
  const code = codes[index];
  writeFileSync(
    resolve(PACKET_DIR, '采访', `${code}_事实单.md`),
    `# 采访对象${code}：${interview.profile.name}\n\n身份：${interview.profile.role}；性格：${interview.profile.traits}\n\n## 最近三天真实发生的事\n\n${interview.facts.map((line) => `- ${line}`).join('\n')}\n\n## 五个问题\n\n${QUESTIONS.map(([kind, question], qIndex) => `${qIndex + 1}. （${kind}）${question}`).join('\n')}\n`,
  );
  writeFileSync(
    resolve(PACKET_DIR, '采访', `${code}_真人对照_待写.md`),
    `# 采访对象${code}（真人对照）\n\n请只看「${code}_事实单.md」，把自己当成${interview.profile.name}，用口语回答五个问题，每题 2 到 4 句。不要看别的版本。\n\n${QUESTIONS.map(([, question], qIndex) => `${qIndex + 1}. ${question}\n\n   答：\n`).join('\n')}`,
  );
  if (interview.answers) {
    writeFileSync(
      resolve(PACKET_DIR, '采访', `${code}_回答_版本1.md`),
      `# 采访对象${code} · 版本 1\n\n${QUESTIONS.map(([, question], qIndex) => `**${qIndex + 1}. ${question}**\n\n${interview.answers[qIndex] ?? '（无）'}\n`).join('\n')}`,
    );
  }
});
writeFileSync(
  resolve(PACKET_DIR, '编年史', '事实单.md'),
  `# 编年史事实单\n\n${chronicle.facts.map((line) => `- ${line}`).join('\n')}\n`,
);
writeFileSync(
  resolve(PACKET_DIR, '编年史', '真人对照_待写.md'),
  '# 编年史（真人对照）\n\n请只看「事实单.md」，以青岚山史官的口吻写一段编年史，600 字以内。不要看别的版本。\n\n',
);
if (chronicle.text) {
  writeFileSync(resolve(PACKET_DIR, '编年史', '版本1.md'), `# 编年史 · 版本 1\n\n${chronicle.text}\n`);
}
process.stdout.write(`${JSON.stringify({ interviews: interviews.map((entry) => ({ actorId: entry.actorId, facts: entry.facts.length, answered: Boolean(entry.answers) })), chronicleFacts: chronicle.facts.length, chronicleWritten: Boolean(chronicle.text) })}\n`);

#!/usr/bin/env node

// 《NPC 人性过关标准》v1 打分：从主世界、社交演化世界的日志，以及情景题、采访结果里取证，
// 按标准的过关线给分。
//   node godot-taixu-client/tools/humanity_score.mjs [--out score.json]
// 主世界日志：.logs/humanity-eval/rules-*.jsonl（完整版）、rules-memory-*、deepseek-memory-*；
//            .logs/ab-rules-vs-deepseek/deepseek-ab-*.jsonl（第二轮 DeepSeek 完整版）。
// 社交演化世界：.logs/humanity-eval/social-*.jsonl。

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const EVAL = resolve(ROOT, '.logs/humanity-eval');
const AB = resolve(ROOT, '.logs/ab-rules-vs-deepseek');
const HOURS_PER_TICK = 0.25;
const LONER = new Set(['life:q6:remote_gatherer', 'life:q6:explorer']);
// 守卫向守静弟子汇报当值是脚本写好的社交委托，不算自然交往。
const SCRIPTED_PAIRS = new Set(['life:q6:guard>life:q6:cultivator']);

const args = process.argv.slice(2);
// --set baseline：现有 NPC；--set human：打开拟人生活 v1 之后。
const SET = args.includes('--set') ? args[args.indexOf('--set') + 1] : 'baseline';
if (SET !== 'baseline' && SET !== 'human') throw new Error('usage: --set baseline|human');
const outPath = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : resolve(EVAL, SET === 'human' ? 'score-human.json' : 'score.json');

const list = (dir, prefix) =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl')).sort().map((name) => resolve(dir, name))
    : [];
const load = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const latestPerSeed = (paths) => {
  const bySeed = new Map();
  for (const path of paths) {
    const seed = path.match(/-(s\d)-/u)?.[1] ?? path;
    bySeed.set(seed, path);
  }
  return [...bySeed.values()];
};

const HUMAN = SET === 'human';
const worlds = {
  rulesFull: latestPerSeed(list(EVAL, HUMAN ? 'rules-human-ab-' : 'rules-ab-')),
  rulesMemory: latestPerSeed(list(EVAL, HUMAN ? 'rules-human-memory-ab-' : 'rules-memory-ab-')),
  // R2(b) 要看争吵 30 天后的态度：37 天的长测里只有头几天的争吵看得到，所以另跑 100 天（--run-tag long）。
  rulesLong: latestPerSeed(list(EVAL, HUMAN ? 'rules-human-long-ab-' : 'rules-long-ab-')),
  // 只作补充证据：DeepSeek 自己做决定时（A/B 那一臂）在"上次扑空"面前怎么选。
  deepseekMemory: latestPerSeed(list(EVAL, HUMAN ? 'deepseek-human-memory-ab-' : 'deepseek-memory-ab-')),
  social: list(EVAL, 'social-'),
  scenarios: resolve(EVAL, HUMAN ? 'scenarios-human.json' : 'scenarios.json'),
  interviews: resolve(EVAL, HUMAN ? 'interviews-human-live.json' : 'interviews-live.json'),
};
void AB;

// ---------------------------------------------------------------- 个人层

function goalRuns(records) {
  const byActor = new Map();
  for (const record of records) {
    if (record.type !== 'goal_terminal' || !(record.sourceRef ?? '').startsWith('resource:')) continue;
    if (record.status !== 'completed' && record.status !== 'failed') continue;
    const entries = byActor.get(record.actorId) ?? [];
    entries.push(record);
    byActor.set(record.actorId, entries);
  }
  let maxRun = 0;
  let failures = 0;
  let repeats = 0;
  for (const entries of byActor.values()) {
    let run = 0;
    let lastFailureTick = -Infinity;
    for (const entry of entries) {
      if (entry.status === 'failed') {
        failures += 1;
        run += 1;
        maxRun = Math.max(maxRun, run);
        if (entry.tick - lastFailureTick <= 24 / HOURS_PER_TICK) repeats += 1;
        lastFailureTick = entry.tick;
      } else {
        run = 0;
      }
    }
  }
  return { maxRun, failures, repeats, repeatRate: failures > 0 ? repeats / failures : 0 };
}

// 模型自己做的决定里：面前有"24 小时内在此扑空过"的采药选项时，模型和规则各有多少次仍然选它。
function modelLearning(records) {
  const offered = new Map();
  let turns = 0;
  let modelPicked = 0;
  let rulePicked = 0;
  for (const record of records) {
    if (record.type === 'decision_offered') offered.set(record.seq, record);
    if (record.type !== 'decision_resolved' || record.policy !== 'llm') continue;
    const offer = offered.get(record.seq);
    const recent = (offer?.candidates ?? []).filter((candidate) => {
      const last = candidate.resourceOutlook?.lastOutcome;
      return last && last.status === 'failed' && last.hoursAgo <= 24;
    });
    if (recent.length === 0) continue;
    turns += 1;
    if (recent.some((candidate) => candidate.candidateId === record.selectedCandidateId)) modelPicked += 1;
    if (recent.some((candidate) => candidate.candidateId === offer.defaultCandidateId)) rulePicked += 1;
  }
  return { turns, modelPicked, rulePicked };
}

function hourOf(tick) {
  return (tick * HOURS_PER_TICK) % 24;
}

const isNightHour = (hour) => hour >= 21 || hour < 6;

// 作息 (a) 按时长算：标准原文是"夜里的休息占全部休息的比例"，并以"夜晚占一天的 37.5%"
// 作对照，说的是时长。休息时长 = 休息动作从开始到结束，加上睡着的时段（intentional_idle
// 'sleeping'，到预定醒来或这个人的下一个动作、下一次停歇为止）。旧口径（数休息动作的次数）
// 一并给出，写作 nightRestShareByCount。
function restTime(records) {
  const started = new Map();
  const intervals = [];
  const lastIdle = new Map();
  const closeIdle = (actorId, tick) => {
    const idle = lastIdle.get(actorId);
    if (!idle) return;
    lastIdle.delete(actorId);
    const end = Math.min(tick, idle.untilTick);
    if (end > idle.tick) intervals.push({ actorId, from: idle.tick, to: end, kind: 'sleep' });
  };
  let lastTick = 0;
  for (const record of records) {
    if (typeof record.tick === 'number') lastTick = Math.max(lastTick, record.tick);
    if (!record.actorId) continue;
    if (record.type === 'action_selected') {
      closeIdle(record.actorId, record.tick);
      if (record.actionType === 'rest') started.set(record.actionId, record);
    } else if (record.type === 'action_terminal' && record.actionType === 'rest') {
      const start = started.get(record.actionId);
      if (start && record.tick > start.tick) intervals.push({ actorId: record.actorId, from: start.tick, to: record.tick, kind: 'rest' });
      started.delete(record.actionId);
    } else if (record.type === 'intentional_idle') {
      closeIdle(record.actorId, record.tick);
      if (record.reasonCode === 'sleeping' && Number.isFinite(record.untilGameHour)) {
        lastIdle.set(record.actorId, { tick: record.tick, untilTick: Math.round(record.untilGameHour / HOURS_PER_TICK) });
      }
    }
  }
  for (const actorId of [...lastIdle.keys()]) closeIdle(actorId, lastTick);
  let night = 0;
  let total = 0;
  let sleep = 0;
  for (const interval of intervals) {
    for (let tick = interval.from; tick < interval.to; tick += 1) {
      total += 1;
      if (isNightHour(hourOf(tick))) night += 1;
      if (interval.kind === 'sleep') sleep += 1;
    }
  }
  const actors = new Set(records.filter((record) => record.type === 'action_selected').map((record) => record.actorId)).size;
  const days = (lastTick * HOURS_PER_TICK) / 24;
  const perActorDay = (ticks) => (actors > 0 && days > 0 ? (ticks * HOURS_PER_TICK) / actors / days : 0);
  return {
    nightRestShare: total > 0 ? night / total : 0,
    restHoursPerActorDay: perActorDay(total),
    sleepIdleHoursPerActorDay: perActorDay(sleep),
  };
}

function rhythm(records) {
  let rest = 0;
  let nightRest = 0;
  const days = new Map();
  for (const record of records) {
    if (record.type !== 'action_selected') continue;
    const hour = hourOf(record.tick);
    if (record.actionType === 'rest') {
      rest += 1;
      if (isNightHour(hour)) nightRest += 1;
    }
    const day = Math.floor((record.tick * HOURS_PER_TICK) / 24);
    const key = `${record.actorId}|${day}`;
    const counts = days.get(key) ?? {};
    counts[record.actionType] = (counts[record.actionType] ?? 0) + 1;
    days.set(key, counts);
  }
  const similarities = [];
  for (const [key, counts] of days) {
    const [actorId, day] = key.split('|');
    const next = days.get(`${actorId}|${Number(day) + 1}`);
    if (next) similarities.push(cosine(counts, next));
  }
  return {
    ...restTime(records),
    nightRestShareByCount: rest > 0 ? nightRest / rest : 0,
    restActions: rest,
    daySimilarity: median(similarities),
  };
}

function persona(records) {
  const ticks = records.filter((record) => record.type === 'action_selected').map((record) => record.tick);
  const half = (Math.min(...ticks) + Math.max(...ticks)) / 2;
  const whole = new Map();
  const first = new Map();
  const second = new Map();
  for (const record of records) {
    if (record.type !== 'action_selected') continue;
    for (const [map, include] of [[whole, true], [first, record.tick < half], [second, record.tick >= half]]) {
      if (!include) continue;
      const counts = map.get(record.actorId) ?? {};
      counts[record.actionType] = (counts[record.actionType] ?? 0) + 1;
      map.set(record.actorId, counts);
    }
  }
  const actors = [...whole.keys()].sort();
  const between = [];
  for (let i = 0; i < actors.length; i += 1) {
    for (let j = i + 1; j < actors.length; j += 1) between.push(jsDivergence(whole.get(actors[i]), whole.get(actors[j])));
  }
  const within = actors.filter((actor) => first.get(actor) && second.get(actor)).map((actor) => jsDivergence(first.get(actor), second.get(actor)));
  const talkShare = Object.fromEntries(actors.map((actor) => {
    const counts = whole.get(actor);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return [actor, (counts.talk ?? 0) / total];
  }));
  const loner = actors.filter((actor) => LONER.has(actor)).map((actor) => talkShare[actor]);
  const others = actors.filter((actor) => !LONER.has(actor)).map((actor) => talkShare[actor]);
  return {
    between: mean(between),
    within: mean(within),
    ratio: mean(within) > 0 ? mean(between) / mean(within) : Infinity,
    lonerTalkShare: mean(loner),
    othersMedianTalkShare: median(others),
    traitCoherent: mean(loner) < median(others),
  };
}

// ---------------------------------------------------------------- 关系层与社会层

// 主世界：每日关系快照 → 每 7 天取一张，看朋友（好感 ≥ 25）、交恶（≤ -15）的成立与破裂。
function mainWorldBands(records) {
  const snapshots = records.filter((record) => record.type === 'network' && record.day % 7 === 0);
  if (snapshots.length < 2) return null;
  const band = (row) => (row.affinity >= 25 ? 'friendly' : row.affinity <= -15 ? 'hostile' : 'neutral');
  const transitions = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = new Map(snapshots[index - 1].rows.map((row) => [`${row.from}>${row.to}`, band(row)]));
    for (const row of snapshots[index].rows) {
      const before = previous.get(`${row.from}>${row.to}`) ?? 'neutral';
      const now = band(row);
      if (before !== now) transitions.push({ index, pair: `${row.from}>${row.to}`, from: before, to: now });
    }
  }
  const sustained = transitions.filter((transition) => {
    const next = snapshots[transition.index + 1];
    if (!next) return true;
    const [from, to] = transition.pair.split('>');
    const row = next.rows.find((entry) => entry.from === from && entry.to === to);
    return row && band(row) === transition.to;
  });
  const actors = new Set(snapshots[0].rows.map((row) => row.from)).size;
  const days = snapshots.at(-1).day - snapshots[0].day;
  const finalBands = { friendly: 0, hostile: 0, neutral: 0 };
  for (const row of snapshots.at(-1).rows) finalBands[band(row)] += 1;
  return {
    transitions: transitions.length,
    sustained: sustained.length,
    perActorPer90Days: days > 0 ? transitions.length / actors / (days / 90) : 0,
    sustainedPer30Days: days > 0 ? sustained.length / (days / 30) : 0,
    finalBands,
    days,
  };
}

// 主世界：谈话与赠礼的方向和次数（目标来自 action_selected.targetActorId）。
function mainWorldInteractions(records) {
  const interactions = [];
  for (const record of records) {
    if (record.type !== 'action_selected' || !record.targetActorId) continue;
    if (!['talk', 'gift', 'request_teaching', 'group_talk'].includes(record.actionType)) continue;
    interactions.push({ day: (record.tick * HOURS_PER_TICK) / 24, from: record.actorId, to: record.targetActorId, kind: record.actionType });
  }
  return interactions;
}

// 主世界 R2：每次争吵后，被冒犯者对冒犯者的态度（每日关系快照）和主动来往（谈话、送礼）。
// 快照 day d 是第 d 天开始时的状态：争吵前取 d，争吵后取 d+1，30 天后取 d+31。
function mainWorldGrudge(records) {
  const offenses = records.filter((record) => record.type === 'social_event' && record.reasonCode === 'quarrel');
  const apologies = records.filter((record) => record.type === 'social_event' && record.reasonCode === 'apology').length;
  if (offenses.length === 0) return { offenses: 0, apologies };
  const interactions = mainWorldInteractions(records);
  const byDay = new Map(records.filter((record) => record.type === 'network').map((network) => [network.day, network]));
  const edge = (network, from, to) => network?.rows.find((row) => row.from === from && row.to === to);
  let before = 0;
  let after = 0;
  let measuredDrop = 0;
  let dropped = 0;
  let measured30 = 0;
  let partial = 0;
  let full = 0;
  let none = 0;
  for (const offense of offenses) {
    const victim = offense.targetActorId;
    const offender = offense.actorId;
    const day = (offense.tick * HOURS_PER_TICK) / 24;
    const start = Math.floor(day);
    for (const entry of interactions) {
      if (entry.from !== victim || entry.to !== offender) continue;
      if (entry.day >= day - 7 && entry.day < day) before += 1;
      if (entry.day > day && entry.day <= day + 7) after += 1;
    }
    const pre = edge(byDay.get(start), victim, offender);
    const post = edge(byDay.get(start + 1), victim, offender);
    if (pre && post) {
      measuredDrop += 1;
      if (post.affinity < pre.affinity) dropped += 1;
    }
    const later = edge(byDay.get(start + 31), victim, offender);
    if (pre && post && later) {
      measured30 += 1;
      if (later.affinity > post.affinity && later.affinity < pre.affinity) partial += 1;
      else if (later.affinity >= pre.affinity) full += 1;
      else none += 1;
    }
  }
  return {
    offenses: offenses.length,
    apologies,
    victimInitiationsBefore: before,
    victimInitiationsAfter: after,
    attitudeDropped: dropped,
    measuredDrop,
    measured30,
    partialRecovery: partial,
    fullRecovery: full,
    noRecovery: none,
  };
}

// 主世界 R4：埋下的那件事（第 2 天 10:00 重诺弟子独自在山门外见到一头白鹿，只有他知道）
// 怎么传开；另附所有消息的走样和纠正。一开始就知道的（当事人、在场的人）不算"传到"：
// 传到率 = 3 天内经谈话得知的人 / 一开始不知道的人。
const PLANTED_NEWS_ID = 'event:q6:white_deer_sighting';
function mainWorldRumor(records) {
  const heard = records.filter((record) => record.type === 'news_heard');
  if (heard.length === 0) return null;
  const actors = new Set(records.filter((record) => record.type === 'action_selected').map((record) => record.actorId)).size || 10;
  const planted = heard.filter((record) => record.newsId === PLANTED_NEWS_ID);
  const told = heard.filter((record) => record.newsSource === 'told');
  const summary = {
    told: told.length,
    newlyDistorted: told.filter((record) => record.distortion).length,
    heldDistorted: told.filter((record) => record.distorted && !record.corrected).length,
    corrections: told.filter((record) => record.corrected).length,
  };
  if (planted.length === 0) return { planted: null, ...summary };
  const start = Math.min(...planted.map((record) => record.tick));
  const seeds = new Set(planted.filter((record) => record.newsSource !== 'told').map((record) => record.actorId));
  const by72 = new Set(planted.filter((record) => record.tick <= start + 72 / HOURS_PER_TICK).map((record) => record.actorId));
  const spread72 = [...by72].filter((actorId) => !seeds.has(actorId)).length;
  return {
    planted: {
      seeds: seeds.size,
      knowers72h: by72.size,
      knowersEnd: new Set(planted.map((record) => record.actorId)).size,
      spreadShare72h: actors - seeds.size > 0 ? spread72 / (actors - seeds.size) : 0,
      distorted: planted.some((record) => record.distorted),
      corrected: planted.some((record) => record.corrected),
    },
    ...summary,
  };
}

// 主世界 S2：众人眼里的名声（三成以上的人觉得他爱惹事 → 惹事；觉得他热心 → 热心肠），
// 以及印象变了以后，这个人主动找他的次数变没变（前后各 7 天；吵过架的两人不算，那是 R2）。
function mainWorldReputation(records) {
  const networks = records.filter((record) => record.type === 'network' && record.rows.some((row) => row.trouble !== undefined));
  if (networks.length < 2) return null;
  const subjects = [...new Set(networks[0].rows.map((row) => row.to))].sort();
  const label = (rows, subject) => {
    const views = rows.filter((row) => row.to === subject);
    const share = (test) => views.filter(test).length / Math.max(1, views.length);
    if (share((row) => row.trouble >= 1) >= 0.3) return '惹事';
    if (share((row) => row.warmth >= 1) >= 0.3) return '热心肠';
    return '无';
  };
  const labelChanges = [];
  for (const subject of subjects) {
    let previous = label(networks[0].rows, subject);
    for (const network of networks.slice(1)) {
      const now = label(network.rows, subject);
      if (now !== previous) labelChanges.push({ subject, day: network.day, from: previous, to: now });
      previous = now;
    }
  }
  const finalLabels = Object.fromEntries(subjects.map((subject) => [subject, label(networks.at(-1).rows, subject)]));
  const quarrelled = new Set(
    records
      .filter((record) => record.type === 'social_event' && record.reasonCode === 'quarrel')
      .flatMap((record) => [`${record.actorId}>${record.targetActorId}`, `${record.targetActorId}>${record.actorId}`]),
  );
  const interactions = mainWorldInteractions(records);
  const turns = { trouble: { pairs: 0, before: 0, after: 0 }, warmth: { pairs: 0, before: 0, after: 0 } };
  const seen = new Set();
  for (let index = 1; index < networks.length; index += 1) {
    const previous = new Map(networks[index - 1].rows.map((row) => [`${row.from}>${row.to}`, row]));
    for (const row of networks[index].rows) {
      const key = `${row.from}>${row.to}`;
      const prior = previous.get(key);
      for (const kind of ['trouble', 'warmth']) {
        if (seen.has(`${kind}:${key}`) || !prior || !(prior[kind] < 1 && row[kind] >= 1)) continue;
        seen.add(`${kind}:${key}`);
        if (quarrelled.has(key)) continue;
        const day = networks[index].day;
        turns[kind].pairs += 1;
        for (const entry of interactions) {
          if (entry.from !== row.from || entry.to !== row.to) continue;
          if (entry.day >= day - 7 && entry.day < day) turns[kind].before += 1;
          if (entry.day >= day && entry.day < day + 7) turns[kind].after += 1;
        }
      }
    }
  }
  // 众人那一层：某人第一次被公认"惹事"（或"热心肠"）之后，别人主动找他的次数（前后各 7 天）。
  const labelTurns = { 惹事: { subjects: 0, before: 0, after: 0 }, 热心肠: { subjects: 0, before: 0, after: 0 } };
  const firstLabel = new Set();
  for (const change of labelChanges) {
    if (!(change.to in labelTurns) || firstLabel.has(`${change.to}:${change.subject}`)) continue;
    firstLabel.add(`${change.to}:${change.subject}`);
    labelTurns[change.to].subjects += 1;
    for (const entry of interactions) {
      if (entry.to !== change.subject || entry.from === change.subject) continue;
      if (quarrelled.has(`${entry.from}>${entry.to}`)) continue;
      if (entry.day >= change.day - 7 && entry.day < change.day) labelTurns[change.to].before += 1;
      if (entry.day >= change.day && entry.day < change.day + 7) labelTurns[change.to].after += 1;
    }
  }
  const valuesChange = networks.some((network) =>
    network.rows.some((row) => row.trouble !== 0 || row.warmth !== 0));
  return { labelChanges: labelChanges.length, labelChangeList: labelChanges.slice(0, 12), finalLabels, valuesChange, turns, labelTurns };
}

function socialWorld(records) {
  const interactions = [];
  const helps = [];
  const assaults = [];
  const changes = [];
  const networks = [];
  let days = 360;
  for (const record of records) {
    if (record.type === 'run_started') days = record.days;
    if (record.kind === 'event') {
      const from = record.actorIds[0];
      const to = record.targetActorIds[0];
      if (from && to) interactions.push({ day: record.day, from, to, kind: record.type });
      if (record.type === 'gift_given' || record.type === 'request_resolved') helps.push({ day: record.day, from, to });
      if (record.type === 'teaching_resolved') helps.push({ day: record.day, from: to, to: from });
      if (record.type === 'combatant_defeated' || record.type === 'combat_attack_resolved') {
        assaults.push({ day: record.day, attacker: from, victim: to, eventId: record.eventId });
      }
    }
    if (record.kind === 'relationship_change') changes.push(record);
    if (record.kind === 'network') networks.push(record);
  }
  return { interactions, helps, assaults, changes, networks, days };
}

function reciprocity(helps, days) {
  if (helps.length < 5) return { helps: helps.length, ratio: null };
  const countByPair = new Map();
  for (const help of helps) countByPair.set(`${help.from}>${help.to}`, (countByPair.get(`${help.from}>${help.to}`) ?? 0) + 1);
  let observed = 0;
  let expected = 0;
  for (const help of helps) {
    const back = helps.some((other) => other.from === help.to && other.to === help.from && other.day > help.day && other.day <= help.day + 7);
    observed += Number(back);
    const rate = (countByPair.get(`${help.to}>${help.from}`) ?? 0) / days;
    expected += 1 - Math.exp(-rate * 7);
  }
  return { helps: helps.length, observedRate: observed / helps.length, expectedRate: expected / helps.length, ratio: expected > 0 ? observed / expected : null };
}

function grudge(world) {
  if (world.assaults.length === 0) return { assaults: 0 };
  let before = 0;
  let after = 0;
  let partial = 0;
  let measured = 0;
  for (const assault of world.assaults) {
    for (const interaction of world.interactions) {
      if (interaction.from !== assault.victim || interaction.to !== assault.attacker) continue;
      if (interaction.day >= assault.day - 14 && interaction.day < assault.day) before += 1;
      if (interaction.day > assault.day && interaction.day <= assault.day + 14) after += 1;
    }
    const prior = [...world.networks].filter((network) => network.day <= assault.day).at(-1);
    const later = world.networks.find((network) => network.day >= assault.day + 30);
    const change = world.changes.find((entry) => entry.eventId === assault.eventId && entry.fromActorId === assault.victim && entry.toActorId === assault.attacker);
    if (!prior || !later || !change) continue;
    const edge = (network) => network.rows.find((row) => row.from === assault.victim && row.to === assault.attacker);
    const beforeAffinity = edge(prior)?.affinity ?? 0;
    const rightAfter = beforeAffinity + (change.appliedDelta.affinity ?? 0);
    const laterAffinity = edge(later)?.affinity ?? 0;
    measured += 1;
    if (laterAffinity > rightAfter && laterAffinity < beforeAffinity) partial += 1;
  }
  return { assaults: world.assaults.length, victimInitiationsBefore: before, victimInitiationsAfter: after, measured, partialRecovery: partial };
}

function tieGini(interactions) {
  const actors = [...new Set(interactions.flatMap((entry) => [entry.from, entry.to]))];
  const ginis = [];
  for (const actor of actors) {
    const counts = actors.filter((other) => other !== actor).map((other) => interactions.filter((entry) => entry.from === actor && entry.to === other).length);
    if (counts.some((count) => count > 0)) ginis.push(gini(counts));
  }
  return { actors: actors.length, meanGini: mean(ginis) };
}

function bandOf(row) {
  if (row.affinity >= 15 && row.trust >= 3 && row.suspicion < 30) return 'friendly';
  if (row.affinity <= -15 || row.suspicion >= 30) return 'hostile';
  return 'neutral';
}

function bandTransitions(world) {
  const transitions = [];
  for (let index = 1; index < world.networks.length; index += 1) {
    const previous = new Map(world.networks[index - 1].rows.map((row) => [`${row.from}>${row.to}`, bandOf(row)]));
    for (const row of world.networks[index].rows) {
      const before = previous.get(`${row.from}>${row.to}`) ?? 'neutral';
      const now = bandOf(row);
      if (before !== now && (before !== 'neutral' || now !== 'neutral')) {
        transitions.push({ day: world.networks[index].day, pair: `${row.from}>${row.to}`, from: before, to: now, index });
      }
    }
  }
  // 持续：下一张快照仍在新状态。
  const sustained = transitions.filter((transition) => {
    const next = world.networks[transition.index + 1];
    if (!next) return true;
    const [from, to] = transition.pair.split('>');
    const row = next.rows.find((entry) => entry.from === from && entry.to === to);
    return row && bandOf(row) === transition.to;
  });
  const actors = world.networks[0]?.actors.length ?? 12;
  return { transitions: transitions.length, sustained: sustained.length, perActorPer90Days: transitions.length / actors / (world.days / 90), sustainedPer30Days: sustained.length / (world.days / 30) };
}

function repeatedCooperation(helps, days) {
  let windows = 0;
  for (let start = 0; start < days; start += 30) {
    const counts = new Map();
    for (const help of helps) {
      if (help.day < start || help.day >= start + 30) continue;
      const key = [help.from, help.to].sort().join('|');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    windows += [...counts.values()].filter((count) => count >= 3).length;
  }
  return windows / (days / 30);
}

function networkStructure(interactions, excludePairs = new Set()) {
  const counts = new Map();
  const nodes = new Set();
  for (const entry of interactions) {
    if (excludePairs.has(`${entry.from}>${entry.to}`)) continue;
    nodes.add(entry.from);
    nodes.add(entry.to);
    const key = [entry.from, entry.to].sort().join('|');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  if (values.length === 0) return { nodes: nodes.size, strongTies: 0 };
  const threshold = Math.max(3, values[Math.floor(values.length * 0.75)] ?? 3);
  const adjacency = new Map([...nodes].map((node) => [node, new Set()]));
  for (const [key, count] of counts) {
    if (count < threshold) continue;
    const [a, b] = key.split('|');
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const n = nodes.size;
  const edges = [...adjacency.values()].reduce((sum, set) => sum + set.size, 0) / 2;
  const density = n > 1 ? edges / ((n * (n - 1)) / 2) : 0;
  const local = [];
  for (const [node, neighbours] of adjacency) {
    const list = [...neighbours];
    if (list.length < 2) continue;
    let links = 0;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) if (adjacency.get(list[i]).has(list[j])) links += 1;
    }
    local.push(links / ((list.length * (list.length - 1)) / 2));
    void node;
  }
  const degrees = [...adjacency.values()].map((set) => set.size);
  return {
    nodes: n,
    threshold,
    strongTies: edges,
    density,
    clustering: mean(local),
    clusteringVsRandom: density > 0 ? mean(local) / density : null,
    maxDegreeVsMean: mean(degrees) > 0 ? Math.max(...degrees) / mean(degrees) : null,
  };
}

// ---------------------------------------------------------------- 打分

const points = {
  I1: (runs) => (runs.maxRun <= 2 && runs.repeatRate <= 0.2 ? 8 : runs.maxRun <= 4 || runs.repeatRate <= 0.5 ? 4 : 0),
  I2a: (share) => (share >= 0.6 ? 4 : share >= 0.45 ? 2 : 0),
  I2b: (sim) => (sim >= 0.5 && sim <= 0.9 ? 4 : (sim >= 0.35 && sim < 0.5) || (sim > 0.9 && sim <= 0.97) ? 2 : 0),
  I3a: (ratio) => (ratio >= 3 ? 4 : ratio >= 1.5 ? 2 : 0),
  I3b: (coherent) => (coherent ? 4 : 0),
  R1: (ratio) => (ratio === null ? 0 : ratio >= 2 ? 8 : ratio >= 1.3 ? 4 : 0),
  R3a: (g) => (g >= 0.4 ? 3 : 0),
  R3b: (per90) => (per90 === null ? 0 : per90 >= 1 ? 4 : per90 > 0 ? 2 : 0),
  S1a: (ratio) => (ratio !== null && ratio >= 1.5 ? 4 : 0),
  S1b: (ratio) => (ratio !== null && ratio >= 1.5 ? 4 : 0),
  S3: (per30) => (per30 >= 3 ? 7 : per30 >= 1 ? 3 : 0),
};

const evidence = {};
const merged = (paths) => paths.map(load);

const rulesFull = merged(worlds.rulesFull);
const rulesLong = merged(worlds.rulesLong);
const rulesMemory = merged(worlds.rulesMemory);
const deepseekMemory = merged(worlds.deepseekMemory);
const social = merged(worlds.social).map(socialWorld);
if (rulesFull.length === 0 || rulesMemory.length === 0) {
  throw new Error(`no main-world logs for set ${SET}`);
}

const perSeed = (runs, fn) => runs.map(fn);
evidence.I1 = {
  rules: perSeed(rulesMemory, goalRuns),
  modelDecides: perSeed(deepseekMemory, goalRuns),
  modelLearning: perSeed(deepseekMemory, modelLearning),
};
evidence.I2 = { rules: perSeed(rulesFull, rhythm) };
evidence.I3 = { rules: perSeed(rulesFull, persona) };
evidence.I4 = existsSync(worlds.scenarios) ? JSON.parse(readFileSync(worlds.scenarios, 'utf8')) : null;
evidence.I5 = existsSync(worlds.interviews) ? factCheck(JSON.parse(readFileSync(worlds.interviews, 'utf8'))) : null;

const mainInteractions = rulesFull.map(mainWorldInteractions);
const mainBands = rulesFull.map(mainWorldBands);
evidence.R1 = {
  main: mainInteractions.map((entries) => reciprocity(entries.filter((entry) => entry.kind === 'gift' || entry.kind === 'request_teaching'), 37.5)),
  social: social.map((world) => reciprocity(world.helps, world.days)),
};
evidence.R2 = {
  main: (rulesLong.length > 0 ? rulesLong : rulesFull).map(mainWorldGrudge),
  mainRunDays: rulesLong.length > 0 ? 100 : 37.5,
  standardRuns: rulesFull.map(mainWorldGrudge),
  social: social.map(grudge),
};
evidence.R4 = { main: rulesFull.map(mainWorldRumor) };
evidence.S2 = { main: rulesFull.map(mainWorldReputation) };
evidence.R3 = {
  main: mainInteractions.map((entries) => tieGini(entries.filter((entry) => !SCRIPTED_PAIRS.has(`${entry.from}>${entry.to}`)))),
  social: social.map((world) => ({ ...tieGini(world.interactions), ...bandTransitions(world) })),
};
evidence.S1 = {
  main: mainInteractions.map((entries) => networkStructure(entries, SCRIPTED_PAIRS)),
  social: social.map((world) => networkStructure(world.interactions)),
};
evidence.S3 = {
  main: mainInteractions.map((entries, index) => {
    const bands = mainBands[index];
    const helps = entries.filter((entry) => entry.kind === 'gift' || entry.kind === 'request_teaching');
    const cooperation = repeatedCooperation(helps, 37.5);
    return bands
      ? { sustainedTransitionsPer30Days: bands.sustainedPer30Days, repeatedCooperationPer30Days: cooperation, per30Days: bands.sustainedPer30Days + cooperation }
      : { per30Days: null, note: '这批日志没有关系快照' };
  }),
  social: social.map((world) => {
    const transitions = bandTransitions(world);
    const cooperation = repeatedCooperation(world.helps, world.days);
    return { sustainedTransitionsPer30Days: transitions.sustainedPer30Days, repeatedCooperationPer30Days: cooperation, per30Days: transitions.sustainedPer30Days + cooperation };
  }),
};

function factCheck(data) {
  const places = ['山门生活院', '凝露药圃', '青石坊市', '松风歇脚亭', '丹房守备处', '药圃', '坊市', '药铺', '丹房', '歇脚亭'];
  const people = ['守静弟子', '疲惫弟子', '卖药弟子', '远行采药人', '药圃弟子', '重诺弟子', '河湾掌柜', '丹房守卫', '谨慎行脚弟子', '返山弟子'];
  // 拟人生活的事实单里另有"睡下""某某送了你一株灵草"。
  const activities = { 采: ['采灵草'], 卖: ['卖给药铺'], 修炼: ['修炼'], 歇: ['歇息'], 睡: ['歇息', '睡下'], 说话: ['说话'], 聊: ['说话'], 送: ['送东西', '送了你'], 委托: ['委托'] };
  const rows = [];
  for (const interview of data.interviews) {
    if (!interview.answers) continue;
    const facts = interview.facts.join('\n');
    for (const index of [0, 1, 4]) {
      const answer = interview.answers[index] ?? '';
      for (const place of places) if (answer.includes(place)) rows.push({ actorId: interview.actorId, q: index + 1, mention: place, supported: facts.includes(place) || (place === '药铺' && facts.includes('药铺')) });
      for (const person of people) if (answer.includes(person) && person !== interview.profile.name) rows.push({ actorId: interview.actorId, q: index + 1, mention: person, supported: facts.includes(person) });
      for (const [word, accepted] of Object.entries(activities)) if (answer.includes(word)) rows.push({ actorId: interview.actorId, q: index + 1, mention: word, supported: accepted.some((fact) => facts.includes(fact)) });
    }
  }
  const supported = rows.filter((row) => row.supported).length;
  return { mentions: rows.length, supported, ratio: rows.length > 0 ? supported / rows.length : null, unsupported: rows.filter((row) => !row.supported) };
}

// ---------------------------------------------------------------- 汇总

const avg = (values) => mean(values.filter((value) => value !== null && Number.isFinite(value)));
const worse = (runs) => ({
  maxRun: Math.max(...runs.map((run) => run.maxRun)),
  repeatRate: avg(runs.map((run) => run.repeatRate)),
  failures: runs.reduce((sum, run) => sum + run.failures, 0),
});
// 两栏：规则决策（纯规则，不会说话）；规则决策 + DeepSeek 说话（正式游戏的组合：
// 规则做决定，DeepSeek 只负责采访回答和编年史）。第三栏是社交演化世界，只作参考。
const columns = ['rules', 'combo', 'social'];
const score = {};
const set = (item, column, value, detail) => {
  score[item] ??= {};
  score[item][column] = { points: value, detail };
};
const sameAsRules = new Set(['I1', 'I2', 'I3', 'I4', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3']);

{
  const runs = evidence.I1.rules;
  const summary = worse(runs);
  set('I1', 'rules', points.I1(summary), summary);
  const r = evidence.I2.rules;
  const share = avg(r.map((entry) => entry.nightRestShare));
  const sim = avg(r.map((entry) => entry.daySimilarity));
  set('I2', 'rules', points.I2a(share) + points.I2b(sim), {
    nightRestShare: share,
    nightRestShareByCount: avg(r.map((entry) => entry.nightRestShareByCount)),
    restHoursPerActorDay: avg(r.map((entry) => entry.restHoursPerActorDay)),
    daySimilarity: sim,
  });
  const p = evidence.I3.rules;
  const ratio = avg(p.map((entry) => entry.ratio));
  const coherent = p.filter((entry) => entry.traitCoherent).length * 2 > p.length;
  set('I3', 'rules', points.I3a(ratio) + points.I3b(coherent), { ratio, coherent, lonerTalk: avg(p.map((entry) => entry.lonerTalkShare)), othersTalk: avg(p.map((entry) => entry.othersMedianTalkShare)) });
}
if (evidence.I4) {
  set('I4', 'rules', evidence.I4.results.filter((entry) => entry.rulePass).length * 2, evidence.I4.results.map((entry) => `${entry.id}:${entry.rulePass ? '过' : '不过'}`).join(' '));
}
set('I5', 'rules', 0, '规则层不会说话');
if (evidence.I5) {
  const auto = evidence.I5.ratio !== null && evidence.I5.ratio >= 0.9 ? 2 : 0;
  set('I5', 'combo', auto, { factRatio: evidence.I5.ratio, mentions: evidence.I5.mentions, blind: '另有盲评 0–6 分' });
} else {
  set('I5', 'combo', null, '未生成采访');
}

const r1Main = avg(evidence.R1.main.map((entry) => entry.ratio));
set('R1', 'rules', points.R1(Number.isFinite(r1Main) ? r1Main : null), { helps: evidence.R1.main.map((entry) => entry.helps), ratio: Number.isFinite(r1Main) ? r1Main : null });
set('R1', 'social', points.R1(avg(evidence.R1.social.map((entry) => entry.ratio))), { ratio: avg(evidence.R1.social.map((entry) => entry.ratio)) });
{
  const rows = evidence.R2.main;
  const total = (key) => rows.reduce((sum, entry) => sum + (entry[key] ?? 0), 0);
  if (total('offenses') === 0) {
    set('R2', 'rules', 0, '主世界没有冲突');
  } else {
    // (a) 态度下降，且 7 天内主动找对方的次数不到之前的一半；(b) 30 天后部分恢复的比例。
    const dropShare = total('attitudeDropped') / Math.max(1, total('measuredDrop'));
    const before = total('victimInitiationsBefore');
    const after = total('victimInitiationsAfter');
    const avoid = dropShare >= 0.8 && before > 0 && after <= 0.5 * before;
    const measured30 = total('measured30');
    const partialShare = measured30 > 0 ? total('partialRecovery') / measured30 : null;
    set('R2', 'rules', (avoid ? 4 : 0) + (partialShare === null ? 0 : partialShare >= 0.5 ? 4 : partialShare > 0 ? 2 : 0), {
      runDays: evidence.R2.mainRunDays,
      offenses: rows.map((entry) => entry.offenses),
      apologies: rows.map((entry) => entry.apologies),
      attitudeDroppedShare: dropShare,
      victimInitiations7dBefore: before,
      victimInitiations7dAfter: after,
      measured30,
      partialRecoveryShare: partialShare,
      fullRecovery: total('fullRecovery'),
      noRecovery: total('noRecovery'),
    });
  }
}
const g = evidence.R2.social;
const avoid = g.reduce((sum, entry) => sum + (entry.victimInitiationsBefore ?? 0), 0) > g.reduce((sum, entry) => sum + (entry.victimInitiationsAfter ?? 0), 0);
const partialShare = g.reduce((sum, entry) => sum + (entry.partialRecovery ?? 0), 0) / Math.max(1, g.reduce((sum, entry) => sum + (entry.measured ?? 0), 0));
set('R2', 'social', (avoid ? 4 : 0) + (partialShare >= 0.5 ? 4 : partialShare > 0 ? 2 : 0), { avoidance: avoid, partialRecoveryShare: partialShare, assaults: g.map((entry) => entry.assaults) });
{
  const per90 = mainBands.every(Boolean) ? avg(mainBands.map((entry) => entry.perActorPer90Days)) : null;
  set('R3', 'rules', points.R3a(avg(evidence.R3.main.map((entry) => entry.meanGini))) + points.R3b(per90), {
    meanGini: avg(evidence.R3.main.map((entry) => entry.meanGini)),
    perActorPer90Days: per90 ?? '无关系快照',
    finalBands: mainBands[0]?.finalBands,
  });
}
set('R3', 'social', points.R3a(avg(evidence.R3.social.map((entry) => entry.meanGini))) + points.R3b(avg(evidence.R3.social.map((entry) => entry.perActorPer90Days))), { meanGini: avg(evidence.R3.social.map((entry) => entry.meanGini)), perActorPer90Days: avg(evidence.R3.social.map((entry) => entry.perActorPer90Days)) });
{
  const rows = evidence.R4.main.filter(Boolean);
  const planted = rows.map((entry) => entry.planted).filter(Boolean);
  if (planted.length === 0) {
    set('R4', 'rules', 0, '没有能跑的世界接入流言');
  } else {
    // 3 分：3 天内经谈话传到一开始不知道的人里的 ≥ 30%；4 分：埋下的事在多数 seed 里走了样又被纠正。
    const spread = avg(planted.map((entry) => entry.spreadShare72h));
    const both = planted.filter((entry) => entry.distorted && entry.corrected).length;
    const total = (key) => rows.reduce((sum, entry) => sum + (entry[key] ?? 0), 0);
    set('R4', 'rules', (spread >= 0.3 ? 3 : 0) + (both * 2 > planted.length ? 4 : 0), {
      spreadShare72h: spread,
      seeds: planted.map((entry) => entry.seeds),
      knowers72h: planted.map((entry) => entry.knowers72h),
      plantedDistortedAndCorrected: `${both}/${planted.length}`,
      allNewsTold: total('told'),
      allNewsNewlyDistorted: total('newlyDistorted'),
      allNewsCorrections: total('corrections'),
    });
  }
}
set('R4', 'social', 0, '没有能跑的世界接入流言');
for (const [column, rows] of [['rules', evidence.S1.main], ['social', evidence.S1.social]]) {
  const clustering = avg(rows.map((entry) => entry.clusteringVsRandom));
  const central = avg(rows.map((entry) => entry.maxDegreeVsMean));
  set('S1', column, points.S1a(Number.isFinite(clustering) ? clustering : null) + points.S1b(Number.isFinite(central) ? central : null), { clusteringVsRandom: clustering, maxDegreeVsMean: central, strongTies: rows.map((entry) => entry.strongTies) });
}
{
  const rows = evidence.S2.main.filter(Boolean);
  if (rows.length === 0) {
    set('S2', 'rules', 0, '角色写死，名声恒为 0');
  } else {
    // 7 分：名声因经历而变，且觉得某人爱惹事（或热心）之后，找他的次数随之变少（或变多）。
    const sum = (kind, key) => rows.reduce((total, entry) => total + entry.turns[kind][key], 0);
    const trouble = { pairs: sum('trouble', 'pairs'), before: sum('trouble', 'before'), after: sum('trouble', 'after') };
    const warmth = { pairs: sum('warmth', 'pairs'), before: sum('warmth', 'before'), after: sum('warmth', 'after') };
    const changes = rows.reduce((total, entry) => total + entry.labelChanges, 0);
    // 要明显：少找至少两成五，或多找至少两成五（各自前后 7 天，样本至少 5 次）。
    // 看两层：众人公认之后（名声），以及某个人自己改了看法之后（印象）。
    const labelSum = (label, key) => rows.reduce((total, entry) => total + entry.labelTurns[label][key], 0);
    const troubled = { subjects: labelSum('惹事', 'subjects'), before: labelSum('惹事', 'before'), after: labelSum('惹事', 'after') };
    const warmed = { subjects: labelSum('热心肠', 'subjects'), before: labelSum('热心肠', 'before'), after: labelSum('热心肠', 'after') };
    const clearly = (turn, fewer) =>
      turn.before >= 5 && (fewer ? turn.after <= 0.75 * turn.before : turn.after >= 1.25 * turn.before);
    const behaviour =
      clearly(troubled, true) || clearly(warmed, false) || clearly(trouble, true) || clearly(warmth, false);
    set('S2', 'rules', changes > 0 && behaviour ? 7 : changes > 0 || rows.some((entry) => entry.valuesChange) ? 3 : 0, {
      labelChanges: changes,
      finalLabels: rows[0].finalLabels,
      labelledTroublemaker7dBeforeAfter: troubled,
      labelledWarm7dBeforeAfter: warmed,
      troubleTurn7dBeforeAfter: trouble,
      warmthTurn7dBeforeAfter: warmth,
    });
  }
}
set('S2', 'social', 0, '角色写死，没有名声');
{
  const rows = evidence.S3.main;
  const per30 = rows.every((entry) => entry.per30Days !== null) ? avg(rows.map((entry) => entry.per30Days)) : null;
  set('S3', 'rules', per30 === null ? 0 : points.S3(per30), per30 === null ? rows[0]?.note : {
    per30Days: per30,
    sustainedTransitions: avg(rows.map((entry) => entry.sustainedTransitionsPer30Days)),
    repeatedCooperation: avg(rows.map((entry) => entry.repeatedCooperationPer30Days)),
  });
}
set('S3', 'social', points.S3(avg(evidence.S3.social.map((entry) => entry.per30Days))), { per30Days: avg(evidence.S3.social.map((entry) => entry.per30Days)) });
set('S4', 'rules', 0, '规则层不会写史');
set('S4', 'combo', null, '待盲评（0–8 分）');

const cellFor = (item, column) =>
  score[item]?.[column] ?? (column === 'combo' && sameAsRules.has(item) ? score[item]?.rules : undefined);
const totals = {};
for (const column of columns) {
  let sum = 0;
  let pendingMax = 0;
  for (const item of Object.keys(score)) {
    const cell = cellFor(item, column);
    if (!cell) continue;
    if (cell.points === null) pendingMax += item === 'S4' ? 8 : item === 'I5' ? 8 : 0;
    else sum += cell.points;
  }
  if (column === 'combo' && score.I5?.combo?.points !== null && score.I5?.combo) pendingMax += 6;
  totals[column] = { sum, pendingMax };
}

writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), set: SET, worlds, score, totals, evidence }, null, 2)}\n`);
const fmt = (value) => (value === null || value === undefined ? '—' : typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(3)) : JSON.stringify(value));
process.stdout.write(`集合：${SET === 'human' ? '拟人生活 v1' : '现有 NPC（基线）'}\n\n`);
process.stdout.write('| 项 | 规则决策 | 规则决策 + DeepSeek 说话 | 社交演化世界（参考） |\n|---|---|---|---|\n');
for (const item of ['I1', 'I2', 'I3', 'I4', 'I5', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']) {
  const cell = (column) => {
    const entry = cellFor(item, column);
    if (!entry) return '—';
    return `${entry.points === null ? '待评' : entry.points} · ${typeof entry.detail === 'string' ? entry.detail : Object.entries(entry.detail ?? {}).map(([key, value]) => `${key}=${fmt(value)}`).join(', ')}`;
  };
  process.stdout.write(`| ${item} | ${cell('rules')} | ${cell('combo')} | ${cell('social')} |\n`);
}
process.stdout.write(`\n合计：规则决策 ${totals.rules.sum}；规则决策 + DeepSeek 说话 ${totals.combo.sum}（另有最多 ${totals.combo.pendingMax} 分待盲评）；社交演化世界 ${totals.social.sum}\n`);
const learning = evidence.I1.modelLearning;
if (learning.length > 0) {
  process.stdout.write(`补充（DeepSeek 自己做决定时，面前有 24 小时内扑空过的采药选项）：${learning.map((entry) => `${entry.modelPicked}/${entry.turns} 次仍选它（规则默认 ${entry.rulePicked}）`).join('；')}\n`);
}
process.stdout.write(`${outPath}\n`);

// ---------------------------------------------------------------- 数学

function cosine(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const key of keys) {
    const x = a[key] ?? 0;
    const y = b[key] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

function jsDivergence(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const sa = keys.reduce((sum, key) => sum + (a[key] ?? 0), 0);
  const sb = keys.reduce((sum, key) => sum + (b[key] ?? 0), 0);
  let total = 0;
  for (const key of keys) {
    const p = (a[key] ?? 0) / sa;
    const q = (b[key] ?? 0) / sb;
    const m = (p + q) / 2;
    if (p > 0) total += 0.5 * p * Math.log2(p / m);
    if (q > 0) total += 0.5 * q * Math.log2(q / m);
  }
  return total;
}

function gini(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const n = sorted.length;
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  if (n === 0 || sum === 0) return 0;
  let weighted = 0;
  sorted.forEach((value, index) => {
    weighted += (index + 1) * value;
  });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function mean(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : NaN;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

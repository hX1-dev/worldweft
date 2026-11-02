// 玩家对话 · 世界：从拟人生活主世界（purposeBoundLifeSoak）的日志里，读出 NPC 某一刻的处境
// （在哪、手上做什么、身上有什么、听说过什么、对谁怎么看、接下来要做什么）。这些是规则层的事实。
// 试验台 player_dialogue_probe.mjs 和真人试玩窗口 player_dialogue_chat.mjs 共用；只读日志，不改世界。
// 需要 ts-node 加载器（引用了 convex/xianxia 的 .ts）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIALOGUE_PERSONAS } from '../../convex/xianxia/playerDialoguePersonas.ts';
import { hasDutyPost, humanChronotype, humanDayFocus, isHumanSleepTime } from '../../convex/xianxia/humanLifeLogic.ts';

export const HOURS_PER_TICK = 0.25;
export const DEFAULT_SOAK_SEED = 'ab-20261021:s1';

export const LOCATIONS = {
  mountain_gate: '山门生活院',
  herb_field: '凝露药圃',
  market: '青石坊市',
  rest_pavilion: '松风歇脚亭',
  alchemy_room: '丹房守备处',
};

export const TRAITS = {
  'life:q6:cultivator': ['inner_disciple', '中庸', '权力'],
  'life:q6:tired': ['outer_disciple', '无私', '义气'],
  'life:q6:seller': ['outer_disciple', '利己', '名声'],
  'life:q6:remote_gatherer': ['outer_disciple', '中庸', '孤僻'],
  'life:q6:local_gatherer': ['outer_disciple', '无私', '天伦'],
  'life:q6:quester': ['outer_disciple', '正直', '义气'],
  'life:q6:merchant': ['merchant', '利己', '名声'],
  'life:q6:guard': ['guard', '正直', '忠贞'],
  'life:q6:explorer': ['outer_disciple', '中庸', '孤僻'],
  'life:q6:emergency': ['outer_disciple', '中庸', '爱家'],
};

export const PEOPLE = Object.values(DIALOGUE_PERSONAS).map((persona) => ({ actorId: persona.actorId, name: persona.name }));
export const nameOf = (actorId) => DIALOGUE_PERSONAS[actorId]?.name ?? actorId;

export const VERB = {
  cultivate: '修炼',
  gather: '采药',
  rest: '歇脚',
  trade: '卖药',
  talk: '和人说话',
  travel: '赶路',
  gift: '送东西',
  explore: '四处查看',
  turn_in_request: '交委托',
  accept_request: '接委托',
};

// 最新一份种子 s1 的拟人生活规则臂日志。新检出的仓库里还没有，就先跑一份
// （规则臂、3,600 tick，约 1 分钟，不调模型；和基线检查的 rules-human s1 是同一份）。
export function latestSoakLog(root) {
  const evalDir = resolve(root, '.logs/humanity-eval');
  const latest = () =>
    (existsSync(evalDir) ? readdirSync(evalDir) : [])
      .filter((entry) => entry.startsWith('rules-human-ab-') && entry.includes('-s1-') && entry.endsWith('.jsonl'))
      .sort()
      .at(-1);
  if (!latest()) {
    mkdirSync(evalDir, { recursive: true });
    process.stderr.write('还没有拟人生活日志，先跑一份 s1（约 1 分钟）……\n');
    const run = spawnSync(
      process.execPath,
      [
        '--experimental-specifier-resolution=node',
        '--loader',
        'ts-node/esm',
        resolve(root, 'godot-taixu-client/tools/run_ab_rules_vs_deepseek.mjs'),
        '--arm', 'rules',
        '--seed', DEFAULT_SOAK_SEED,
        '--ticks', '3600',
        '--outlook-mode', 'full',
        '--human-life',
        '--log-dir', '.logs/humanity-eval',
      ],
      { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } },
    );
    if (run.status !== 0) throw new Error(`player_dialogue_soak_run_failed: ${(run.stderr ?? '').trim().split('\n').at(-1)}`);
  }
  const name = latest();
  if (!name) throw new Error('player_dialogue_soak_log_missing');
  return resolve(evalDir, name);
}

export function clock(tick) {
  const hours = tick * HOURS_PER_TICK;
  const minutes = Math.round((hours % 24) * 60);
  return {
    day: Math.floor(hours / 24) + 1,
    text: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    hour: hours % 24,
  };
}

export function tickAt(day, hour) {
  return Math.round(((day - 1) * 24 + hour) / HOURS_PER_TICK);
}

export function isAsleepAt(actorId, tick) {
  return isHumanSleepTime({ humanLifeV1: true, currentGameHour: tick * HOURS_PER_TICK, humanDay: humanChronotype(actorId) });
}

// 一件事按他知道的版本说出来；predicate 是去掉主语的半句（说到这个人时换成"他"）。
function knownNewsPredicate(entry) {
  const object = entry.objectActorId ? nameOf(entry.objectActorId) : '';
  const worse = entry.newsExaggerated === true;
  switch (entry.newsKind) {
    case 'quarrel':
      return worse ? `和${object}吵得差点动手` : `跟${object}吵了一架`;
    case 'apology':
      return `向${object}赔了不是`;
    case 'gift':
      return worse ? `送了${object}好几株灵草` : `送了${object}一株灵草`;
    case 'commission':
      return `交了${object}的采药委托`;
    case 'injury':
      return worse ? '被药瘴伤得很重' : '被药瘴伤了';
    case 'sighting':
      return worse ? '在山门外看见一群白鹿' : '在山门外看见一头白鹿';
    default:
      return '出了点事';
  }
}

function planText(actorId, focus) {
  const [role] = TRAITS[actorId];
  if (role === 'guard') return focus === 'livelihood' ? '照常当值' : '轮休，歇一天';
  if (role === 'merchant') return focus === 'livelihood' ? '照常看铺子' : '关了铺子出去走走';
  if (focus === 'cultivation') return '修炼一天';
  if (focus === 'livelihood') return '去药圃采药，拿去坊市卖';
  if (focus === 'social') return '找朋友坐坐';
  return '歇一天，出去走走';
}

export function loadDialogueWorld(logPath, { seed = DEFAULT_SOAK_SEED } = {}) {
  const records = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const terminalsById = new Map(records.filter((record) => record.type === 'action_terminal').map((record) => [record.actionId, record]));
  const lastTick = records.reduce((max, record) => Math.max(max, record.tick ?? 0), 0);

  // 某一刻：在哪、在不在路上、手上在做什么。
  function stateAt(actorId, tick) {
    let location;
    let inProgress;
    let idle;
    for (const record of records) {
      if (record.tick > tick) break;
      if (record.actorId !== actorId) continue;
      if (record.type === 'action_terminal' && record.finalLocationId) location = record.finalLocationId;
      if (record.type === 'action_selected') {
        const terminal = terminalsById.get(record.actionId);
        inProgress = terminal && terminal.tick > tick ? record : undefined;
        if (!location) location = record.fromLocationId;
        idle = undefined;
      }
      if (record.type === 'intentional_idle') idle = record;
    }
    return { location, inProgress, idle };
  }

  function focusOn(actorId, dayIndex) {
    const [role, innerTrait, outerTrait] = TRAITS[actorId];
    return humanDayFocus({ seedKey: `${seed}:human_focus:${actorId}:${dayIndex}`, role, innerTrait, outerTrait });
  }

  // 手上的事（给人看的说法）、忙不忙、是不是歇口气。
  function activityOf(state, focus) {
    const { inProgress, idle } = state;
    if (inProgress) {
      return { activity: VERB[inProgress.actionType] ?? '忙着', busy: ['cultivate', 'gather', 'trade', 'travel'].includes(inProgress.actionType) };
    }
    if (idle?.reasonCode === 'on_watch') return { activity: '当值', busy: true };
    if (idle?.reasonCode === 'awaiting_customer') return { activity: '守铺子', busy: false };
    if (idle?.reasonCode === 'purpose_goal_cadence_wait') {
      return focus === 'cultivation'
        ? { activity: '修炼间歇，打坐调息', busy: false, breakFrom: '修炼' }
        : { activity: '歇口气', busy: false };
    }
    return { activity: '歇着', busy: false };
  }

  // 他接下来要做的事（日志里这一刻之后的下一个动作）。stay：接着做手上的事（正做着的，
  // 或歇口气之后原地接着做同一件事）；placeName：要先赶路去的地方。当值、睡觉也算。收尾时照实说。
  function nextActivityAt(actorId, tick, current, breakFrom) {
    if (current.inProgress && current.inProgress.actionType !== 'travel') return { kind: current.inProgress.actionType, stay: true };
    if (current.idle?.reasonCode === 'on_watch') return { kind: 'watch', stay: true };
    if (current.idle?.reasonCode === 'awaiting_customer') return { kind: 'shop', stay: true };
    let destination;
    const away = () => (destination && destination !== current.location ? LOCATIONS[destination] : undefined);
    for (const record of records) {
      if (record.tick <= tick || record.actorId !== actorId) continue;
      if (record.type === 'intentional_idle' && record.reasonCode === 'sleeping') return { kind: 'sleep', stay: false };
      if (record.type === 'intentional_idle' && record.reasonCode === 'on_watch') return { kind: 'watch', stay: false, placeName: away() };
      if (record.type !== 'action_selected') continue;
      if (record.actionType === 'travel') {
        destination = record.targetLocationId;
        continue;
      }
      return {
        kind: record.actionType,
        stay: !away() && breakFrom !== undefined && breakFrom === VERB[record.actionType],
        placeName: away(),
        personName: record.targetActorId ? nameOf(record.targetActorId) : undefined,
      };
    }
    return undefined;
  }

  // 从日志里抽出 NPC 在 tick 这一刻的处境（规则层的事实）。player 是他和这位玩家之间的往来。
  function situationAt(actorId, tick, player) {
    const [role] = TRAITS[actorId];
    const at = clock(tick);
    const dayIndex = at.day - 1;
    const focus = focusOn(actorId, dayIndex);
    const state = stateAt(actorId, tick);
    const { location } = state;
    const { activity, busy, breakFrom } = activityOf(state, focus);
    const next = nextActivityAt(actorId, tick, state, breakFrom);
    const lastOffer = records.filter((record) => record.type === 'decision_offered' && record.actorId === actorId && record.tick <= tick).at(-1);
    // 最近的事分今天、昨天说（按日历日，不是"过去 24 小时"），免得 AI 把昨天的事说成今天。
    const todayStart = Math.floor((tick * HOURS_PER_TICK) / 24) * (24 / HOURS_PER_TICK);
    const since = todayStart - 24 / HOURS_PER_TICK;
    const when = (recordTick) => (recordTick >= todayStart ? '今天' : '昨天');
    const recentEvents = [];
    for (const record of records) {
      if (record.tick > tick || record.tick < since) continue;
      if (record.type === 'social_event' && (record.actorId === actorId || record.targetActorId === actorId)) {
        const other = nameOf(record.actorId === actorId ? record.targetActorId : record.actorId);
        recentEvents.push(
          `${when(record.tick)}${record.reasonCode === 'quarrel' ? `和${other}吵了一架` : record.actorId === actorId ? `向${other}赔了不是` : `${other}来赔了不是`}`,
        );
      }
      if (record.type === 'action_selected' && record.actorId === actorId && record.actionType === 'gift' && terminalsById.get(record.actionId)?.status === 'completed') {
        recentEvents.push(`${when(record.tick)}送了${nameOf(record.targetActorId)}一株灵草`);
      }
      if (record.type === 'action_selected' && record.targetActorId === actorId && record.actionType === 'gift' && terminalsById.get(record.actionId)?.status === 'completed') {
        recentEvents.push(`${when(record.tick)}${nameOf(record.actorId)}送了你一株灵草`);
      }
    }
    const counts = { 今天: {}, 昨天: {} };
    for (const record of records) {
      if (record.tick > tick || record.tick < since || record.actorId !== actorId || record.type !== 'action_selected') continue;
      if (!['cultivate', 'gather', 'trade'].includes(record.actionType)) continue;
      const day = counts[when(record.tick)];
      day[record.actionType] = (day[record.actionType] ?? 0) + 1;
    }
    // 次数说成人话（"修炼了大半天"），不报数，免得 AI 照着念"修了六回"。
    const amount = (count) => (count >= 4 ? '了大半天' : count >= 2 ? '了几回' : '过一回');
    const routine = [];
    for (const day of ['昨天', '今天']) {
      const done = Object.entries(counts[day]).map(([kind, count]) => `${VERB[kind]}${amount(count)}`);
      if (done.length > 0) routine.push(`${day}${done.join('、')}`);
    }
    recentEvents.unshift(...routine);
    const latest = new Map();
    for (const record of records) {
      if (record.tick > tick || record.type !== 'news_heard' || record.actorId !== actorId) continue;
      if ((tick - record.tick) * HOURS_PER_TICK > 30 * 24) continue;
      latest.set(record.newsId, record);
    }
    const news = [...latest.values()]
      .filter((entry) => entry.newsSource !== 'direct' || entry.newsKind === 'sighting' || entry.newsKind === 'injury')
      .map((entry) => ({
        newsId: entry.newsId,
        kind: entry.newsKind,
        text: `${nameOf(entry.subjectActorId)}${knownNewsPredicate(entry)}`,
        predicate: knownNewsPredicate(entry),
        heardTick: entry.tick,
        source: entry.newsSource,
        aboutActorIds: [entry.subjectActorId, entry.objectActorId].filter(Boolean),
      }));
    const network = records.filter((record) => record.type === 'network' && record.tick <= tick).at(-1);
    const opinions = (network?.rows ?? [])
      .filter((row) => row.from === actorId)
      .map((row) => ({
        actorId: row.to,
        name: nameOf(row.to),
        relationship: row.affinity,
        warmth: row.warmth ?? 0,
        trouble: row.trouble ?? 0,
        suspicion: row.suspicion ?? 0,
      }));
    // 手头自己的灵草：采到的 − 卖掉的 − 送出的 − 交委托的（别人送的不算），再减去送给这位玩家的。
    let own = actorId === 'life:q6:seller' ? 1 : 0;
    for (const record of records) {
      if (record.tick > tick || record.actorId !== actorId || record.type !== 'action_terminal' || record.status !== 'completed') continue;
      if (record.actionType === 'gather') own += 1;
      if (['trade', 'gift', 'turn_in_request'].includes(record.actionType)) own -= 1;
    }
    own -= player?.herbsGivenToPlayer ?? 0;
    // 近 7 天做过哪些事、和谁打过交道（供核对 AI 说的"我常去采药""跟掌柜磨价钱"之类是否属实）。
    const doneKinds = new Set();
    const metActorIds = new Set();
    for (const record of records) {
      if (record.tick > tick || record.tick < tick - (7 * 24) / HOURS_PER_TICK) continue;
      if (record.type === 'action_selected' && record.actorId === actorId && record.targetActorId) metActorIds.add(record.targetActorId);
      if (record.type === 'action_selected' && record.targetActorId === actorId) metActorIds.add(record.actorId);
      if (record.type === 'social_event' && (record.actorId === actorId || record.targetActorId === actorId)) {
        metActorIds.add(record.actorId === actorId ? record.targetActorId : record.actorId);
      }
      if (record.actorId === actorId && record.type === 'action_terminal' && record.status === 'completed') doneKinds.add(record.actionType);
      if (record.actorId === actorId && record.type === 'intentional_idle' && record.reasonCode === 'on_watch') doneKinds.add('on_watch');
      if (record.actorId === actorId && record.type === 'intentional_idle' && record.reasonCode === 'awaiting_customer') doneKinds.add('awaiting_customer');
    }
    return {
      day: at.day,
      clock: at.text,
      hour: at.hour,
      recentActivityKinds: [...doneKinds].sort(),
      metActorIds: [...metActorIds].sort(),
      // 今天、昨天各做过哪些事（供核对 AI 说的"今儿卖了药"之类）。
      doneToday: Object.keys(counts.今天).sort(),
      doneYesterday: Object.keys(counts.昨天).sort(),
      placeName: LOCATIONS[location] ?? '山里',
      location,
      activity,
      busy,
      breakFrom,
      focus,
      dutyDay: hasDutyPost(role) && focus === 'livelihood',
      plan: planText(actorId, focusOn(actorId, dayIndex + 1)),
      next,
      bedtimeHour: humanChronotype(actorId).bedtimeHour,
      fatigue: lastOffer?.fatigue ?? 0,
      mood: 5,
      recentEvents: recentEvents.slice(-4),
      news,
      opinions,
      player,
      giftable: own > 0,
      ownHerbs: Math.max(0, own),
    };
  }

  // 去找他：那天 10:00 起，找第一个他醒着、不在路上的时刻。
  function visitTick(actorId, day) {
    for (let hour = 10; hour <= 19; hour += 0.25) {
      const tick = tickAt(day, hour);
      const { inProgress, location } = stateAt(actorId, tick);
      if (!isAsleepAt(actorId, tick) && location && inProgress?.actionType !== 'travel') return tick;
    }
    return tickAt(day, 12);
  }

  // 两个 NPC 之间真发生了的来往（说上了话、送到了东西），流言跟着它传。
  const interactions = records
    .filter(
      (record) =>
        record.type === 'action_selected' &&
        (record.actionType === 'talk' || record.actionType === 'gift') &&
        record.targetActorId &&
        terminalsById.get(record.actionId)?.status === 'completed',
    )
    .map((record) => ({ tick: record.tick, a: record.actorId, b: record.targetActorId }));
  function interactionsBetween(fromTick, toTick) {
    return interactions.filter((entry) => entry.tick > fromTick && entry.tick <= toTick);
  }

  // 某一刻 from 对 to 的好感（日志里最近一次的关系快照）。
  const networks = records.filter((record) => record.type === 'network').sort((left, right) => left.tick - right.tick);
  function affinityBetween(fromId, toId, tick) {
    let snapshot;
    for (const network of networks) {
      if (network.tick > tick) break;
      snapshot = network;
    }
    return snapshot?.rows?.find((row) => row.from === fromId && row.to === toId)?.affinity ?? 0;
  }

  // 这一刻每个人在哪、在做什么（试玩窗口的地图用）。
  function whereabouts(tick) {
    return Object.values(DIALOGUE_PERSONAS).map((persona) => {
      const state = stateAt(persona.actorId, tick);
      const asleep = isAsleepAt(persona.actorId, tick);
      const travelling = state.inProgress?.actionType === 'travel';
      const { activity } = activityOf(state, focusOn(persona.actorId, clock(tick).day - 1));
      return {
        actorId: persona.actorId,
        name: persona.name,
        role: persona.role,
        location: state.location,
        placeName: LOCATIONS[state.location] ?? '山里',
        asleep,
        travelling,
        heading: travelling ? LOCATIONS[state.inProgress.targetLocationId] : undefined,
        activity: asleep ? '睡着' : travelling ? '赶路' : activity,
      };
    });
  }

  return { logPath, seed, records, lastTick, stateAt, situationAt, visitTick, whereabouts, interactionsBetween, affinityBetween };
}

// 他的性格（流言传多快、记仇多久要用）。
export function traitsOf(actorId) {
  const [, innerTrait, outerTrait] = TRAITS[actorId] ?? [];
  return { innerTrait, outerTrait };
}

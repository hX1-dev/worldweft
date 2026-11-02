// 玩家对话 · 真人试玩窗口的网页（由 player_dialogue_chat.mjs 在本机提供）。
// 所有动态文字一律用 textContent 放进页面（NPC 的话可能来自 AI），不拼 HTML。

export const CHAT_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>和 NPC 说话 · 试玩</title>
<style>
:root {
  --bg: #f6f4ef; --panel: #fffdf8; --ink: #2b2a27; --muted: #7a766d; --line: #e4dfd3;
  --accent: #8a3b2e; --accent-soft: #f3e3dc; --npc: #f1ede4; --me: #e3edf3; --flag: #fff3c9; --flag-line: #d9a400;
  --ai: #2f6f8f; --rule: #4f7a33;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1d1c1a; --panel: #262522; --ink: #ece8df; --muted: #a39e93; --line: #3a3833;
    --accent: #e08a74; --accent-soft: #3a2a25; --npc: #302e2a; --me: #25343d; --flag: #463c1c; --flag-line: #c99a1a;
    --ai: #7fb7d4; --rule: #a3c98a;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
h1 { font-size: 17px; margin: 0; font-weight: 600; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.time { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#clock { font-weight: 600; font-variant-numeric: tabular-nums; }
button, select, input[type=number] { font: inherit; font-size: 14px; padding: 3px 10px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 6px; }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .45; cursor: default; }
main { display: grid; grid-template-columns: 250px minmax(0, 1fr) 290px; gap: 16px; padding: 16px; max-width: 1400px; margin: 0 auto; }
@media (max-width: 980px) { main { grid-template-columns: 1fr; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.panel h2 { font-size: 14px; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
.place { margin-bottom: 10px; }
.place h3 { font-size: 13px; margin: 8px 0 4px; color: var(--muted); font-weight: 600; }
.chip { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; margin: 4px 0; padding: 5px 10px; }
.chip .what { color: var(--muted); font-size: 12px; white-space: nowrap; }
.chip.current { border-color: var(--accent); background: var(--accent-soft); }
.empty { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
#chat { display: flex; flex-direction: column; min-height: 72vh; }
#who { border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 8px; }
#who .name { font-weight: 600; font-size: 16px; }
#who .sub { color: var(--muted); font-size: 13px; }
#turns { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 2px; max-height: 64vh; }
.turn { max-width: 86%; padding: 7px 12px; border-radius: 10px; border: 1px solid transparent; }
.turn.npc { background: var(--npc); align-self: flex-start; }
.turn.player { background: var(--me); align-self: flex-end; }
.turn.flagged { background: var(--flag); border-color: var(--flag-line); }
.turn .meta { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 3px; }
.tag-rule { color: var(--rule); }
.tag-ai { color: var(--ai); }
.flagbtn { font-size: 12px; padding: 0 7px; }
.notebox { display: flex; gap: 6px; margin-top: 4px; }
.notebox input { flex: 1; font: inherit; font-size: 13px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); }
.sys { align-self: center; color: var(--muted); font-size: 13px; text-align: center; }
.sys.strong { color: var(--accent); font-size: 14px; font-weight: 600; background: var(--accent-soft); padding: 4px 12px; border-radius: 8px; }
form#say { display: flex; gap: 8px; margin-top: 10px; }
form#say input { flex: 1; min-width: 0; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); }
.opts { margin-top: 6px; font-size: 12px; color: var(--muted); }
.stats dl { display: grid; grid-template-columns: auto auto; gap: 3px 10px; margin: 0 0 10px; }
.stats dt { color: var(--muted); }
.stats dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.small { font-size: 12px; color: var(--muted); word-break: break-all; }
.tips { font-size: 13px; color: var(--muted); padding-left: 18px; margin: 6px 0 0; }
</style>
</head>
<body>
<header>
  <h1>太虚界 · 和 NPC 说话</h1>
  <span class="badge" id="mode"></span>
  <div class="time">
    <span id="clock"></span>
    <button id="hour" type="button">过一小时</button>
    <button id="morning" type="button">到第二天上午</button>
    <label class="small">跳到第 <input id="day" type="number" min="1" max="37" style="width:4em"> 天</label>
    <select id="hourSel" aria-label="几点"></select>
    <button id="jump" type="button">去</button>
  </div>
</header>
<main>
  <section class="panel" id="places" aria-label="山里的人"></section>
  <section class="panel" id="chat">
    <div id="who"><div class="name">先在左边挑一个人去找他</div><div class="sub">睡着的、在路上的找不到；他刚走开的，过一会儿再来。</div></div>
    <div id="turns" aria-live="polite"></div>
    <form id="say" autocomplete="off">
      <input id="line" maxlength="120" placeholder="随便说点什么，回车发送" disabled>
      <button type="submit" id="send" disabled>说</button>
      <button type="button" id="leave" disabled>走开</button>
    </form>
    <div class="opts"><label><input type="checkbox" id="showSource"> 显示哪句是规则说的、哪句是 AI 说的（看完再打开，免得影响判断）</label></div>
  </section>
  <section class="panel stats" id="stats" aria-label="统计"></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const INTENT_LABEL = { free: '随口闲聊', ask_self: '问他本人' };
const PHRASE_LABEL = {
  open: '他先开口', greetStranger: '问候', greetKnown: '问候', greetBack: '回礼', farewell: '告别', thanks: '道谢',
  activity: '说在忙什么', activityIdle: '说在忙什么', activityBreak: '说在忙什么', plan: '说明天的打算',
  newsNone: '讲听来的事', newsNoMore: '讲听来的事', newsTell: '讲听来的事', newsTellBad: '讲听来的事',
  personFriend: '评人', personGood: '评人', personNeutral: '评人', personBad: '评人', personGrudge: '评人', personAgain: '评人',
  remember: '记得你', rememberNamed: '记得你', rememberNone: '记得你', nameKnown: '答你叫什么', nameUnknown: '答你叫什么', giveYes: '送不送东西', giveNo: '送不送东西', giveNone: '送不送东西',
  outOfWorld: '听不懂出戏的话', denyClaim: '不认没影的事', introduceAck: '记下你是谁', close: '收尾', closeGo: '收尾', closeDuty: '收尾',
  ack: '应一声', caredFor: '谢你关心', praised: '谢你夸', crudeReact: '皱眉', rebuke: '斥责', stormOff: '翻脸走开',
  refuseTalk: '不理你', greetCold: '冷着问好', rememberCold: '记得你', openAccuse: '当面问你',
  apologyAccepted: '认下道歉', apologyCold: '冷冷应一声', apologyAgain: '赔过了，说过了', apologyElsewhere: '让你去跟被骂的人说', apologyNone: '没事',
  deflect: '随口接一句',
};
const CLOSED_NOTE = {
  npc_rule: '（他忙去了。过一会儿再来找他。）',
  npc_model: '（他不想再聊了。过一会儿再来找他。）',
  npc_angry: '（他翻脸走了。今天别再找他了。）',
  npc_refused: '（他不想理你。）',
  player: '（你告辞了。）',
  player_walked_off: '（你走开了。）',
};
// 他对你的态度（"没什么看法"不标）。
const ATTITUDE_LABEL = { hostile: '不理你', cold: '烦你', friendly: '对你不错', close: '把你当朋友' };
const ATTITUDE_SENTENCE = { hostile: '恨你，不想理你', cold: '有点烦你', neutral: '没什么看法', friendly: '挺喜欢你', close: '把你当朋友' };
const TONE_LABEL = { insult: '骂人', threat: '威胁', crude: '粗话', false_claim: '硬编往事', ai_rude: '无礼（AI 判的）', kind: '客气', care: '关心', ai_friendly: '客气（AI 判的）', backchannel: '敷衍', apology: '道歉（他认了）', neutral: '' };
let view = null;
let waiting = false;
let waitStarted = 0;
let waitTimer = null;
let openNote = null; // [对话序号, 第几句]：正在写"哪里不像"的那句

try { $('showSource').checked = localStorage.getItem('npcChatShowSource') === '1'; } catch (error) { /* 浏览器不让存就算了 */ }
$('showSource').addEventListener('change', () => {
  try { localStorage.setItem('npcChatShowSource', $('showSource').checked ? '1' : '0'); } catch (error) { /* 同上 */ }
  render();
});
for (let hour = 6; hour <= 22; hour += 1) {
  const option = document.createElement('option');
  option.value = String(hour);
  option.textContent = String(hour).padStart(2, '0') + ':00';
  $('hourSel').appendChild(option);
}

async function api(path, body) {
  try {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (data.state) view = data.state;
    return data;
  } catch (error) {
    return { ok: false, message: '连不上本机的对话服务了，它可能已经停了。' };
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let lastMessage = '';
function render() {
  if (!view) return;
  $('mode').textContent = view.live ? '真调 DeepSeek' : '试跑：交给 AI 的话只占位';
  $('clock').textContent = '第 ' + view.time.day + ' 天 ' + view.time.clock;
  $('day').max = String(view.time.lastDay);
  if (!$('day').value) $('day').value = String(view.time.day);
  $('hour').disabled = waiting;
  $('morning').disabled = waiting;
  $('jump').disabled = waiting;
  renderPlaces();
  renderChat();
  renderStats();
}

function renderPlaces() {
  const box = $('places');
  box.replaceChildren(el('h2', '', '山里的人（点谁就去找谁）'));
  const groups = new Map();
  for (const person of view.people) {
    const key = person.travelling ? '路上' : person.placeName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const order = ['山门生活院', '凝露药圃', '青石坊市', '松风歇脚亭', '丹房守备处', '路上', '山里'];
  for (const place of order) {
    const people = groups.get(place);
    // "山里"是日志里没记地点的人；没有这样的人就不列。
    if (place === '山里' && (!people || people.length === 0)) continue;
    const section = el('div', 'place');
    section.appendChild(el('h3', '', place));
    if (!people || people.length === 0) {
      section.appendChild(el('p', 'empty', '没人'));
    } else {
      for (const person of people) {
        const chip = el('button', 'chip');
        chip.type = 'button';
        if (view.current && view.current.actorId === person.actorId && !view.current.closedBy) chip.classList.add('current');
        chip.appendChild(el('span', '', person.name));
        const what = person.travelling ? '去' + (person.heading || '别处') : person.away ? '刚走开' : person.activity;
        const mood = ATTITUDE_LABEL[person.attitude] ? ' · ' + ATTITUDE_LABEL[person.attitude] : '';
        chip.appendChild(el('span', 'what', what + mood));
        chip.disabled = waiting || person.asleep || person.travelling || person.away;
        chip.title = person.role;
        chip.addEventListener('click', () => approach(person.actorId));
        section.appendChild(chip);
      }
    }
    box.appendChild(section);
  }
}

function sourceText(turn) {
  if (!turn.source) return '';
  if (turn.source.kind === 'rule') return '规则 · ' + (PHRASE_LABEL[turn.source.phrase] || turn.source.phrase || '');
  const bits = ['AI'];
  if (turn.source.dry) bits.push('试跑');
  if (turn.source.tokens) bits.push(turn.source.tokens + ' token');
  if (turn.source.hit !== undefined && turn.source.tokens) bits.push('命中缓存 ' + turn.source.hit);
  if (turn.source.ms) bits.push((turn.source.ms / 1000).toFixed(1) + ' 秒');
  if (turn.source.fallback) bits.push('没回上来，换成了规则的话');
  if (turn.source.deduped) bits.push('删了重复的半句');
  return bits.join(' · ');
}

function renderChat() {
  const current = view.current;
  const who = $('who');
  const turns = $('turns');
  if (!current) {
    who.replaceChildren(el('div', 'name', '先在左边挑一个人去找他'), el('div', 'sub', '睡着的、在路上的找不到；他刚走开的，过一会儿再来。'));
    turns.replaceChildren();
    if (lastMessage) turns.appendChild(el('div', 'sys', lastMessage));
  } else {
    who.replaceChildren(
      el('div', 'name', current.name),
      el('div', 'sub', current.role + ' · 在' + current.placeName + '，' + current.activity + ' · 第 ' + current.day + ' 天 ' + current.clock),
      el('div', 'sub', '他对你：' + (ATTITUDE_SENTENCE[current.attitude] || '没什么看法') + '（好感度 ' + current.relationship + '）'),
    );
    turns.replaceChildren();
    current.turns.forEach((turn, index) => turns.appendChild(renderTurn(current, turn, index)));
    if (current.closedBy) turns.appendChild(el('div', 'sys strong', CLOSED_NOTE[current.closedBy] || '（这段话说完了。）'));
    if (waiting) {
      const seconds = Math.floor((Date.now() - waitStarted) / 1000);
      turns.appendChild(el('div', 'sys', '（' + current.name + '想了想……' + (seconds >= 2 ? '已等 ' + seconds + ' 秒，最多等 8 秒' : '') + '）'));
    }
    if (lastMessage) turns.appendChild(el('div', 'sys', lastMessage));
    turns.scrollTop = turns.scrollHeight;
  }
  const canTalk = Boolean(current && !current.closedBy && !waiting);
  $('line').disabled = !canTalk;
  $('send').disabled = !canTalk;
  $('leave').disabled = !canTalk;
  // 他走开了：输入框里说清楚接下来能做什么。
  $('line').placeholder = current && current.closedBy
    ? '他走开了。在左边找别人，或者点"过一小时"再来找他。'
    : current
      ? '随便说点什么，回车发送'
      : '先在左边挑一个人';
  if (canTalk && document.activeElement !== $('line') && !openNote) $('line').focus();
}

function renderTurn(current, turn, index) {
  const box = el('div', 'turn ' + turn.speaker + (turn.flagged ? ' flagged' : ''));
  box.appendChild(el('div', '', turn.text));
  if (turn.speaker !== 'npc') {
    // 你这句让好感度变了多少。
    if (turn.affinity && (turn.affinity.delta !== 0 || TONE_LABEL[turn.affinity.tone])) {
      const sign = turn.affinity.delta > 0 ? '+' : '';
      const label = TONE_LABEL[turn.affinity.tone] ? TONE_LABEL[turn.affinity.tone] + ' · ' : '';
      box.appendChild(el('div', 'meta', label + '好感度 ' + sign + turn.affinity.delta + ' → ' + turn.affinity.after));
    }
    return box;
  }
  const meta = el('div', 'meta');
  const flag = el('button', 'flagbtn', turn.flagged ? '取消"不像"' : '不像');
  flag.type = 'button';
  flag.title = '这句不像他、出戏、说错了事，就点一下';
  flag.addEventListener('click', () => toggleFlag(current.index, index, !turn.flagged));
  meta.appendChild(flag);
  if (turn.flagged && turn.note) meta.appendChild(el('span', '', '你写的：' + turn.note));
  if ($('showSource').checked) meta.appendChild(el('span', turn.source && turn.source.kind === 'ai' ? 'tag-ai' : 'tag-rule', sourceText(turn)));
  box.appendChild(meta);
  if (openNote && openNote[0] === current.index && openNote[1] === index) {
    const form = el('form', 'notebox');
    const input = el('input');
    input.placeholder = '哪里不像？（可以不写，回车保存）';
    input.maxLength = 120;
    const save = el('button', '', '保存');
    save.type = 'submit';
    form.append(input, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const note = input.value.trim();
      openNote = null;
      if (note) await api('/api/flag', { index: current.index, turn: index, flag: true, note });
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { openNote = null; render(); }
    });
    box.appendChild(form);
    setTimeout(() => input.focus(), 0);
  }
  return box;
}

function renderStats() {
  const s = view.stats;
  const box = $('stats');
  box.replaceChildren(el('h2', '', '这次试玩'));
  const rows = [
    ['对话', s.conversations + ' 段'],
    ['你说了', s.playerLines + ' 句'],
    ['NPC 说了', s.npcLines + ' 句'],
    ['　规则说的', s.ruleLines + ' 句'],
    ['　AI 说的', s.aiLines + ' 句（' + pct(s.aiShare) + '）'],
    ['每段对话 token', s.meanTokens === null ? '—' : String(Math.round(s.meanTokens))],
    ['　其中按全价算', s.meanUncached === null ? '—' : String(Math.round(s.meanUncached))],
    ['缓存命中', s.cacheHitShare === null ? '—' : pct(s.cacheHitShare)],
    ['AI 回话用时', s.p50Ms === null ? '—' : '中位 ' + (s.p50Ms / 1000).toFixed(1) + ' 秒，最慢 ' + (s.maxMs / 1000).toFixed(1) + ' 秒'],
    ['你标了"不像"', s.flags + ' 句（规则 ' + s.flagsRule + '，AI ' + s.flagsAi + '）'],
    ['你骂人、威胁', s.offenses + ' 句'],
    ['他翻脸走了', s.stormOffs + ' 回'],
    ['他不理你', s.refusals + ' 回'],
    ['听说你骂过人的', s.rumorHeardBy + ' 人'],
    ['自动检查对不上', s.checkIssues + ' 处'],
    ['AI 没回上来', s.fallbacks + ' 句'],
  ];
  const list = el('dl');
  for (const [name, value] of rows) list.append(el('dt', '', name), el('dd', '', value));
  box.appendChild(list);
  const kinds = Object.entries(s.aiIntents || {});
  if (kinds.length > 0) {
    box.appendChild(el('h2', '', '交给 AI 的是哪类话'));
    const list2 = el('dl');
    for (const [intent, count] of kinds) list2.append(el('dt', '', INTENT_LABEL[intent] || intent), el('dd', '', count + ' 句'));
    box.appendChild(list2);
  }
  box.appendChild(el('h2', '', '可以试试'));
  const tips = el('ul', 'tips');
  for (const tip of ['骂他一句，看他翻不翻脸；看旁边谁听见了', '跟他说几件要紧的（表白、"我是妖"、"明天请你吃红烧肉"），隔天再去，看他记不记得', '点顶上"到第二天上午"，看他还冷不冷着你、流言传到了谁那儿', '隔天跟他说"对不起"，看他消不消气；同一天、或再隔一天再说一遍试试', '去找没被你骂过的人道歉，看他怎么说', '说"我是太子"，看他当不当真']) {
    tips.appendChild(el('li', '', tip));
  }
  box.appendChild(tips);
  box.appendChild(el('p', 'small', '记录随时保存在：' + view.sessionFile));
}

function pct(value) {
  return value === null || value === undefined ? '—' : Math.round(value * 100) + '%';
}

async function approach(actorId) {
  if (waiting) return;
  lastMessage = '';
  openNote = null;
  const data = await api('/api/approach', { actorId });
  lastMessage = data.message || '';
  render();
}

async function toggleFlag(index, turn, flag) {
  const data = await api('/api/flag', { index, turn, flag });
  openNote = flag && data.ok ? [index, turn] : null;
  render();
}

$('say').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('line').value.trim();
  if (!text || waiting) return;
  $('line').value = '';
  lastMessage = '';
  // 先把自己这句显示出来，等他回话（每秒刷新一下等了几秒）。
  if (view.current) view.current.turns.push({ speaker: 'player', text });
  waiting = true;
  waitStarted = Date.now();
  waitTimer = setInterval(renderChat, 1000);
  render();
  const data = await api('/api/say', { text });
  clearInterval(waitTimer);
  waiting = false;
  lastMessage = data.ok ? '' : data.message || '';
  render();
});
// 中文输入法选字时按的回车不算发送。
$('line').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
$('leave').addEventListener('click', async () => {
  lastMessage = '';
  await api('/api/leave', {});
  render();
});
for (const [id, body] of [['hour', { action: 'hour' }], ['morning', { action: 'next_morning' }]]) {
  $(id).addEventListener('click', async () => {
    lastMessage = '';
    const data = await api('/api/time', body);
    lastMessage = data.message || '';
    render();
  });
}
$('jump').addEventListener('click', async () => {
  lastMessage = '';
  const data = await api('/api/time', { action: 'set', day: Number($('day').value), hour: Number($('hourSel').value) });
  lastMessage = data.message || '';
  render();
});

api('/api/state').then(() => {
  if (view) $('hourSel').value = String(Math.max(6, Math.min(22, Math.floor(view.time.hour))));
  render();
});
</script>
</body>
</html>
`;

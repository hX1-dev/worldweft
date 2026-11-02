// 玩家对话 · 字面检查：AI 说的话有没有编（《玩家对话过关标准》A1、A3）。
// 打分脚本 player_dialogue_score.mjs 和真人试玩窗口 player_dialogue_chat.mjs 共用。
// 纯 JS，不引用 .ts，普通 node 就能跑。只看字面：抓得住见过的几类编造，抓不住所有的。

export const NAMES = {
  'life:q6:cultivator': '守静弟子',
  'life:q6:tired': '疲惫弟子',
  'life:q6:seller': '卖药弟子',
  'life:q6:remote_gatherer': '远行采药人',
  'life:q6:local_gatherer': '药圃弟子',
  'life:q6:quester': '重诺弟子',
  'life:q6:merchant': '河湾掌柜',
  'life:q6:guard': '丹房守卫',
  'life:q6:explorer': '谨慎行脚弟子',
  'life:q6:emergency': '返山弟子',
};
export const MODERN = /人工智能|\bAI\b|语言模型|模型|程序|提示词|prompt|system|手机|电脑|互联网|ChatGPT|DeepSeek|机器人|设定|扮演/iu;
export const TRAIT_WORDS = /孤僻|义气|利己|名声|正直|中庸|无私|天伦|爱家|忠贞|权力/u;
export const ACTIVITY_CLAIMS = [
  // （"远行采药人"是人名，第七轮补。）
  [/采药(?!人)|采灵草|挖药/u, ['gather']],
  // （掌柜守着铺子收药卖药，说"卖灵草"是他的本行。）
  [/卖药|卖灵草|去坊市卖/u, ['trade', 'awaiting_customer']],
  [/修炼|打坐|练功|闭关/u, ['cultivate']],
  // （"谁当值谁劈柴""当值的人天天换"说的是院里轮杂事，不是他自己当值：v1.7 第五轮补。）
  // （第六轮补"有守卫当值"：说的是守卫。）
  [/(?<![谁该轮卫])当值(?![的人])|值守|守丹房/u, ['on_watch']],
  [/守铺子|看铺子|开铺子/u, ['awaiting_customer']],
];
// v1.1 收紧（第一轮真调后补上的几类编造）：
// 说自己手上有灵草、药材，要对得上他身上真有的；
export const ITEM_CLAIM = /(?:还有|有)(?:[一二两三四五几]|好几)株|有刚采的|这儿有[^，。！？]{0,6}(?:灵草|药材|货)|正好有[^，。！？]{0,4}(?:灵草|药材|货)/u;
// 世界里只有五处地方，说出别的店铺、灶房、客栈之类就是编的（v1.5 补：道歉这轮试玩里的"院里灶上还温着些"）；
// v1.7 按常识单（docs/世界逻辑/青岚山外门_生活常识_草案.md）：生活院有公用灶房、后山坡是药圃，这些不算编；
// 饭堂、食堂没有，甲乙丙院没有（就一个院子）。
export const INVENTED_PLACE = /食堂|饭堂|膳堂|斋堂|小摊|摊子|面摊|面馆|酒楼|客栈|茶馆|茶楼|酒肆|饭馆|藏经阁|演武场|讲经堂|[甲乙丙丁]院|[东西南北]院/u;
// AI 不许在话里答应替玩家做事（规则不会去兑现）；
// （v1.6 补：自测里 AI 说过"你先去，我随后就到""走，我领你去东边那片湿土"。）
export const PROMISE =
  /我带你|带你去|带你过去|陪你去|我帮你|替你|给你留|回头给你|下回给你|改天给你|我去给你|包在我身上|随后就到|随后就去|随后就来|我就过去|这就过去|一会儿就过去|我领你|领你去|跟我来|我带路|咱们一起去|我们一起去|给你盛|给道友盛|盛一碗给|我去取|这就给您|给您称|给你称|跟我去|我等你|等你来|在[^，。！？]{0,6}等你|我去[^，。！？]{0,4}(?:淘米|把米|煮|做饭|生火|烧火)|我正好要煮|一块儿吃|一起吃点|道友稍坐|我[^，。！？]{0,8}帮你(?:问|打听|看|说|找|捎|带)|(?:回头|待会儿?|等会儿?|改天|明儿|明天)[^，。！？]{0,3}帮你/u;
// （第六轮补："我待会儿修炼回来帮你问问"。）
// （v1.7 第三轮补：约道友一起吃饭、"我去灶房把米淘了"，转头规则让他去修炼了，前后对不上。）
// 说自己眼下累，要对得上他的精神（疲劳 30 以上才算累）。"修炼累了就去亭子坐坐"这种说习惯的不算。
export const TIRED_CLAIM = /(?:有点|有些|挺|很|好|真)(?:累|乏|困)|累得慌|累坏了|乏了|没精神/u;
// 说"今儿卖了药""昨天采药"，要对得上那一天真做过。
export const DAY_CLAIMS = [
  [/(?:今天|今儿|今日)[^，。！？]{0,6}?(卖|采|修炼|打坐|练功)/u, 'doneToday'],
  [/(?:昨天|昨儿|昨日)[^，。！？]{0,6}?(卖|采|修炼|打坐|练功)/u, 'doneYesterday'],
];
export const DAY_VERB_KIND = { 卖: 'trade', 采: 'gather', 修炼: 'cultivate', 打坐: 'cultivate', 练功: 'cultivate' };
// 这个世界里没处买东西（灵石只进不出），说买了什么、拿灵石换了什么就是编的。
export const PURCHASE_CLAIM = /买了|买来|换了?丹药|换成丹药|买丹药|花了[^，。！？]{0,4}灵石|灵石[^，。！？]{0,6}换(?:了|成)/u;
// v1.6：说起和道友的往事（"上回你……""前天你说……"），得有更早的来往作底；头一回见面的人没有往事可说。
export const PAST_CLAIM = /(?:上回|上次|那天|前几天|前天|昨天|之前|以前)(?:你|道友|客官)/u;
// v1.6 自测补：说自己跟谁吵过（"丹房守卫今早跟我吵了一架"），要对得上"最近的事"里真吵过；
// 世界里没有的人（管事、执事、师父……）是编的。
export const SELF_QUARREL_CLAIM = /(?:跟|和)我[^，。！？]{0,4}(?:吵|呛|闹)|我[^，。！？]{0,6}(?:跟|和)[^，。！？]{1,6}(?:吵|呛)(?:了|过)/u;
// （执事、长老在内门，常识单里有，提一句不算编；外门没有管事、管杂物的人，也没有师父带。）
export const INVENTED_PERSON = /管事|管杂物|杂役|掌门|师父|师傅|宗主|管家/u;
// 说"没有饭堂""外门没有师父带""山里哪有青叶参""食堂？山里没这东西"是照实否认，不算编：前面四个字内、
// 或紧跟在后面的几个字里有否认的词，就跳过。
// （v1.7 补"没听说什么食堂"：没听说、没见过后头可以隔几个字。）
const DENIAL_BEFORE = /(?:没有|没|哪有|哪来|不是|并无|无|不卖|谈不上)[^，。！？]{0,3}$|(?:没听说|没听过|没见过)[^，。！？]{0,5}$/u;
// （v1.7 第三轮补："食堂？咱们这儿没饭堂"——后头的"没"不一定连着"有""那""这"；
//   再补"说的是饭堂吧？山里没有饭堂"：反问一句，紧跟着否认。逗号后头的不算，免得"去饭堂吃吧，没多远"漏掉。）
const DENIAL_AFTER = /^[？?，,！!…\s]*[^，。！？]{0,4}(?:没|哪来|哪有|不存在)|^[^，。！？]{0,2}[？?！!]+[^，。！？]{0,4}(?:没|哪来|哪有|不存在)/u;
export function inventedMention(text, pattern) {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  for (const match of text.matchAll(global)) {
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
    if (!DENIAL_BEFORE.test(before) && !DENIAL_AFTER.test(after)) return match[0];
  }
  return undefined;
}
// 山里只有凝露草（常识单）；别的草名（青叶参、清瘴草、灵芝……）是编的。泛称（灵草、草药、杂草、这草、拔草）不算。
// （v1.7 补动词："认认草""看草""找草""晒草"说的是干活，不是草名。）
const GENERIC_GRASS = /(?:灵|凝露|杂|野|青|花|水|干|稻|株|棵|根|片|丛|这|那|此|除|拔|锄|割|打|种|长|吃|药|仙|小|嫩|枯|好|茅|认|看|找|采|挖|晒|收|寻|辨|识)草/u;
export function inventedHerbName(text) {
  for (const match of text.matchAll(/[一-龥]{0,2}[一-龥]草(?![率稿拟创莽包帽鞋席堆棚地丛木屋绳])|[一-龥]{1,2}(?:参|芝)(?![悟加与透拜考见])/gu)) {
    const name = match[0];
    if (/草$/u.test(name) && GENERIC_GRASS.test(name.slice(-3))) continue;
    // （"就是草深路滑"：草前头是个虚字，不是草名。第五轮补。）
    if (/草$/u.test(name) && /[是的了有在和跟与或把被就都也还些点]$/u.test(name.slice(0, -1))) continue;
    if (DENIAL_BEFORE.test(text.slice(Math.max(0, match.index - 6), match.index + name.length - 2))) continue;
    // （v1.7 第四轮补："青叶参？没听说过"——否认在后头；第五轮补"没听过这名儿""这名儿我没听过"。）
    if (/^[？?，,！!…\s]*[^，。！？]{0,4}(?:没听|没见|没这|没有|不知道|不认得|哪有|哪来)/u.test(text.slice(match.index + name.length, match.index + name.length + 12))) continue;
    return name;
  }
  return undefined;
}
// 各处之间都是三刻钟上下，没有近道（常识单）；说有近道、小径是编的（第五轮："绕药圃后头那条小径"）。
export const INVENTED_ROUTE = /近道|近路|捷径|抄近|小径/u;
// 执事、长老在内门（常识单）；说他们住在、待在外门哪处，是编的（v1.7 第三轮："执事住西排头一间"）。
export const OUTER_OFFICIAL = /(?:执事|长老)(?!堂)[^，。！？]{0,3}(?:住|在)(?:[东西]排|生活院|院里|院子|这院|坊市|药圃|歇脚亭|丹房)/u;
// 谁住哪间（常识单）。和 convex/xianxia/playerDialoguePersonas.ts 的 DIALOGUE_ROOMS_Q6 一样，F3 核对两份没走样。
export const ROOMS = {
  'life:q6:quester': '东排头一间',
  'life:q6:seller': '东排第二间',
  'life:q6:tired': '东排第三间',
  'life:q6:remote_gatherer': '东排最里头一间',
  'life:q6:emergency': '西排头一间',
  'life:q6:local_gatherer': '西排第二间，挨着井',
  'life:q6:explorer': '西排第三间',
  'life:q6:cultivator': '院子最里头那间',
  'life:q6:merchant': '坊市药铺后头',
  'life:q6:guard': '丹房守备处的值房',
};
const ORDINAL = /头一间|第一间|第二间|第三间/u;
const sameOrdinal = (claim, room) => {
  const claimed = claim.match(ORDINAL)?.[0]?.replace('第一间', '头一间');
  const actual = room.match(ORDINAL)?.[0];
  return !claimed || !actual || claimed === actual;
};
// 说某人（或自己）住东排、西排第几间，和常识单对不上的，返回那人的名字；都对得上返回 undefined。
// 只核对"排"和"头一间、第二间、第三间"；"北头""那几间"这类说不准的不核对。
// 空着的那间是西排第四间（第五轮：有人说成"东排第四间"），说错了返回"空屋"。
export function roomClaimWrong(text, selfActorId) {
  const empty = text.match(/空着的?(?:是|那间是)?([东西])排|([东西])排[^，。！？]{0,4}空着/u);
  if (empty && (empty[1] ?? empty[2]) !== '西') return '空屋';
  const own = text.match(/我(?:就)?住(?:在)?([东西])(?:排|边)([^，。！？]{0,5})/u);
  if (own && ROOMS[selfActorId]) {
    const room = ROOMS[selfActorId];
    if (!room.startsWith(`${own[1]}排`) || !sameOrdinal(own[2], room)) return NAMES[selfActorId];
  }
  for (const [actorId, name] of Object.entries(NAMES)) {
    // （掌柜、守卫不住院里，说他们住东排西排也算对不上。）
    const room = ROOMS[actorId] ?? '';
    const said =
      text.match(new RegExp(`${name}[^，。！？]{0,4}住(?:在)?([东西])(?:排|边)([^，。！？]{0,5})`, 'u')) ??
      text.match(new RegExp(`([东西])(?:排|边)([^，。！？]{0,6})住着?(?:个|的是)?${name}`, 'u'));
    if (said && (!room.startsWith(`${said[1]}排`) || !sameOrdinal(said[2], room))) return name;
  }
  return undefined;
}
// 简称同时是地名的（"药圃"既是凝露药圃，也是药圃弟子的简称）：只认全名。
const PLACE_LIKE_ALIASES = new Set(['药圃']);

// 说累只算说自己的：同一句里，"累"前面最近的主语是"你/道友"的（"倒是你，看着有点乏"），是说玩家，不算。
function saysSelfTired(text) {
  return text.split(/[。！？]/u).some((sentence) => {
    const match = sentence.match(TIRED_CLAIM);
    if (!match) return false;
    const before = sentence.slice(0, match.index);
    // 说的是别人（"你""道友""他""她"在"我"之后最近）就不算；v1.6 补"他成日累得慌"（说疲惫弟子）。
    const lastOther = Math.max(before.lastIndexOf('你'), before.lastIndexOf('道友'), before.lastIndexOf('他'), before.lastIndexOf('她'));
    return !(lastOther >= 0 && lastOther > before.lastIndexOf('我'));
  });
}

// 核对 AI 说的一句话。situation 是他那一刻的处境（试验台和试玩窗口记下的那份）。
// 返回：提到了几处可核对的事（mentions）、对得上的几处（supported）、冒名几处、对不上的是哪几类。
export function checkAiLine(text, situation, selfActorId) {
  let mentions = 0;
  let supported = 0;
  let identityErrors = 0;
  const unsupported = [];
  const known = new Set([
    selfActorId,
    ...situation.news.flatMap((entry) => entry.aboutActorIds),
    ...situation.opinions
      .filter((entry) => entry.relationship >= 15 || entry.trouble > 0 || entry.warmth > 0 || entry.suspicion > 0)
      .map((entry) => entry.actorId),
    // 近 7 天打过交道的人（卖药给掌柜、说过话、送过东西、吵过架）。
    ...(situation.metActorIds ?? []),
    // 待会儿要去找的人（提示词里写着"待会儿要去找某某说点事"，v1.7 第七轮补）。
    ...Object.entries(NAMES)
      .filter(([, name]) => situation.next?.personName === name)
      .map(([actorId]) => actorId),
  ]);
  for (const [actorId, name] of Object.entries(NAMES)) {
    const short = name.replace(/弟子$/u, '');
    if (!text.includes(name) && (PLACE_LIKE_ALIASES.has(short) || !text.includes(short))) continue;
    if (short.length < 2) continue;
    mentions += 1;
    // 河湾掌柜是山里唯一的铺子掌柜（世界设定里写着），说"去坊市问河湾掌柜""掌柜那儿收药"算知道的事（第五轮补）。
    const shopRole = actorId === 'life:q6:merchant' && /坊市|药铺|铺子|收|卖|买/u.test(text);
    if (known.has(actorId) || shopRole) supported += 1;
    else unsupported.push(name);
    if (actorId !== selfActorId && new RegExp(`我(?:就)?是${name}`, 'u').test(text)) identityErrors += 1;
  }
  for (const [pattern, kinds] of ACTIVITY_CLAIMS) {
    const found = text.match(pattern);
    if (!found) continue;
    // 顿号串起来的几样（"无非是采药、当值、接些委托"）是在说大家平常做什么，不是说他自己（第六轮补）。
    const around = `${text[found.index - 1] ?? ''}${text[found.index + found[0].length] ?? ''}`;
    if (around.includes('、')) continue;
    mentions += 1;
    if (kinds.some((kind) => situation.recentActivityKinds.includes(kind))) supported += 1;
    else unsupported.push(String(pattern));
  }
  const herbs = situation.ownHerbs ?? (situation.giftable ? 1 : 0);
  const has = (pattern) => (value) => pattern.test(value);
  const checks = [
    [has(ITEM_CLAIM), herbs > 0, 'item'],
    [(value) => inventedMention(value, INVENTED_PLACE) !== undefined, false, 'place'],
    [has(PROMISE), false, 'promise'],
    [has(PURCHASE_CLAIM), false, 'purchase'],
    [saysSelfTired, situation.fatigue >= 30, 'tired'],
    // situation.player 是这段话开始时的往来（试验台和试玩窗口记下的那份）。
    [has(PAST_CLAIM), (situation.player?.visits ?? 0) > 0, 'memory'],
    [has(SELF_QUARREL_CLAIM), (situation.recentEvents ?? []).some((event) => /吵/u.test(event)), 'quarrel'],
    // （"管事的都是内门那边的人""师父在内门才有"说的是内门，和常识单对得上：第六、七轮补。）
    [(value) => inventedMention(value.replace(/(?:管事|师父|师傅)的?[^，。！？]{0,4}内门/gu, '内门'), INVENTED_PERSON) !== undefined || OUTER_OFFICIAL.test(value), false, 'person'],
    [(value) => inventedHerbName(value) !== undefined, false, 'herb'],
    [(value) => roomClaimWrong(value, selfActorId) !== undefined, false, 'room'],
    [(value) => inventedMention(value, INVENTED_ROUTE) !== undefined, false, 'route'],
  ];
  for (const [matches, ok, mention] of checks) {
    if (!matches(text)) continue;
    mentions += 1;
    if (ok) supported += 1;
    else unsupported.push(mention);
  }
  for (const [pattern, field] of DAY_CLAIMS) {
    const match = text.match(pattern);
    if (!match || !Array.isArray(situation[field])) continue;
    mentions += 1;
    if (situation[field].includes(DAY_VERB_KIND[match[1]])) supported += 1;
    else unsupported.push(field);
  }
  return { mentions, supported, identityErrors, unsupported };
}

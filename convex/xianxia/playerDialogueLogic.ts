import { HUMAN_NEWS_SALIENCE, humanGossipChance, type HumanNewsKind } from './humanSocietyLogic';
import {
  ATTITUDE_WORD,
  PLAYER_ACTOR_ID,
  VOICE_ACCUSE_CHANCE,
  apologyStanding,
  type DialogueAttitude,
  type PlayerTone,
} from './playerAffinityLogic';
import {
  DIALOGUE_LIFE_FACTS_Q6,
  DIALOGUE_PERSONAS,
  DIALOGUE_ROOMS_Q6,
  DIALOGUE_PHRASEBOOK,
  DIALOGUE_WORLD_Q6,
  type DialoguePersona,
  type DialoguePhrase,
  type DialogueVoice,
  type DialogueWorldSheet,
} from './playerDialoguePersonas';
import { seededRoll } from './rules';
import { estimateSocialPromptTokens } from './socialModelPolicy';

// 玩家对话 v1：规则做主，模板说常用话，AI 只补规则接不住的话。全部是纯函数：
//   开不开口、聊多久、什么时候收尾，由规则定；收尾的理由照实说他接下来要做的事；
//   寒暄、告别、道谢、说在忙什么、讲听来的事、评人、推辞、回绝出戏的话，走人设模板；
//   其余的话才交给 AI：所有人共用的世界单在最前、人物卡其次（都不变，命中缓存），处境和事实在后；
//   事实全部来自规则层，AI 不记事，也不能改世界（它只能说一句话，或说要收尾）。
//   好感度（v1.3）：玩家的口气由规则判（骂人、威胁、粗话、敷衍、关心、夸人），好感度的加减、翻脸、冷淡
//   都由规则做（playerAffinityLogic.ts）；AI 只拿到"你对他"一个词，最多在回话里附一个口气标签。
// v1.5（道歉这轮试玩后）：英文、粤语和更多方言脏话归骂人；"灵草你""明日你"不再误判成骂人；
// 得罪过他（含 AI 判的无礼）才收得下道歉，同一回只认一次；"我叫什么"是问他记不记得，不是报名字；
// 常见的告别、问好、应答、夸人（bye、又见面了、好欸、久仰）由规则接。
// v1.6：记得聊过的事（表白、自称身份、说要请吃送礼、想买东西、说还会再来……），记下哪天、几回，下回见面用上。
// v1.7：山里的生活常识（吃、住、路、灵草、买卖、管事），玩家说到哪类，规则才把那一条带给 AI。
// v1.8：常识粘住几句（玩家说到的那条，这段话接下来两句还带着），每句最多约 150 token；AI 的话说出口前先过检查器，
// 对不上的重说一次，还不对就换成规则的话（核对在 godot-taixu-client/tools/player_dialogue_engine.mjs）。
// 依据：docs/玩家对话过关标准.md、docs/世界逻辑/青岚山外门_生活常识_草案.md。

export const PLAYER_DIALOGUE_VERSION = 'taixu.player-dialogue.v1.8' as const;

export type DialogueNews = {
  newsId: string;
  kind: HumanNewsKind;
  // 按这个 NPC 自己知道的版本说出来的话（可能是听错的）；predicate 是去掉主语的那半句，
  // 说到这个人时可以换成"他"。
  text: string;
  predicate: string;
  heardTick: number;
  source: 'direct' | 'witness' | 'told';
  // [做事的人, 被做事的人]（按他知道的版本）。
  aboutActorIds: string[];
};

export type DialogueOpinion = {
  actorId: string;
  name: string;
  relationship: number;
  warmth: number;
  trouble: number;
  suspicion: number;
};

// 规则层排好的下一件事（收尾时照实说）。stay：接着做手上（或歇口气之前）的那件事，不用走；
// placeName：要先去的地方（就在这儿做的不填）。
export type DialogueNext = {
  kind: string;
  stay: boolean;
  placeName?: string;
  personName?: string;
};

export type DialogueSituation = {
  day: number;
  clock: string;
  hour: number;
  placeName: string;
  // 手上的事，例如"修炼""采药""歇脚""当值""守铺子"。
  activity: string;
  // 正在做事（修炼、采药、当值……），而不是闲着。
  busy: boolean;
  // 正歇口气，歇完要接着做的事（例如"修炼"）。
  breakFrom?: string;
  focus?: 'cultivation' | 'livelihood' | 'social' | 'idle';
  dutyDay?: boolean;
  // 明天的打算，例如"修炼一天"。
  plan: string;
  next?: DialogueNext;
  bedtimeHour: number;
  fatigue: number;
  mood: number;
  recentEvents: string[];
  news: DialogueNews[];
  opinions: DialogueOpinion[];
  player: {
    relationship: number;
    met: boolean;
    memory: string[];
    name?: string;
    toldNewsIds: string[];
    // 以前见过几回、头一回是第几天。
    visits?: number;
    firstDay?: number;
    // 问过他对谁的看法、他当时说的是哪一档（看法没变，再问就说"上回说过"）。
    askedAbout?: Record<string, DialoguePhrase>;
    // 骂过、威胁过他几回；哪一天跟他赔过不是；得罪他还没赔过不是的有多少（见 playerAffinityLogic）。
    insults?: number;
    lastApologyDay?: number;
    apologyOwed?: number;
    // 记得的往事各是哪天说的、说了几回（v1.6；键是 memory 里的那句）；见面时已经先提过的往事。
    memoryLog?: Record<string, MemoryEntry>;
    recalled?: string[];
  };
  // 手头有没有能送人的灵草（自己的、不是答应了别人的）；ownHerbs 是株数。
  giftable: boolean;
  ownHerbs?: number;
  // 他眼下对道友的态度（规则按好感度和恩怨算的）；不给就当"没什么看法"。
  attitude?: DialogueAttitude;
};

function isCold(situation: DialogueSituation) {
  return situation.attitude === 'cold' || situation.attitude === 'hostile';
}

// 说的是道友本人的事（"道友骂了卖药弟子"），不当新鲜事讲给道友本人听。
function aboutPlayer(entry: DialogueNews) {
  return entry.aboutActorIds.includes(PLAYER_ACTOR_ID);
}

export type PlayerIntent =
  | 'insult'
  | 'threat'
  | 'out_of_world'
  | 'false_claim'
  | 'crude'
  | 'apology'
  | 'backchannel'
  | 'care'
  | 'praise'
  | 'farewell'
  | 'thanks'
  | 'remember_me'
  | 'request_item'
  | 'ask_person'
  | 'ask_self'
  | 'ask_activity'
  | 'ask_plan'
  | 'ask_news'
  | 'introduce'
  | 'greeting'
  | 'free';

// askName：问的是"我叫什么"（remember_me 的一种，答名字）。
export type ClassifiedLine = { intent: PlayerIntent; personId?: string; playerName?: string; askName?: boolean };

// 出戏的话：现实世界的东西，或想让 NPC 跳出设定。
// （"AI"按整词找：英文里的 again、wait 不算。）
// （v1.6 补"好感度""NPC"这类游戏里的说法：山里的人听不懂。"对你有好感"不算。）
const OUT_OF_WORLD =
  /人工智能|\bAI\b|OpenAI|模型|程序|提示词|prompt|system|手机|电脑|互联网|网络|ChatGPT|DeepSeek|机器人|忽略之前|设定|扮演|英文|English|代码|好感度|\bNPC\b/iu;

// 硬说他答应过、欠了什么（"你答应过送我灵草""你欠我灵石"）。NPC 在对话里从不许诺、也不欠玩家东西，
// 所以这类话一定对不上，由规则直接回"没这回事"，不交给 AI（免得 AI 顺着认下）。
// 以后规则真会记下承诺时，这里要先查记着的承诺。
// v1.6 补："昨天说好的那株灵芝还有么"（自测里 AI 顺着认了"灵芝的事小店记下了"）——NPC 在对话里从不跟人约定什么，
// 说"昨天、上回说好的"就一定对不上。
const FALSE_CLAIM =
  /你(?:上次|上回|之前|那天|前几天)?(?:答应过?|说好了?|说过要|说要|保证过?)(?:要)?(?:送|给|带|帮|教|还)|你(?:还)?欠我|说好的(?:灵草|灵石|东西)|你不是说要(?:送|给|带|帮)|(?:昨天|昨儿|前天|上回|上次|之前|那天|前几天)[^，。！？]{0,4}说好(?:了)?的/u;
// 问话：带着这些的，就算以问好开头（"早啊，昨儿我说啥来着？"），也是在问事，交给 AI。
const QUESTIONISH = /[？?]|什么|啥|吗|么|呢|怎么|哪|咋|多少|几时/u;

// "我是阿明""叫我小陆"里的名字。以这些字开头的、带疑问词的（"我叫什么"）、自报的身份，都不是名字。
const NOT_A_NAME = /^(?:新|刚|外门|内门|弟子|道友|你|谁|来|这|那|个|从|山|了)/u;
const QUESTION_WORD = /什么|啥|谁|哪|怎|几|吗|呢|么/u;
// 自报的身份、称号（"我是太子""我是仙人"）也不是名字：规则不记，交给 AI，按规矩不当真。
const CLAIMED_TITLE = /太子|皇帝|皇子|王爷|公主|仙人|仙君|上仙|宗主|掌门|长老|天帝|神仙|大能|帝君|城主|将军|圣人/u;
function nameFrom(raw: string | undefined) {
  const name = raw?.replace(/(?:就行|就好|就可以|便是|就是|就)?[吧呀啊哦呢嘛啦]*$/u, '');
  if (!name || NOT_A_NAME.test(name) || QUESTION_WORD.test(name) || CLAIMED_TITLE.test(name)) return undefined;
  return name;
}
// 问自己叫什么（"我叫什么""我叫什么名字""还记得我叫啥吗"）：问他记不记得，不是报名字。
const ASK_MY_NAME = /我叫(?:什么|啥|甚么)|我(?:的)?名字(?:是|叫)?(?:什么|啥)|(?:知道|记得|记住)我(?:叫|的名字)/u;
// 问他还记不记得自己（"还记得我吗""还认得我不"）。"你还记得我说要请你吃什么吗""还记得我昨儿说啥不"问的是一件事，交给 AI。
const REMEMBER_ME = /(?:记得|认得|认识)我(?:了)?(?:吗|么|嘛|不|没|吧|啊|呀|[？?!！。~～]|$)|知道我是谁|^我是谁[吗呀啊？?]*$/u;
// 问山里有什么新鲜事（"最近有什么新鲜事""听说了什么"）。"听说你会算数？""听说丹房闹鬼，真的假的"问的是一件具体的事，交给 AI。
const ASK_NEWS =
  /新鲜事|有什么(?:事|消息|传闻|新闻)|有啥(?:事|消息|新闻)|最近[^，。！？]{0,6}(?:事|消息)|(?:听说|听到)(?:了|过)?(?:什么|啥)|什么(?:消息|传闻)/u;

// 道歉（"对不起""我错了""是我不对""给你赔个不是"）。夹着骂人的道歉按骂人算（骂人先判）。
const APOLOGY = /对不起|抱歉|我错了|是我错了|是我不对|不好意思|原谅我|我道歉|向你道歉|赔个不是|赔不是|对不住|别生气了|别生我的?气/u;

// 骂人：冲着人骂的脏话、辱骂，含几处方言、粤语和英文的；整句只有"日""操""滚""屌""fuck"的也算。
// "草你""日你"只在句首、"我""老子"后面，或后面跟着"妈""娘"这类才算（"这灵草你要吗""明日你去哪"不算）。
const INSULT = new RegExp(
  [
    '操你|艹你|肏|草泥马|操死你|日死你|(?:^|我|老子)[日草艹]你|[日草艹]你(?:妈|娘|大爷|祖宗|全家|奶奶|姥姥|先人)',
    '你他妈|傻[逼屄比bB狗]|蠢狗|煞笔|沙比|\\bsb\\b|nmsl|你妈的|你妈逼|你娘的|狗东西|王八蛋|王八羔子|混蛋|贱人|贱货|贱种|杂种',
    '蠢货|蠢猪|蠢材|蠢才|白痴|智障|弱智|脑残|神经病|二百五|废物|窝囊废|饭桶|人渣|畜生|婊子|不要脸|老不死|丑八怪|猪脑子|你是猪',
    '去死|死开|滚蛋|滚开|给我滚|滚犊子|你放屁|放你的屁|放狗屁|狗屁',
    // 方言
    '妈卖批|\\bmmp\\b|龟儿子|狗日的|狗娘养的|瓜批|哈批',
    // 粤语
    '丢雷|屌你|丢你老母|仆街|扑街|冚家铲|顶你个肺|食屎|收皮|痴线|戆居|\\bon9\\b|diu\\s*(?:lei|nei)',
    // 英文
    'fuck\\s*(?:you|u|off|ya|yourself|your|ur)\\b|motherfuck|suck\\s*my|\\bdick(?:head)?s?\\b|\\bbitch|\\basshole|\\bbastard|\\bcunt',
    '\\bidiot|\\bmoron|\\bstupid\\b|\\bdumb(?:ass)?\\b|\\bscrew\\s*you|\\bstfu\\b|\\bgtfo\\b|\\bslut|\\bwhore|\\bretard|\\bloser\\b|\\bjerk\\b',
    '^滚[!！。~～]*$|^(?:日|操|艹|屌)[!！。~～]*$|^(?:fuck|fk|fck|fuk|fxxk|f\\*+k)[!！。~～]*$',
  ].join('|'),
  'iu',
);
// 威胁、挑衅。
const THREAT = /杀了你|杀死你|打死你|弄死你|宰了你|揍你|砍了你|废了你|你打我呀|有种打我|来打我呀|^[？?]*杀[!！。？?~～]*$/u;
// 粗话：脱口而出的"卧槽""我靠""shit"，不是冲着他骂。整句只有这个时规则回一句；夹在话里的只降一点好感。
// "我靠采药过活""我草药采完了""他妈妈""你妹妹"不算。
const CRUDE =
  /卧槽|卧艹|握草|我[草艹曹擦](?![药木本地丛根叶屋鞋帽席率稿图案])|我靠(?![着山吃采卖种修打自过活养])|妈的|他妈(?!妈)|尼玛|你妹(?!妹)|tmd|\bwc\b|\bwtf\b|\bshit\b|\bdamn\b|what\s*the\s*(?:hell|heck)|\bfuck(?:ing|in)?\b/iu;
const CRUDE_ONLY =
  /^(?:卧槽|卧艹|握草|我[草艹曹擦日]|我靠|妈的|他妈的?|尼玛|你妹|tmd|wc|wtf|shit|holyshit|damn|whatthe(?:fuck|hell|heck)|fucking|omg)+$/iu;
// 简短应答（整句就这几个字）。
const BACKCHANNEL =
  /^(?:哦+|噢+|喔+|嗯+|恩+|额+|呃+|啊+|行+|好+|好的|好吧|好嘞|好[欸耶呀啊哒滴嘛哇叭]|嗯[呢哪啊]|行[吧啊呀]|可以|成|妥|收到|了解|没|没有|不知道|不清楚|不晓得|是吗|是么|这样啊|这样|原来如此|原来是这样|对+|是+|是的|对的|对啊|对呀|对哦|是呢|是啊|也是|也对|有道理|确实|知道了|晓得了|明白了?|懂了|得嘞|哈+|呵+|嘿+|嘻+|哇+|哇哦|哦豁|ok+|okay|okey|嗯嗯|哦哦|噢噢)$/iu;
// 关心他。
// （"那少领点没事吧"问的是事，不是问他好不好：光"没事吧"只认整句。）
const CARE = /你还好吗|你没事吧|^没事吧[？?]*$|累不累|累了吧|辛苦了|保重|注意身体|别太累|伤好了吗|好些了吗|身体怎么样|歇一歇吧|歇会儿吧/u;
// 夸他（"久仰""听过你的大名"也算）。
const PRAISE =
  /你真厉害|真厉害|好厉害|厉害啊|佩服|了不起|你真好|你人真好|你是好人|真棒|有本事|好样的|久仰|如雷贯耳|名不虚传|大名鼎鼎|听过你的大名|高明|真能干|太强了|仙风道骨|气度不凡|仰慕|敬佩|崇拜|你(?:真|好|长得)?(?:好看|漂亮|帅|美)/u;
// 问他明天、接下来要做什么。
const ASK_PLAN =
  /(?:你|您)[^，。！？]{0,4}(?:明天|打算|接下来|之后)|明天[^，。！？]{0,6}(?:做什么|干什么|干嘛|去哪|忙什么|打算)|接下来[^，。！？]{0,4}(?:做什么|干什么|干嘛|去哪)|有什么打算/u;
// 告别（含英文的 bye；整句只有"88""拜"的也算）。
const FAREWELL =
  /再见|告辞|先走了|回头见|改天见|拜别|我走了|我走啦|不打扰了|拜拜|白白|回聊|下次聊|下回聊|改天聊|告退|失陪|后会有期|先撤了|我撤了|晚安|^(?:bye|bye-?bye|good-?bye|see\s*(?:you|ya|u)|cya|gtg|ttyl)\b|^(?:88|886|拜)[!！。~～]*$/iu;
// 问好（含"又见面了""好久不见"）；英文问候也当问候。
// （"早饭几点开"的"早"不是问早：早后面跟着饭、餐、点、起的不算。）
const GREETING =
  /^(?:你好|您好|见过|打扰|嗨|哈喽|哈啰|早(?![饭餐点起课])|晚上好|道友好|又见面|好久不见|久违|幸会|有礼了|在吗|在不在|早上好|上午好|中午好|下午好|师兄好|师姐好|前辈好|掌柜好|掌柜的好|大哥好|大姐好)/u;
const ENGLISH_GREETING = /^(?:hi|hello|hey|hiya|yo|halo|morning|good\s*(?:morning|afternoon|evening))\b/iu;

// 去掉标点和空白，看整句是什么。
function bareLine(line: string) {
  return line.replace(/[\s，。！？、,.!?~～…·'"“”]+/gu, '');
}

// 模型回话里不许出现的现代词（出现就换成模板）。
export const OUT_OF_WORLD_REPLY_WORDS =
  /人工智能|\bAI\b|语言模型|模型|程序|提示词|prompt|system|手机|电脑|互联网|ChatGPT|DeepSeek|机器人|设定|扮演/iu;

export function dialogueAliases(name: string) {
  const aliases = new Set([name]);
  if (name.endsWith('弟子') && name.length > 2) aliases.add(name.slice(0, -2));
  if (name === '谨慎行脚弟子') aliases.add('行脚');
  if (name === '丹房守卫') aliases.add('守卫');
  if (name === '河湾掌柜') aliases.add('掌柜');
  if (name === '远行采药人') aliases.add('采药人');
  return [...aliases].filter((alias) => alias.length >= 2);
}

// 玩家这句话是什么意思：按关键词判断，判断不了的交给 AI。
// npcAsked：他上一句是在问玩家（以问号结尾）——这时玩家答"没""嗯"是在回他的话，交给 AI 接，免得答非所问。
export function classifyPlayerLine(
  text: string,
  people: ReadonlyArray<{ actorId: string; name: string }>,
  selfActorId?: string,
  options: { npcAsked?: boolean } = {},
): ClassifiedLine {
  const line = text.trim();
  const bare = bareLine(line);
  if (INSULT.test(line) || INSULT.test(bare)) return { intent: 'insult' };
  if (THREAT.test(line)) return { intent: 'threat' };
  if (OUT_OF_WORLD.test(line)) return { intent: 'out_of_world' };
  if (FALSE_CLAIM.test(line)) return { intent: 'false_claim' };
  if (CRUDE_ONLY.test(bare)) return { intent: 'crude' };
  if (APOLOGY.test(line)) return { intent: 'apology' };
  if (BACKCHANNEL.test(bare)) return options.npcAsked ? { intent: 'free' } : { intent: 'backchannel' };
  if (FAREWELL.test(line)) return { intent: 'farewell' };
  if (/谢谢|多谢|谢了|感谢/u.test(line)) return { intent: 'thanks' };
  if (ASK_MY_NAME.test(line)) return { intent: 'remember_me', askName: true };
  if (REMEMBER_ME.test(line)) return { intent: 'remember_me' };
  // 要灵草、药（规则管得了的东西）；"心得能借我瞄两眼不"这类要别的，交给 AI。
  if (/(?:能送我|送我一|给我一|借我|能不能给我|分我)[^，。！？]{0,6}(?:灵草|草|药)|(?:灵草|草药)[^，。！？]{0,6}(?:送我|给我|分我|借我)/u.test(line)) {
    return { intent: 'request_item' };
  }
  const mentioned = people.find(
    (person) => person.actorId !== selfActorId && dialogueAliases(person.name).some((alias) => line.includes(alias)),
  );
  if (mentioned && /怎么样|如何|为人|人怎么|觉得|这人|那人|好不好/u.test(line)) {
    return { intent: 'ask_person', personId: mentioned.actorId };
  }
  if (CARE.test(line)) return { intent: 'care' };
  // 夸的是别人（说到了旁人）就不算夸他。
  if (!mentioned && PRAISE.test(line)) return { intent: 'praise' };
  if (/你是个什么样的人|说说你自己|你是谁|你叫什么|介绍一下你/u.test(line)) return { intent: 'ask_self' };
  if (/在忙什么|忙什么呢|干什么呢|做什么呢|忙啥|在做什么|在干嘛/u.test(line)) return { intent: 'ask_activity' };
  // 问他之后要做什么（"我打算追你"是玩家自己的打算，不算）。
  if (ASK_PLAN.test(line)) return { intent: 'ask_plan' };
  if (ASK_NEWS.test(line)) return { intent: 'ask_news' };
  const named = nameFrom(line.match(/(?:叫我|我叫)([一-龥]{1,4})/u)?.[1]);
  // "我是阿明"：两三个字、后面就断句的才当名字。
  const playerName = named ?? nameFrom(line.match(/我是([一-龥]{2,3})(?=[，。！？,.!?\s~～]|$)/u)?.[1]);
  if (playerName || /我是新来的|我刚来|初来乍到/u.test(line)) {
    return { intent: 'introduce', playerName };
  }
  // 只是问好才算问好；问好后面跟着一句问话（"早啊，昨儿我说啥来着？"），交给 AI 接那句问话。
  if ((GREETING.test(line) || ENGLISH_GREETING.test(line)) && !(bare.length > 6 && QUESTIONISH.test(line))) return { intent: 'greeting' };
  return { intent: 'free' };
}

// —— 记得聊过的事（v1.6）——
// 玩家说过的要紧事，由规则从他的原话里认出来，记成 NPC 口吻的一句（"向我表白过"），并记下哪天说的、说了几回。
// 下回见面：给 AI 的处境里写最要紧的三件（"前天向你表白过（两回）"）；问"还记得我吗"答最要紧的那件；
// 本来就愿意开口的人，隔天见面会先提一句（每件只提一次）。
// 每类事记多久、多要紧各不相同（照 RimWorld 的社交记忆，每类有自己的时长）：骂人、表白记得最久，
// 问过什么、说过怪话几天就淡；淡了的不再写进处境、不再提，规则层的记录不删。依据：过关标准第五节。

export type MemoryKind =
  | 'grudge'
  | 'romance'
  | 'apology'
  | 'identity'
  | 'false_claim'
  | 'offer'
  | 'return'
  | 'request'
  | 'kindness'
  | 'weird'
  | 'asked'
  | 'rude'
  | 'said'
  | 'name';

// weight：多要紧（挑往事时先看它）；keepDays：过了这么多天就淡了；opening：隔天见面值得先提一句。
export const MEMORY_KINDS: ReadonlyArray<{ kind: MemoryKind; match: RegExp; weight: number; keepDays: number; opening?: boolean }> = [
  { kind: 'grudge', match: /^(?:骂过我|威胁过我)$/u, weight: 9, keepDays: 60 },
  { kind: 'romance', match: /^向我表白过$/u, weight: 8, keepDays: 60, opening: true },
  { kind: 'apology', match: /^跟我赔过不是$/u, weight: 7, keepDays: 30 },
  // 规则没认出骂人、AI 判了无礼的话（"你像块木头"）：也记着，冷着你时会说起。
  { kind: 'rude', match: /^对我说过难听的话$/u, weight: 7, keepDays: 30 },
  { kind: 'identity', match: /^说自己是/u, weight: 6, keepDays: 30, opening: true },
  { kind: 'false_claim', match: /^硬说我答应过什么$/u, weight: 6, keepDays: 30 },
  { kind: 'offer', match: /^说要(?:请我|送我|给我|买下我)/u, weight: 5, keepDays: 14, opening: true },
  { kind: 'return', match: /^说过还会再来找我$/u, weight: 4, keepDays: 3, opening: true },
  { kind: 'request', match: /^(?:向我要过灵草|问过我买)/u, weight: 4, keepDays: 14 },
  { kind: 'kindness', match: /^(?:关心过我|夸过我)$/u, weight: 3, keepDays: 14 },
  { kind: 'weird', match: /^说过些听不懂的怪话$/u, weight: 3, keepDays: 7 },
  { kind: 'asked', match: /^问过我/u, weight: 2, keepDays: 7 },
  // 别的闲聊原话（"说过「听说你会算数？」"）：最不要紧，三天就淡；只给 AI 看，下回问"我昨天说啥了"答得上。
  { kind: 'said', match: /^说过「/u, weight: 1, keepDays: 3 },
  { kind: 'name', match: /^说你叫/u, weight: 0, keepDays: Number.POSITIVE_INFINITY },
];
const OTHER_MEMORY = { kind: 'asked' as const, weight: 1, keepDays: 7 };
export function memoryKindOf(text: string) {
  return MEMORY_KINDS.find((entry) => entry.match.test(text)) ?? OTHER_MEMORY;
}

// 示好、表白（"我有点喜欢你""你喜欢我吗""我打算追你""我爱你""好想你"）。"我喜欢你的灵草""我想你帮我"不算。
const ROMANCE = new RegExp(
  [
    '我(?:有点|有些|好|很|真的?|挺|最|也|特别)?(?:喜欢|爱)你(?![的家们这那])',
    '你[^，。！？]{0,6}爱我(?![的做])|你[^，。！？]{0,3}喜欢我(?![的做])|喜不喜欢我|爱不爱我',
    '爱上你|好想你|想你了|想你(?=[啊呀！!。~～]|$)|追你|谈恋爱|(?:结为|结成|做我的?)道侣|嫁给我|娶你|(?:和|跟)我在一起',
    '做我的?(?:媳妇|老婆|老公|夫君|娘子)',
  ].join('|'),
  'u',
);
// 自称妖、魔、太子之类的身份（"我是妖""我是大秦王朝的太子"）；"我是来采药的""我是你师兄"不算，名字另记。
const IDENTITY_CLAIM = /我(?:其实|本来)?(?:是|乃)([一-龥]{1,10}?)(?=[，。！？,.!?\s~～啊呀]|$)/u;
const IDENTITY_WORD = /妖|魔|鬼|神|仙|龙|精|怪|帝|皇|王|圣|佛|尊|太子|公主|掌门|长老|宗主|城主|将军/u;
// "我是被妖怪追过来的""我是为了修仙才来的""我是来找仙草的"说的是事，不是自称身份。
const IDENTITY_NOT_START = /^(?:被|从|来|在|去|为|因|跟|和|给|替|说|想|要|不|没|也|都|又|还|真|这|那|你|他|她)/u;
// 说要买下他的铺子、请他吃东西、给他钱、送他东西。"我送你回去""我给你说个事""我请你帮个忙"不算。
const OFFER_SHOP = /买下(?:你的|你这|这家|这间|这个)?(?:店|铺子|药铺|铺)/u;
const OFFER_FOOD =
  /请你(?:吃|喝)|给你(?:买|带|捎|做)了?[^，。！？]{0,16}(?:吃|喝|肉|饭|菜|酒|茶|点心|糕|饼|果|汤|粥)|要吃什么[^，。！？]{0,6}(?:给你|请你)/u;
// （"十两银子"的"两"才算钱，"送你两株灵草"是送东西；"送你一句话""送你一程"不是。）
const OFFER_MONEY = /(?:给你|送你)[^，。！？]{0,8}(?:灵石|银子|银两|钱|[\d一二三四五六七八九十百千万]两)/u;
const OFFER_GIFT = /送你(?:[一两几](?![句程])|个|件|株|份|点|些|样)|送你了|送给你/u;
// 想跟他买东西（"我想买药"）；问他要不要买（"你要买药吗"）不算。
const WANT_BUY = /(?:^|我)(?:想|要)买([一-龥]{1,4}?)(?=[，。！？,.!?\s~～吗呢啊]|$)/u;
// 说还会再来（"明天我再来找你""改天再来"）；问他明天来不来不算。
const WILL_RETURN =
  /明天(?:我)?(?:还|再)(?:来|找你)|改天(?:我)?(?:再|还)来|(?:下回|下次)(?:我)?(?:再|还)来|回头(?:我)?(?:再)?来找你|我(?:还)?会再来|我还会来/u;

// 从玩家的一句话里认出要记住的事（只看玩家的原话，不看 AI 的话）。骂人、威胁、道歉、报名字、问事、要东西、
// 硬编往事这几类由 ruleReply 记，这里不重复；骂人的话里别的不记。
export function memoriesFromLine(text: string, line: ClassifiedLine): string[] {
  if (line.intent === 'insult' || line.intent === 'threat') return [];
  // 问他记不记得的话（"你还记得我说要请你吃什么吗"）不是在说这件事，什么也不记（自测里被当成"说要请我吃东西"）。
  if (/记得|认得|记性|记不记/u.test(text)) return [];
  const found: string[] = [];
  if (ROMANCE.test(text)) found.push('向我表白过');
  const identity = text.match(IDENTITY_CLAIM)?.[1];
  if (identity && IDENTITY_WORD.test(identity) && !IDENTITY_NOT_START.test(identity) && !line.playerName) found.push(`说自己是${identity}`);
  if (OFFER_SHOP.test(text)) found.push('说要买下我的铺子');
  else if (OFFER_FOOD.test(text)) found.push('说要请我吃东西');
  else if (OFFER_MONEY.test(text)) found.push('说要给我钱');
  else if (OFFER_GIFT.test(text)) found.push('说要送我东西');
  const item = text.match(WANT_BUY)?.[1];
  if (item && !/[你我他她]/u.test(item)) found.push(`问过我买${item}`);
  if (WILL_RETURN.test(text)) found.push('说过还会再来找我');
  if (line.intent === 'care') found.push('关心过我');
  if (line.intent === 'praise') found.push('夸过我');
  if (line.intent === 'out_of_world') found.push('说过些听不懂的怪话');
  // 别的闲聊（交给 AI 接的话，四个字以上）：一字不改记下原话（太长就截短），问"记不记得"的话不记。
  if (found.length === 0 && (line.intent === 'free' || line.intent === 'ask_self') && bareLine(text).length >= 4) {
    found.push(`说过「${clipQuote(text)}」`);
  }
  return found;
}

// AI 的回话里已经提到的往事（之后见面不再先提）：表白、自称身份、说要请吃送礼、说还会再来，按字面找。
export function memoriesMentionedIn(text: string, memory: ReadonlyArray<string>) {
  return memory.filter((entry) => {
    const { kind } = memoryKindOf(entry);
    if (kind === 'romance') return /表白|喜欢|爱/u.test(text);
    if (kind === 'identity') return text.includes(entry.replace(/^说自己是/u, ''));
    if (entry === '说要请我吃东西') return /请.{0,3}吃|吃的/u.test(text);
    if (entry === '说要给我钱') return /给.{0,3}(?:钱|灵石|银子)/u.test(text);
    if (entry === '说要送我东西') return /送/u.test(text);
    if (entry === '说要买下我的铺子') return /买下|买铺子|买店/u.test(text);
    if (kind === 'return') return /再来|又来|真来/u.test(text);
    return false;
  });
}

// 记下一件事：头一回说是哪天、最近一回是哪天（哪个时刻）、说了几回。
// quote：玩家最近一回说这件事的原话（一字不改，太长就截短）。只给说要请吃、送东西、给钱、买铺子这类留，
// 好让他记得"请我吃红烧肉"而不只是"请我吃东西"（自测里她答成了"吃的倒没提是哪一样"）。
export type MemoryEntry = { firstDay: number; lastDay: number; lastTick: number; count: number; quote?: string };
export function noteMemory(
  log: Readonly<Record<string, MemoryEntry>> | undefined,
  text: string,
  tick: number,
  day: number,
  quote?: string,
): MemoryEntry {
  const before = log?.[text];
  const next = before ? { ...before, lastDay: day, lastTick: tick, count: before.count + 1 } : { firstDay: day, lastDay: day, lastTick: tick, count: 1 };
  return quote ? { ...next, quote } : next;
}

// 原话截短（「」换成引号，免得和外面的「」混在一起）。
export function clipQuote(text: string, limit = 16) {
  const plain = text.trim().replace(/[「」]/gu, '"');
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}
// 哪些往事要留原话：说要请吃、送东西、给钱、买铺子。
export function keepsQuote(memory: string) {
  return memoryKindOf(memory).kind === 'offer';
}

const CHINESE_DIGITS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];
// 多久以前，说成人话（按日历日算）：刚才（这段话里）、今天、昨天、前天、三天前……十来天前。
export function whenWord(daysAgo: number, sameTalk = false) {
  if (sameTalk) return '刚才';
  if (daysAgo <= 0) return '今天';
  if (daysAgo === 1) return '昨天';
  if (daysAgo === 2) return '前天';
  if (daysAgo < 10) return `${CHINESE_DIGITS[daysAgo]}天前`;
  if (daysAgo < 20) return '十来天前';
  if (daysAgo < 30) return '二十来天前';
  return '一个多月前';
}

export type RecalledMemory = {
  text: string;
  kind: MemoryKind;
  weight: number;
  opening: boolean;
  // 旧记录没有记哪天说的：when 为空，按今天算。
  when: string;
  daysAgo: number;
  sameTalk: boolean;
  count: number;
  quote?: string;
};

// 他眼下还记得的往事（没淡掉的），先挑要紧的，再挑新近的；名字另算，不在这里。nowTick：这段话的时刻
// （同一时刻记下的就是"刚才"这段话里说的）。
export function memoriesToRecall(player: DialogueSituation['player'], day: number, nowTick?: number): RecalledMemory[] {
  const log = player.memoryLog ?? {};
  return player.memory
    .map((text, order) => {
      const info = memoryKindOf(text);
      const entry = log[text];
      const daysAgo = entry ? Math.max(0, day - entry.lastDay) : 0;
      const sameTalk = entry !== undefined && nowTick !== undefined && entry.lastTick === nowTick;
      return {
        order,
        memory: {
          text,
          kind: info.kind,
          weight: info.weight,
          opening: 'opening' in info && info.opening === true,
          when: entry ? whenWord(daysAgo, sameTalk) : '',
          daysAgo,
          sameTalk,
          count: entry?.count ?? 1,
          ...(entry?.quote ? { quote: entry.quote } : {}),
        },
        keepDays: info.keepDays,
      };
    })
    .filter(({ memory, keepDays }) => memory.kind !== 'name' && memory.daysAgo <= keepDays)
    .sort((left, right) => right.memory.weight - left.memory.weight || left.memory.daysAgo - right.memory.daysAgo || right.order - left.order)
    .map(({ memory }) => memory);
}

// —— 山里的生活常识（v1.7）——
// 这几句话说到的常识（吃、住、路、灵草、买卖、管事）：先看玩家这句、再看他上一句，按常识单的顺序挑，只带一条
// （最初两条要多约 180 token，超了"约一百"的线）；没说到就一条不带，不多花 token。
export function lifeFactsFor(texts: ReadonlyArray<string>, facts = DIALOGUE_LIFE_FACTS_Q6, limit = 1) {
  const found: string[] = [];
  for (const text of texts) {
    for (const entry of facts) {
      if (found.length >= limit) return found;
      if (!found.includes(entry.fact) && entry.cue.test(text)) found.push(entry.fact);
    }
  }
  return found;
}

// —— 常识粘住几句（v1.8，照 SillyTavern 世界书的做法）——
// 玩家这句说到的常识，这段话接下来两句还带着：接着住处追问"东排北头有人住吗"，这句里没有能触发住处那条的字眼
// （v1.7 自测里就这么丢的）。每句最多约 150 token 的常识：先放玩家这句说到的（按常识单的顺序），再放粘着的
// （新近的在前），最后放 NPC 上一句说到的；第一条总放，后面的放得下才放，所以必要时能带两条。
// NPC 上一句说到的只带这一回，不粘（玩家没问，不多花）。
export const LIFE_FACT_STICKY_LINES = 2;
export const LIFE_FACT_BUDGET_TOKENS = 150;
export type StickyLifeFact = { fact: string; linesLeft: number };
export function lifeFactsForLine(input: {
  playerLine: string;
  lastNpcLine?: string;
  sticky?: ReadonlyArray<StickyLifeFact>;
  facts?: typeof DIALOGUE_LIFE_FACTS_Q6;
  budgetTokens?: number;
}): { facts: string[]; sticky: StickyLifeFact[] } {
  const sheet = input.facts ?? DIALOGUE_LIFE_FACTS_Q6;
  const budget = input.budgetTokens ?? LIFE_FACT_BUDGET_TOKENS;
  const fromPlayer = lifeFactsFor([input.playerLine], sheet, sheet.length);
  const fromNpc = input.lastNpcLine ? lifeFactsFor([input.lastNpcLine], sheet, sheet.length) : [];
  const carried = (input.sticky ?? []).filter((entry) => entry.linesLeft > 0).map((entry) => entry.fact);
  const chosen: string[] = [];
  let spent = 0;
  for (const fact of [...new Set([...fromPlayer, ...carried, ...fromNpc])]) {
    const cost = estimateSocialPromptTokens([{ content: fact }]);
    if (chosen.length > 0 && spent + cost > budget) continue;
    chosen.push(fact);
    spent += cost;
  }
  // 玩家这句说到的，从这句起再带两句；粘着、这句没再说到的，少一句，用完就不带。
  const sticky: StickyLifeFact[] = fromPlayer.map((fact) => ({ fact, linesLeft: LIFE_FACT_STICKY_LINES }));
  for (const entry of input.sticky ?? []) {
    if (!fromPlayer.includes(entry.fact) && entry.linesLeft > 1) sticky.push({ fact: entry.fact, linesLeft: entry.linesLeft - 1 });
  }
  return { facts: chosen, sticky };
}

// 说了几回（两回以上才说）。
function countWord(count: number) {
  return count >= 3 ? '（好几回）' : count === 2 ? '（两回）' : '';
}

// 这句话的口气（好感度怎么变）。粗话夹在别的话里，意思照常判，口气算粗话。
export function toneOfLine(line: ClassifiedLine, text: string): PlayerTone {
  switch (line.intent) {
    case 'insult':
      return 'insult';
    case 'threat':
      return 'threat';
    case 'crude':
      return 'crude';
    case 'false_claim':
      return 'false_claim';
    case 'care':
      return 'care';
    case 'praise':
    case 'thanks':
      return 'kind';
    case 'backchannel':
      return 'backchannel';
    // 道歉的好感由宿主按 applyApology 另算（只对骂过他的人有用），这里不按口气加减。
    case 'apology':
      return 'neutral';
    default:
      return CRUDE.test(text) ? 'crude' : 'neutral';
  }
}

function phraseVariants(voice: DialogueVoice, phrase: DialoguePhrase) {
  return DIALOGUE_PHRASEBOOK[voice][phrase] ?? DIALOGUE_PHRASEBOOK.steady[phrase] ?? [];
}

// 这类话里还有没说过的说法。
export function hasFreshPhrase(voice: DialogueVoice, phrase: DialoguePhrase, used: ReadonlySet<string>) {
  return phraseVariants(voice, phrase).some((variant) => !used.has(`${phrase}:${variant}`));
}

// 挑一句没用过的说法，填上事实。used 由调用方保存：同一个人对同一位玩家说过的说法，下次见面也算用过。
export function pickPhrase(
  voice: DialogueVoice,
  phrase: DialoguePhrase,
  seedKey: string,
  used: Set<string>,
  slots: Record<string, string> = {},
) {
  const variants = phraseVariants(voice, phrase);
  if (variants.length === 0) return undefined;
  const start = Math.floor(seededRoll(seedKey) * variants.length);
  let chosen = variants[start];
  for (let offset = 0; offset < variants.length; offset += 1) {
    const candidate = variants[(start + offset) % variants.length];
    if (!used.has(`${phrase}:${candidate}`)) {
      chosen = candidate;
      break;
    }
  }
  used.add(`${phrase}:${chosen}`);
  return chosen.replace(/\{(\w+)\}/gu, (_, key: string) => slots[key] ?? '');
}

export type DialogueAction =
  | { type: 'give_item' }
  | { type: 'tell_news'; newsId: string }
  | { type: 'apology' }
  | { type: 'end'; reason: string };

export type DialogueReply = {
  text: string;
  by: 'rule' | 'ai';
  phrase?: DialoguePhrase;
  // 这句话用到的事实（人名、事的编号），供核对。
  facts: string[];
  action?: DialogueAction;
  // 这句之后要记住的、和玩家有关的事。
  memory?: string;
  // 这句话里提到的往事（以后见面不再先提）。
  recalled?: string;
  // 说了对谁的看法、哪一档（记下来，下次再问时对照）。
  opinionGiven?: { personId: string; phrase: DialoguePhrase };
};

// 讲给人听的新鲜事：十天内听来的；挑最值得讲、还没跟玩家讲过的；自己是当事人的不当新鲜事讲。
export const DIALOGUE_NEWS_FRESH_HOURS = 10 * 24;
export function newsToTell(situation: DialogueSituation, selfActorId?: string, nowTick?: number) {
  return [...situation.news]
    .filter((entry) => !aboutPlayer(entry))
    .filter((entry) => !situation.player.toldNewsIds.includes(entry.newsId))
    .filter((entry) => !selfActorId || !entry.aboutActorIds.includes(selfActorId))
    .filter((entry) => nowTick === undefined || (nowTick - entry.heardTick) * 0.25 <= DIALOGUE_NEWS_FRESH_HOURS)
    .sort(
      (left, right) =>
        HUMAN_NEWS_SALIENCE[right.kind] - HUMAN_NEWS_SALIENCE[left.kind] ||
        right.heardTick - left.heardTick ||
        left.newsId.localeCompare(right.newsId),
    )[0];
}

// AI 的话里已经提到的听来的事（之后规则不再把它当新鲜事讲）。按字面找：事的关键词，
// 外加当事人的名字（受伤、白鹿这类说出关键词就算）。
const NEWS_MENTION: Record<HumanNewsKind, RegExp> = {
  quarrel: /吵|闹|过节|不和/u,
  apology: /赔|道歉|认错/u,
  gift: /送/u,
  commission: /委托/u,
  injury: /药瘴|受伤|伤了|伤得|伤着/u,
  sighting: /白鹿/u,
};
export function newsMentionedIn(text: string, news: ReadonlyArray<DialogueNews>) {
  return news
    .filter((entry) => NEWS_MENTION[entry.kind].test(text))
    .filter(
      (entry) =>
        entry.kind === 'injury' ||
        entry.kind === 'sighting' ||
        entry.aboutActorIds.some((actorId) =>
          dialogueAliases(DIALOGUE_PERSONAS[actorId]?.name ?? '').some((alias) => text.includes(alias)),
        ),
    )
    .map((entry) => entry.newsId);
}

// 对某人的看法落在哪一档：有怨 > 爱惹事 > 好友 > 不错 > 不熟。
export function opinionPhrase(opinion: DialogueOpinion | undefined): DialoguePhrase {
  if (!opinion) return 'personNeutral';
  if (opinion.suspicion >= 15) return 'personGrudge';
  if (opinion.trouble >= 1) return 'personBad';
  if (opinion.relationship >= 40) return 'personFriend';
  if (opinion.warmth >= 1 || opinion.relationship >= 25) return 'personGood';
  return 'personNeutral';
}

// 评人时带的那件事：说坏话配吵架，说好话配送东西、赔不是、交委托；不熟的人，听来什么说什么。
function storyFits(phrase: DialoguePhrase, kind: HumanNewsKind) {
  if (phrase === 'personBad') return kind === 'quarrel';
  if (phrase === 'personGood' || phrase === 'personFriend') return kind === 'gift' || kind === 'apology' || kind === 'commission';
  return phrase === 'personNeutral';
}

// 骂过、威胁过他（记在和玩家的往来里，下回见面他会说）。
export const GRUDGE_MEMORIES = ['骂过我', '威胁过我', '对我说过难听的话'];

// 规则能接的话就由规则说；接不住（问"你是个什么样的人"、随口的闲话）返回 undefined，交给 AI。
// opened：这段话是他先开的口（玩家再问好，就回一句，不再"是你啊"）。
// stormOff：规则算过火气，这一句他忍不住了，翻脸走开。
export function ruleReply(input: {
  persona: DialoguePersona;
  situation: DialogueSituation;
  line: ClassifiedLine;
  seedKey: string;
  used: Set<string>;
  nowTick?: number;
  opened?: boolean;
  stormOff?: boolean;
}): DialogueReply | undefined {
  const { persona, situation, line, seedKey, used } = input;
  const say = (phrase: DialoguePhrase, slots: Record<string, string> = {}) =>
    pickPhrase(persona.voice, phrase, `${seedKey}:${phrase}`, used, slots);
  const rule = (phrase: DialoguePhrase, slots: Record<string, string> = {}, extra: Partial<DialogueReply> = {}) => {
    const text = say(phrase, slots);
    return text === undefined ? undefined : { text, by: 'rule' as const, phrase, facts: [], ...extra };
  };
  const angry = (memory?: string) => rule('stormOff', {}, { action: { type: 'end', reason: 'npc_angry' }, ...(memory ? { memory } : {}) });
  const cold = isCold(situation);
  switch (line.intent) {
    case 'insult':
    case 'threat': {
      const memory = line.intent === 'insult' ? '骂过我' : '威胁过我';
      return input.stormOff ? angry(memory) : rule('rebuke', {}, { memory });
    }
    case 'crude':
      return input.stormOff ? angry() : rule('crudeReact');
    case 'apology': {
      // 得罪过他、还没赔过（骂人、威胁，也算粗话、硬编往事、AI 判的无礼）：收下，每天只认一次（宿主据 action
      // 加好感、减半冷淡期）；他记得的"骂过我"不消失，另记一笔。赔过了、或今天已经赔过：说过了。
      const standing = apologyStanding(situation.player, situation.day);
      if (standing === 'owed') {
        return rule(situation.attitude === 'hostile' ? 'apologyCold' : 'apologyAccepted', {}, { memory: '跟我赔过不是', action: { type: 'apology' } });
      }
      if (standing !== 'none') return rule('apologyAgain');
      // 没得罪过他、只是听说你骂了别人：让你去跟被骂的人说。
      const heard = situation.news.find((entry) => aboutPlayer(entry));
      if (heard) return rule('apologyElsewhere', { person: DIALOGUE_PERSONAS[heard.aboutActorIds[1] ?? '']?.name ?? '人家' });
      return rule('apologyNone');
    }
    case 'backchannel':
      return rule('ack');
    case 'care':
      return rule('caredFor');
    case 'praise':
      return rule('praised');
    case 'out_of_world':
      return rule('outOfWorld');
    case 'false_claim':
      return input.stormOff ? angry('硬说我答应过什么') : rule('denyClaim', {}, { memory: '硬说我答应过什么' });
    case 'greeting':
      // 冷着你的人，就算是他先开的口，回你的问好也是冷的。
      // 没见过面、只是听说了你的事而冷着的，冷冷地问一句"有事？"，不说"是你"。
      return rule(
        cold ? (situation.player.met ? 'greetCold' : 'greetColdStranger') : input.opened ? 'greetBack' : situation.player.met ? 'greetKnown' : 'greetStranger',
      );
    case 'farewell':
      return rule('farewell', {}, { action: { type: 'end', reason: 'player_left' } });
    case 'thanks':
      return rule('thanks');
    case 'ask_activity': {
      const phrase = situation.busy ? 'activity' : situation.breakFrom ? 'activityBreak' : 'activityIdle';
      return rule(
        phrase,
        { place: situation.placeName, activity: situation.activity, breakFrom: situation.breakFrom ?? '' },
        { facts: ['activity'] },
      );
    }
    case 'ask_plan':
      return rule('plan', { plan: situation.plan }, { facts: ['plan'] });
    case 'ask_news': {
      const news = newsToTell(situation, persona.actorId, input.nowTick);
      // 没有新的可讲：跟玩家讲过事的，说"就这些了"；没讲过的，说没听说什么。
      if (!news) {
        return rule(situation.player.toldNewsIds.length > 0 ? 'newsNoMore' : 'newsNone', {}, { memory: '问过我山里的新鲜事' });
      }
      // 吵架、受伤这类坏事，心软的人会叹口气（没有这种说法的就照常说）。
      const bad = news.kind === 'quarrel' || news.kind === 'injury';
      const phrase = bad && DIALOGUE_PHRASEBOOK[persona.voice].newsTellBad ? 'newsTellBad' : 'newsTell';
      return rule(phrase, { news: news.text }, {
        facts: [news.newsId],
        action: { type: 'tell_news', newsId: news.newsId },
        memory: '问过我山里的新鲜事',
      });
    }
    case 'ask_person': {
      const personId = line.personId ?? '';
      const opinion = situation.opinions.find((entry) => entry.actorId === personId);
      const name = opinion?.name ?? DIALOGUE_PERSONAS[personId]?.name ?? '那人';
      const phrase = opinionPhrase(opinion);
      const base = say(phrase, { person: name });
      if (base === undefined) return undefined;
      // 有亲见或听来的事作底，就带一句（有怨的人不细说；不熟的人，跟玩家讲过的事不再讲）。
      const story =
        phrase === 'personGrudge'
          ? undefined
          : situation.news.find(
              (entry) =>
                entry.aboutActorIds[0] === personId &&
                storyFits(phrase, entry.kind) &&
                !(phrase === 'personNeutral' && situation.player.toldNewsIds.includes(entry.newsId)),
            );
      let text = base;
      if (story && phrase === 'personNeutral') {
        text += story.source === 'told' ? `倒是听说他${story.predicate}。` : `那回他${story.predicate}，我正好在。`;
      } else if (story) {
        text += `${story.source === 'told' ? '听说' : ''}他${story.predicate}。`;
      }
      // 上回问过、看法没变：先说一句"上回说过"。
      if (situation.player.askedAbout?.[personId] === phrase) text = say('personAgain', { base: text }) ?? text;
      return {
        text,
        by: 'rule',
        phrase,
        facts: [personId, ...(story ? [story.newsId] : [])].filter(Boolean),
        // 带出来的那件事，也算跟玩家讲过了。
        ...(story ? { action: { type: 'tell_news' as const, newsId: story.newsId } } : {}),
        memory: `问过我${name}的为人`,
        opinionGiven: { personId, phrase },
      };
    }
    case 'remember_me': {
      // 答最要紧、没淡掉的那件往事：这段话里刚说的不算"上回"；闲聊原话、已了结的"还会再来"不拿来答；
      // 见面时已经提过的，有别的就说别的。
      const brought = situation.player.recalled ?? [];
      const candidates = memoriesToRecall(situation.player, situation.day, input.nowTick).filter(
        (entry) => !entry.sameTalk && entry.kind !== 'said' && entry.kind !== 'return',
      );
      const memory = (candidates.find((entry) => !brought.includes(entry.text)) ?? candidates[0])?.text;
      // 冷着、又被骂过：记得，而且记的是这个。
      const grudge = situation.player.memory.filter((entry) => GRUDGE_MEMORIES.includes(entry)).at(-1);
      if (situation.player.met && cold && grudge) return rule('rememberCold', { memory: grudge }, { facts: ['player_memory'], recalled: grudge });
      // 问"我叫什么"：报过名字（这段话里刚报的也算）就照说，没报过就说没报过。
      if (line.askName) {
        return situation.player.name ? rule('nameKnown', { name: situation.player.name }, { facts: ['player_name'] }) : rule('nameUnknown');
      }
      // 没见过才说"没印象"；见过、只是没什么要紧的事，就说"来找过我"。
      if (!situation.player.met) return rule('rememberNone');
      const extra = { facts: ['player_memory'], ...(memory ? { recalled: memory } : {}) };
      return situation.player.name
        ? rule('rememberNamed', { name: situation.player.name, memory: memory ?? '来找过我' }, extra)
        : rule('remember', { memory: memory ?? '来找过我' }, extra);
    }
    case 'introduce':
      return rule('introduceAck', {}, {
        memory: line.playerName ? `说你叫${line.playerName}` : '说你是新来的',
      });
    case 'request_item':
      if (!situation.giftable) return rule('giveNone', {}, { memory: '向我要过灵草' });
      // 冷着的人不送。
      if (cold) return rule('giveNo', {}, { memory: '向我要过灵草' });
      return situation.player.relationship >= 20
        ? rule('giveYes', {}, { action: { type: 'give_item' }, memory: '向我要过灵草' })
        : rule('giveNo', {}, { memory: '向我要过灵草' });
    case 'ask_self':
    case 'free':
      return undefined;
  }
}

// —— 开口 ——

const VOICE_OPENNESS: Record<DialogueVoice, number> = {
  warm: 0.7,
  upright: 0.65,
  shrewd: 0.65,
  gentle: 0.6,
  merchant: 0.6,
  steady: 0.35,
  wary: 0.25,
  curt: 0.15,
  formal: 0.1,
};

// recalled：开口时先提的那件往事（宿主记下，以后不再提）。
export type DialogueOpening =
  | { open: false; reason: 'asleep' | 'on_duty' | 'not_inclined' | 'cold' | 'hostile' }
  | { open: true; reason: 'news' | 'known' | 'newcomer' | 'accuse' | 'recall'; text: string; newsId?: string; recalled?: string };

// 隔天见面值得先提的往事：示好、自称身份、说要请吃送礼、说还会再来；不是今天说的，没淡掉，以前没提过。
// 说过还会再来、人真来了，最该先说这个（"还真来了"）。
export function memoryToBringUp(situation: DialogueSituation, nowTick?: number) {
  const brought = situation.player.recalled ?? [];
  const candidates = memoriesToRecall(situation.player, situation.day, nowTick).filter(
    (entry) => entry.opening && entry.daysAgo >= 1 && !brought.includes(entry.text),
  );
  return candidates.find((entry) => entry.kind === 'return') ?? candidates[0];
}

// 这一回见面就了结的往事：说过还会再来的，人来了，这事就过去了——见面时提没提都一样，以后不再"还真来了"。
export function memoriesSettledByVisit(situation: DialogueSituation, nowTick?: number) {
  return memoriesToRecall(situation.player, situation.day, nowTick)
    .filter((entry) => entry.kind === 'return' && entry.daysAgo >= 1)
    .map((entry) => entry.text);
}

// 亲眼看见的事是多久以前：两个钟头内"刚才"，同一天"今天"，再往前"昨天""前天""那天"（一刻 0.25 小时）。
function sawWhen(heardTick: number, day: number, nowTick?: number) {
  if (nowTick !== undefined && (nowTick - heardTick) * 0.25 <= 2) return '刚才';
  const daysAgo = day - (Math.floor((heardTick * 0.25) / 24) + 1);
  return daysAgo <= 0 ? '今天' : daysAgo === 1 ? '昨天' : daysAgo === 2 ? '前天' : '那天';
}

// 玩家走到身边时，NPC 先不先开口、为什么。当值时不开口；正忙着开口的劲减半；
// 有值得提的往事、值得说的事、和玩家熟、或是对新来的人客气，才有理由开口。
export function decideOpening(input: {
  persona: DialoguePersona;
  situation: DialogueSituation;
  asleep: boolean;
  seedKey: string;
  used: Set<string>;
  nowTick?: number;
}): DialogueOpening {
  const { persona, situation } = input;
  if (input.asleep) return { open: false, reason: 'asleep' };
  // 恨你的人当着值也一样不理你（宿主让他说一句"请回"就走）。
  if (situation.attitude === 'hostile') return { open: false, reason: 'hostile' };
  if (situation.dutyDay && situation.busy) return { open: false, reason: 'on_duty' };
  const say = (phrase: DialoguePhrase, slots: Record<string, string> = {}) =>
    pickPhrase(persona.voice, phrase, `${input.seedKey}:${phrase}`, input.used, slots);
  // 听说道友骂了人（被骂的不是他自己）：会当面问一句——只是听说而冷着的，也会问；
  // 自己也被道友骂过的，懒得提别人的事，冷着不开口。
  const accusation =
    (situation.player.insults ?? 0) > 0
      ? undefined
      : situation.news.find(
          (entry) =>
            aboutPlayer(entry) && entry.aboutActorIds[1] !== persona.actorId && !situation.player.toldNewsIds.includes(entry.newsId),
        );
  if (accusation && seededRoll(`${input.seedKey}:accuse`) < VOICE_ACCUSE_CHANCE[persona.voice] * (situation.busy ? 0.5 : 1)) {
    // 当场看见的说"我都看见了"（带上是刚才、昨天还是那天），听人说的说"听说"。
    const text = say(accusation.source === 'told' ? 'openAccuse' : 'openAccuseSaw', {
      person: DIALOGUE_PERSONAS[accusation.aboutActorIds[1] ?? '']?.name ?? '人',
      when: sawWhen(accusation.heardTick, situation.day, input.nowTick),
    });
    if (text) return { open: true, reason: 'accuse', text, newsId: accusation.newsId };
  }
  if (situation.attitude === 'cold') return { open: false, reason: 'cold' };
  const inclination = VOICE_OPENNESS[persona.voice] * (situation.busy ? 0.5 : 1);
  if (seededRoll(`${input.seedKey}:open`) >= inclination) return { open: false, reason: 'not_inclined' };
  // 先提往事（"前天你向我表白过，我还记着"）；说过还会再来、真来了的："还真来了"。
  const recall = situation.player.met ? memoryToBringUp(situation, input.nowTick) : undefined;
  if (recall) {
    const text = recall.kind === 'return' ? say('openReturned') : say('openRecall', { when: recall.when, memory: recall.text });
    if (text) return { open: true, reason: 'recall', text, recalled: recall.text };
  }
  const news = newsToTell(situation, persona.actorId, input.nowTick);
  if (
    news &&
    HUMAN_NEWS_SALIENCE[news.kind] >= 0.7 &&
    seededRoll(`${input.seedKey}:news`) < humanGossipChance(persona, situation.player.relationship, HUMAN_NEWS_SALIENCE[news.kind])
  ) {
    const text = say('openNews', { news: news.text });
    if (text) return { open: true, reason: 'news', text, newsId: news.newsId };
  }
  if (situation.player.met && situation.player.relationship >= 15) {
    const text = say('openKnown');
    if (text) return { open: true, reason: 'known', text };
  }
  if (!situation.player.met) {
    const text = say('openNewcomer');
    if (text) return { open: true, reason: 'newcomer', text };
  }
  return { open: false, reason: 'not_inclined' };
}

// —— 聊多久、怎么收尾 ——

// stay：收尾后就在原地接着做（"我得接着修炼了"），不说"先走了"。
export type DialogueBudget = { turns: number; closingReason: string; stay: boolean; busyReason?: string };

// 能聊几个来回：闲着、交际的日子、和玩家熟，聊得久；正忙、修炼日、当值、快到就寝、
// 累了，聊得短；话少的人本来就聊得短。
export function chatBudget(persona: DialoguePersona, situation: DialogueSituation): DialogueBudget {
  let turns = 5;
  if (situation.busy) turns -= 2;
  if (situation.focus === 'cultivation') turns -= 1;
  if (situation.focus === 'social') turns += 2;
  if (situation.focus === 'idle') turns += 1;
  if (situation.dutyDay) turns -= 2;
  const toBed = (situation.bedtimeHour - situation.hour + 24) % 24;
  const nearBed = toBed <= 1.5;
  if (nearBed) turns -= 2;
  const tired = situation.fatigue >= 60;
  if (tired) turns -= 2;
  if (persona.voice === 'curt' || persona.voice === 'formal') turns -= 2;
  if (persona.voice === 'wary') turns -= 1;
  if (['warm', 'upright', 'gentle', 'shrewd'].includes(persona.voice)) turns += 1;
  if (situation.player.relationship >= 25) turns += 1;
  if (situation.player.relationship >= 40) turns += 1;
  // 冷着你的人不想多聊。
  if (isCold(situation)) turns -= 2;
  const reason = closingReason(persona, situation, { nearBed, tired });
  return {
    turns: Math.max(1, Math.min(8, turns)),
    closingReason: reason,
    stay: /^(接着|歇会儿$)/u.test(reason),
    busyReason:
      situation.busy || situation.dutyDay || situation.focus === 'cultivation' || nearBed || tired
        ? 'busy'
        : undefined,
  };
}

// 规则层排好的下一件事，说成收尾的理由（"我得{理由}了"）。
function nextReason(next: DialogueNext): string | undefined {
  const there = !next.stay ? next.placeName : undefined;
  switch (next.kind) {
    case 'cultivate':
      return next.stay ? '接着修炼' : there ? `回${there}修炼` : '去修炼';
    case 'gather':
      return next.stay ? '接着采药' : there ? `去${there}采药` : '去采药';
    case 'trade':
      return next.stay ? '接着卖药' : there ? `去${there}卖药` : '去卖药';
    case 'talk':
      return next.personName ? `去找${next.personName}说点事` : '去找人说点事';
    case 'gift':
      return next.personName ? `去给${next.personName}送株灵草` : '去给人送株灵草';
    case 'turn_in_request':
      return '去交委托';
    case 'accept_request':
      return '去接个委托';
    case 'rest':
      return next.stay ? '歇会儿' : there ? `去${there}歇会儿` : '去歇会儿';
    case 'explore':
      return '四处转转';
    case 'watch':
      return next.stay ? '接着当值' : '回去当值';
    case 'shop':
      return '照看铺子';
    case 'sleep':
      return '回去歇着';
    default:
      return undefined;
  }
}

// 收尾的理由：照实说他接下来要做的事；规则层没给，就看就寝、累、当值、手上的事和当天的心思。
function closingReason(
  persona: DialoguePersona,
  situation: DialogueSituation,
  flags: { nearBed: boolean; tired: boolean },
) {
  const planned = situation.next ? nextReason(situation.next) : undefined;
  if (planned) return planned;
  if (flags.nearBed) return '回去歇着';
  if (flags.tired) return '去歇会儿';
  if (situation.dutyDay) return persona.voice === 'merchant' ? '照看铺子' : situation.busy ? '接着当值' : '回去当值';
  if (situation.busy && situation.activity.includes('修炼')) return '接着修炼';
  if (situation.breakFrom) return `接着${situation.breakFrom}`;
  if (situation.activity.includes('修炼') || situation.focus === 'cultivation') return '回去修炼';
  if (situation.focus === 'livelihood') return situation.activity.includes('卖') ? '去坊市卖药' : '去药圃干活';
  if (situation.focus === 'social') return '去找朋友坐坐';
  return '去办点事';
}

export function closingLine(input: {
  persona: DialoguePersona;
  budget: DialogueBudget;
  seedKey: string;
  used: Set<string>;
}): DialogueReply {
  const { persona, budget, used } = input;
  const reason = budget.closingReason;
  const duty = reason.includes('当值') || reason === '照看铺子';
  // 要走的，"先走了"一类和普通收尾都可以；原地接着做的，只用普通收尾。
  const order: DialoguePhrase[] = [
    ...(duty ? (['closeDuty'] as const) : []),
    ...(budget.stay
      ? (['close'] as const)
      : seededRoll(`${input.seedKey}:closeGo`) < 0.5
        ? (['closeGo', 'close'] as const)
        : (['close', 'closeGo'] as const)),
  ];
  const available = order.filter((phrase) => phraseVariants(persona.voice, phrase).length > 0);
  const phrase = available.find((candidate) => hasFreshPhrase(persona.voice, candidate, used)) ?? available[0];
  const text = (phrase ? pickPhrase(persona.voice, phrase, `${input.seedKey}:${phrase}`, used, { reason }) : undefined) ?? `我得${reason}了。`;
  return {
    text,
    by: 'rule',
    phrase: 'close',
    facts: [],
    action: { type: 'end', reason },
  };
}

// —— 交给 AI 的话 ——

function moodWord(mood: number) {
  return mood <= 3 ? '不太好' : mood >= 7 ? '不错' : '平常';
}

function fatigueWord(fatigue: number) {
  return fatigue >= 60 ? '很累' : fatigue >= 30 ? '有点累' : '还好';
}

function relationshipWord(relationship: number) {
  if (relationship >= 40) return '很熟';
  if (relationship >= 25) return '处得不错';
  if (relationship >= 10) return '认识';
  return '还不熟';
}

function opinionWord(opinion: DialogueOpinion) {
  const phrase = opinionPhrase(opinion);
  return {
    personGrudge: '跟他闹过不愉快',
    personBad: '爱惹事',
    personFriend: '好友',
    personGood: '人不错',
    personNeutral: '不熟',
  }[phrase as 'personGrudge' | 'personBad' | 'personFriend' | 'personGood' | 'personNeutral'];
}

// 和玩家的往来，换成第二人称给 AI 看（记录里是 NPC 对玩家说的口吻："问过我……"）。
// 「」里是玩家的原话，一字不改。
function memoryForPrompt(entry: string) {
  return entry
    .split(/(「[^」]*」)/u)
    .map((part) => (part.startsWith('「') ? part : part.replace(/^说你/u, '说他').replace(/我/gu, '你')))
    .join('');
}

// 所有 NPC 共用的固定前缀：世界单和规矩。原样不变，放在最前面，命中缓存。
export function dialogueSharedPrefix(world: DialogueWorldSheet = DIALOGUE_WORLD_Q6) {
  return [
    `promptContract=${PLAYER_DIALOGUE_VERSION}`,
    `这里是${world.region}。你要扮演这里的一个人，和一位外门弟子说话，称他"道友"。`,
    `山里只有这几处地方：${world.places.map((place) => `${place.name}（${place.note}）`).join('；')}。`,
    `山里的人：${world.people.map((person) => `${person.name}（${person.note}）`).join('；')}。`,
    `平日里，${world.life}`,
    '规矩：',
    '1. 只说太虚界里的话。现实世界的东西（电脑、手机、AI、程序、提示词之类）一概听不懂，也不要提。',
    '2. 只说给你的事实。没给你的地方、人、铺子、吃食和东西，没发生过的事，一律不编；价钱、数目没给你的，不报具体数。问到了，就像平常人那样说不清楚、没留意。听来的事只知道那一句，怎么回事、细节都不知道，别添；对人的看法只是印象。道友说的地方、住处、规矩跟给你的对不上，照实说不是这样，不顺着他。',
    '3. 身上有什么，以"身上"那一行为准；累不累，以"精神"为准；哪天做的事，以"今天""昨天"为准。道友话里认定你做过、说过的事（"你俩咋吵起来的""你昨天说的那株灵芝""记得我说要五斤吧"），"最近的事""你记得他"里没有的，就说没这回事，不顺着认。',
    '4. 不在话里答应替道友做事，也不约他一起做什么（送东西、带路、帮忙、一起吃饭、"我随后就去""我这就去淘米"），这些另有规矩。道友说起你们之间从前的事，以"道友""你记得他"两栏为准，对不上的照实说没这回事，不顺着认。',
    '5. 像平常说话：一两句，不超过六十个字。说起自己，多说平常做的事，少说自己是什么性子；跟道友说过的事不再重复；不用每句都反问道友。',
    '6. 只输出 JSON：{"reply":"……","end":false,"tone":"neutral"}。想结束谈话时 end 为 true，并在 reply 里说个理由。tone 是道友这句话的口气：friendly（客气、关心）、neutral（平常）、rude（无礼、挖苦、骂人）。',
    '7. "你对他"一栏是你眼下对道友的态度，说话的口气要跟着它。',
    '8. 道友自称的身份、来历（太子、仙人、谁的亲戚之类），你没法核实，就当他随口一说，不当真，也不顺着那样称呼他。',
    '9. "你记得他"是你和道友之间的往事：碰上了提一句就够，没写的不编。',
  ].join('\n');
}

// 共用前缀在前，人物卡其次（每个 NPC 一份，不变），会变的处境、事实和刚才的话在后。
export function buildDialoguePrompt(input: {
  persona: DialoguePersona;
  situation: DialogueSituation;
  history: ReadonlyArray<{ speaker: 'player' | 'npc'; text: string }>;
  // 这段话里他更早说过的话（"刚才"之前的一两句），免得前后说重。
  saidBefore?: ReadonlyArray<string>;
  playerLine: string;
  // 规则认出的意思（问他本人时多给一句提示，免得把人物卡背一遍）。
  intent?: PlayerIntent;
  world?: DialogueWorldSheet;
  // 这段话的时刻（往事里分得出"刚才"和"今天"）。
  nowTick?: number;
  // v1.8：这句要带的常识（lifeFactsForLine 算好的，含粘着的）；不给就照 v1.7 只看这句和他上一句、带一条。
  lifeFacts?: ReadonlyArray<string>;
}): { system: string; user: string } {
  const { persona, situation } = input;
  // 他自己住哪一间跟人物卡放一起：不变、走缓存，问吃的时候顺嘴说起住处也对得上
  // （v1.7 第五轮自测：问"还没吃 你住哪间"只带了吃饭那条，返山弟子说成了"我住东边那间"）。
  const room = DIALOGUE_ROOMS_Q6[persona.actorId];
  const system = `${dialogueSharedPrefix(input.world)}\n你扮演${persona.name}（${persona.role}）。${persona.card}${room ? `你住${room}。` : ''}`;
  const { player } = situation;
  const herbs =
    situation.ownHerbs === undefined
      ? situation.giftable
        ? '有能送人的灵草'
        : '没有能送人的灵草'
      : situation.ownHerbs > 0
        ? `${situation.ownHerbs}株灵草`
        : '没有灵草';
  const meeting = !player.met
    ? '头一回见'
    : `见过${player.visits ?? 1}回${player.firstDay ? `（头一回是第${player.firstDay}天）` : ''}，${relationshipWord(player.relationship)}`;
  // 他记得的往事：最要紧、没淡掉的三件，带上是什么时候、说了几回（"前天向你表白过（两回）"）。
  // （这段话里刚说过的闲聊原话，"刚才"一栏里已经有了，不重复。）
  const memory = memoriesToRecall(player, situation.day, input.nowTick)
    .filter((entry) => !(entry.kind === 'said' && entry.sameTalk))
    .slice(0, 3)
    .map((entry) => `${entry.when}${memoryForPrompt(entry.text)}${entry.quote ? `（原话「${entry.quote}」）` : ''}${countWord(entry.count)}`);
  // 待会儿要做的事（规则定的，收尾时也照这个说）：v1.7 第四轮自测补——守卫在生活院歇着、接下来去修炼，
  // AI 不知道，说了句"我就回岗上了"，规则收尾又说"得去修炼"，前后对不上。
  const after = situation.next ? nextReason(situation.next) : undefined;
  const lines = [
    `第${situation.day}天 ${situation.clock}，你在${situation.placeName}，${situation.activity}${after ? `，待会儿要${after}` : ''}。心境${moodWord(situation.mood)}，精神${fatigueWord(situation.fatigue)}。`,
    `身上：${herbs}。`,
    `道友：${meeting}${player.name ? `；他叫${player.name}` : ''}。`,
  ];
  if (memory.length > 0) lines.push(`你记得他：${memory.join('；')}。`);
  // 态度平常就不写（省 token）；冷淡、记仇、熟络才写一个词。
  if (situation.attitude && situation.attitude !== 'neutral') {
    const insults = player.insults ?? 0;
    lines.push(`你对他：${ATTITUDE_WORD[situation.attitude]}${insults > 0 ? `（他骂过你${insults > 1 ? `${insults}回` : ''}）` : ''}。`);
  }
  if (situation.recentEvents.length > 0) lines.push(`最近的事：${situation.recentEvents.slice(-3).join('；')}。`);
  // 自己是当事人的事已在"最近的事"里，这里只放别人的事。
  const news = [...situation.news]
    .filter((entry) => !entry.aboutActorIds.includes(persona.actorId))
    .sort((left, right) => HUMAN_NEWS_SALIENCE[right.kind] - HUMAN_NEWS_SALIENCE[left.kind] || right.heardTick - left.heardTick)
    .slice(0, 2);
  if (news.length > 0) {
    const told = (entry: DialogueNews) => (player.toldNewsIds.includes(entry.newsId) ? '（跟道友说过了）' : '');
    lines.push(`你听说的事：${news.map((entry) => `${entry.text}${told(entry)}`).join('；')}。`);
  }
  const opinions = [...situation.opinions]
    .filter((entry) => opinionPhrase(entry) !== 'personNeutral')
    .sort((left, right) => Math.abs(right.relationship) - Math.abs(left.relationship))
    .slice(0, 3);
  if (opinions.length > 0) lines.push(`你对人的看法：${opinions.map((entry) => `${entry.name}${opinionWord(entry)}`).join('；')}。`);
  // 道友这句（没说到就看你上一句）说到吃、住、路、灵草、买卖、管事的，带上那条山里的常识（一回一条）。
  const lastNpcLine = [...input.history].reverse().find((turn) => turn.speaker === 'npc')?.text;
  const common = input.lifeFacts ?? lifeFactsFor([input.playerLine, ...(lastNpcLine ? [lastNpcLine] : [])]);
  if (common.length > 0) lines.push(`山里的常识：${common.join('；')}。`);
  if (input.saidBefore && input.saidBefore.length > 0) {
    lines.push(`你前面说过：${input.saidBefore.slice(-2).map((text) => `「${text}」`).join('')}`);
  }
  const recent = input.history.slice(-2);
  if (recent.length > 0) {
    lines.push('刚才：');
    for (const turn of recent) lines.push(`${turn.speaker === 'player' ? '道友' : '你'}：${turn.text}`);
  }
  lines.push(`道友说："${input.playerLine}"`);
  if (input.intent === 'ask_self') lines.push('（他问的是你这个人：挑一两件你平常真做的事说，别把自己的性子一条条报出来。）');
  return { system, user: lines.join('\n') };
}

// AI 的回话里，和他这段话前面说过的重了的话，去掉：整句（去掉标点五个字以上）原样说过的，删整句；
// 逗号隔开的半句（六个字以上）原样说过的，删那半句。句尾的"呢、啊、吧"之类不算差别。
// 去掉后什么也不剩，就原样留着。
export function dropRepeatedClauses(text: string, earlier: ReadonlyArray<string>) {
  const bare = (value: string) => value.replace(/[，。！？、；：…—\s]/gu, '');
  const core = (value: string) => bare(value).replace(/[呢啊吧呀嘛哦啦]+$/u, '');
  const said = bare(earlier.join(''));
  const repeated = (value: string, least: number) => core(value).length >= least && said.includes(core(value));
  const sentences = text.match(/[^。！？]+[。！？]*/gu) ?? [text];
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (repeated(sentence, 5)) continue;
    const end = sentence.match(/[。！？]*$/u)?.[0] ?? '';
    const parts = sentence.slice(0, sentence.length - end.length).split(/[，、；]/u);
    const freshParts = parts.filter((part) => !repeated(part, 5));
    if (freshParts.length === parts.length) kept.push(sentence);
    else if (freshParts.some((part) => bare(part).length > 0)) kept.push(`${freshParts.join('，')}${end || '。'}`);
  }
  const result = kept.join('').trim();
  return result.length > 0 && result !== text ? { text: result, dropped: true } : { text, dropped: false };
}

// AI 附带的口气标签（只认这三个，别的一律当平常）。规则据此有上限地加减好感度，AI 不直接改数。
export type DialogueReplyTone = 'friendly' | 'neutral' | 'rude';

export type ParsedDialogueReply =
  | { ok: true; text: string; end: boolean; trimmed: boolean; tone: DialogueReplyTone }
  | { ok: false; reasonCode: 'dialogue_reply_unparsed' | 'dialogue_reply_out_of_world' | 'dialogue_reply_empty' };

// 模型的回话：取 JSON；太长的截到 80 字以内的句号；出现现代词的不用（换成模板）。
export function parseDialogueReply(content: string): ParsedDialogueReply {
  type RawReply = { reply?: unknown; end?: unknown; tone?: unknown } | null;
  let parsed: RawReply | undefined;
  for (const attempt of [content, content.match(/\{[\s\S]*\}/u)?.[0]]) {
    if (!attempt) continue;
    try {
      parsed = JSON.parse(attempt) as RawReply;
      break;
    } catch {
      // 试下一种
    }
  }
  if (!parsed || typeof parsed.reply !== 'string') return { ok: false, reasonCode: 'dialogue_reply_unparsed' };
  let text = parsed.reply.trim();
  if (!text) return { ok: false, reasonCode: 'dialogue_reply_empty' };
  if (OUT_OF_WORLD_REPLY_WORDS.test(text) || /^[\x00-\x7f]+$/u.test(text)) {
    return { ok: false, reasonCode: 'dialogue_reply_out_of_world' };
  }
  let trimmed = false;
  if (text.length > 80) {
    const cut = Math.max(...['。', '！', '？', '…'].map((mark) => text.lastIndexOf(mark, 80)));
    text = cut > 10 ? text.slice(0, cut + 1) : `${text.slice(0, 78)}……`;
    trimmed = true;
  }
  const tone: DialogueReplyTone = parsed.tone === 'friendly' || parsed.tone === 'rude' ? parsed.tone : 'neutral';
  return { ok: true, text, end: parsed.end === true, trimmed, tone };
}

#!/usr/bin/env node

// 《NPC 人性过关标准》I4 情景题：把 NPC 放进 4 个固定情景，看规则和模型各选什么。
// 候选来自正式的 purpose-v2 候选链，规则走 selectPersonaPreferredProposal，
// 模型用与 A/B 相同的系统提示，在同一批合法候选里选（每题 3 次，取多数）。
//   node --experimental-specifier-resolution=node --loader ts-node/esm \
//     godot-taixu-client/tools/humanity_scenarios.mjs [--live] [--samples 3]
// --live 需要环境变量 XIANXIA_PI_NPC_DEEPSEEK_API_KEY；不加则只跑规则并打印候选。

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildPiNpcEligibleCandidateBundle,
  selectPersonaPreferredProposal,
} from '../../convex/xianxia/autonomyDecisionTraceLogic.ts';
import { buildPurposeBoundLifeCandidateBundle } from '../../convex/xianxia/purposeBoundLifeCandidateLogic.ts';
import { deriveSameLocationSocialSources } from '../../convex/xianxia/sameLocationSocialOpportunityLogic.ts';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const SAMPLES = Number(args[args.indexOf('--samples') + 1] ?? 3) || 3;
// --human-life：按拟人生活 v1 的作息和规则答题（22 点睡、6 点起，不设当天心思）。
const HUMAN_LIFE = args.includes('--human-life');
const ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(ROOT, '.logs/humanity-eval');
const SELF_ID = 'probe:disciple';
const DAY = 3;

function baseContext({ hour = 14, fatigue = 20, inventory = [], overrides = {} } = {}) {
  const gameHour = DAY * 24 + hour;
  return {
    lifeObservation: { observationRevision: `humanity:scenario:${gameHour}:${fatigue}` },
    purposeBoundLifeIntentV2: true,
    currentGameHour: gameHour,
    phase: hour < 6 || hour >= 21 ? 'night' : hour < 9 ? 'dawn' : hour < 18 ? 'day' : 'dusk',
    self: {
      actorId: SELF_ID,
      name: '林青',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: 3,
      mood: 5,
      health: 10,
      maxHealth: 10,
      fatigue,
      spirit: 5,
      reputation: 0,
      currentLocationId: 'mountain_gate',
      inventory: [{ itemId: 'spirit_stone', qty: 12 }, ...inventory],
      innerTrait: '中庸',
      outerTrait: '义气',
      persona: '中庸；义气',
    },
    currentLocationName: '山门生活院',
    currentLocationSpiritualEnergy: 6,
    cultivationModes: ['ambient'],
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'rest', 'talk', 'gift', 'explore', 'use_item'],
    knownLocations: [
      { locationId: 'mountain_gate', name: '山门生活院', allowedActions: ['cultivate', 'rest', 'talk', 'gift', 'explore', 'use_item'], dangerLevel: 0, spiritualEnergy: 6 },
      { locationId: 'herb_field', name: '凝露药圃', allowedActions: ['gather', 'cultivate', 'rest', 'talk'], dangerLevel: 0, spiritualEnergy: 3 },
      { locationId: 'rest_pavilion', name: '松风歇脚亭', allowedActions: ['rest', 'talk'], dangerLevel: 0, spiritualEnergy: 2 },
    ],
    purposeResourceNodes: [],
    purposeShopOffers: [],
    ...(HUMAN_LIFE ? { humanLifeV1: true, humanDay: { bedtimeHour: 22, wakeHour: 6 } } : {}),
    recentlyTalked: [],
    giftCooldownTargetActorIds: [],
    ...overrides,
  };
}

function socialTarget(actorId, fields) {
  return {
    actorId,
    role: 'outer_disciple',
    locationId: 'mountain_gate',
    relationship: 0,
    trust: 0,
    suspicion: 0,
    debt: 0,
    fear: 0,
    recentlyTalked: false,
    aliveAndCapable: true,
    busy: false,
    cooldownClear: true,
    sessionCapacityAvailable: true,
    ...fields,
  };
}

function withSocial(context, targets, memories = []) {
  const sources = deriveSameLocationSocialSources({
    nowGameHour: context.currentGameHour,
    currentGameDay: Math.floor(context.currentGameHour / 24),
    actor: {
      actorId: SELF_ID,
      locationId: 'mountain_gate',
      health: context.self.health,
      maxHealth: context.self.maxHealth,
      hasHealingItem: false,
      hasGiftableItem: context.self.inventory.some((item) => item.itemId !== 'spirit_stone' && item.qty > 0),
    },
    targets,
    requests: [],
    beliefs: [],
    memories,
  });
  return {
    ...context,
    others: targets.map((target) => ({
      actorId: target.actorId,
      name: target.name ?? target.actorId,
      role: target.role,
      realm: 'qi_refining',
      relationship: target.relationship,
      trust: target.trust,
      suspicion: target.suspicion,
      debt: target.debt,
      fear: target.fear,
    })),
    sameLocationSocialSources: sources.length > 0 ? sources : undefined,
  };
}

const SCENARIOS = [
  {
    id: 'Q1',
    title: '深夜 23 点，有些累（疲劳 45），没有急事',
    humanAnswer: '去睡觉（休息，或者等到天亮）',
    context: () => baseContext({ hour: 23, fatigue: 45 }),
    passes: (choice) => choice.kind === 'wait' || choice.intentKind === 'rest' || choice.intentRef === 'rest',
  },
  {
    id: 'Q2',
    title: '多日未见的老友就在身边，手头没有急事',
    humanAnswer: '去聊几句',
    context: () =>
      withSocial(baseContext(), [
        socialTarget('probe:friend', { name: '苏晚', relationship: 45, trust: 20, lastTouchedDay: DAY - 7 }),
      ]),
    passes: (choice) => choice.intentKind === 'talk' && choice.targetActorId === 'probe:friend',
  },
  {
    id: 'Q3',
    title: '昨天受过对方的恩，对方就在身边，自己手头有富余的东西',
    humanAnswer: '回报对方（送东西或道谢）',
    context: () =>
      withSocial(
        baseContext({ inventory: [{ itemId: 'spirit_herb', qty: 2 }] }),
        [socialTarget('probe:benefactor', { name: '周婶', relationship: 20, trust: 10, debt: 15, lastTouchedDay: DAY - 1 })],
        [
          {
            sourceEventId: 'event:probe:gift_yesterday',
            aboutActorIds: ['probe:benefactor'],
            eventActorIds: ['probe:benefactor'],
            eventTargetActorIds: [SELF_ID],
            type: 'gift_given',
            source: 'direct',
            createdAt: DAY * 24 - 20,
            expiresAt: DAY * 24 + 100,
          },
        ],
      ),
    passes: (choice) =>
      (choice.intentKind === 'gift' || choice.intentKind === 'talk') &&
      choice.targetActorId === 'probe:benefactor',
  },
  {
    id: 'Q4',
    title: '两小时前刚在药圃扑空，此刻有别的正事可做',
    humanAnswer: '不马上再去',
    context: () =>
      baseContext({
        overrides: {
          purposeResourceNodes: [
            {
              resourceNodeId: 'q6_dew_patch',
              name: '凝露灵草丛',
              locationId: 'herb_field',
              itemId: 'spirit_herb',
              available: 1,
              sourceRevision: 'resource:rev:9:available:1',
              outlook: {
                inTransitActorCount: 0,
                heldForRequestCount: 0,
                etaGameHours: 0.75,
                expectedAvailableOnArrival: 1,
                lastOutcome: { status: 'failed', reasonCode: 'purpose_goal_source_missing', hoursAgo: 2 },
              },
            },
          ],
        },
      }),
    passes: (choice) => !(choice.intentKind === 'gather' || choice.planner === 'gather'),
  },
];

const SYSTEM_PROMPT = [
  '你是太虚界 NPC 的高层生活意图选择器，不是世界规则或身体控制器。',
  '活着优先；其次遵守人物性格、真实需要、义务和正在发展的生活。',
  '只能选择 candidates 中给出的 candidateId，不能创造动作、坐标、物品或结果。',
  '不要输出思维过程。只输出严格 json：',
  '{"kind":"submit_intent","candidateId":"...","reasonCode":"survival|personal_goal|obligation|relationship|routine","summary":"最多80字"}',
  '或 {"kind":"wait","reasonCode":"no_good_action|insufficient_context","summary":"最多80字"}。',
].join('\n');

function describe(proposal, candidate) {
  const intent = proposal?.params?.purposeBoundIntent;
  return {
    kind: 'selected',
    candidateId: candidate?.candidateId,
    planner: candidate?.planner,
    intentKind: candidate?.intentKind ?? proposal?.type,
    intentRef: intent?.intendedActivity,
    targetActorId: proposal?.targetActorId,
    intent: proposal?.intent,
  };
}

async function askModel(context, bundle) {
  const user = JSON.stringify({
    observationRevision: bundle.observationRevision,
    gameHour: context.currentGameHour,
    self: {
      actorId: context.self.actorId,
      name: context.self.name,
      role: context.self.role,
      innerTrait: context.self.innerTrait,
      outerTrait: context.self.outerTrait,
      locationId: context.self.currentLocationId,
      health: context.self.health,
      maxHealth: context.self.maxHealth,
      fatigue: context.self.fatigue,
      cultivationXp: context.self.cultivationXp,
    },
    candidates: bundle.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      planner: candidate.planner,
      intentKind: candidate.intentKind,
      targetRef: candidate.targetRef,
      intent: Array.from(candidate.intent ?? '').slice(0, 160).join(''),
      survivalUrgency: candidate.survivalUrgency,
      needScore: candidate.needScore,
      personaFit: candidate.personaFit,
      personaReasonCodes: candidate.personaReasonCodes.slice(0, 4),
      commitmentUrgency: candidate.commitmentUrgency,
      relationshipReasons: candidate.relationshipReasons.slice(0, 4),
      ...(candidate.resourceOutlook ? { resourceOutlook: candidate.resourceOutlook } : {}),
    })),
  });
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      // 与正式 NPC 的调用参数一致（piNpcDeepSeekTransport）：不开思考、温度 0。
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      stream: false,
      temperature: 0,
      max_tokens: 180,
    }),
  });
  if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'invalid', raw: text.slice(0, 200), usage: body.usage };
  }
  if (parsed.kind === 'wait') return { kind: 'wait', summary: parsed.summary, usage: body.usage };
  const option = bundle.options.find((entry) => entry.candidate.candidateId === parsed.candidateId);
  if (!option) return { kind: 'invalid', raw: text.slice(0, 200), usage: body.usage };
  return { ...describe(option.proposal, option.candidate), summary: parsed.summary, usage: body.usage };
}

const results = [];
for (const scenario of SCENARIOS) {
  const context = scenario.context();
  context.purposeBoundLifeCandidateBundle = buildPurposeBoundLifeCandidateBundle(context);
  const now = context.currentGameHour * 3_600_000;
  const bundle = buildPiNpcEligibleCandidateBundle(context, now);
  const ruleChoice = selectPersonaPreferredProposal(context, now);
  const ruleOption = ruleChoice
    ? bundle.options.find((entry) => entry.candidate.candidateId === ruleChoice.candidateId)
    : undefined;
  const rule = ruleChoice
    ? describe(ruleChoice.proposal, ruleOption?.candidate ?? { candidateId: ruleChoice.candidateId, intentKind: ruleChoice.proposal.type })
    : { kind: 'wait' };
  const model = [];
  if (LIVE) {
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      try {
        model.push(await askModel(context, bundle));
      } catch (error) {
        model.push({ kind: 'error', error: String(error?.message ?? error) });
      }
    }
  }
  const modelPasses = model.filter((choice) => choice.kind !== 'error' && choice.kind !== 'invalid' && scenario.passes(choice)).length;
  results.push({
    id: scenario.id,
    title: scenario.title,
    humanAnswer: scenario.humanAnswer,
    offered: bundle.candidates.map((candidate) => ({
      planner: candidate.planner,
      intentKind: candidate.intentKind,
      intent: candidate.intent,
      needScore: candidate.needScore,
    })),
    rule,
    rulePass: scenario.passes(rule),
    model,
    modelPass: LIVE ? modelPasses * 2 > model.length : null,
  });
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, `scenarios${HUMAN_LIFE ? '-human' : ''}${LIVE ? '-live' : ''}.json`);
writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), live: LIVE, humanLife: HUMAN_LIFE, samples: SAMPLES, results }, null, 2)}\n`);
for (const result of results) {
  process.stdout.write(
    `${result.id} ${result.title}\n  人会：${result.humanAnswer}\n  候选：${result.offered.map((entry) => `${entry.intentKind}(${entry.needScore})`).join(' / ') || '无'}\n` +
      `  规则：${result.rule.kind === 'wait' ? '无可选（等待）' : `${result.rule.intentKind} ${result.rule.intent ?? ''}`} → ${result.rulePass ? '过' : '不过'}\n` +
      (LIVE
        ? `  模型：${result.model.map((choice) => (choice.kind === 'selected' ? choice.intentKind : choice.kind)).join(' / ')} → ${result.modelPass ? '过' : '不过'}\n`
        : ''),
  );
}
process.stdout.write(`${outPath}\n`);

#!/usr/bin/env node

// 规则组 vs DeepSeek 成对 A/B。
// 两臂共用同一 seed 的隔离内存世界（purposeBoundLifeSoak，不起后端、不碰默认世界）。
//   --arm rules     每个 hook 决策都记录规则默认选择，然后交回规则执行。
//   --arm deepseek  按 tick 均匀分配模型回合：模型只能在服务端给出的合法候选里选或 wait，
//                   其余决策仍走规则；每个模型回合同时记录规则在同一快照上的默认选择，形成成对样本。
// 指标（动作熵、聊天率、wait 率、目标成功率）由 ab_rules_vs_deepseek_metrics.mjs 从 JSONL 计算。
//
// 用法：
//   node --experimental-specifier-resolution=node --loader ts-node/esm \
//     godot-taixu-client/tools/run_ab_rules_vs_deepseek.mjs --arm rules --seed ab:s1
//   node ... run_ab_rules_vs_deepseek.mjs --arm deepseek --seed ab:s1 --max-turns 300
// key 只从 XIANXIA_PI_NPC_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY 环境变量读取，否则在 TTY 隐藏输入；不落盘、不进日志。

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  assertPurposeBoundLifeSoakReady,
  runPurposeBoundLifeSoak,
} from '../../convex/xianxia/purposeBoundLifeSoakLogic.ts';

const CONTRACT_VERSION = 'taixu.ab-rules-vs-deepseek.v1';
const MODEL = 'deepseek-v4-flash';
const INPUT_COST_PER_MILLION = 0.14;
const OUTPUT_COST_PER_MILLION = 0.28;
// DeepSeek 偶发 5xx/429 时同一回合最多再试 3 次（间隔递增），连续 5 个回合都失败才熔断。
const RETRY_DELAYS_MS = [3_000, 8_000, 15_000];
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 5;
const MAX_CHILD_CANDIDATES = 12;
// 公平轮换只在"最近 FAIRNESS_WINDOW_TICKS 内出现过 hook 决策"的 NPC 之间做，
// 否则一个很少有两个以上候选的角色（守卫、掌柜）会把所有人的回合卡死。
const FAIRNESS_WINDOW_TICKS = 120;

const SOCIAL_INTENT_KINDS = new Set([
  'talk',
  'gift',
  'request_teaching',
  'invite_social',
  'respond_social_invitation',
  'group_talk',
  'group_decide',
]);

const args = parseArgs(process.argv.slice(2));
const ARM = args.arm;
if (ARM !== 'rules' && ARM !== 'deepseek') {
  throw new Error('ab_arm_required: --arm rules|deepseek');
}
const SEED = String(args.seed ?? 'ab-rules-vs-deepseek:s1').trim();
const TICKS = Number(args.ticks ?? 3_600);
const MAX_TURNS = ARM === 'deepseek' ? Number(args['max-turns'] ?? 300) : 0;
const TURN_EVERY_TICKS = Number(
  args['turn-every-ticks'] ?? Math.max(1, Math.floor(TICKS / Math.max(1, MAX_TURNS))),
);
const MAX_CALLS = Number(args['max-calls'] ?? MAX_TURNS * 2);
const MAX_COST_USD = Number(args['max-cost-usd'] ?? 0.3);
// 有社交候选的决策只占 hook 决策的 5–9%，均匀采样拿不到足够的聊天样本；
// --social-boost 让这类决策不受 tick 配额限制也交给模型，记为 sampling=social_boost，
// 熵和 wait 率只在 uniform 样本上算，聊天率用全部有 talk 候选的回合。
const SOCIAL_BOOST = ARM === 'deepseek' && args['social-boost'] === true;
// 相邻两次外呼的最小间隔，给 provider 留余地。
const MIN_INTERVAL_MS = Number(args['min-interval-ms'] ?? 1_500);
// memory_only：不告诉 NPC 谁在路上、哪份被委托预留，只留它自己上次的结局（人性标准 I1）。
const OUTLOOK_MODE = args['outlook-mode'] === 'memory_only' ? 'memory_only' : 'full';
// 拟人生活 v1：作息、吃一堑长一智、一天一个样（NPC 人性优化第一轮）。
const HUMAN_LIFE = args['human-life'] === true;
const LOG_SUBDIR = typeof args['log-dir'] === 'string' ? args['log-dir'] : '.logs/ab-rules-vs-deepseek';
// --run-tag long：在运行编号里加一段标签（例如 100 天的长测），免得和同一组的标准长度混在一起。
const RUN_TAG = typeof args['run-tag'] === 'string' ? args['run-tag'] : '';
if (RUN_TAG && !/^[a-z0-9]{1,16}$/u.test(RUN_TAG)) throw new Error('ab_run_tag_invalid: [a-z0-9]{1,16}');
if (!Number.isInteger(TICKS) || TICKS < 1_000 || TICKS > 10_000) {
  throw new Error('ab_ticks_out_of_range: 1000..10000');
}
if (!Number.isInteger(TURN_EVERY_TICKS) || TURN_EVERY_TICKS < 1) {
  throw new Error('ab_turn_every_ticks_invalid');
}

const root = resolve(import.meta.dirname, '../..');

let apiKey;
if (ARM === 'deepseek') {
  apiKey =
    process.env.XIANXIA_PI_NPC_DEEPSEEK_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) apiKey = await readHiddenSecret();
  if (!apiKey || apiKey.length < 16 || apiKey.length > 512) {
    throw new Error('ab_api_key_invalid');
  }
}

const runId = `${ARM}${HUMAN_LIFE ? '-human' : ''}${RUN_TAG ? `-${RUN_TAG}` : ''}${OUTLOOK_MODE === 'memory_only' ? '-memory' : ''}-${slug(SEED)}-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
const logDir = resolve(root, LOG_SUBDIR);
mkdirSync(logDir, { recursive: true });
const logPath = resolve(logDir, `${runId}.jsonl`);
const manifestPath = resolve(logDir, `${runId}.manifest.json`);
closeSync(openSync(logPath, 'wx', 0o600));

// 计数
let seq = 0;
let hookDecisions = 0;
let ruleDecisions = 0;
let turns = 0;
let socialBoostTurns = 0;
let selectedTurns = 0;
let waitTurns = 0;
let providerFailedTurns = 0;
let invalidCandidateSelections = 0;
let providerCalls = 0;
let inputTokens = 0;
let outputTokens = 0;
let providerLatencyMs = 0;
let consecutiveProviderFailures = 0;
let providerAttemptFailures = 0;
let lastProviderCallAt = 0;
let circuitReason;
let interrupted = false;
let nextTurnTick = 1;
let lastLiveActorId;
const liveTurnsByActor = new Map();
const eligibleLiveActors = new Set();
const lastHookTickByActor = new Map();
const llmSkipReasonCounts = {};
// 决策 → 动作/目标 的归属索引，让 action_terminal / goal_terminal 能标出 decidedBy
const pendingDecisionByActor = new Map();
const decidedByAction = new Map();
const decidedByGoal = new Map();
let actionsSelected = 0;
let actionsTerminal = 0;
let goalsCreated = 0;
let goalsTerminal = 0;
let runtimeEvents = 0;
const startedAt = Date.now();

const onSignal = () => {
  interrupted = true;
  if (!circuitReason) circuitReason = 'signal_interrupted';
};
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

writeLog({
  type: 'run_started',
  contractVersion: CONTRACT_VERSION,
  runId,
  arm: ARM,
  seed: SEED,
  ticks: TICKS,
  outlookMode: OUTLOOK_MODE,
  humanLife: HUMAN_LIFE,
  maxTurns: MAX_TURNS,
  turnEveryTicks: TURN_EVERY_TICKS,
  socialBoost: SOCIAL_BOOST,
  minIntervalMs: MIN_INTERVAL_MS,
  retryDelaysMs: RETRY_DELAYS_MS,
  maxConsecutiveProviderFailures: MAX_CONSECUTIVE_PROVIDER_FAILURES,
  maxCalls: MAX_CALLS,
  maxCostUsd: MAX_COST_USD,
  model: ARM === 'deepseek' ? MODEL : null,
  nodeVersion: process.version,
  startedAt: new Date(startedAt).toISOString(),
  syntheticWorld: true,
  defaultWorldTouched: false,
  cronStarted: false,
  backendStarted: false,
});

let summary;
let failure;
let releaseReady = false;
let releaseFailure;
try {
  summary = runPurposeBoundLifeSoak({
    seed: SEED,
    ticks: TICKS,
    outlookMode: OUTLOOK_MODE,
    humanLife: HUMAN_LIFE,
    // 每个游戏日一张关系快照，供人性标准的关系层、社会层取证（只读）。
    observeNetwork: (snapshot) => writeLog({ type: 'network', ...snapshot }),
    beforeTick: (tick) => {
      if (tick === 1 || tick % 300 === 0) {
        writeLog({
          type: 'heartbeat',
          tick,
          elapsedMs: Date.now() - startedAt,
          hookDecisions,
          ruleDecisions,
          turns,
          selectedTurns,
          waitTurns,
          providerFailedTurns,
          providerCalls,
          estimatedCostUsd: estimatedCostUsd(),
          actionsSelected,
          actionsTerminal,
          goalsCreated,
          goalsTerminal,
          circuitReason,
        });
      }
    },
    decisionHook: (decision) => decide(decision),
    runtimeEventHook: (event) => onRuntimeEvent(event),
  });
  try {
    assertPurposeBoundLifeSoakReady(summary);
    releaseReady = true;
  } catch (error) {
    releaseFailure = error instanceof Error ? error.message : 'release_audit_failed';
  }
} catch (error) {
  failure = error instanceof Error ? error.message : 'ab_run_failed';
  writeLog({ type: 'run_failed', failure });
} finally {
  apiKey = undefined;
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
}

const endedAt = Date.now();
const counters = {
  hookDecisions,
  ruleDecisions,
  turns,
  socialBoostTurns,
  selectedTurns,
  waitTurns,
  providerFailedTurns,
  providerAttemptFailures,
  llmSkipReasonCounts,
  invalidCandidateSelections,
  providerCalls,
  inputTokens,
  outputTokens,
  providerLatencyMs,
  estimatedCostUsd: estimatedCostUsd(),
  runtimeEvents,
  actionsSelected,
  actionsTerminal,
  goalsCreated,
  goalsTerminal,
  circuitReason,
  interrupted,
};
writeLog({
  type: 'run_completed',
  runId,
  arm: ARM,
  seed: SEED,
  endedAt: new Date(endedAt).toISOString(),
  elapsedMs: endedAt - startedAt,
  failure,
  releaseReady,
  releaseFailure,
  ...counters,
  worldSummary: summary,
  defaultWorldTouched: false,
  cronStarted: false,
  backendStarted: false,
  secretRetained: false,
});

const manifest = {
  contractVersion: CONTRACT_VERSION,
  runId,
  arm: ARM,
  seed: SEED,
  ticks: TICKS,
  outlookMode: OUTLOOK_MODE,
  humanLife: HUMAN_LIFE,
  maxTurns: MAX_TURNS,
  turnEveryTicks: TURN_EVERY_TICKS,
  model: ARM === 'deepseek' ? MODEL : null,
  logPath,
  logSha256: sha256(readFileSync(logPath)),
  startedAt: new Date(startedAt).toISOString(),
  endedAt: new Date(endedAt).toISOString(),
  elapsedMs: endedAt - startedAt,
  failure,
  releaseReady,
  releaseFailure,
  ...counters,
  world: summary
    ? {
        decisions: summary.decisions,
        actions: summary.actions,
        settlements: summary.settlements,
        actorCount: summary.actorCount,
        resources: summary.resources,
        releaseStatus: summary.releaseAudit?.releaseStatus,
        trajectoryDigest: summary.trajectoryDigest,
      }
    : null,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ...manifest, manifestPath }, null, 2)}\n`);
if (failure) process.exitCode = 1;

// ---------------------------------------------------------------------------

function decide(decision) {
  seq += 1;
  hookDecisions += 1;
  const decisionSeq = seq;
  lastHookTickByActor.set(decision.actor.actorId, decision.tick);
  const defaultCandidate = decision.candidates.find(
    (candidate) => candidate.candidateId === decision.defaultCandidateId,
  );
  const social = socialSummary(decision);
  writeLog({
    type: 'decision_offered',
    seq: decisionSeq,
    tick: decision.tick,
    gameHour: decision.gameHour,
    actorId: decision.actor.actorId,
    role: decision.actor.role,
    locationId: decision.actor.locationId,
    health: decision.actor.health,
    maxHealth: decision.actor.maxHealth,
    fatigue: decision.actor.fatigue,
    candidateCount: decision.candidates.length,
    candidates: decision.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      planner: candidate.planner,
      intentKind: candidate.intentKind,
      targetRef: candidate.targetRef,
      personaFit: candidate.personaFit,
      needScore: candidate.needScore,
      survivalUrgency: candidate.survivalUrgency,
      commitmentUrgency: candidate.commitmentUrgency,
      ...(candidate.resourceOutlook ? { resourceOutlook: candidate.resourceOutlook } : {}),
    })),
    defaultCandidateId: decision.defaultCandidateId,
    defaultIntentKind: defaultCandidate?.intentKind,
    defaultPlanner: defaultCandidate?.planner,
    social,
  });

  const sampling = llmSampling(decision);
  if (sampling.skip) {
    return resolveRule(decision, decisionSeq, defaultCandidate, sampling.skip);
  }
  return resolveLlm(decision, decisionSeq, defaultCandidate, sampling.kind);
}

// 返回 { kind: 'uniform' | 'social_boost' } 或 { skip: 原因 }。
function llmSampling(decision) {
  if (ARM !== 'deepseek') return { skip: 'rules_arm' };
  if (interrupted) return { skip: 'interrupted' };
  if (circuitReason) return { skip: 'circuit_open' };
  if (turns >= MAX_TURNS) return { skip: 'max_turns' };
  if (decision.candidates.length > MAX_CHILD_CANDIDATES) return { skip: 'too_many_candidates' };
  if (decision.tick < nextTurnTick) {
    if (SOCIAL_BOOST && decision.candidates.some(isSocialCandidate)) {
      return { kind: 'social_boost' };
    }
    return { skip: 'tick_pacing' };
  }
  eligibleLiveActors.add(decision.actor.actorId);
  const actorTurns = liveTurnsByActor.get(decision.actor.actorId) ?? 0;
  const activeActors = [...eligibleLiveActors].filter(
    (actorId) => (lastHookTickByActor.get(actorId) ?? -Infinity) >= decision.tick - FAIRNESS_WINDOW_TICKS,
  );
  const minimumActorTurns = Math.min(
    ...activeActors.map((actorId) => liveTurnsByActor.get(actorId) ?? 0),
  );
  if (actorTurns > minimumActorTurns) return { skip: 'fairness' };
  if (eligibleLiveActors.size > 1 && decision.actor.actorId === lastLiveActorId) {
    return { skip: 'rotation' };
  }
  return { kind: 'uniform' };
}

function resolveRule(decision, decisionSeq, defaultCandidate, skipReason, extra = {}) {
  ruleDecisions += 1;
  llmSkipReasonCounts[skipReason] = (llmSkipReasonCounts[skipReason] ?? 0) + 1;
  pendingDecisionByActor.set(decision.actor.actorId, {
    tick: decision.tick,
    seq: decisionSeq,
    decidedBy: 'rule',
  });
  writeLog({
    type: 'decision_resolved',
    seq: decisionSeq,
    tick: decision.tick,
    actorId: decision.actor.actorId,
    policy: 'rule',
    outcome: 'rule_default',
    llmSkippedReason: skipReason,
    selectedCandidateId: decision.defaultCandidateId,
    selectedIntentKind: defaultCandidate?.intentKind,
    selectedPlanner: defaultCandidate?.planner,
    defaultIntentKind: defaultCandidate?.intentKind,
    agreesWithDefault: true,
    ...extra,
  });
  return undefined;
}

function resolveLlm(decision, decisionSeq, defaultCandidate, sampling) {
  turns += 1;
  if (sampling === 'uniform') {
    // 只有均匀样本推进 tick 配额和公平轮换，social_boost 不影响均匀样本的分布。
    nextTurnTick = decision.tick + TURN_EVERY_TICKS;
    liveTurnsByActor.set(
      decision.actor.actorId,
      (liveTurnsByActor.get(decision.actor.actorId) ?? 0) + 1,
    );
    lastLiveActorId = decision.actor.actorId;
  } else {
    socialBoostTurns += 1;
  }
  const turnId = `${runId}:turn:${turns}`;
  const payload = {
    actorId: decision.actor.actorId,
    turnId,
    observationRevision: decision.observationRevision,
    candidateSetDigest: decision.candidateSetDigest,
    messages: buildMessages(decision),
    eligibleCandidateIds: decision.candidates.map((candidate) => candidate.candidateId),
  };
  const { response, attempts } = callProviderWithRetry(payload, decision, turnId);
  if (!response) {
    providerFailedTurns += 1;
    consecutiveProviderFailures += 1;
    if (consecutiveProviderFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
      openCircuit('consecutive_provider_failures');
    }
    // 模型不可用不算模型的选择：回退规则，只记一笔 provider_failed。
    return resolveRule(decision, decisionSeq, defaultCandidate, 'provider_failed', {
      policy: 'rule_fallback',
      turnId,
      sampling,
      providerReasonCode: attempts.at(-1)?.reasonCode,
      providerAttempts: attempts.length,
    });
  }
  enforceBudgets();
  const result = response.result;
  const status = result?.status ?? 'provider_failed';
  const selectedCandidate = decision.candidates.find(
    (candidate) => candidate.candidateId === result?.selectedCandidateId,
  );
  const usage = {
    turnId,
    sampling,
    providerCalls: response.externalProviderCalls,
    providerAttempts: attempts.length + 1,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    latencyMs: response.latencyMs,
    reasonCode: result?.intent?.reasonCode,
    failureReasonCode: result?.failureReasonCode,
    summary: bounded(result?.intent?.summary, 80),
  };

  if (status === 'selected' && selectedCandidate) {
    consecutiveProviderFailures = 0;
    selectedTurns += 1;
    pendingDecisionByActor.set(decision.actor.actorId, {
      tick: decision.tick,
      seq: decisionSeq,
      decidedBy: 'llm',
      turnId,
    });
    writeLog({
      type: 'decision_resolved',
      seq: decisionSeq,
      tick: decision.tick,
      actorId: decision.actor.actorId,
      policy: 'llm',
      outcome: 'selected',
      selectedCandidateId: selectedCandidate.candidateId,
      selectedIntentKind: selectedCandidate.intentKind,
      selectedPlanner: selectedCandidate.planner,
      defaultIntentKind: defaultCandidate?.intentKind,
      agreesWithDefault: selectedCandidate.candidateId === decision.defaultCandidateId,
      ...usage,
    });
    return {
      kind: 'selected',
      candidateId: selectedCandidate.candidateId,
      reasonCode: result.intent?.reasonCode ?? 'routine',
      summary: bounded(result.intent?.summary, 80) ?? '选择合法生活目标。',
    };
  }
  if (status === 'wait') {
    consecutiveProviderFailures = 0;
    waitTurns += 1;
    writeLog({
      type: 'decision_resolved',
      seq: decisionSeq,
      tick: decision.tick,
      actorId: decision.actor.actorId,
      policy: 'llm',
      outcome: 'wait',
      selectedIntentKind: 'wait',
      defaultIntentKind: defaultCandidate?.intentKind,
      agreesWithDefault: false,
      ...usage,
    });
    return {
      kind: 'wait',
      reasonCode:
        result.intent?.reasonCode === 'no_good_action' ? 'no_good_action' : 'insufficient_context',
      summary: bounded(result.intent?.summary, 80) ?? '保持等待。',
    };
  }
  if (status === 'selected' && !selectedCandidate) {
    invalidCandidateSelections += 1;
    openCircuit('stale_or_invalid_candidate');
  } else {
    providerFailedTurns += 1;
    consecutiveProviderFailures += 1;
    if (consecutiveProviderFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
      openCircuit('consecutive_provider_failures');
    }
  }
  return resolveRule(decision, decisionSeq, defaultCandidate, `provider_${status}`, {
    policy: 'rule_fallback',
    ...usage,
  });
}

// 一次子进程外呼。成功返回 { ok: true, response }，失败返回 { ok: false, reasonCode }。
function callProviderOnce(payload) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastProviderCallAt);
  if (wait > 0) sleepMs(wait);
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-specifier-resolution=node',
      '--loader',
      'ts-node/esm',
      resolve(import.meta.dirname, 'purpose_bound_life_live_deepseek_call.mjs'),
    ],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 256 * 1024,
      env: childEnvironment(),
    },
  );
  lastProviderCallAt = Date.now();
  try {
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(safeChildFailure(child.stderr));
    const response = JSON.parse(child.stdout);
    providerCalls += response.externalProviderCalls ?? 0;
    inputTokens += response.inputTokens ?? 0;
    outputTokens += response.outputTokens ?? 0;
    providerLatencyMs += response.latencyMs ?? 0;
    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      reasonCode: error instanceof Error ? bounded(error.message, 160) : 'provider_process_failed',
    };
  }
}

// 同一回合内对 provider_failed（含子进程失败）按 RETRY_DELAYS_MS 重试；其它状态原样交回。
function callProviderWithRetry(payload, decision, turnId) {
  const attempts = [];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const outcome = callProviderOnce(payload);
    if (outcome.ok && outcome.response.result?.status !== 'provider_failed') {
      return { response: outcome.response, attempts };
    }
    const reasonCode = outcome.ok
      ? outcome.response.result?.failureReasonCode ?? 'provider_failed'
      : outcome.reasonCode;
    attempts.push({ attempt, reasonCode });
    providerAttemptFailures += 1;
    writeLog({
      type: 'provider_attempt_failed',
      turnId,
      tick: decision.tick,
      actorId: decision.actor.actorId,
      attempt,
      reasonCode,
      eventTypes: outcome.ok ? outcome.response.eventTypes : undefined,
      willRetry: attempt < RETRY_DELAYS_MS.length && !circuitReason && !interrupted,
    });
    enforceBudgets();
    if (attempt >= RETRY_DELAYS_MS.length || circuitReason || interrupted) break;
    sleepMs(RETRY_DELAYS_MS[attempt]);
  }
  return { response: undefined, attempts };
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function onRuntimeEvent(event) {
  runtimeEvents += 1;
  let decidedBy;
  let decisionSeq;
  let turnId;
  if (event.type === 'action_selected') {
    actionsSelected += 1;
    const pending = pendingDecisionByActor.get(event.actorId);
    if (pending && pending.tick === event.tick) {
      decidedBy = pending.decidedBy;
      decisionSeq = pending.seq;
      turnId = pending.turnId;
      pendingDecisionByActor.delete(event.actorId);
    } else {
      // 没有经过 hook 的决策（生存强制、目标续行等）由引擎直接决定。
      decidedBy = 'engine';
    }
    const owner = { decidedBy, decisionSeq, turnId };
    if (event.actionId) decidedByAction.set(event.actionId, owner);
    if (event.goalId) decidedByGoal.set(event.goalId, owner);
  } else if (event.type === 'goal_created') {
    goalsCreated += 1;
    const owner = event.goalId ? decidedByGoal.get(event.goalId) : undefined;
    decidedBy = owner?.decidedBy;
    decisionSeq = owner?.decisionSeq;
    turnId = owner?.turnId;
  } else if (event.type === 'action_terminal') {
    actionsTerminal += 1;
    const owner = event.actionId ? decidedByAction.get(event.actionId) : undefined;
    decidedBy = owner?.decidedBy;
    decisionSeq = owner?.decisionSeq;
    turnId = owner?.turnId;
    if (event.goalId && owner && !decidedByGoal.has(event.goalId)) {
      decidedByGoal.set(event.goalId, owner);
    }
  } else if (event.type === 'goal_terminal') {
    goalsTerminal += 1;
    const owner = event.goalId ? decidedByGoal.get(event.goalId) : undefined;
    decidedBy = owner?.decidedBy;
    decisionSeq = owner?.decisionSeq;
    turnId = owner?.turnId;
  }
  writeLog({ ...event, decidedBy, decisionSeq, turnId });
}

function socialSummary(decision) {
  const kinds = decision.candidates.map((candidate) => candidate.intentKind);
  return {
    talkOffered: kinds.filter((kind) => kind === 'talk').length,
    giftOffered: kinds.filter((kind) => kind === 'gift').length,
    socialOffered: decision.candidates.filter(isSocialCandidate).length,
    nearbyActorCount: decision.socialContext.nearbyActorCount,
    nearbyRelationshipEligibleActorCount:
      decision.socialContext.nearbyRelationshipEligibleActorCount,
    activeGroupConversation: decision.socialContext.activeGroupConversation,
  };
}

function isSocialCandidate(candidate) {
  return (
    SOCIAL_INTENT_KINDS.has(candidate.intentKind) ||
    candidate.planner === 'group' ||
    candidate.planner === 'conversation'
  );
}

// 系统提示词与 c021q7 一小时 soak 完全相同；第二轮起采药候选多带一个 resourceOutlook
// （在途人数、委托预留、到达时预计剩余量、上次结局），候选说明文字里也写了同样的信息。
function buildMessages(decision) {
  const system = [
    '你是太虚界 NPC 的高层生活意图选择器，不是世界规则或身体控制器。',
    '活着优先；其次遵守人物性格、真实需要、义务和正在发展的生活。',
    '只能选择 candidates 中给出的 candidateId，不能创造动作、坐标、物品或结果。',
    '不要输出思维过程。只输出严格 json：',
    '{"kind":"submit_intent","candidateId":"...","reasonCode":"survival|personal_goal|obligation|relationship|routine","summary":"最多80字"}',
    '或 {"kind":"wait","reasonCode":"no_good_action|insufficient_context","summary":"最多80字"}。',
  ].join('\n');
  const user = JSON.stringify({
    observationRevision: decision.observationRevision,
    gameHour: decision.gameHour,
    self: decision.actor,
    candidates: decision.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      planner: candidate.planner,
      intentKind: candidate.intentKind,
      targetRef: candidate.targetRef,
      intent: bounded(candidate.intent, 160),
      survivalUrgency: candidate.survivalUrgency,
      needScore: candidate.needScore,
      personaFit: candidate.personaFit,
      personaReasonCodes: candidate.personaReasonCodes.slice(0, 4),
      commitmentUrgency: candidate.commitmentUrgency,
      relationshipReasons: candidate.relationshipReasons.slice(0, 4),
      ...(candidate.resourceOutlook ? { resourceOutlook: candidate.resourceOutlook } : {}),
    })),
  });
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  if (messages.reduce((total, message) => total + Array.from(message.content).length, 0) > 9_000) {
    throw new Error('ab_prompt_budget_exceeded');
  }
  return messages;
}

function childEnvironment() {
  // Windows 子进程需要 SystemRoot/TEMP 等才能正常联网；只透传这些系统变量，不透传其它 key。
  const passthrough = [
    'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'PATHEXT', 'PATH',
    'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'HOME', 'LANG',
  ];
  const env = {};
  for (const name of passthrough) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return {
    ...env,
    NODE_NO_WARNINGS: '1',
    XIANXIA_PI_NPC_DEEPSEEK_API_KEY: apiKey,
    XIANXIA_PI_NPC_PROVIDER_ENDPOINT: 'https://api.deepseek.com/chat/completions',
    XIANXIA_PI_NPC_ALLOW_LOOPBACK_PROVIDER_FIXTURE: '0',
  };
}

function enforceBudgets() {
  if (providerCalls > MAX_CALLS) openCircuit('provider_call_budget_exceeded');
  if (estimatedCostUsd() > MAX_COST_USD) openCircuit('cost_budget_exceeded');
}

function openCircuit(reasonCode) {
  if (circuitReason) return;
  circuitReason = reasonCode;
  writeLog({ type: 'circuit_opened', reasonCode, turns, providerCalls });
}

function estimatedCostUsd() {
  return Number(
    (
      (inputTokens * INPUT_COST_PER_MILLION) / 1_000_000 +
      (outputTokens * OUTPUT_COST_PER_MILLION) / 1_000_000
    ).toFixed(8),
  );
}

function writeLog(event) {
  appendFileSync(
    logPath,
    `${JSON.stringify({ ...event, recordedAt: new Date().toISOString() })}\n`,
    { encoding: 'utf8' },
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`ab_unexpected_argument:${token}`);
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      parsed[name] = true;
    } else {
      parsed[name] = next;
      index += 1;
    }
  }
  return parsed;
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 32) || 'seed';
}

function bounded(value, limit) {
  if (typeof value !== 'string') return undefined;
  return Array.from(value).slice(0, limit).join('');
}

function safeChildFailure(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (/401|403|auth|credential|key/iu.test(text)) return 'provider_auth_failed';
  if (/429|rate/iu.test(text)) return 'provider_rate_limited';
  if (/timeout|timed/iu.test(text)) return 'provider_timeout';
  return 'provider_process_failed';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readHiddenSecret() {
  if (!process.stdin.isTTY || !process.stderr.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('ab_api_key_missing: set XIANXIA_PI_NPC_DEEPSEEK_API_KEY or run in a TTY');
  }
  return new Promise((resolveSecret, rejectSecret) => {
    const bytes = [];
    const input = process.stdin;
    const previousRawMode = input.isRaw === true;
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(previousRawMode);
      input.pause();
    };
    const finish = () => {
      const buffer = Buffer.from(bytes);
      bytes.fill(0);
      cleanup();
      process.stderr.write('\n');
      // 终端粘贴可能带 bracketed-paste 转义序列（ESC[200~ … ESC[201~），一并去掉。
      const secret = buffer
        .toString('utf8')
        .replace(/\u001b\[[0-9;]*[A-Za-z~]/gu, '')
        .trim();
      buffer.fill(0);
      resolveSecret(secret);
    };
    const onData = (chunk) => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3) {
          cleanup();
          rejectSecret(new Error('ab_key_input_interrupted'));
          return;
        }
        if (byte === 10 || byte === 13) {
          finish();
          return;
        }
        if (byte === 8 || byte === 127) bytes.pop();
        else bytes.push(byte);
      }
    };
    process.stderr.write('DeepSeek API key（隐藏输入，Enter 确认；也可先设环境变量 XIANXIA_PI_NPC_DEEPSEEK_API_KEY 再运行）: ');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

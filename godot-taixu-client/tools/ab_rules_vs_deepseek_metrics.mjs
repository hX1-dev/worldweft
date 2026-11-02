#!/usr/bin/env node

// 从 run_ab_rules_vs_deepseek.mjs 的 JSONL 计算四项指标：动作熵、聊天率、wait 率、目标成功率。
//   node godot-taixu-client/tools/ab_rules_vs_deepseek_metrics.mjs \
//     --rules a.jsonl [--rules b.jsonl ...] --deepseek c.jsonl [--out report.md] [--json report.json]
// 两个层面：
//   轨迹层：整条运行里所有 hook 决策 / 所有动作 / 所有目标（规则臂 vs DeepSeek 臂，同 seed）。
//   成对层：DeepSeek 臂里每个模型回合，模型的选择 vs 规则在同一快照上的默认选择。
// 置信区间用 bootstrap（2000 次，固定随机种子）。

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const SOCIAL_KINDS = new Set([
  'talk', 'gift', 'request_teaching', 'invite_social',
  'respond_social_invitation', 'group_talk', 'group_decide',
]);
const SOCIAL_ACTIONS = new Set([
  'talk', 'gift', 'request_teaching', 'invite_social',
  'respond_social_invitation', 'group_talk', 'group_decide',
]);
const BOOTSTRAP_ROUNDS = 2_000;

const args = parseArgs(process.argv.slice(2));
const rulesPaths = toList(args.rules);
const deepseekPaths = toList(args.deepseek);
if (rulesPaths.length === 0 && deepseekPaths.length === 0) {
  throw new Error('usage: --rules <jsonl> [--deepseek <jsonl>] [--out report.md] [--json report.json]');
}

const rulesRuns = rulesPaths.map((path) => analyzeRun(loadRun(path)));
const deepseekRuns = deepseekPaths.map((path) => analyzeRun(loadRun(path)));
const report = {
  generatedAt: new Date().toISOString(),
  rules: rulesRuns,
  deepseek: deepseekRuns,
  comparison: deepseekRuns.length > 0 && rulesRuns.length > 0
    ? compareArms(rulesRuns, deepseekRuns)
    : null,
  // 多个 DeepSeek seed 时把全部模型回合与模型决定的目标合并，得到更有统计功效的成对估计。
  pooledPaired: deepseekRuns.length > 1
    ? pairedMetrics(
        deepseekRuns.flatMap((run) => run.decisions.filter((decision) => decision.policy === 'llm')),
        [],
        deepseekRuns.flatMap((run) => run.goals),
      )
    : null,
};
const markdown = renderMarkdown(report);
process.stdout.write(markdown);
if (args.out) writeFileSync(args.out, markdown, 'utf8');
if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

// ---------------------------------------------------------------------------

function loadRun(path) {
  const records = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const started = records.find((record) => record.type === 'run_started');
  const completed = records.find((record) => record.type === 'run_completed');
  if (!started) throw new Error(`run_started_missing:${path}`);
  return { path, records, started, completed };
}

function analyzeRun(run) {
  const offered = new Map();
  const decisions = [];
  const actions = [];
  const goals = [];
  for (const record of run.records) {
    if (record.type === 'decision_offered') {
      offered.set(record.seq, record);
    } else if (record.type === 'decision_resolved') {
      const offer = offered.get(record.seq);
      const talkOffered = (offer?.social?.talkOffered ?? 0) > 0;
      const socialOffered = (offer?.social?.socialOffered ?? 0) > 0;
      const selectedKind = record.selectedIntentKind ?? 'unknown';
      const contended = (candidate) =>
        Boolean(candidate?.resourceOutlook) && candidate.resourceOutlook.expectedAvailableOnArrival < 1;
      const selectedCandidate = offer?.candidates?.find(
        (candidate) => candidate.candidateId === record.selectedCandidateId,
      );
      decisions.push({
        seq: record.seq,
        tick: record.tick,
        actorId: record.actorId,
        turnId: record.turnId,
        policy: record.policy,
        outcome: record.outcome,
        sampling: record.sampling ?? 'uniform',
        llmSkippedReason: record.llmSkippedReason,
        candidateCount: offer?.candidateCount ?? 0,
        defaultKind: record.defaultIntentKind ?? offer?.defaultIntentKind ?? 'unknown',
        selectedKind,
        talkOffered,
        socialOffered,
        selectedIsTalk: selectedKind === 'talk',
        selectedIsSocial: SOCIAL_KINDS.has(selectedKind),
        isWait: record.outcome === 'wait',
        agrees: record.agreesWithDefault === true,
        contendedOffered: (offer?.candidates ?? []).some(contended),
        selectedContended: contended(selectedCandidate),
        latencyMs: record.latencyMs,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
      });
    } else if (record.type === 'action_selected') {
      actions.push({ actionType: record.actionType, decidedBy: record.decidedBy ?? 'engine' });
    } else if (record.type === 'goal_terminal') {
      goals.push({
        status: record.status,
        reasonCode: record.reasonCode,
        sourceRef: record.sourceRef ?? '',
        decidedBy: record.decidedBy ?? 'engine',
        turnId: record.turnId,
      });
    }
  }
  const llmTurns = decisions.filter((decision) => decision.policy === 'llm');
  const world = run.completed?.worldSummary;
  return {
    path: run.path,
    file: basename(run.path),
    arm: run.started.arm,
    seed: run.started.seed,
    ticks: run.started.ticks,
    model: run.started.model,
    completed: Boolean(run.completed) && !run.completed.failure,
    failure: run.completed?.failure,
    releaseReady: run.completed?.releaseReady,
    elapsedMs: run.completed?.elapsedMs,
    cost: {
      providerCalls: run.completed?.providerCalls ?? 0,
      inputTokens: run.completed?.inputTokens ?? 0,
      outputTokens: run.completed?.outputTokens ?? 0,
      estimatedCostUsd: run.completed?.estimatedCostUsd ?? 0,
      providerFailedTurns: run.completed?.providerFailedTurns ?? 0,
      meanLatencyMs: llmTurns.length > 0
        ? Math.round(sum(llmTurns.map((turn) => turn.latencyMs ?? 0)) / llmTurns.length)
        : null,
    },
    world: world
      ? {
          decisions: world.decisions,
          actions: world.actions,
          settlements: world.settlements,
          actorCount: world.actorCount,
          engineIdleShare: world.decisions > 0 ? (world.decisions - world.actions) / world.decisions : null,
          resources: world.resources,
          releaseStatus: world.releaseAudit?.releaseStatus,
        }
      : null,
    trajectory: trajectoryMetrics(decisions, actions, goals),
    paired: llmTurns.length > 0 ? pairedMetrics(llmTurns, decisions, goals) : null,
    decisions,
    actions,
    goals,
  };
}

function trajectoryMetrics(decisions, actions, goals) {
  const resolved = decisions.filter((decision) => decision.outcome !== 'provider_failed');
  const talkOfferedDecisions = resolved.filter((decision) => decision.talkOffered);
  const socialOfferedDecisions = resolved.filter((decision) => decision.socialOffered);
  const terminalGoals = goals.filter((goal) => goal.status === 'completed' || goal.status === 'failed');
  const herbGoals = terminalGoals.filter((goal) => goal.sourceRef.startsWith('resource:'));
  return {
    sourceMissing: terminalGoals.filter(
      (goal) => goal.status === 'failed' && goal.reasonCode === 'purpose_goal_source_missing',
    ).length,
    resourceGoalSuccessRate: rate(
      herbGoals.filter((goal) => goal.status === 'completed').length,
      herbGoals.length,
    ),
    hookDecisions: decisions.length,
    llmDecisions: decisions.filter((decision) => decision.policy === 'llm').length,
    actionEntropyBits: entropy(actions.map((action) => action.actionType)),
    actionKinds: distribution(actions.map((action) => action.actionType)),
    hookChoiceEntropyBits: entropy(resolved.map((decision) => decision.selectedKind)),
    hookChoiceKinds: distribution(resolved.map((decision) => decision.selectedKind)),
    talkRateWhenOffered: rate(talkOfferedDecisions.filter((decision) => decision.selectedIsTalk).length, talkOfferedDecisions.length),
    talkOfferedDecisions: talkOfferedDecisions.length,
    socialRateWhenOffered: rate(socialOfferedDecisions.filter((decision) => decision.selectedIsSocial).length, socialOfferedDecisions.length),
    socialOfferedDecisions: socialOfferedDecisions.length,
    socialActionShare: rate(actions.filter((action) => SOCIAL_ACTIONS.has(action.actionType)).length, actions.length),
    waitRate: rate(resolved.filter((decision) => decision.isWait).length, resolved.length),
    goalSuccessRate: rate(terminalGoals.filter((goal) => goal.status === 'completed').length, terminalGoals.length),
    goalTerminals: terminalGoals.length,
    goalFailureReasons: distribution(terminalGoals.filter((goal) => goal.status === 'failed').map((goal) => goal.reasonCode ?? 'unknown')),
    goalSuccessByDecider: Object.fromEntries(
      ['llm', 'rule', 'engine'].map((decider) => {
        const subset = terminalGoals.filter((goal) => goal.decidedBy === decider);
        return [decider, { ...rate(subset.filter((goal) => goal.status === 'completed').length, subset.length), n: subset.length }];
      }),
    ),
  };
}

function pairedMetrics(llmTurns, decisions, goals) {
  const rng = mulberry32(20261021);
  // 熵和 wait 只用均匀样本；聊天/社交率用全部有相应候选的模型回合（含 social_boost）。
  const uniformTurns = llmTurns.filter((turn) => turn.sampling === 'uniform');
  const llmKinds = uniformTurns.map((turn) => turn.selectedKind);
  const defaultKinds = uniformTurns.map((turn) => turn.defaultKind);
  const talkTurns = llmTurns.filter((turn) => turn.talkOffered);
  const socialTurns = llmTurns.filter((turn) => turn.socialOffered);
  const llmGoals = goals.filter((goal) => goal.decidedBy === 'llm' && (goal.status === 'completed' || goal.status === 'failed'));
  const ruleGoals = goals.filter((goal) => goal.decidedBy === 'rule' && (goal.status === 'completed' || goal.status === 'failed'));

  const entropyDiff = bootstrap(rng, uniformTurns, (sample) =>
    entropy(sample.map((turn) => turn.selectedKind)) - entropy(sample.map((turn) => turn.defaultKind)));
  const talkDiff = bootstrap(rng, talkTurns, (sample) =>
    mean(sample.map((turn) => Number(turn.selectedIsTalk))) - mean(sample.map((turn) => Number(turn.defaultKind === 'talk'))));
  const socialDiff = bootstrap(rng, socialTurns, (sample) =>
    mean(sample.map((turn) => Number(turn.selectedIsSocial))) - mean(sample.map((turn) => Number(SOCIAL_KINDS.has(turn.defaultKind)))));
  const waitCi = bootstrap(rng, uniformTurns, (sample) => mean(sample.map((turn) => Number(turn.isWait))));
  const goalDiff = bootstrapTwoSample(rng, llmGoals, ruleGoals, (a, b) =>
    mean(a.map((goal) => Number(goal.status === 'completed'))) - mean(b.map((goal) => Number(goal.status === 'completed'))));

  // Turns where at least one offered trip was projected to come up empty, and
  // what the model did with it (the rule never picks such a trip).
  const contendedTurns = llmTurns.filter((turn) => turn.contendedOffered);
  const goalByTurn = new Map(goals.filter((goal) => goal.turnId).map((goal) => [goal.turnId, goal]));
  const contendedPicks = contendedTurns.filter((turn) => turn.selectedContended);
  const contendedPickOutcomes = {};
  for (const turn of contendedPicks) {
    const goal = goalByTurn.get(turn.turnId);
    const key = goal ? `${goal.status}${goal.status === 'failed' ? `:${goal.reasonCode}` : ''}` : 'unlinked';
    contendedPickOutcomes[key] = (contendedPickOutcomes[key] ?? 0) + 1;
  }

  const transitions = {};
  for (const turn of llmTurns) {
    if (turn.agrees) continue;
    const key = `${turn.defaultKind} → ${turn.selectedKind}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
  }
  return {
    turns: llmTurns.length,
    uniformTurns: uniformTurns.length,
    socialBoostTurns: llmTurns.length - uniformTurns.length,
    agreementRate: rate(llmTurns.filter((turn) => turn.agrees).length, llmTurns.length),
    agreementRateUniform: rate(uniformTurns.filter((turn) => turn.agrees).length, uniformTurns.length),
    entropy: {
      llmBits: entropy(llmKinds),
      ruleBits: entropy(defaultKinds),
      diff: entropyDiff,
      llmKinds: distribution(llmKinds),
      ruleKinds: distribution(defaultKinds),
    },
    talk: {
      turnsWithTalkOffered: talkTurns.length,
      llm: rate(talkTurns.filter((turn) => turn.selectedIsTalk).length, talkTurns.length),
      rule: rate(talkTurns.filter((turn) => turn.defaultKind === 'talk').length, talkTurns.length),
      diff: talkDiff,
    },
    social: {
      turnsWithSocialOffered: socialTurns.length,
      llm: rate(socialTurns.filter((turn) => turn.selectedIsSocial).length, socialTurns.length),
      rule: rate(socialTurns.filter((turn) => SOCIAL_KINDS.has(turn.defaultKind)).length, socialTurns.length),
      diff: socialDiff,
    },
    wait: {
      llm: { ...rate(uniformTurns.filter((turn) => turn.isWait).length, uniformTurns.length), ci95: waitCi.ci95 },
      rule: rate(0, uniformTurns.length),
    },
    goalSuccess: {
      llm: { ...rate(llmGoals.filter((goal) => goal.status === 'completed').length, llmGoals.length), n: llmGoals.length },
      rule: { ...rate(ruleGoals.filter((goal) => goal.status === 'completed').length, ruleGoals.length), n: ruleGoals.length },
      diff: goalDiff,
    },
    contended: {
      turnsOffered: contendedTurns.length,
      llmPicked: rate(contendedPicks.length, contendedTurns.length),
      outcomes: contendedPickOutcomes,
    },
    topTransitions: Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

function compareArms(rulesRuns, deepseekRuns) {
  const pick = (run) => ({
    actionEntropyBits: run.trajectory.actionEntropyBits,
    hookChoiceEntropyBits: run.trajectory.hookChoiceEntropyBits,
    talkRateWhenOffered: run.trajectory.talkRateWhenOffered.value,
    socialRateWhenOffered: run.trajectory.socialRateWhenOffered.value,
    socialActionShare: run.trajectory.socialActionShare.value,
    waitRate: run.trajectory.waitRate.value,
    engineIdleShare: run.world?.engineIdleShare ?? null,
    goalSuccessRate: run.trajectory.goalSuccessRate.value,
    resourceGoalSuccessRate: run.trajectory.resourceGoalSuccessRate.value,
    sourceMissingCount: run.trajectory.sourceMissing,
  });
  const stats = (runs) => {
    const values = runs.map(pick);
    const keys = Object.keys(values[0]);
    return Object.fromEntries(keys.map((key) => {
      const numbers = values.map((entry) => entry[key]).filter((value) => value !== null && Number.isFinite(value));
      return [key, numbers.length > 0 ? { mean: mean(numbers), min: Math.min(...numbers), max: Math.max(...numbers), n: numbers.length } : null];
    }));
  };
  return {
    rulesSeeds: rulesRuns.map((run) => run.seed),
    deepseekSeeds: deepseekRuns.map((run) => run.seed),
    rulesStats: stats(rulesRuns),
    deepseekStats: stats(deepseekRuns),
    perSeed: deepseekRuns.map((run) => {
      const sameSeedRules = rulesRuns.find((candidate) => candidate.seed === run.seed) ?? null;
      return { seed: run.seed, deepseek: pick(run), rules: sameSeedRules ? pick(sameSeedRules) : null };
    }),
  };
}

// ---------------------------------------------------------------------------

function renderMarkdown(report) {
  const lines = [];
  lines.push('# 规则组 vs DeepSeek 成对 A/B · 指标');
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push('');
  lines.push('## 运行');
  lines.push('');
  lines.push('| 臂 | seed | ticks | 完成 | 世界决策 | 动作 | hook 决策 | 模型回合 | provider 调用 | 费用 USD | 平均延迟 ms | 用时 |');
  lines.push('|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const run of [...report.rules, ...report.deepseek]) {
    lines.push(`| ${run.arm} | ${run.seed} | ${run.ticks} | ${run.completed ? '是' : `否(${run.failure ?? '?'})`} | ${run.world?.decisions ?? '-'} | ${run.world?.actions ?? '-'} | ${run.trajectory.hookDecisions} | ${run.trajectory.llmDecisions} | ${run.cost.providerCalls} | ${run.cost.estimatedCostUsd} | ${run.cost.meanLatencyMs ?? '-'} | ${fmtDuration(run.elapsedMs)} |`);
  }
  lines.push('');
  lines.push('## 轨迹层（整条运行）');
  lines.push('');
  lines.push('| 臂 | seed | 动作熵 bits | hook 选择熵 bits | 聊天率(有 talk 候选时) | 社交率(有社交候选时) | 社交动作占比 | wait 率 | 引擎空闲占比 | 目标成功率 | source_missing | 采药目标成功率 |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const run of [...report.rules, ...report.deepseek]) {
    const t = run.trajectory;
    lines.push(`| ${run.arm} | ${run.seed} | ${fmt(t.actionEntropyBits)} | ${fmt(t.hookChoiceEntropyBits)} | ${pct(t.talkRateWhenOffered)} | ${pct(t.socialRateWhenOffered)} | ${pct(t.socialActionShare)} | ${pct(t.waitRate)} | ${run.world?.engineIdleShare != null ? `${(run.world.engineIdleShare * 100).toFixed(1)}%` : '-'} | ${pct(t.goalSuccessRate)} | ${t.sourceMissing} | ${pct(t.resourceGoalSuccessRate)} |`);
  }
  lines.push('');
  if (report.comparison) {
    const c = report.comparison;
    const metricRows = [
      ['actionEntropyBits', '动作熵 bits'],
      ['hookChoiceEntropyBits', 'hook 选择熵 bits'],
      ['talkRateWhenOffered', '聊天率'],
      ['socialRateWhenOffered', '社交率'],
      ['waitRate', 'wait 率'],
      ['engineIdleShare', '引擎空闲占比'],
      ['goalSuccessRate', '目标成功率'],
      ['resourceGoalSuccessRate', '采药目标成功率'],
      ['sourceMissingCount', 'source_missing 次数'],
    ];
    const fmtStat = (stat, isRate, isCount) => {
      if (!stat) return '-';
      const f = (value) => (value == null ? '-' : isCount ? value.toFixed(0) : isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
      return stat.n > 1 ? `${f(stat.mean)} [${f(stat.min)}, ${f(stat.max)}]` : f(stat.mean);
    };
    lines.push(`跨 seed 汇总：规则臂 n=${c.rulesSeeds.length}，DeepSeek 臂 n=${c.deepseekSeeds.length}；均值 [最小, 最大]：`);
    lines.push('');
    lines.push('| 指标 | 规则臂 | DeepSeek 臂 |');
    lines.push('|---|---|---|');
    for (const [key, label] of metricRows) {
      const isCount = key.endsWith('Count');
      const isRate = !key.endsWith('Bits') && !isCount;
      lines.push(`| ${label} | ${fmtStat(c.rulesStats[key], isRate, isCount)} | ${fmtStat(c.deepseekStats[key], isRate, isCount)} |`);
    }
    lines.push('');
    if (c.perSeed.some((entry) => entry.rules)) {
      lines.push('同 seed 逐对比较（规则 → DeepSeek）：');
      lines.push('');
      lines.push('| seed | 动作熵 | 聊天率 | 社交率 | 引擎空闲 | 目标成功率 |');
      lines.push('|---|---|---|---|---|---|');
      for (const entry of c.perSeed) {
        if (!entry.rules) continue;
        const pair = (key, isRate) => {
          const f = (value) => (value == null ? '-' : isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
          return `${f(entry.rules[key])} → ${f(entry.deepseek[key])}`;
        };
        lines.push(`| ${entry.seed} | ${pair('actionEntropyBits', false)} | ${pair('talkRateWhenOffered', true)} | ${pair('socialRateWhenOffered', true)} | ${pair('engineIdleShare', true)} | ${pair('goalSuccessRate', true)} |`);
      }
      lines.push('');
    }
  }
  if (report.pooledPaired) {
    renderPaired(lines, `成对层 · 全部 DeepSeek seed 合并（${report.deepseek.map((run) => run.seed).join(', ')}）`, report.pooledPaired);
  }
  for (const run of report.deepseek) {
    if (!run.paired) continue;
    renderPaired(lines, `成对层 · DeepSeek 臂 ${run.seed}`, run.paired);
  }
  lines.push('## 动作分布（轨迹层）');
  lines.push('');
  for (const run of [...report.rules, ...report.deepseek]) {
    lines.push(`- ${run.arm} ${run.seed}: ${Object.entries(run.trajectory.actionKinds).map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## 目标失败原因');
  lines.push('');
  for (const run of [...report.rules, ...report.deepseek]) {
    const reasons = Object.entries(run.trajectory.goalFailureReasons);
    lines.push(`- ${run.arm} ${run.seed}: ${reasons.length > 0 ? reasons.map(([reason, n]) => `${reason} ${n}`).join(', ') : '无'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderPaired(lines, title, p) {
  lines.push(`## ${title}（${p.turns} 个模型回合 = ${p.uniformTurns} 均匀采样 + ${p.socialBoostTurns} 社交加采，同一快照上模型 vs 规则默认）`);
  lines.push('');
  lines.push(`与规则默认一致：全部 ${pct(p.agreementRate)}，均匀样本 ${pct(p.agreementRateUniform)}`);
  lines.push('');
  lines.push('| 指标 | DeepSeek | 规则默认 | 差值 (95% CI) |');
  lines.push('|---|---:|---:|---|');
  lines.push(`| 选择熵 bits（均匀样本 ${p.uniformTurns}） | ${fmt(p.entropy.llmBits)} | ${fmt(p.entropy.ruleBits)} | ${fmtCi(p.entropy.diff, false)} |`);
  lines.push(`| 聊天率（${p.talk.turnsWithTalkOffered} 回合有 talk 候选） | ${pct(p.talk.llm)} | ${pct(p.talk.rule)} | ${fmtCi(p.talk.diff, true)} |`);
  lines.push(`| 社交率（${p.social.turnsWithSocialOffered} 回合有社交候选） | ${pct(p.social.llm)} | ${pct(p.social.rule)} | ${fmtCi(p.social.diff, true)} |`);
  lines.push(`| wait 率（均匀样本） | ${pct(p.wait.llm)} (CI ${fmtRange(p.wait.llm.ci95, true)}) | 0.0% | - |`);
  lines.push(`| 目标成功率（模型选的 ${p.goalSuccess.llm.n} 个目标 vs 规则选的 ${p.goalSuccess.rule.n} 个） | ${pct(p.goalSuccess.llm)} | ${pct(p.goalSuccess.rule)} | ${fmtCi(p.goalSuccess.diff, true)} |`);
  if (p.contended) {
    const outcomes = Object.entries(p.contended.outcomes).map(([key, n]) => `${key} ${n}`).join('，') || '无';
    lines.push(`| 选了预计扑空的采药（${p.contended.turnsOffered} 回合有此候选） | ${pct(p.contended.llmPicked)} | 0.0% | 结局：${outcomes} |`);
  }
  lines.push('');
  lines.push('模型选择分布 vs 规则默认分布：');
  lines.push('');
  lines.push(renderDistribution(p.entropy.llmKinds, p.entropy.ruleKinds));
  lines.push('');
  if (p.topTransitions.length > 0) {
    lines.push('模型改变了规则默认的回合（默认 → 模型）：');
    lines.push('');
    for (const [key, count] of p.topTransitions) lines.push(`- ${key}: ${count}`);
    lines.push('');
  }
}

function renderDistribution(llmKinds, ruleKinds) {
  const kinds = [...new Set([...Object.keys(llmKinds), ...Object.keys(ruleKinds)])].sort(
    (a, b) => (ruleKinds[b] ?? 0) + (llmKinds[b] ?? 0) - (ruleKinds[a] ?? 0) - (llmKinds[a] ?? 0),
  );
  const rows = ['| 意图 | DeepSeek | 规则默认 |', '|---|---:|---:|'];
  for (const kind of kinds) rows.push(`| ${kind} | ${llmKinds[kind] ?? 0} | ${ruleKinds[kind] ?? 0} |`);
  return rows.join('\n');
}

// ---------------------------------------------------------------------------

function entropy(values) {
  if (values.length === 0) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / values.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function distribution(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function rate(numerator, denominator) {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

function bootstrap(rng, items, statistic) {
  if (items.length === 0) return { point: null, ci95: null, n: 0 };
  const point = statistic(items);
  const draws = [];
  for (let round = 0; round < BOOTSTRAP_ROUNDS; round += 1) {
    const sample = [];
    for (let index = 0; index < items.length; index += 1) {
      sample.push(items[Math.floor(rng() * items.length)]);
    }
    draws.push(statistic(sample));
  }
  draws.sort((a, b) => a - b);
  return { point, ci95: [quantile(draws, 0.025), quantile(draws, 0.975)], n: items.length };
}

function bootstrapTwoSample(rng, a, b, statistic) {
  if (a.length === 0 || b.length === 0) return { point: null, ci95: null, n: [a.length, b.length] };
  const point = statistic(a, b);
  const draws = [];
  for (let round = 0; round < BOOTSTRAP_ROUNDS; round += 1) {
    const sampleA = [];
    const sampleB = [];
    for (let index = 0; index < a.length; index += 1) sampleA.push(a[Math.floor(rng() * a.length)]);
    for (let index = 0; index < b.length; index += 1) sampleB.push(b[Math.floor(rng() * b.length)]);
    draws.push(statistic(sampleA, sampleB));
  }
  draws.sort((x, y) => x - y);
  return { point, ci95: [quantile(draws, 0.025), quantile(draws, 0.975)], n: [a.length, b.length] };
}

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function fmt(value) {
  return value == null ? '-' : value.toFixed(3);
}

function pct(rateValue) {
  if (!rateValue || rateValue.value == null) return '-';
  return `${(rateValue.value * 100).toFixed(1)}% (${rateValue.numerator}/${rateValue.denominator})`;
}

function fmtRange(ci, isRate) {
  if (!ci) return '-';
  const f = (value) => (isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
  return `[${f(ci[0])}, ${f(ci[1])}]`;
}

function fmtCi(stat, isRate) {
  if (!stat || stat.point == null) return '-';
  const f = (value) => (isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
  const sign = stat.point > 0 ? '+' : '';
  return `${sign}${f(stat.point)} ${fmtRange(stat.ci95, isRate)}`;
}

function fmtDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`;
}

function toList(value) {
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected_argument:${token}`);
    const name = token.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith('--') ? true : next;
    if (value !== true) index += 1;
    if (parsed[name] === undefined) parsed[name] = value;
    else parsed[name] = [...toList(parsed[name]), value];
  }
  return parsed;
}

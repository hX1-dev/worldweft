#!/usr/bin/env node
// 拟人生活基线：用规则那一路跑固定种子，比对轨迹指纹（world.trajectoryDigest）。
// 底层改动（重构、剪代码、搬家）都不该让这些指纹变；变了就说明 NPC 的行为跟着变了。
// 拟人生活的规则改动会改变带 human 的几组，改完要重定基线，并在报告里写明为什么变。
//
// 用法：
//   node --experimental-specifier-resolution=node --loader ts-node/esm \
//     godot-taixu-client/tools/check_life_baseline.mjs [--quick] [--jobs 4]
//   --quick  只跑 s1 的 5 组（约 2 分钟）；默认跑全部 15 组（约 5 分钟，100 天长测最慢）。
//   日志写在 .logs/life-baseline/<时间>/，不进版本库。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const jobsAt = argv.indexOf('--jobs');
const JOBS = jobsAt >= 0 ? Number(argv[jobsAt + 1]) : Math.max(1, Math.min(6, cpus().length - 1));
if (!Number.isInteger(JOBS) || JOBS < 1) throw new Error('life_baseline_jobs_invalid');

// 种子 ab-20261021:s1–s3。full = 知道谁在路上、哪份委托被预留；memory = 只记得自己上次的结局。
const EXPECTED = [
  ['rules', 's1', '3ba127abb40597fb'],
  ['rules', 's2', '4accda8216cc4ff1'],
  ['rules', 's3', '7de46af941096a2f'],
  ['rules-memory', 's1', '8b8fb444daefb8d3'],
  ['rules-memory', 's2', 'f20d16391479172e'],
  ['rules-memory', 's3', 'afdf50efb13c5e5e'],
  ['rules-human', 's1', 'd5f180494c6dc9c7'],
  ['rules-human', 's2', '585bac1684bc1eff'],
  ['rules-human', 's3', 'a777383f07b02543'],
  ['rules-human-memory', 's1', 'a3a0a9075a8afc02'],
  ['rules-human-memory', 's2', 'bf8521d1e6a76969'],
  ['rules-human-memory', 's3', 'e7764cf1e115965a'],
  ['rules-human-long', 's1', '96f97ca378e7a818'],
  ['rules-human-long', 's2', '1affe50a7f6b94dd'],
  ['rules-human-long', 's3', 'c01d3c45fcd68073'],
].filter(([, seed]) => !QUICK || seed === 's1');

const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const logDir = `.logs/life-baseline/${stamp}`;
mkdirSync(resolve(root, logDir), { recursive: true });

function argsFor(kind, seed) {
  const a = ['godot-taixu-client/tools/run_ab_rules_vs_deepseek.mjs', '--arm', 'rules', '--seed', `ab-20261021:${seed}`];
  a.push('--ticks', kind.includes('long') ? '9600' : '3600');
  a.push('--outlook-mode', kind.includes('memory') ? 'memory_only' : 'full');
  a.push('--log-dir', logDir);
  if (kind.includes('human')) a.push('--human-life');
  if (kind.includes('long')) a.push('--run-tag', 'long');
  return a;
}

function runOne([kind, seed]) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [...process.execArgv, ...argsFor(kind, seed)], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('close', (code) => done({ kind, seed, code, err }));
  });
}

const queue = [...EXPECTED];
const finished = [];
await Promise.all(
  Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) finished.push(await runOne(queue.shift()));
  }),
);

const manifests = readdirSync(resolve(root, logDir))
  .filter((f) => f.endsWith('.manifest.json'))
  .map((f) => JSON.parse(readFileSync(resolve(root, logDir, f), 'utf8')));

let ok = 0;
for (const [kind, seed, want] of EXPECTED) {
  const prefix = `${kind}-ab-20261021-${seed}-`;
  const m = manifests.find((x) => String(x.runId).startsWith(prefix));
  const got = m ? String(m.world?.trajectoryDigest ?? '').replace(/^stable64:/u, '') : '';
  const run = finished.find((r) => r.kind === kind && r.seed === seed);
  const same = got === want;
  if (same) ok += 1;
  console.log(`${same ? '✔' : '✘'} ${`${kind} ${seed}`.padEnd(24)} ${got || '(没有结果)'}${same ? '' : `  应为 ${want}`}`);
  if (!m && run?.err) console.log(`    ${run.err.trim().split('\n').slice(-3).join('\n    ')}`);
}
console.log(`${ok}/${EXPECTED.length} 组指纹一致（日志：${logDir}）`);
process.exit(ok === EXPECTED.length ? 0 : 1);

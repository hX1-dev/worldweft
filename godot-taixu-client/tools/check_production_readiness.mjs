#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const listOnly = process.argv.includes('--list');

const steps = [
  {
    label: 'real release source',
    command: 'npm',
    args: ['run', 'godot:check-release-source'],
  },
  {
    label: 'full-local isolated snapshot',
    command: process.execPath,
    args: ['godot-taixu-client/tools/check_clean_snapshot.mjs', '--full-local'],
  },
  {
    label: '24-tick agent soak',
    command: 'npm',
    args: ['run', 'godot:check-agent-soak-long'],
    needsDebugToken: true,
  },
  {
    label: 'Qinglan navigation audit',
    command: 'npm',
    args: ['run', 'qinglan:audit-mask'],
  },
  {
    label: 'whitespace gate',
    command: 'git',
    args: ['diff', '--check'],
  },
  {
    label: 'final release source',
    command: 'npm',
    args: ['run', 'godot:check-release-source'],
  },
];

if (listOnly) {
  for (const step of steps) console.log(`${step.label}: ${step.command} ${step.args.join(' ')}`);
  process.exit(0);
}

const env = {
  ...process.env,
  CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '120',
};
const debugTokenName = ['GODOT', 'BRIDGE', 'DEBUG', 'TOKEN'].join('_');

for (const step of steps) {
  if (step.needsDebugToken && !env[debugTokenName]) {
    env[debugTokenName] = localConvexEnvironmentValue(debugTokenName);
    if (!env[debugTokenName]) {
      throw new Error('Production readiness requires the local Convex debug credential for soak verification.');
    }
  }
  console.log(`\n== ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${step.label} failed with exit code ${result.status}.`);
  }
}

console.log('\nGodot production readiness automation passed. Complete the manual client gate before release.');

function localConvexEnvironmentValue(name) {
  const result = spawnSync('npx', ['convex', 'env', 'get', name], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

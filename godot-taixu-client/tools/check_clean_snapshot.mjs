#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fullLocal = process.argv.includes('--full-local');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'godot-taixu-snapshot-'));
const checkout = join(temporaryRoot, 'checkout');
const archive = join(temporaryRoot, 'head.tar');
let completed = false;

function run(label, command, args, options = {}) {
  console.log(`\n== ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? checkout,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function manifest() {
  const result = spawnSync(
    process.execPath,
    ['godot-taixu-client/tools/check_source_boundary.mjs', '--json'],
    { cwd: root, encoding: 'utf8', env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function copyReleaseFiles(paths) {
  for (const path of paths) {
    const source = resolve(root, path);
    const destination = resolve(checkout, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function snapshotEnvironment() {
  const godotBin =
    process.env.GODOT_BIN ??
    resolve(root, 'tmp/godot-download/Godot.app/Contents/MacOS/Godot');
  const env = {
    ...process.env,
    GODOT_BIN: godotBin,
    CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '120',
  };
  if (fullLocal) {
    for (const name of [
      'GODOT_BRIDGE_WORLD_ID',
      'GODOT_BRIDGE_TOKEN',
      'GODOT_BRIDGE_DEBUG_TOKEN',
    ]) {
      if (!env[name]) env[name] = localConvexEnvironmentValue(name);
      if (!env[name]) throw new Error(`Full-local snapshot requires Convex environment value ${name}.`);
    }
  }
  return env;
}

function localConvexEnvironmentValue(name) {
  const result = spawnSync('npx', ['convex', 'env', 'get', name], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: '120',
    },
  });
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

try {
  const { releaseFiles } = manifest();
  run('archive tracked HEAD', 'git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'], {
    cwd: root,
  });
  mkdirSync(checkout, { recursive: true });
  run('extract tracked HEAD', 'tar', ['-xf', archive, '-C', checkout], { cwd: root });
  copyReleaseFiles(releaseFiles);

  run('initialize isolated Git repository', 'git', ['init', '--quiet']);
  run('configure isolated Git author', 'git', ['config', 'user.name', 'Godot Snapshot Check']);
  run('configure isolated Git email', 'git', [
    'config',
    'user.email',
    'godot-snapshot-check@localhost',
  ]);
  run('stage isolated snapshot', 'git', ['add', '-A']);
  run('commit isolated snapshot', 'git', ['commit', '--quiet', '-m', 'isolated Godot snapshot']);

  symlinkSync(resolve(root, 'node_modules'), resolve(checkout, 'node_modules'), 'dir');
  const localEnv = resolve(root, '.env.local');
  if (existsSync(localEnv)) copyFileSync(localEnv, resolve(checkout, '.env.local'));
  const localConvexConfig = resolve(root, '.convex/local/default/config.json');
  if (existsSync(localConvexConfig)) {
    const snapshotConvexConfig = resolve(checkout, '.convex/local/default/config.json');
    mkdirSync(dirname(snapshotConvexConfig), { recursive: true });
    copyFileSync(localConvexConfig, snapshotConvexConfig);
  }
  const env = snapshotEnvironment();

  if (fullLocal) {
    run('Convex codegen', 'npx', ['convex', 'codegen'], { env });
    run('generated source stability', 'git', ['diff', '--exit-code', '--', 'convex/_generated']);
  }
  run('release source gate', 'npm', ['run', 'godot:check-release-source'], { env });
  run('scoped static gate', 'npm', ['run', 'godot:check-static'], { env });
  run('focused unit gate', 'npm', ['run', 'godot:check-unit'], { env });
  run(
    'Godot asset import',
    env.GODOT_BIN,
    [
      '--headless',
      '--log-file',
      resolve(temporaryRoot, 'godot-import.log'),
      '--path',
      resolve(checkout, 'godot-taixu-client'),
      '--import',
    ],
    { env },
  );
  run('Godot contracts', 'npm', ['run', 'godot:check-contracts'], { env });
  if (fullLocal) {
    run('bridge smoke', process.execPath, ['godot-taixu-client/tools/check_bridge.mjs'], { env });
    run('agent soak', 'npm', ['run', 'godot:check-agent-soak'], { env });
  }

  completed = true;
  console.log(`\nGodot clean snapshot check passed (${releaseFiles.length} release files).`);
} finally {
  rmSync(resolve(checkout, '.env.local'), { force: true });
  rmSync(resolve(checkout, '.convex'), { recursive: true, force: true });
  if (completed) rmSync(temporaryRoot, { recursive: true, force: true });
  else {
    console.error(`\nClean snapshot retained for inspection: ${checkout}`);
  }
}

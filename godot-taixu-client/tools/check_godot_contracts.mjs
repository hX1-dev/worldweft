#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const projectPath = resolve(root, 'godot-taixu-client');
const godotBin = resolveGodotBinary();
let godotRunSequence = 0;

function resolveGodotBinary() {
  const candidates = [
    process.env.GODOT_BIN,
    resolve(root, 'tmp/godot-download/Godot.app/Contents/MacOS/Godot'),
    '/Applications/Godot.app/Contents/MacOS/Godot',
  ];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    candidates.push(resolve(directory, 'godot4'), resolve(directory, 'godot'));
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(label, command, args) {
  console.log(`\n== ${label}`);
  console.log([command, ...args].join(' '));
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.error) {
    throw result.error;
  }
  assert(result.status === 0, `${label} failed with exit code ${result.status}.`);
  const combined = stdout + stderr;
  assert(
    !/(?:SCRIPT ERROR:|Parse Error:|ERROR: Failed to load script|ERROR: Failed loading resource:|ERROR: Unable to open file: res:\/\/)/.test(
      combined,
    ),
    `${label} reported a Godot script/resource load error despite exit code ${result.status}.`,
  );
  console.log(`ok ${label} (${seconds}s)`);
}

function runGodot(label, args) {
  godotRunSequence += 1;
  const logPath = resolve(
    tmpdir(),
    `godot-taixu-contract-${process.pid}-${godotRunSequence}.log`,
  );
  run(label, godotBin, ['--log-file', logPath, ...args]);
}

assert(
  godotBin && existsSync(godotBin),
  'Godot binary not found. Set GODOT_BIN or install Godot in /Applications or PATH.',
);

// A clean checkout has no .godot import cache yet; build it before scripts preload fonts or textures.
runGodot('Godot asset import', [
  '--headless',
  '--path',
  projectPath,
  '--import',
]);
run('navigation/map contract syntax', process.execPath, [
  '--check',
  'godot-taixu-client/tools/check_navigation_mask.mjs',
]);
run('navigation/map contract', process.execPath, [
  'godot-taixu-client/tools/check_navigation_mask.mjs',
]);
runGodot('Godot spatial contract', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_spatial_contract.gd',
]);
runGodot('Godot action presentation formatter', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_action_presentation_formatter.gd',
]);
runGodot('Godot action menu policy', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_action_menu_policy.gd',
]);
runGodot('Godot response context policy', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_response_context_policy.gd',
]);
runGodot('Godot action client contract', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_action_client.gd',
]);
runGodot('Godot resident renderer', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_resident_renderer.gd',
]);
runGodot('Godot resident inspector formatter', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_resident_inspector_formatter.gd',
]);
runGodot('Godot trace formatter', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_trace_formatter.gd',
]);
runGodot('Godot trace state', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_trace_state.gd',
]);
runGodot('Godot main scene contract', [
  '--headless',
  '--path',
  projectPath,
  '--script',
  'res://tools/check_main_scene_contract.gd',
]);
runGodot('Godot headless startup', [
  '--headless',
  '--path',
  projectPath,
  '--quit-after',
  '120',
]);

console.log('\nGodot contract checks passed.');

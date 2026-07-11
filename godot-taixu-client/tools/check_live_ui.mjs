#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(root, '..');
const godot =
  process.env.GODOT_BIN ??
  join(repositoryRoot, 'tmp/godot-download/Godot.app/Contents/MacOS/Godot');
const artifactDir =
  process.env.GODOT_LIVE_UI_ARTIFACT_DIR ?? join(tmpdir(), 'godot-taixu-live-ui');

if (!process.env.GODOT_BRIDGE_TOKEN?.trim() || !process.env.GODOT_BRIDGE_DEBUG_TOKEN?.trim()) {
  throw new Error('GODOT_BRIDGE_TOKEN and GODOT_BRIDGE_DEBUG_TOKEN are required.');
}
if (!existsSync(godot)) throw new Error(`Godot binary was not found at ${godot}.`);
mkdirSync(artifactDir, { recursive: true });

for (const [width, height] of [
  [1024, 720],
  [1440, 900],
]) {
  const output = join(artifactDir, `taixu-live-${width}x${height}.png`);
  const result = spawnSync(
    godot,
    [
      '--path',
      root,
      '--resolution',
      `${width}x${height}`,
      '--position',
      '80,80',
      '--log-file',
      join(artifactDir, `taixu-live-${width}x${height}.log`),
      '--script',
      'res://tools/check_live_client.gd',
      '--',
      '--width',
      String(width),
      '--height',
      String(height),
      '--output',
      output,
    ],
    { cwd: repositoryRoot, env: process.env, encoding: 'utf8', stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Godot live UI check failed at ${width}x${height}.`);
  }
  if (!existsSync(output)) throw new Error(`Godot live UI screenshot is missing: ${output}`);
}

console.log(`Godot live UI checks passed. Artifacts: ${artifactDir}`);

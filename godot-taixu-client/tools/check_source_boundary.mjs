#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const requireTracked = process.argv.includes('--require-tracked');
const listSource = process.argv.includes('--list');
const jsonOutput = process.argv.includes('--json');

const rootReleaseFiles = [
  '.gitignore',
  'package.json',
  'tsconfig.godot-bridge.json',
  'convex/http.ts',
  'convex/testing.ts',
  'convex/godot.ts',
  'convex/godotBridgeAuth.test.ts',
  'convex/godotBridgeAuth.ts',
  'convex/godotBridgeContract.test.ts',
  'convex/godotBridgeContract.ts',
  'convex/godotCapabilities.test.ts',
  'convex/godotCapabilities.ts',
  'convex/godotExchange.test.ts',
  'convex/godotExchange.ts',
  'convex/godotMapBoundary.test.ts',
  'convex/godotMapBoundary.ts',
  'convex/godotMapPages.ts',
  'convex/godotPresentation.test.ts',
  'convex/godotPresentation.ts',
  'convex/godotReadModel.ts',
  'convex/godotSpatial.test.ts',
  'convex/godotSpatial.ts',
  'convex/godotTesting.ts',
  'convex/godotTestingPolicy.test.ts',
  'convex/godotTestingPolicy.ts',
  'convex/godotViewerPolicy.test.ts',
  'convex/godotViewerPolicy.ts',
  'convex/xianxia/access.ts',
  'convex/xianxia/access.test.ts',
  'convex/xianxia/actionIdempotency.test.ts',
  'convex/xianxia/actionIdempotency.ts',
  'convex/xianxia/actionSchema.ts',
  'convex/xianxia/actions.ts',
  'convex/xianxia/agent.ts',
  'convex/xianxia/agentTickLease.ts',
  'convex/xianxia/agentTickLeasePolicy.test.ts',
  'convex/xianxia/agentTickLeasePolicy.ts',
  'convex/xianxia/agentTickScheduler.test.ts',
  'convex/xianxia/agentTickScheduler.ts',
  'convex/xianxia/memory.ts',
  'convex/xianxia/memoryFanout.test.ts',
  'convex/xianxia/config.ts',
  'convex/xianxia/cultivationLogic.test.ts',
  'convex/xianxia/cultivationLogic.ts',
  'convex/xianxia/durableContracts.test.ts',
  'convex/xianxia/durableContracts.ts',
  'convex/xianxia/events.ts',
  'convex/xianxia/gm.ts',
  'convex/xianxia/groupScene.ts',
  'convex/xianxia/growth.ts',
  'convex/xianxia/grudgeLogic.test.ts',
  'convex/xianxia/grudgeLogic.ts',
  'convex/xianxia/locations.ts',
  'convex/xianxia/movement.ts',
  'convex/xianxia/personalityLogic.test.ts',
  'convex/xianxia/personalityLogic.ts',
  'convex/xianxia/quests.ts',
  'convex/xianxia/qinglan.ts',
  'convex/xianxia/qinglanFangshiZones.test.ts',
  'convex/xianxia/qinglanFangshiZones.ts',
  'convex/xianxia/qinglanNavigation.test.ts',
  'convex/xianxia/qinglanNavigation.ts',
  'convex/xianxia/qinglanProfiles.test.ts',
  'convex/xianxia/qinglanProfiles.ts',
  'convex/xianxia/refusalLogic.test.ts',
  'convex/xianxia/refusalLogic.ts',
  'convex/xianxia/relationshipLogic.test.ts',
  'convex/xianxia/relationshipLogic.ts',
  'convex/xianxia/rules.test.ts',
  'convex/xianxia/rules.ts',
  'convex/xianxia/schema.ts',
  'convex/xianxia/seed.ts',
  'data/qinglanCollisionVolumes.ts',
  'data/qinglanMaskContract.ts',
  'data/qinglanRegions.ts',
  'data/qinglanTestAgents.ts',
  'data/xianxiaCharacters.ts',
];

const ignoredRuntimePaths = [
  '.convex/local/default/convex_local_backend.sqlite3',
  '.env.local',
  'tmp/godot-download/Godot.app',
  'godot-taixu-client/.godot/imported/example.ctex',
];

const textExtensions = new Set([
  '.cjs',
  '.gd',
  '.godot',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tscn',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function walk(directory) {
  const result = [];
  for (const name of readdirSync(resolve(root, directory))) {
    if (name === '.godot') continue;
    const absolute = resolve(root, directory, name);
    const path = relative(root, absolute);
    if (statSync(absolute).isDirectory()) result.push(...walk(path));
    else result.push(path);
  }
  return result;
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

function normalizeDeclaredPath(path) {
  return String(path).replace(/^\.\//, '');
}

function scriptSourcePaths(script) {
  if (typeof script !== 'string') return [];
  return [
    ...script.matchAll(
      /(?:^|\s)((?:convex|godot-taixu-client)\/[^\s*]+\.(?:ts|mjs|gd))(?=\s|$)/g,
    ),
  ].map((match) => normalizeDeclaredPath(match[1]));
}

const clientReleaseFiles = walk('godot-taixu-client');
const generatedReleaseFiles = walk('convex/_generated');
const releaseFiles = [
  ...new Set([...rootReleaseFiles, ...generatedReleaseFiles, ...clientReleaseFiles]),
].sort();
const releaseFileSet = new Set(releaseFiles);

const bridgeTypecheck = JSON.parse(
  readFileSync(resolve(root, 'tsconfig.godot-bridge.json'), 'utf8'),
);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const typecheckFiles = new Set((bridgeTypecheck.files ?? []).map(normalizeDeclaredPath));
const lintFiles = new Set(scriptSourcePaths(packageJson.scripts?.['godot:check-lint']));
const unitFiles = new Set(scriptSourcePaths(packageJson.scripts?.['godot:check-unit']));

for (const path of [...typecheckFiles, ...unitFiles]) {
  assert(
    releaseFileSet.has(path),
    `Declared typecheck/unit source is outside the release unit: ${path}`,
  );
}
for (const path of typecheckFiles) {
  assert(lintFiles.has(path), `Bridge TypeScript source is missing from scoped lint: ${path}`);
}

for (const path of releaseFiles) {
  assert(existsSync(resolve(root, path)), `Required release source is missing: ${path}`);
  assert(git(['check-ignore', '--no-index', path]) === null, `Release source is ignored: ${path}`);
}

for (const path of ignoredRuntimePaths) {
  assert(git(['check-ignore', '--no-index', path]) !== null, `Runtime/local path is not ignored: ${path}`);
}

const credentialPattern = /(?:authorization\s*:\s*bearer|godot_bridge_(?:debug_)?token\s*[:=])\s*["']?[a-z0-9_=-]{24,}/i;
for (const path of releaseFiles) {
  if (!textExtensions.has(extension(path))) continue;
  const text = readFileSync(resolve(root, path), 'utf8');
  assert(!credentialPattern.test(text), `Possible embedded bridge credential in ${path}`);
}

const untracked = releaseFiles.filter(
  (path) => git(['ls-files', '--error-unmatch', '--', path]) === null,
);
if (listSource) {
  const untrackedSet = new Set(untracked);
  console.log(
    releaseFiles
      .map((path) => `${untrackedSet.has(path) ? 'untracked' : 'tracked  '} ${path}`)
      .join('\n'),
  );
}
if (jsonOutput) {
  console.log(JSON.stringify({ releaseFiles, untracked }));
}
if (requireTracked) {
  const uncommitted = releaseFiles.filter(
    (path) => (git(['status', '--porcelain', '--', path]) ?? '') !== '',
  );
  assert(
    untracked.length === 0,
    `Release source is not tracked (${untracked.length} file(s)); first entries: ${untracked.slice(0, 8).join(', ')}`,
  );
  assert(
    uncommitted.length === 0,
    `Release source is not committed (${uncommitted.length} file(s)); first entries: ${uncommitted.slice(0, 8).join(', ')}`,
  );
}

if (!jsonOutput) {
  console.log(
    `Godot source boundary check passed (${releaseFiles.length} release files, ${untracked.length} currently untracked${requireTracked ? ', tracking enforced' : ''}).`,
  );
}

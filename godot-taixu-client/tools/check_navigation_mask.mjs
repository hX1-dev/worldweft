#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const sourcePath = 'public/assets/qinglanRegions.json';
const clientPath = 'godot-taixu-client/assets/qinglanRegions.json';
const sourceMapPath = 'public/assets/qinglan-reference-town-footprint-no-bamboo-v1.png';
const clientMapPath = 'godot-taixu-client/assets/qinglan-reference-town-footprint-no-bamboo-v1.png';
const mainScriptPath = 'godot-taixu-client/scripts/Main.gd';
const navigationScriptPath = 'godot-taixu-client/scripts/NavigationMask.gd';

const expectedWatchPoints = [
  ['west-gate-red-roof-left', 100, 210, 'collision'],
  ['west-gate-red-roof-center', 120, 230, 'collision'],
  ['west-gate-red-roof-right', 160, 250, 'collision'],
  ['west-gate-mouth-road', 120, 300, 'walkable'],
  ['west-inner-stairs', 248, 236, 'walkable'],
  ['open-light-grass-top-left', 20, 20, 'grass'],
  ['light-grass-west-edge', 35, 76, 'grass'],
  ['deep-green-bamboo-top-left', 78, 56, 'grass'],
];

const expectedTilePoints = [
  ['godot-player-spawn', { x: 35, y: 30 }, true],
  ['medicine-shop-snapped-entry', { x: 34.74, y: 31.558 }, true],
  ['west-roof-blocker', { x: 6.63, y: 13.92 }, false],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function cellKey(col, row) {
  return `${col},${row}`;
}

function sourcePointToCell(data, x, y) {
  return {
    col: Math.floor(Math.max(0, Math.min(data.image.width - 1, x)) / data.cellMask.gridSize),
    row: Math.floor(Math.max(0, Math.min(data.image.height - 1, y)) / data.cellMask.gridSize),
  };
}

function tileToCell(data, tile) {
  const imageX = Math.max(0, Math.min(data.image.width - 1, (tile.x / contract.mapCols) * data.image.width));
  const imageY = Math.max(0, Math.min(data.image.height - 1, (tile.y / contract.mapRows) * data.image.height));
  return sourcePointToCell(data, imageX, imageY);
}

function readPngSize(path) {
  const buffer = readFileSync(path);
  const signature = buffer.subarray(0, 8).toString('hex');
  assert(signature === '89504e470d0a1a0a', `${path} must be a PNG file.`);
  assert(buffer.subarray(12, 16).toString('ascii') === 'IHDR', `${path} must start with a PNG IHDR chunk.`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    hash: sha256(buffer),
  };
}

function gdConstNumber(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*:=\\s*([0-9.]+)`));
  assert(match, `${mainScriptPath} must define ${name}.`);
  return Number(match[1]);
}

function gdConstString(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*:=\\s*"([^"]+)"`));
  assert(match, `${mainScriptPath} must define ${name}.`);
  return match[1];
}

function gdExportString(text, name, path) {
  const match = text.match(new RegExp(`@export\\s+var\\s+${name}\\s*:=\\s*"([^"]+)"`));
  assert(match, `${path} must define ${name}.`);
  return match[1];
}

function gdExportVector2(text, name, path) {
  const match = text.match(
    new RegExp(`@export\\s+var\\s+${name}\\s*:=\\s*Vector2\\(([0-9.]+),\\s*([0-9.]+)\\)`),
  );
  assert(match, `${path} must define ${name} as Vector2(x, y).`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function gdVarVector2(text, name, path) {
  const match = text.match(new RegExp(`var\\s+${name}\\s*:=\\s*Vector2\\(([0-9.]+),\\s*([0-9.]+)\\)`));
  assert(match, `${path} must define ${name} as Vector2(x, y).`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function loadMapContract() {
  const mainScript = readFileSync(mainScriptPath, 'utf8');
  const navigationScript = readFileSync(navigationScriptPath, 'utf8');
  const mapCols = gdConstNumber(mainScript, 'MAP_COLS');
  const mapRows = gdConstNumber(mainScript, 'MAP_ROWS');
  const tileSize = gdConstNumber(mainScript, 'TILE_SIZE');
  const mapTexture = gdConstString(mainScript, 'MAP_TEXTURE');
  const maskPath = gdExportString(navigationScript, 'mask_path', navigationScriptPath);
  const worldTiles = gdExportVector2(navigationScript, 'world_tiles', navigationScriptPath);
  const navigationImageSize = gdVarVector2(navigationScript, 'image_size', navigationScriptPath);

  assert(mapCols === 96, `${mainScriptPath} MAP_COLS must stay 96 until the Qinglan map is intentionally migrated.`);
  assert(mapRows === 72, `${mainScriptPath} MAP_ROWS must stay 72 until the Qinglan map is intentionally migrated.`);
  assert(tileSize === 32, `${mainScriptPath} TILE_SIZE must stay 32 for Godot tile/world mapping.`);
  assert(mapTexture === 'res://assets/qinglan-reference-town-footprint-no-bamboo-v1.png', `${mainScriptPath} MAP_TEXTURE must point at the Qinglan client PNG.`);
  assert(maskPath === 'res://assets/qinglanRegions.json', `${navigationScriptPath} mask_path must point at the Qinglan client mask.`);
  assert(worldTiles.x === mapCols && worldTiles.y === mapRows, `${navigationScriptPath} world_tiles must match Main.gd MAP_COLS/MAP_ROWS.`);

  return {
    mapCols,
    mapRows,
    tileSize,
    worldWidthPx: mapCols * tileSize,
    worldHeightPx: mapRows * tileSize,
    mapTexture,
    maskPath,
    navigationImageSize,
  };
}

const contract = loadMapContract();
const clientText = readFileSync(clientPath, 'utf8');
const clientPng = readPngSize(clientMapPath);
const sourceMaskExists = existsSync(sourcePath);
const sourceMapExists = existsSync(sourceMapPath);
assert(
  sourceMaskExists === sourceMapExists,
  `${sourcePath} and ${sourceMapPath} must either both exist or both be absent.`,
);
if (sourceMaskExists && sourceMapExists) {
  const sourceText = readFileSync(sourcePath, 'utf8');
  assert(
    sha256(sourceText) === sha256(clientText),
    `${clientPath} must match ${sourcePath}; copy the generated mask after regenerating it.`,
  );
  const sourcePng = readPngSize(sourceMapPath);
  assert(
    sourcePng.hash === clientPng.hash,
    `${clientMapPath} must match ${sourceMapPath}; copy the source PNG after regenerating it.`,
  );
}

const data = loadJson(clientPath);
assert(data.image?.coordinateSpace === 'source-image-pixels', `${clientPath} image.coordinateSpace must be source-image-pixels.`);
assert(data.image?.width === clientPng.width, `${clientPath} image.width must match ${clientMapPath}.`);
assert(data.image?.height === clientPng.height, `${clientPath} image.height must match ${clientMapPath}.`);
assert(contract.navigationImageSize.x === data.image.width, `${navigationScriptPath} image_size.x must match mask image width.`);
assert(contract.navigationImageSize.y === data.image.height, `${navigationScriptPath} image_size.y must match mask image height.`);
assert(Number(data.cellMask?.gridSize) === 8, `${clientPath} cellMask.gridSize must be 8 source pixels per cell.`);
const maskCols = Math.ceil(data.image.width / data.cellMask.gridSize);
const maskRows = Math.ceil(data.image.height / data.cellMask.gridSize);
const expectedCellCapacity = maskCols * maskRows;
assert(
  Array.isArray(data.cellMask?.cells) && data.cellMask.cells.length > expectedCellCapacity * 0.95,
  `${clientPath} cellMask.cells must cover the source image grid.`,
);
const cells = new Map(data.cellMask.cells.map((cell) => [cellKey(cell.col, cell.row), cell.type]));
const navigableTypes = new Set(['walkable', 'grass', 'dock']);

for (const [name, x, y, expectedType] of expectedWatchPoints) {
  const cell = sourcePointToCell(data, x, y);
  const actualType = cells.get(cellKey(cell.col, cell.row));
  assert(
    actualType === expectedType,
    `${name} expected ${expectedType} at cell ${cellKey(cell.col, cell.row)}, got ${actualType}`,
  );
}

for (const [name, tile, expectedWalkable] of expectedTilePoints) {
  const cell = tileToCell(data, tile);
  const actualType = cells.get(cellKey(cell.col, cell.row));
  const walkable = navigableTypes.has(actualType);
  assert(
    walkable === expectedWalkable,
    `${name} expected walkable=${expectedWalkable} at tile ${tile.x},${tile.y}, got ${actualType}`,
  );
}

console.log(
  `Godot navigation/map contract check passed (${contract.mapCols}x${contract.mapRows} tiles, ${contract.worldWidthPx}x${contract.worldHeightPx} world px, ${clientPng.width}x${clientPng.height} source px).`,
);

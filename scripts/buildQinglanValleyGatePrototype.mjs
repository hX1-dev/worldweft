import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outputDir = path.resolve(
  root,
  'public/assets/maps/qinglan/chunks/qinglan_valley_gate',
);
const convexDataPath = path.resolve(root, 'data/qinglanValleyGate.generated.ts');
const sourcePath = path.join(outputDir, 'source-footprint.png');
const shrineTexturePath = path.resolve(
  root,
  'docs/static-map-concepts/qinglan-fangshi-texture-sheet-concept-v3-slightly-brighter.png',
);

const MAP = {
  id: 'qinglan_valley_gate',
  name: '青岚溪谷入口',
  width: 48,
  height: 36,
  tileSize: 32,
  sourcePixelsPerCell: 8,
  visualPixelsPerCell: 32,
};

const MASK_COLORS = {
  walkable: '#f4d58d',
  grass: '#9bcf66',
  collision: '#ff4d5f',
  occlusion: '#1f8f4d',
  water: '#4fc3ff',
  dock: '#d28a4c',
};
const MASK_RGBA = Object.fromEntries(
  Object.entries(MASK_COLORS).map(([type, hex]) => [type, hexToRgba(hex)]),
);
const NAVIGABLE = new Set(['walkable', 'grass', 'dock']);

const locations = [
  location('valley_west_entry', '溪谷西口', 0, 15, 8, 7, 2, 18),
  location('rest_clearing', '松风歇脚地', 6, 7, 11, 7, 11, 10),
  location('creek_bridge', '听泉木桥', 20, 15, 9, 7, 24, 18),
  location('herb_meadow', '凝露药草坡', 11, 24, 11, 8, 16, 28),
  location('sealed_shrine', '封印古祠', 33, 6, 11, 9, 38, 12),
  location('mist_gate', '溪谷雾门', 42, 13, 6, 11, 46, 18),
];

const npcPoints = [
  point('valley_guide', '溪谷引路弟子', 'guide', 4, 18, 'valley_west_entry'),
  point('resting_disciple', '歇脚修士', 'rest', 11, 10, 'rest_clearing'),
  point('bridge_guard', '巡桥弟子', 'guard', 20, 18, 'creek_bridge'),
  point('herb_gatherer', '采药杂役', 'gather', 16, 28, 'herb_meadow'),
  point('mist_sentinel', '雾门守卫', 'guard', 42, 18, 'mist_gate'),
];

const interactions = [
  interaction(
    'west_return_portal',
    '返回青岚坊市',
    'portal',
    1,
    18,
    'valley_west_entry',
    ['travel'],
    {
      status: 'available',
      destinationMapId: 'qinglan',
      destinationLocationId: 'market_west_gate',
    },
  ),
  interaction('rest_campfire', '篝火歇息', 'rest', 11, 10, 'rest_clearing', ['rest', 'talk']),
  interaction(
    'bridge_inscription',
    '桥栏刻字',
    'inspect',
    24,
    18,
    'creek_bridge',
    ['inspect'],
    {
      observationId: 'valley_bridge_inscription_v1',
      revision: 1,
      observation: '桥栏刻字提示木桥狭窄，往来者应依次通行。',
    },
  ),
  interaction('dew_herb_patch', '凝露草', 'resource', 17, 28, 'herb_meadow', ['gather']),
  interaction(
    'sealed_shrine_door',
    '古祠封印',
    'seal',
    38,
    12,
    'sealed_shrine',
    ['inspect'],
    {
      observationId: 'valley_sealed_shrine_door_v1',
      revision: 1,
      observation: '封印纹路仍然完整，门扉目前无法开启。',
    },
  ),
  interaction(
    'mist_gate_portal',
    '进入溪谷深处',
    'portal',
    46,
    18,
    'mist_gate',
    ['travel'],
    {
      status: 'unavailable',
      reasonCode: 'portal_destination_unavailable',
    },
  ),
];

if (process.argv.includes('--convex-data-only')) {
  const generatedData = writeConvexDataModuleFromJsonSources();
  console.log(
    `Built Convex-importable ${generatedData.mapId} data in ${path.relative(root, convexDataPath)}`,
  );
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const source = parsePng(sourcePath);
const shrineTextureSheet = parsePng(shrineTexturePath);
const shrineSprite = extractBackgroundCutout(shrineTextureSheet, {
  x: 20,
  y: 305,
  width: 270,
  height: 205,
});
assertSourceDimensions(source);

const cells = {};
const grid = [];
for (let row = 0; row < MAP.height; row += 1) {
  const rowTypes = [];
  for (let col = 0; col < MAP.width; col += 1) {
    const x = col * MAP.sourcePixelsPerCell + Math.floor(MAP.sourcePixelsPerCell / 2);
    const y = row * MAP.sourcePixelsPerCell + Math.floor(MAP.sourcePixelsPerCell / 2);
    const index = (y * source.width + x) * 4;
    const type = classifyExactColor(
      source.pixels[index],
      source.pixels[index + 1],
      source.pixels[index + 2],
      source.pixels[index + 3],
    );
    if (!type) throw new Error(`Unclassified source cell ${col},${row}`);
    cells[`${col},${row}`] = type;
    rowTypes.push(type);
  }
  grid.push(rowTypes);
}

const runs = gridToRuns(grid);
const counts = countTypes(grid);
const cellMask = {
  mapId: MAP.id,
  source: 'source-footprint.png',
  coordinateSpaces: {
    sourceImage: { width: source.width, height: source.height },
    worldTiles: { width: MAP.width, height: MAP.height, tileSize: MAP.tileSize },
    maskGrid: { width: MAP.width, height: MAP.height, sourcePixelsPerCell: MAP.sourcePixelsPerCell },
  },
  navigableTypes: [...NAVIGABLE],
  blockingTypes: ['collision', 'occlusion', 'water'],
  counts,
  cells,
  runs,
};

writeJson(path.join(outputDir, 'cellMask.json'), cellMask);
writeJson(path.join(outputDir, 'locations.json'), { mapId: MAP.id, locations });
writeJson(path.join(outputDir, 'npcPoints.json'), { mapId: MAP.id, points: npcPoints });
writeJson(path.join(outputDir, 'interactions.json'), { mapId: MAP.id, points: interactions });
writeConvexDataModuleFromJsonSources();
writeJson(path.join(outputDir, 'map-data.tmj'), buildTiledMap(runs));
writeJson(path.join(outputDir, 'renderLayers.json'), {
  mapId: MAP.id,
  order: ['ground', 'ground_dynamic', 'actors', 'sortable_props', 'foreground', 'ui'],
  ground: { file: 'ground-clean.png' },
  foreground: { file: 'foreground.png', affectsNavigation: false },
  dynamicEffects: [
    {
      id: 'creek_ripples',
      kind: 'uv_scroll',
      bounds: { x: 22, y: 0, width: 6, height: 36 },
      speed: 0.22,
      affectsNavigation: false,
    },
    {
      id: 'rest_campfire_flame',
      kind: 'sprite_cycle',
      tile: { x: 11, y: 10 },
      frames: 4,
      fps: 6,
      affectsNavigation: false,
    },
    {
      id: 'mist_gate_breath',
      kind: 'alpha_pulse',
      tile: { x: 46, y: 18 },
      durationMs: 2400,
      affectsNavigation: false,
    },
  ],
  sortableProps: [
    { id: 'campfire', tile: { x: 11, y: 10 }, anchor: { x: 0.5, y: 0.82 } },
    { id: 'shrine_door', tile: { x: 38, y: 12 }, anchor: { x: 0.5, y: 1 } },
    { id: 'mist_gate', tile: { x: 45, y: 19 }, anchor: { x: 0.5, y: 1 } },
  ],
  ySort: { enabled: true, key: 'anchorWorldY' },
});

const ground = renderGround(grid);
const foreground = renderForeground(grid, shrineSprite);
const beauty = compositeLayers(ground, foreground);
const shrineDetail = cropImage(
  beauty,
  31 * MAP.visualPixelsPerCell,
  3 * MAP.visualPixelsPerCell,
  14 * MAP.visualPixelsPerCell,
  11 * MAP.visualPixelsPerCell,
);
const playable = cloneImage(beauty);
drawMarkers(playable);
const maskPreview = renderMaskPreview(grid);

writePng(path.join(outputDir, 'ground-clean.png'), ground.width, ground.height, ground.pixels);
writePng(path.join(outputDir, 'foreground.png'), foreground.width, foreground.height, foreground.pixels);
writePng(path.join(outputDir, 'shrine-sprite.png'), shrineSprite.width, shrineSprite.height, shrineSprite.pixels);
writePng(path.join(outputDir, 'beauty-preview.png'), beauty.width, beauty.height, beauty.pixels);
writePng(
  path.join(outputDir, 'shrine-detail-preview.png'),
  shrineDetail.width,
  shrineDetail.height,
  shrineDetail.pixels,
);
writePng(path.join(outputDir, 'playable-preview.png'), playable.width, playable.height, playable.pixels);
writePng(
  path.join(outputDir, 'final-mask-preview.png'),
  maskPreview.width,
  maskPreview.height,
  maskPreview.pixels,
);

writeJson(path.join(outputDir, 'manifest.json'), {
  mapId: MAP.id,
  displayName: MAP.name,
  version: 4,
  artRevision: 'high-detail-32px-reference-sprite-shrine',
  projection: 'orthographic_2_5d_visual_with_logical_grid',
  sourceOfTruth: 'source-footprint.png',
  visualReference: 'docs/static-map-concepts/qinglan-fangshi-texture-sheet-concept-v3-slightly-brighter.png',
  dimensions: {
    worldTiles: { width: MAP.width, height: MAP.height, tileSize: MAP.tileSize },
    sourceImage: { width: source.width, height: source.height },
    visualImage: {
      width: MAP.width * MAP.visualPixelsPerCell,
      height: MAP.height * MAP.visualPixelsPerCell,
      pixelsPerTile: MAP.visualPixelsPerCell,
    },
  },
  files: {
    cellMask: 'cellMask.json',
    tiled: 'map-data.tmj',
    ground: 'ground-clean.png',
    foreground: 'foreground.png',
    beautyPreview: 'beauty-preview.png',
    shrineDetailPreview: 'shrine-detail-preview.png',
    shrineSprite: 'shrine-sprite.png',
    preview: 'playable-preview.png',
    maskPreview: 'final-mask-preview.png',
    locations: 'locations.json',
    npcPoints: 'npcPoints.json',
    interactions: 'interactions.json',
    renderLayers: 'renderLayers.json',
    playablePrototype: 'prototype.html',
  },
});

console.log(`Built ${MAP.name} in ${path.relative(root, outputDir)}`);
console.log(JSON.stringify({ counts, locations: locations.length, npcPoints: npcPoints.length, interactions: interactions.length }, null, 2));

function assertSourceDimensions(image) {
  const expectedWidth = MAP.width * MAP.sourcePixelsPerCell;
  const expectedHeight = MAP.height * MAP.sourcePixelsPerCell;
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    throw new Error(
      `Expected source ${expectedWidth}x${expectedHeight}, got ${image.width}x${image.height}`,
    );
  }
}

function classifyExactColor(r, g, b, a) {
  for (const [type, color] of Object.entries(MASK_RGBA)) {
    if (r === color[0] && g === color[1] && b === color[2] && a === color[3]) return type;
  }
  return null;
}

function gridToRuns(sourceGrid) {
  const result = [];
  for (let row = 0; row < sourceGrid.length; row += 1) {
    let from = 0;
    let type = sourceGrid[row][0];
    for (let col = 1; col <= sourceGrid[row].length; col += 1) {
      if (sourceGrid[row][col] === type) continue;
      result.push({ row, from, to: col - 1, type });
      from = col;
      type = sourceGrid[row][col];
    }
  }
  return result;
}

function countTypes(sourceGrid) {
  const result = Object.fromEntries(Object.keys(MASK_COLORS).map((type) => [type, 0]));
  for (const row of sourceGrid) for (const type of row) result[type] += 1;
  return result;
}

function buildTiledMap(sourceRuns) {
  let nextObjectId = 1;
  const maskLayers = Object.keys(MASK_COLORS).map((type, index) => ({
    color: MASK_COLORS[type],
    draworder: 'topdown',
    id: index + 2,
    name: type,
    objects: sourceRuns
      .filter((run) => run.type === type)
      .map((run) => ({
        height: MAP.sourcePixelsPerCell,
        id: nextObjectId++,
        name: '',
        type,
        visible: true,
        width: (run.to - run.from + 1) * MAP.sourcePixelsPerCell,
        x: run.from * MAP.sourcePixelsPerCell,
        y: run.row * MAP.sourcePixelsPerCell,
      })),
    opacity: type === 'walkable' || type === 'grass' ? 0.45 : 0.68,
    properties: [{ name: 'maskType', type: 'string', value: type }],
    type: 'objectgroup',
    visible: true,
    x: 0,
    y: 0,
  }));

  const pointLayer = (id, name, points) => ({
    draworder: 'topdown',
    id,
    name,
    objects: points.map((entry) => ({
      height: 0,
      id: nextObjectId++,
      name: entry.name,
      point: true,
      properties: [
        { name: 'id', type: 'string', value: entry.id },
        { name: 'locationId', type: 'string', value: entry.locationId },
      ],
      type: entry.kind,
      visible: true,
      width: 0,
      x: (entry.tile.x + 0.5) * MAP.sourcePixelsPerCell,
      y: (entry.tile.y + 0.5) * MAP.sourcePixelsPerCell,
    })),
    opacity: 1,
    type: 'objectgroup',
    visible: true,
    x: 0,
    y: 0,
  });

  const layers = [
    {
      id: 1,
      image: 'source-footprint.png',
      name: 'source_locked',
      opacity: 0.72,
      type: 'imagelayer',
      visible: true,
      x: 0,
      y: 0,
    },
    ...maskLayers,
    pointLayer(8, 'npc_points', npcPoints),
    pointLayer(9, 'interactions', interactions),
  ];

  return {
    compressionlevel: -1,
    height: MAP.height,
    infinite: false,
    layers,
    nextlayerid: 10,
    nextobjectid: nextObjectId,
    orientation: 'orthogonal',
    properties: [
      { name: 'mapId', type: 'string', value: MAP.id },
      { name: 'sourceOfTruth', type: 'string', value: 'source-footprint.png' },
      { name: 'worldTileSize', type: 'int', value: MAP.tileSize },
    ],
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    tileheight: MAP.sourcePixelsPerCell,
    tilesets: [],
    tilewidth: MAP.sourcePixelsPerCell,
    type: 'map',
    version: '1.10',
    width: MAP.width,
  };
}

function renderGround(sourceGrid) {
  const scale = MAP.visualPixelsPerCell;
  const image = createImage(MAP.width * scale, MAP.height * scale, [0, 0, 0, 255]);
  const bases = {
    grass: [92, 137, 72, 255],
    walkable: [178, 150, 103, 255],
    water: [49, 121, 143, 255],
    dock: [124, 78, 44, 255],
    collision: [100, 77, 67, 255],
    occlusion: [57, 96, 54, 255],
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const col = Math.floor(x / scale);
      const row = Math.floor(y / scale);
      const type = sourceGrid[row][col];
      const base = bases[type];
      const microX = Math.floor(x / 2);
      const microY = Math.floor(y / 2);
      const texture = (pixelHash(microX, microY, col, row) % 11) - 5;
      const verticalShade = type === 'water' ? Math.floor(((y % scale) / scale) * 8) - 4 : 0;
      setPixel(image, x, y, [
        base[0] + texture + verticalShade,
        base[1] + texture + verticalShade,
        base[2] + texture + verticalShade,
        255,
      ]);
    }
  }

  for (let row = 0; row < MAP.height; row += 1) {
    for (let col = 0; col < MAP.width; col += 1) {
      const type = sourceGrid[row][col];
      const x = col * scale;
      const y = row * scale;
      if (type === 'water') {
        const waveOffset = pixelHash(col, row) % 8;
        drawLine(image, x + 3 + waveOffset, y + 8, x + 17 + waveOffset, y + 8, [117, 185, 191, 170]);
        drawLine(image, x + 1, y + 18, x + 11, y + 18, [36, 94, 121, 150]);
        drawLine(image, x + 15, y + 25, x + 28, y + 25, [88, 165, 178, 135]);
        drawWaterBank(image, sourceGrid, col, row, scale);
      } else if (type === 'dock') {
        for (let plank = 7; plank < scale; plank += 8) {
          drawLine(image, x + plank, y, x + plank, y + scale - 1, [66, 42, 29, 185]);
          drawLine(image, x + plank + 1, y, x + plank + 1, y + scale - 1, [167, 111, 61, 90]);
        }
        drawLine(image, x, y + scale - 2, x + scale - 1, y + scale - 2, [55, 35, 25, 180]);
      } else if (type === 'walkable') {
        drawRoadDetail(image, sourceGrid, col, row, scale);
      } else if (type === 'grass') {
        drawGrassDetail(image, col, row, scale);
      } else if (type === 'collision') {
        if (isShrineFootprintCell(col, row)) drawHiddenShrineFootprint(image, col, row, scale);
        else drawStoneDetail(image, col, row, scale);
      } else if (type === 'occlusion') {
        drawLeafLitter(image, col, row, scale);
      }
    }
  }

  drawDetailedBridge(image, scale);
  drawShrineFoundation(image, scale);
  drawCampfire(image, 11 * scale + scale / 2, 10 * scale + scale / 2);
  for (const [col, row, flower] of [[15, 27, 0], [17, 28, 1], [18, 27, 0], [15, 29, 1], [19, 28, 0]]) {
    drawHerbCluster(image, col * scale + scale / 2, row * scale + scale / 2, flower);
  }
  drawSignpost(image, 5 * scale + scale / 2, 17 * scale + scale / 2);
  return image;
}

function renderForeground(sourceGrid, shrineSprite) {
  const scale = MAP.visualPixelsPerCell;
  const image = createImage(MAP.width * scale, MAP.height * scale, [0, 0, 0, 0]);

  for (let row = 1; row < MAP.height - 1; row += 1) {
    for (let col = 1; col < MAP.width - 1; col += 1) {
      if (sourceGrid[row][col] !== 'occlusion' || (col * 5 + row * 3) % 3 !== 0) continue;
      const x = col * scale + scale / 2;
      const y = row * scale + scale / 2;
      drawTreeCanopy(image, x, y, scale, pixelHash(col, row) % 3);
    }
  }

  drawShrine2_5D(image, scale, shrineSprite);

  // Mist gate pillars frame the road; rune light and mist are visual only.
  fillRect(image, 44 * scale + 6, 13 * scale, 16, 9 * scale, [95, 99, 94, 245]);
  fillRect(image, 45 * scale + 12, 13 * scale, 16, 9 * scale, [116, 116, 104, 245]);
  for (let y = 13 * scale + 8; y < 22 * scale; y += 24) {
    fillRect(image, 44 * scale + 7, y, 14, 3, [55, 68, 65, 180]);
    fillRect(image, 45 * scale + 13, y, 14, 3, [65, 75, 70, 180]);
  }
  fillPolygon(image, [
    [43 * scale + 16, 14 * scale],
    [46 * scale + 24, 14 * scale],
    [46 * scale + 8, 15 * scale + 10],
    [44 * scale, 15 * scale + 10],
  ], [67, 80, 76, 250]);
  for (const y of [15 * scale + 24, 18 * scale, 20 * scale + 10]) {
    drawCircle(image, 44 * scale + 14, y, 3, [112, 205, 182, 220]);
    drawCircle(image, 45 * scale + 20, y + 8, 3, [112, 205, 182, 220]);
  }
  for (let i = 0; i < 7; i += 1) {
    const mistX = (43 * scale + 10) + i * 18;
    const mistY = 17 * scale + (i % 3) * 15;
    fillRect(image, mistX, mistY, 30, 5, [151, 203, 190, 38]);
  }
  return image;
}

function drawWaterBank(image, grid, col, row, scale) {
  const foam = [133, 190, 178, 125];
  const bank = [71, 100, 61, 185];
  const isBank = (x, y) => {
    const type = grid[y]?.[x];
    return type !== undefined && type !== 'water' && type !== 'dock';
  };
  const x = col * scale;
  const y = row * scale;
  if (isBank(col, row - 1)) {
    fillRect(image, x, y, scale, 4, bank);
    drawLine(image, x + 3, y + 5, x + scale - 4, y + 5, foam);
  }
  if (isBank(col, row + 1)) {
    fillRect(image, x, y + scale - 4, scale, 4, bank);
    drawLine(image, x + 4, y + scale - 6, x + scale - 3, y + scale - 6, foam);
  }
  if (isBank(col - 1, row)) {
    fillRect(image, x, y, 4, scale, bank);
    drawLine(image, x + 5, y + 4, x + 5, y + scale - 4, foam);
  }
  if (isBank(col + 1, row)) {
    fillRect(image, x + scale - 4, y, 4, scale, bank);
    drawLine(image, x + scale - 6, y + 3, x + scale - 6, y + scale - 4, foam);
  }
}

function drawRoadDetail(image, grid, col, row, scale) {
  const x = col * scale;
  const y = row * scale;
  const seed = pixelHash(col, row);
  const stones = 2 + (seed % 3);
  for (let i = 0; i < stones; i += 1) {
    const stoneX = x + 4 + (pixelHash(seed, i, 1) % (scale - 11));
    const stoneY = y + 4 + (pixelHash(seed, i, 2) % (scale - 10));
    const stoneWidth = 3 + (pixelHash(seed, i, 3) % 6);
    fillRect(image, stoneX, stoneY, stoneWidth, 2, [130, 112, 82, 90]);
    setPixel(image, stoneX + 1, stoneY, [213, 188, 133, 110]);
  }
  const grassEdge = [66, 111, 59, 130];
  if (grid[row - 1]?.[col] === 'grass') drawLine(image, x, y + 1, x + scale - 1, y + 1, grassEdge);
  if (grid[row + 1]?.[col] === 'grass') drawLine(image, x, y + scale - 2, x + scale - 1, y + scale - 2, grassEdge);
  if (grid[row]?.[col - 1] === 'grass') drawLine(image, x + 1, y, x + 1, y + scale - 1, grassEdge);
  if (grid[row]?.[col + 1] === 'grass') drawLine(image, x + scale - 2, y, x + scale - 2, y + scale - 1, grassEdge);
}

function drawGrassDetail(image, col, row, scale) {
  const seed = pixelHash(col, row, 91);
  const tuftCount = 1 + (seed % 3);
  for (let i = 0; i < tuftCount; i += 1) {
    const x = col * scale + 5 + (pixelHash(seed, i, 5) % (scale - 10));
    const y = row * scale + 8 + (pixelHash(seed, i, 7) % (scale - 12));
    const dark = [50, 105, 54, 190];
    drawLine(image, x, y + 4, x - 2, y, dark);
    drawLine(image, x, y + 4, x + 1, y - 3, dark);
    drawLine(image, x + 1, y + 4, x + 4, y + 1, [104, 163, 79, 170]);
  }
  if (seed % 19 === 0) {
    const x = col * scale + 11;
    const y = row * scale + 9;
    setPixel(image, x, y, [225, 199, 116, 255]);
    setPixel(image, x + 1, y + 1, [197, 121, 129, 255]);
  }
}

function drawStoneDetail(image, col, row, scale) {
  const x = col * scale;
  const y = row * scale;
  const seed = pixelHash(col, row, 203);
  fillRect(image, x + 2, y + scale - 5, scale - 4, 3, [49, 43, 42, 120]);
  for (let i = 0; i < 3; i += 1) {
    const rockX = x + 5 + (pixelHash(seed, i) % (scale - 13));
    const rockY = y + 6 + (pixelHash(seed, i, 4) % (scale - 13));
    const radius = 3 + (pixelHash(seed, i, 8) % 4);
    drawCircle(image, rockX + 2, rockY + 3, radius, [66, 58, 56, 150]);
    drawCircle(image, rockX, rockY, radius, [120, 103, 88, 210]);
    drawLine(image, rockX - 2, rockY - 2, rockX + 1, rockY - 3, [166, 145, 117, 130]);
  }
}

function isShrineFootprintCell(col, row) {
  return col >= 34 && col <= 42 && row >= 7 && row <= 11;
}

function drawHiddenShrineFootprint(image, col, row, scale) {
  const x = col * scale;
  const y = row * scale;
  for (let py = 0; py < scale; py += 1) {
    for (let px = 0; px < scale; px += 1) {
      const texture = (pixelHash(col, row, Math.floor(px / 2), Math.floor(py / 2)) % 9) - 4;
      setPixel(image, x + px, y + py, [88 + texture, 130 + texture, 70 + texture, 255]);
    }
  }
  drawGrassDetail(image, col, row, scale);
}

function drawLeafLitter(image, col, row, scale) {
  const x = col * scale;
  const y = row * scale;
  const seed = pixelHash(col, row, 401);
  for (let i = 0; i < 4; i += 1) {
    const px = x + 3 + (pixelHash(seed, i) % (scale - 6));
    const py = y + 3 + (pixelHash(seed, i, 6) % (scale - 6));
    fillRect(image, px, py, 3, 2, i % 2 ? [96, 119, 57, 130] : [49, 79, 45, 160]);
  }
}

function drawDetailedBridge(image, scale) {
  const x = 21 * scale;
  const y = 17 * scale;
  const width = 7 * scale;
  const height = 3 * scale;
  fillRect(image, x, y, width, height, [126, 79, 43, 255]);
  for (let plank = 0; plank < width; plank += 12) {
    drawLine(image, x + plank, y + 2, x + plank, y + height - 3, [63, 41, 29, 210]);
    drawLine(image, x + plank + 2, y + 3, x + plank + 2, y + height - 4, [169, 112, 62, 100]);
    if (plank % 24 === 0) {
      drawCircle(image, x + plank + 6, y + 10, 2, [45, 36, 30, 230]);
      drawCircle(image, x + plank + 6, y + height - 11, 2, [45, 36, 30, 230]);
    }
  }
  fillRect(image, x, y + 4, width, 5, [72, 47, 31, 230]);
  fillRect(image, x, y + height - 9, width, 5, [72, 47, 31, 230]);
  for (let post = 0; post <= width; post += scale) {
    fillRect(image, x + post - 2, y, 5, 14, [58, 39, 28, 245]);
    fillRect(image, x + post - 2, y + height - 14, 5, 14, [58, 39, 28, 245]);
  }
}

function drawShrineFoundation(image, scale) {
  const centerX = 38.25 * scale;
  // The imported sprite already carries a soft painted shadow; only add entrance steps.
  for (let step = 0; step < 3; step += 1) {
    const width = 54 + step * 12;
    const x = centerX - width / 2;
    const y = 11 * scale + 12 + step * 6;
    fillRect(image, x, y, width, 5, [132 - step * 7, 130 - step * 7, 117 - step * 6, 235]);
    drawLine(image, x, y + 4, x + width - 1, y + 4, [76, 75, 70, 190]);
  }
}

function drawShrine2_5D(image, scale, shrineSprite) {
  if (shrineSprite) {
    const centerX = 38.25 * scale;
    const left = Math.round(centerX - shrineSprite.width / 2);
    const top = Math.round(4.7 * scale);
    blendImage(image, shrineSprite, left, top);
    return;
  }
  const frontLeft = [34 * scale + 14, 7 * scale + 22];
  const frontRight = [40 * scale + 22, 7 * scale + 22];
  const frontBottomLeft = [frontLeft[0], 11 * scale + 24];
  const frontBottomRight = [frontRight[0], 11 * scale + 24];
  const sideTopRight = [42 * scale + 18, 6 * scale + 26];
  const sideBottomRight = [sideTopRight[0], 10 * scale + 28];

  // Visible right side wall first, then the brighter south-facing facade.
  fillPolygon(image, [frontRight, sideTopRight, sideBottomRight, frontBottomRight], [126, 101, 82, 255]);
  fillPolygon(image, [frontLeft, frontRight, frontBottomRight, frontBottomLeft], [184, 151, 111, 255]);

  // Side-wall courses recede northeast to make the depth readable.
  for (let y = sideTopRight[1] + 13; y < sideBottomRight[1]; y += 15) {
    drawLine(image, frontRight[0], y + 26, sideTopRight[0], y, [83, 69, 62, 115]);
  }

  const timber = [79, 43, 35, 255];
  const timberLight = [112, 62, 43, 220];
  fillRect(image, frontLeft[0], frontLeft[1], frontRight[0] - frontLeft[0], 8, timber);
  fillRect(image, frontLeft[0], frontBottomLeft[1] - 9, frontRight[0] - frontLeft[0], 9, timber);
  for (const x of [frontLeft[0] + 7, frontLeft[0] + 58, frontRight[0] - 58, frontRight[0] - 8]) {
    fillRect(image, x, frontLeft[1], 9, frontBottomLeft[1] - frontLeft[1], timber);
    drawLine(image, x + 2, frontLeft[1] + 4, x + 2, frontBottomLeft[1] - 4, timberLight);
  }
  drawLine(image, frontRight[0], frontRight[1], sideTopRight[0], sideTopRight[1], timber);
  drawLine(image, frontRight[0], frontBottomRight[1], sideBottomRight[0], sideBottomRight[1], timber);
  fillRect(image, sideTopRight[0] - 7, sideTopRight[1], 8, sideBottomRight[1] - sideTopRight[1], [66, 41, 35, 255]);

  // Recessed double door and two lattice windows on the front facade.
  const doorLeft = 37 * scale + 6;
  const doorTop = 9 * scale + 2;
  const doorWidth = scale + 20;
  const doorHeight = frontBottomLeft[1] - doorTop;
  fillRect(image, doorLeft - 5, doorTop - 5, doorWidth + 10, doorHeight + 5, [57, 37, 34, 255]);
  fillRect(image, doorLeft, doorTop, doorWidth, doorHeight, [104, 55, 44, 255]);
  drawLine(image, doorLeft + doorWidth / 2, doorTop, doorLeft + doorWidth / 2, doorTop + doorHeight, [55, 34, 31, 255]);
  for (let y = doorTop + 13; y < doorTop + doorHeight - 5; y += 14) {
    drawLine(image, doorLeft + 4, y, doorLeft + doorWidth - 5, y, [139, 77, 54, 130]);
  }
  drawCircle(image, doorLeft + doorWidth / 2 - 5, doorTop + doorHeight / 2, 3, [218, 166, 77, 255]);
  drawCircle(image, doorLeft + doorWidth / 2 + 5, doorTop + doorHeight / 2, 3, [218, 166, 77, 255]);
  drawLatticeWindow(image, 35 * scale + 2, 8 * scale + 27, 42, 44);
  drawLatticeWindow(image, 39 * scale + 8, 8 * scale + 27, 42, 44);

  // Diagonal ridge and two roof planes create the 2.5D viewing angle.
  const ridgeFront = [37 * scale + 18, 4 * scale + 18];
  const ridgeBack = [40 * scale + 24, 5 * scale + 12];
  const eaveFrontLeft = [32 * scale + 22, 7 * scale + 30];
  const eaveFrontRight = [40 * scale + 28, 8 * scale + 8];
  const eaveSideRight = [43 * scale + 10, 6 * scale + 28];

  fillPolygon(image, [ridgeFront, ridgeBack, eaveSideRight, eaveFrontRight], [91, 38, 39, 255]);
  fillPolygon(image, [ridgeFront, ridgeBack, eaveFrontRight, eaveFrontLeft], [143, 55, 50, 255]);

  // Tile channels follow perspective on both roof planes.
  for (let step = 0; step <= 12; step += 1) {
    const t = step / 12;
    const ridgePoint = lerpPoint(ridgeFront, ridgeBack, t);
    const eavePoint = lerpPoint(eaveFrontLeft, eaveFrontRight, t);
    drawLine(image, ridgePoint[0], ridgePoint[1], eavePoint[0], eavePoint[1], [82, 31, 34, 150]);
  }
  for (const t of [0.28, 0.52, 0.76]) {
    const left = lerpPoint(ridgeFront, eaveFrontLeft, t);
    const right = lerpPoint(ridgeBack, eaveFrontRight, t);
    drawLine(image, left[0], left[1], right[0], right[1], [187, 77, 62, 110]);
  }
  for (let step = 1; step < 5; step += 1) {
    const t = step / 5;
    const ridgePoint = lerpPoint(ridgeBack, ridgeFront, t * 0.2);
    const eavePoint = lerpPoint(eaveFrontRight, eaveSideRight, t);
    drawLine(image, ridgePoint[0], ridgePoint[1], eavePoint[0], eavePoint[1], [54, 28, 32, 135]);
  }

  // Thick eaves and upturned tips read as volume rather than a flat polygon.
  for (let offset = 0; offset < 6; offset += 1) {
    drawLine(image, eaveFrontLeft[0], eaveFrontLeft[1] + offset, eaveFrontRight[0], eaveFrontRight[1] + offset, [55, 29, 31, 230]);
    drawLine(image, eaveFrontRight[0], eaveFrontRight[1] + offset, eaveSideRight[0], eaveSideRight[1] + offset, [43, 27, 30, 230]);
  }
  fillPolygon(image, [
    [eaveFrontLeft[0] - 12, eaveFrontLeft[1] - 7],
    [eaveFrontLeft[0] + 18, eaveFrontLeft[1] + 2],
    [eaveFrontLeft[0] + 2, eaveFrontLeft[1] + 8],
  ], [111, 42, 42, 255]);
  fillPolygon(image, [
    [eaveSideRight[0] + 13, eaveSideRight[1] - 8],
    [eaveSideRight[0] - 17, eaveSideRight[1] + 2],
    [eaveSideRight[0] - 2, eaveSideRight[1] + 8],
  ], [77, 34, 38, 255]);

  drawLine(image, ridgeFront[0], ridgeFront[1], ridgeBack[0], ridgeBack[1], [210, 153, 72, 255]);
  drawCircle(image, ridgeFront[0] - 3, ridgeFront[1] - 2, 5, [183, 124, 58, 255]);
  drawCircle(image, ridgeBack[0] + 3, ridgeBack[1] - 2, 5, [160, 105, 54, 255]);

  // Lanterns hang below the eave; their short shadows reinforce the projection.
  for (const x of [35 * scale + 10, 40 * scale - 4]) {
    drawLine(image, x, 8 * scale + 2, x, 8 * scale + 14, [54, 38, 31, 255]);
    fillRect(image, x - 5, 8 * scale + 14, 11, 14, [198, 77, 42, 245]);
    drawLine(image, x - 3, 8 * scale + 18, x + 3, 8 * scale + 18, [239, 142, 67, 170]);
  }
}

function drawLatticeWindow(image, x, y, width, height) {
  fillRect(image, x - 4, y - 4, width + 8, height + 8, [79, 46, 37, 255]);
  fillRect(image, x, y, width, height, [82, 115, 103, 255]);
  for (let col = 1; col < 4; col += 1) drawLine(image, x + (width * col) / 4, y, x + (width * col) / 4, y + height, [50, 43, 39, 220]);
  for (let row = 1; row < 4; row += 1) drawLine(image, x, y + (height * row) / 4, x + width, y + (height * row) / 4, [50, 43, 39, 220]);
  fillRect(image, x + 3, y + 3, width - 6, 3, [143, 183, 157, 70]);
}

function lerpPoint(from, to, amount) {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount];
}

function drawCampfire(image, centerX, centerY) {
  for (let angle = 0; angle < 8; angle += 1) {
    const x = centerX + Math.round(Math.cos((angle / 8) * Math.PI * 2) * 10);
    const y = centerY + Math.round(Math.sin((angle / 8) * Math.PI * 2) * 7);
    drawCircle(image, x, y, 3, [91, 81, 68, 255]);
  }
  drawLine(image, centerX - 8, centerY + 5, centerX + 8, centerY - 4, [74, 45, 30, 255]);
  drawLine(image, centerX - 7, centerY - 4, centerX + 8, centerY + 5, [92, 52, 31, 255]);
  fillPolygon(image, [[centerX, centerY - 15], [centerX + 7, centerY + 5], [centerX, centerY + 1], [centerX - 7, centerY + 5]], [224, 104, 42, 255]);
  fillPolygon(image, [[centerX, centerY - 9], [centerX + 3, centerY + 2], [centerX - 3, centerY + 2]], [255, 214, 91, 255]);
}

function drawHerbCluster(image, centerX, centerY, flowerVariant) {
  for (const offset of [[-7, 3], [0, 0], [7, 4], [-2, 8]]) {
    const x = centerX + offset[0];
    const y = centerY + offset[1];
    drawLine(image, x, y + 6, x, y - 4, [38, 93, 52, 255]);
    drawLine(image, x, y, x - 5, y - 3, [69, 137, 69, 255]);
    drawLine(image, x, y + 1, x + 5, y - 2, [87, 156, 73, 255]);
  }
  const flower = flowerVariant ? [181, 151, 225, 255] : [205, 226, 142, 255];
  drawCircle(image, centerX, centerY - 6, 2, flower);
}

function drawSignpost(image, centerX, centerY) {
  fillRect(image, centerX - 2, centerY - 15, 5, 24, [83, 54, 34, 255]);
  fillPolygon(image, [[centerX - 14, centerY - 15], [centerX + 12, centerY - 15], [centerX + 17, centerY - 9], [centerX + 12, centerY - 4], [centerX - 14, centerY - 4]], [136, 91, 49, 255]);
  drawLine(image, centerX - 10, centerY - 12, centerX + 10, centerY - 12, [191, 139, 77, 120]);
}

function drawTreeCanopy(image, centerX, centerY, scale, variant) {
  drawCircle(image, centerX + 4, centerY + 8, 15, [25, 49, 34, 105]);
  fillRect(image, centerX - 3, centerY + 4, 7, 18, [72, 57, 39, 220]);
  const dark = variant === 0 ? [37, 87, 49, 245] : [35, 79, 53, 245];
  const mid = variant === 2 ? [64, 123, 69, 248] : [55, 116, 63, 248];
  const light = variant === 1 ? [92, 151, 79, 250] : [78, 141, 73, 250];
  for (const [dx, dy, radius, color] of [
    [-10, 1, 14, dark],
    [10, 2, 15, mid],
    [-2, -11, 16, mid],
    [1, -21, 11, light],
    [-14, -12, 10, dark],
    [14, -11, 10, light],
  ]) drawCircle(image, centerX + dx, centerY + dy, radius, color);
  for (let i = 0; i < 7; i += 1) {
    const x = centerX - 12 + (pixelHash(centerX, centerY, i) % 25);
    const y = centerY - 25 + (pixelHash(centerY, centerX, i) % 21);
    fillRect(image, x, y, 3, 2, [127, 176, 91, 130]);
  }
}

function pixelHash(...values) {
  let hash = 2166136261;
  for (const value of values) {
    hash ^= Math.round(value) >>> 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compositeLayers(ground, foreground) {
  const result = createImage(ground.width, ground.height, [0, 0, 0, 255]);
  ground.pixels.copy(result.pixels);
  for (let i = 0; i < foreground.pixels.length; i += 4) {
    const alpha = foreground.pixels[i + 3] / 255;
    if (alpha === 0) continue;
    result.pixels[i] = Math.round(foreground.pixels[i] * alpha + result.pixels[i] * (1 - alpha));
    result.pixels[i + 1] = Math.round(foreground.pixels[i + 1] * alpha + result.pixels[i + 1] * (1 - alpha));
    result.pixels[i + 2] = Math.round(foreground.pixels[i + 2] * alpha + result.pixels[i + 2] * (1 - alpha));
    result.pixels[i + 3] = 255;
  }
  return result;
}

function cloneImage(source) {
  const result = createImage(source.width, source.height, [0, 0, 0, 0]);
  source.pixels.copy(result.pixels);
  return result;
}

function cropImage(source, left, top, width, height) {
  const result = createImage(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * source.width + left) * 4;
    const sourceEnd = sourceStart + width * 4;
    source.pixels.copy(result.pixels, y * width * 4, sourceStart, sourceEnd);
  }
  return result;
}

function drawMarkers(image) {
  const scale = MAP.visualPixelsPerCell;
  for (const entry of npcPoints) {
    const x = entry.tile.x * scale + scale / 2;
    const y = entry.tile.y * scale + scale / 2;
    drawCircle(image, x, y + 2, 9, [35, 47, 59, 255]);
    drawCircle(image, x, y - 1, 6, [104, 190, 216, 255]);
  }
  for (const entry of interactions) {
    const x = entry.tile.x * scale + scale / 2;
    const y = entry.tile.y * scale + scale / 2;
    fillPolygon(image, [[x, y - 9], [x + 9, y], [x, y + 9], [x - 9, y]], [245, 207, 91, 255]);
  }
}

function renderMaskPreview(sourceGrid) {
  const scale = 12;
  const image = createImage(MAP.width * scale, MAP.height * scale, [0, 0, 0, 255]);
  for (let row = 0; row < MAP.height; row += 1) {
    for (let col = 0; col < MAP.width; col += 1) {
      const color = MASK_RGBA[sourceGrid[row][col]];
      fillRect(image, col * scale, row * scale, scale, scale, color);
      drawLine(image, col * scale, row * scale, (col + 1) * scale - 1, row * scale, [37, 48, 42, 75]);
      drawLine(image, col * scale, row * scale, col * scale, (row + 1) * scale - 1, [37, 48, 42, 75]);
    }
  }
  return image;
}

function location(id, name, x, y, width, height, entryX, entryY) {
  return { id, name, bounds: { x, y, width, height }, entryPoint: { x: entryX, y: entryY } };
}

function point(id, name, kind, x, y, locationId) {
  return { id, name, kind, tile: { x, y }, locationId };
}

function interaction(id, name, kind, x, y, locationId, actions, details) {
  const base = { id, name, kind, tile: { x, y }, locationId, actions };
  if (!details) return base;
  return kind === 'portal'
    ? { ...base, portal: details }
    : { ...base, inspection: details };
}

function createImage(width, height, color) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  }
  return { width, height, pixels };
}

function setPixel(image, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = (y * image.width + x) * 4;
  const sourceAlpha = clamp(color[3]) / 255;
  const destinationAlpha = image.pixels[index + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha === 0) return;
  image.pixels[index] = clamp(
    (color[0] * sourceAlpha + image.pixels[index] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  image.pixels[index + 1] = clamp(
    (color[1] * sourceAlpha + image.pixels[index + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  image.pixels[index + 2] = clamp(
    (color[2] * sourceAlpha + image.pixels[index + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  image.pixels[index + 3] = clamp(outputAlpha * 255);
}

function fillRect(image, x, y, width, height, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) setPixel(image, px, py, color);
  }
}

function drawLine(image, x0, y0, x1, y1, color) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setPixel(image, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twice <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function drawCircle(image, centerX, centerY, radius, color) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) setPixel(image, centerX + x, centerY + y, color);
    }
  }
}

function fillPolygon(image, points, color) {
  const minY = Math.floor(Math.min(...points.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        intersections.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (intersections[i + 1] === undefined) continue;
      for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x += 1) {
        setPixel(image, x, y, color);
      }
    }
  }
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgba(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function extractBackgroundCutout(source, bounds) {
  const crop = cropImage(source, bounds.x, bounds.y, bounds.width, bounds.height);
  const total = crop.width * crop.height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBackground = (index) => {
    const pixel = index * 4;
    const r = crop.pixels[pixel];
    const g = crop.pixels[pixel + 1];
    const b = crop.pixels[pixel + 2];
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const average = (r + g + b) / 3;
    return maximum - minimum <= 26 && average >= 64;
  };

  const enqueue = (index) => {
    if (visited[index] || !isBackground(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < crop.width; x += 1) {
    enqueue(x);
    enqueue((crop.height - 1) * crop.width + x);
  }
  for (let y = 0; y < crop.height; y += 1) {
    enqueue(y * crop.width);
    enqueue(y * crop.width + crop.width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % crop.width;
    const y = Math.floor(index / crop.width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < crop.width) enqueue(index + 1);
    if (y > 0) enqueue(index - crop.width);
    if (y + 1 < crop.height) enqueue(index + crop.width);
  }

  for (let index = 0; index < total; index += 1) {
    if (visited[index]) crop.pixels[index * 4 + 3] = 0;
  }
  return trimTransparent(crop, 3);
}

function trimTransparent(source, margin = 0) {
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.pixels[(y * source.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return createImage(1, 1, [0, 0, 0, 0]);
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(source.width - 1, right + margin);
  bottom = Math.min(source.height - 1, bottom + margin);
  return cropImage(source, left, top, right - left + 1, bottom - top + 1);
}

function blendImage(target, source, left, top) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceIndex = (y * source.width + x) * 4;
      const alpha = source.pixels[sourceIndex + 3];
      if (alpha === 0) continue;
      setPixel(target, left + x, top + y, [
        source.pixels[sourceIndex],
        source.pixels[sourceIndex + 1],
        source.pixels[sourceIndex + 2],
        alpha,
      ]);
    }
  }
}

function parsePng(filePath) {
  const bytes = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error(`${filePath} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12] !== 0) {
        throw new Error('Only non-interlaced 8-bit RGB/RGBA PNG is supported');
      }
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    const raw = inflated.subarray(inputOffset, inputOffset + stride);
    inputOffset += stride;
    const scanline = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? scanline[x - channels] : 0;
      const up = previous[x] ?? 0;
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      let value = raw[x];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (value + paeth(left, up, upperLeft)) & 255;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      scanline[x] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      pixels[targetIndex] = scanline[sourceIndex];
      pixels[targetIndex + 1] = scanline[sourceIndex + 1];
      pixels[targetIndex + 2] = scanline[sourceIndex + 2];
      pixels[targetIndex + 3] = channels === 4 ? scanline[sourceIndex + 3] : 255;
    }
    previous = scanline;
  }
  return { width, height, pixels };
}

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

function writePng(filePath, width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0;
    pixels.copy(raw, offset, y * width * 4, (y + 1) * width * 4);
    offset += width * 4;
  }
  const chunks = [
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]));
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

var crcTable;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeConvexDataModuleFromJsonSources() {
  const mask = readJson(path.join(outputDir, 'cellMask.json'));
  const locationsSource = readJson(path.join(outputDir, 'locations.json'));
  const npcPointsSource = readJson(path.join(outputDir, 'npcPoints.json'));
  const interactionsSource = readJson(path.join(outputDir, 'interactions.json'));

  assertMapId(mask, 'cellMask.json');
  assertMapId(locationsSource, 'locations.json');
  assertMapId(npcPointsSource, 'npcPoints.json');
  assertMapId(interactionsSource, 'interactions.json');

  const worldTiles = mask.coordinateSpaces?.worldTiles;
  if (
    worldTiles?.width !== MAP.width ||
    worldTiles?.height !== MAP.height ||
    worldTiles?.tileSize !== MAP.tileSize
  ) {
    throw new Error(
      `Expected cellMask worldTiles ${MAP.width}x${MAP.height} @ ${MAP.tileSize}, got ${JSON.stringify(worldTiles)}`,
    );
  }

  if (!Array.isArray(mask.navigableTypes) || !Array.isArray(mask.blockingTypes)) {
    throw new Error('cellMask.json must define navigableTypes and blockingTypes arrays');
  }
  const allMaskTypes = new Set([...mask.navigableTypes, ...mask.blockingTypes]);
  if (allMaskTypes.size !== mask.navigableTypes.length + mask.blockingTypes.length) {
    throw new Error('cellMask navigableTypes and blockingTypes must be disjoint');
  }

  const sourceCells = mask.cells;
  if (!sourceCells || typeof sourceCells !== 'object' || Array.isArray(sourceCells)) {
    throw new Error('cellMask.json cells must be a coordinate-keyed object');
  }
  const expectedCellCount = worldTiles.width * worldTiles.height;
  if (Object.keys(sourceCells).length !== expectedCellCount) {
    throw new Error(
      `Expected ${expectedCellCount} cellMask cells, got ${Object.keys(sourceCells).length}`,
    );
  }

  const cells = [];
  const generatedCounts = Object.fromEntries([...allMaskTypes].map((type) => [type, 0]));
  for (let row = 0; row < worldTiles.height; row += 1) {
    const rowTypes = [];
    for (let col = 0; col < worldTiles.width; col += 1) {
      const key = `${col},${row}`;
      const type = sourceCells[key];
      if (!allMaskTypes.has(type)) {
        throw new Error(`cellMask ${key} has unknown or missing type ${JSON.stringify(type)}`);
      }
      rowTypes.push(type);
      generatedCounts[type] += 1;
    }
    cells.push(rowTypes);
  }
  for (const key of Object.keys(sourceCells)) {
    const match = /^(\d+),(\d+)$/.exec(key);
    const col = match ? Number.parseInt(match[1], 10) : -1;
    const row = match ? Number.parseInt(match[2], 10) : -1;
    if (!match || col >= worldTiles.width || row >= worldTiles.height) {
      throw new Error(`cellMask contains out-of-bounds coordinate ${key}`);
    }
  }
  for (const type of allMaskTypes) {
    if (mask.counts?.[type] !== generatedCounts[type]) {
      throw new Error(
        `cellMask count mismatch for ${type}: expected ${mask.counts?.[type]}, got ${generatedCounts[type]}`,
      );
    }
  }

  const sourceCollections = [
    ['locations.json', locationsSource.locations, 6],
    ['npcPoints.json', npcPointsSource.points, 5],
    ['interactions.json', interactionsSource.points, 6],
  ];
  for (const [fileName, collection, expectedLength] of sourceCollections) {
    if (!Array.isArray(collection) || collection.length !== expectedLength) {
      throw new Error(
        `${fileName} must contain ${expectedLength} entries, got ${collection?.length ?? 'invalid'}`,
      );
    }
  }

  const locationIds = new Set(locationsSource.locations.map((entry) => entry.id));
  const navigableTypes = new Set(mask.navigableTypes);
  for (const entry of locationsSource.locations) {
    assertNavigableSourceTile(entry.entryPoint, `location ${entry.id}`, cells, navigableTypes);
  }
  for (const entry of [...npcPointsSource.points, ...interactionsSource.points]) {
    if (!locationIds.has(entry.locationId)) {
      throw new Error(`${entry.id} refers to unknown location ${entry.locationId}`);
    }
    assertNavigableSourceTile(entry.tile, `point ${entry.id}`, cells, navigableTypes);
  }

  const generatedData = {
    mapId: mask.mapId,
    width: worldTiles.width,
    height: worldTiles.height,
    tileSize: worldTiles.tileSize,
    navigableTypes: mask.navigableTypes,
    cells,
    locations: locationsSource.locations,
    npcPoints: npcPointsSource.points,
    interactions: interactionsSource.points,
  };
  const moduleSource = renderConvexDataModule(generatedData, mask.blockingTypes);
  fs.writeFileSync(convexDataPath, moduleSource);
  return generatedData;
}

function assertMapId(source, fileName) {
  if (source?.mapId !== MAP.id) {
    throw new Error(`${fileName} mapId must be ${MAP.id}, got ${JSON.stringify(source?.mapId)}`);
  }
}

function assertNavigableSourceTile(tile, label, cells, navigableTypes) {
  if (
    !Number.isInteger(tile?.x) ||
    !Number.isInteger(tile?.y) ||
    tile.x < 0 ||
    tile.y < 0 ||
    tile.x >= MAP.width ||
    tile.y >= MAP.height
  ) {
    throw new Error(`${label} has invalid tile ${JSON.stringify(tile)}`);
  }
  const type = cells[tile.y][tile.x];
  if (!navigableTypes.has(type)) {
    throw new Error(`${label} must be navigable, got ${type} at ${tile.x},${tile.y}`);
  }
}

function renderConvexDataModule(generatedData, blockingTypes) {
  return `/*
 * Generated by scripts/buildQinglanValleyGatePrototype.mjs.
 * Sources: cellMask.json, locations.json, npcPoints.json, interactions.json.
 * cellMask remains the navigation authority. Do not add hand-authored routes here.
 */

export const QINGLAN_VALLEY_GATE_DATA = ${JSON.stringify(generatedData, null, 2)} as const;

export const QINGLAN_VALLEY_GATE_WALKABILITY = {
  navigableTypes: QINGLAN_VALLEY_GATE_DATA.navigableTypes,
  blockingTypes: ${JSON.stringify(blockingTypes)},
} as const;

export type QinglanValleyGateCellType =
  (typeof QINGLAN_VALLEY_GATE_DATA.cells)[number][number];

export function getQinglanValleyGateCell(
  x: number,
  y: number,
): QinglanValleyGateCellType | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return undefined;
  const row = QINGLAN_VALLEY_GATE_DATA.cells[y] as
    | readonly QinglanValleyGateCellType[]
    | undefined;
  return row?.[x];
}

export function isQinglanValleyGateCellNavigable(x: number, y: number): boolean {
  const type = getQinglanValleyGateCell(x, y);
  return (
    type !== undefined &&
    (QINGLAN_VALLEY_GATE_DATA.navigableTypes as readonly string[]).includes(type)
  );
}
`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

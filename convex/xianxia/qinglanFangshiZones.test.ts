import { inZone } from './movementLogic';
import { QINGLAN_FANGSHI_ZONES } from './qinglanFangshiZones';
import {
  QINGLAN_NAVIGATION_SUMMARY,
  isQinglanTileWalkable,
  snapQinglanTileToWalkable,
} from './qinglanNavigation';

describe('青岚坊市候选 zones', () => {
  test('地图尺寸对齐 96x72 blockout', () => {
    expect(QINGLAN_NAVIGATION_SUMMARY.worldTiles.width).toBe(96);
    expect(QINGLAN_NAVIGATION_SUMMARY.worldTiles.height).toBe(72);
  });

  test('zoneId / 入口唯一且非空', () => {
    expect(QINGLAN_FANGSHI_ZONES).toHaveLength(7);
    expect(new Set(QINGLAN_FANGSHI_ZONES.map((z) => z.zoneId)).size).toBe(
      QINGLAN_FANGSHI_ZONES.length,
    );
    for (const z of QINGLAN_FANGSHI_ZONES) expect(z.entryPoints.length).toBeGreaterThan(0);
  });

  test('每个入口都落在自己的 bounds 内，并能吸附到 cellMask 可走区', () => {
    for (const z of QINGLAN_FANGSHI_ZONES) {
      for (const ep of z.entryPoints) {
        expect({ zone: z.zoneId, inBounds: inZone(ep, z.bounds) }).toMatchObject({
          inBounds: true,
        });
        const snapped = snapQinglanTileToWalkable(ep);
        expect({ zone: z.zoneId, ep, snapped }).toMatchObject({ snapped: expect.any(Object) });
        expect({ zone: z.zoneId, ep, snapped, walkable: isQinglanTileWalkable(snapped!) }).toMatchObject({
          walkable: true,
        });
      }
    }
  });

  test('每个 zone 的 bounds 内至少有可走格作为交互落点', () => {
    for (const z of QINGLAN_FANGSHI_ZONES) {
      let foundWalkable = false;
      for (let x = z.bounds.x1; x <= z.bounds.x2; x++) {
        for (let y = z.bounds.y1; y <= z.bounds.y2; y++) {
          if (isQinglanTileWalkable({ x, y })) {
            foundWalkable = true;
            break;
          }
        }
        if (foundWalkable) break;
      }
      expect({ zone: z.zoneId, foundWalkable }).toMatchObject({ foundWalkable: true });
    }
  });

  test('zones 两两不重叠', () => {
    for (let i = 0; i < QINGLAN_FANGSHI_ZONES.length; i++) {
      for (let j = i + 1; j < QINGLAN_FANGSHI_ZONES.length; j++) {
        const a = QINGLAN_FANGSHI_ZONES[i].bounds;
        const b = QINGLAN_FANGSHI_ZONES[j].bounds;
        const overlap = a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
        expect({
          pair: `${QINGLAN_FANGSHI_ZONES[i].zoneId}/${QINGLAN_FANGSHI_ZONES[j].zoneId}`,
          overlap,
        }).toMatchObject({ overlap: false });
      }
    }
  });
});

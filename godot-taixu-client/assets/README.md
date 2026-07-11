# Assets

This folder keeps only the minimum assets needed by the clean Godot client.

Current asset:

- `qinglan-reference-town-footprint-no-bamboo-v1.png`
  - Copied from `public/assets/`.
  - Used as the first Qinglan map background while the Convex bridge is being
    stabilized.
  - Current source-image size is `1448 x 1086` pixels. Godot scales it onto the
    `96 x 72` tile world at `32px` per tile.
- `qinglanRegions.json`
  - Copied from `public/assets/qinglanRegions.json`.
  - Used by `NavigationMask.gd` for Godot-side walkability checks.
  - Keep it byte-for-byte in sync with the generated source file.
  - Its `image` metadata must match the PNG dimensions and its `cellMask`
    uses 8 source pixels per cell.
- `fonts/NotoSansCJKsc-Regular.otf`
  - Bundled CJK UI/map-label font from the official Noto CJK project.
  - Distributed under the SIL Open Font License in `fonts/OFL.txt`.
  - Keeps Chinese world data readable without depending on host system fonts.

Run `node godot-taixu-client/tools/check_navigation_mask.mjs` from the project
root after replacing either file. It checks public/client asset hashes, PNG
dimensions, mask metadata, Godot map constants, and key walkability/collision
watch points.

Generated imports under `.godot/` should remain local editor output.

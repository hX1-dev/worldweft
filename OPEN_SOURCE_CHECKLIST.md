# Public Release Checklist

## Complete

- [x] Separate the Godot-Convex architecture base from the old Web/Pixi client.
- [x] Keep local Convex state, environment files, Godot cache, and dependency
  directories out of Git.
- [x] Preserve AI Town's MIT attribution and state the compatibility boundary.
- [x] Include the Noto font's OFL notice.
- [x] Run the core type, lint, unit, Godot contract, and headless startup gates.
- [x] Verify the production dependency audit has no known vulnerabilities.

## Required Before Public Push

- [ ] Confirm that every Qinglan fixture asset is original, permissively
  licensed, or replace it with a neutral fixture with recorded provenance.
- [ ] Add a public issue policy and contribution guidelines.
- [ ] Add CI for `npm run godot:check-core` on a clean checkout.
- [ ] Re-run the live bridge smoke and long agent soak against the public
  release commit's local checkout.

## Before 1.0

- [ ] Replace the Taixu/Qinglan reference world with a neutral example world
  and neutral internal module paths.

The open-source repository should be public only after the fixture-asset
provenance item is explicitly confirmed.

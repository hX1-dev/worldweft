# Release Readiness

Worldweft is a public alpha engineering baseline. Current runtime and gameplay
scope is recorded in [Implementation status](docs/STATUS.md). Refresh release
evidence against the intended commit; historical results do not certify a new
release.

## Complete

- [x] Separate the Godot-Convex architecture base from the old Web/Pixi client.
- [x] Keep local Convex state, environment files, Godot cache, and dependency
  directories out of Git.
- [x] Preserve AI Town's MIT attribution and state the compatibility boundary.
- [x] Include the Noto font's OFL notice.
- [x] Run the core type, lint, unit, Godot contract, and headless startup gates.
- [x] Provide public contribution guidance, support routes, and issue forms.
- [x] Add CI for source/static/unit checks, the quick life baseline, and dialogue checks.

## Required Before A Distributable Release

- [ ] Confirm that every Qinglan fixture asset is original, permissively
  licensed, or replace it with a neutral fixture with recorded provenance.
- [ ] Re-run the core gate, including headless Godot contracts, on a clean release checkout.
- [ ] Re-run all 15 life-baseline cases and the dialogue checks.
- [ ] Refresh the production dependency audit and record its date and result.
- [ ] Re-run the live bridge smoke and long agent soak against the public
  release commit's local checkout.

## Before 1.0

- [ ] Replace the Taixu/Qinglan reference world with a neutral example world
  and neutral internal module paths.

Fixture-asset provenance must be explicitly confirmed before a distributable
reference release. Repository visibility and passing code checks do not resolve
an asset's licensing. See [NOTICE.md](NOTICE.md) for attribution and fixture notes.

# Godot Taixu Source Boundary

This document defines the reproducible release boundary for the new Godot
Taixu client and the Convex modules required by its formal bridge. It is part
of H6 in `HARDENING_PLAN.md`.

## Delivery Unit

The current delivery unit is deliberately narrower than the repository:

```text
godot-taixu-client/          Godot project, client contracts, tools, and docs
convex/godot*.ts             bridge contract, read models, and projections
convex/http.ts               authenticated /godot/* HTTP transport
convex/godotTesting.ts       restricted godot_smoke_* fixtures
convex/xianxia/              rule/action/tick modules reached by the bridge
tsconfig.godot-bridge.json   focused TypeScript boundary
package.json                 godot:* verification entry points
```

The old Web/Pixi client, `FrameRonin-main/`, `godot-master/`,
`godot-zongmen-prototype/`, unrelated editor tools, and map-production source
are not part of this hardening unit. They are not scanned or treated as release
blockers by the scoped gates.

## Release Source

The following must be versioned for a clean checkout:

- `godot-taixu-client/` documentation, `project.godot`, scenes, scripts,
  contract tools, source assets, Godot UID sidecars, and import settings;
- scoped bridge configuration: `package.json`,
  `godot-taixu-client/.eslintrc.cjs`, and `tsconfig.godot-bridge.json`;
- `convex/godot*.ts`, bridge tests, `convex/http.ts`, restricted fixtures, and
  the xianxia modules reached by the formal semantic action/tick path;
- Convex generated API declarations after `convex codegen`, according to the
  repository's existing generated-file policy.

Godot `.uid` and adjacent asset `.import` files are release metadata. The
machine-local `.godot/` import cache is not.

The executable manifest explicitly owns every `convex/godot*.ts` module, the
xianxia files changed by the formal action/tick hardening, their runtime
Qinglan data, and the Convex `_generated` set. It intentionally does not treat
every transitive import as release ownership: for example, the legacy xianxia
`travel` branch still imports AI Town `moveTo`, but `travel` is not a Godot
bridge action. `convex/http.ts` is included as the changed HTTP host without
pulling unrelated old HTTP dependencies into this delivery unit. Restricted
fixtures now live in `convex/godotTesting.ts` and have no AI Town or LLM test
imports. `convex/testing.ts` remains in the current release snapshot because
removing its old duplicate fixture exports is part of the migration; it is no
longer part of the scoped bridge typecheck/lint surface.

## Local Or Generated Only

These must never be required from version control:

- `.convex/` local backend state and deployment secrets;
- `.env`, `.env*.local`, bridge bearer tokens, or debug credentials;
- root `tmp/`, including downloaded Godot application bundles;
- `godot-taixu-client/.godot/`, logs, editor state, and imported texture cache;
- build output, coverage, and dependency directories.

`npm run godot:check-contracts` accepts `GODOT_BIN` for a machine-installed
Godot executable. The repository-local `tmp/godot-download/...` path is only a
developer convenience and is intentionally ignored.

## Gates

```bash
npm run godot:check-source
npm run godot:list-source
npm run godot:check-release-source
npm run godot:check-clean-snapshot
npm run godot:check-static
npm run godot:check-unit
npm run godot:check-live-ui
```

`godot:check-source` validates only this delivery unit's structure, ignore
rules, and obvious embedded credential patterns in the current worktree. It
also requires every file named by the scoped TypeScript project or focused
unit suite to belong to the release unit, and requires every scoped TypeScript
file to appear in the ESLint command. This prevents manifest/typecheck/lint
drift when a bridge module is added.
`godot:list-source` prints the same manifest with each file's current Git
tracking state.
`godot:check-release-source` adds `--require-tracked` and fails until every
release-source file is tracked and committed relative to `HEAD`. Codex does not
stage or commit those files implicitly; versioning is an explicit
repository-owner action.

`godot:check-clean-snapshot` proves the manifest independently of the dirty
worktree. It exports tracked `HEAD`, overlays only release-source files, commits
them inside a temporary Git repository, links the existing dependency install,
and runs release-source, static, unit, and Godot contract gates. Add
`--full-local` to its Node command to also run codegen, generated-source
stability, authenticated bridge smoke, and agent soak with inherited local
environment credentials. The current repository branch and index are never
modified.

`godot:check-live-ui` is a local windowed evidence gate rather than a
headless/CI requirement. With player and debug credentials in the process
environment it captures exact 1024 x 720 and 1440 x 900 viewports after live
resident selection, actor-context/replay loading, and a debug tick.

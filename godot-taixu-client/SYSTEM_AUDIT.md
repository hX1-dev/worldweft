# Godot Taixu System Audit

Last reviewed: 2026-07-10.

This document records current evidence for the Convex xianxia backend and the
Godot Taixu client integration. It is intentionally evidence-based: a phase is
not considered complete here unless current files and validation output prove
the relevant contract.

## Current Verdict

The Convex <-> Godot bridge is green for the formal closed loop:

```text
Godot-style HTTP request
-> Convex /godot/action or /godot/tick
-> xianxia rules / agent loop
-> actionRecords + worldEvents
-> actionRecord / regionState / actorContext / replay readback
-> Godot presentation, bubbles, trace UI, and formatter contracts
```

The wider long-term goal is still open. H1 durable-state integrity, H2
identity/authorization, H3 action idempotency, H4 strict versioned bridge
contracts, and H5 multi-map/query isolation are verified. Action preparation
is read-only, retries converge on one lifecycle, invalid network input cannot
become a durable action, and Godot reads/ticks cannot cross exact map
boundaries. H6 scoped quality gates, release-unit reproducibility, and module
boundaries are technically green in an isolated snapshot, but the real Git
baseline is blocked pending explicit repository-owner authorization. H7
long-running agent/presence/client hardening is complete; H8 release evidence
and the authorized real Git baseline are the active items.

## Validation Evidence

These commands were run from the repository root during the latest audit:

```bash
CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=120 npx convex codegen
npm test -- convex/godotBridgeAuth.test.ts convex/godotBridgeContract.test.ts convex/godotExchange.test.ts convex/godotMapBoundary.test.ts convex/godotPresentation.test.ts convex/xianxia/access.test.ts convex/xianxia/actionIdempotency.test.ts convex/xianxia/qinglanFangshiZones.test.ts convex/xianxia/qinglanNavigation.test.ts convex/xianxia/qinglanProfiles.test.ts
npx tsc --noEmit --pretty false --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler convex/godot.ts convex/godotMapPages.ts convex/godotMapBoundary.ts convex/http.ts convex/xianxia/qinglan.ts convex/xianxia/qinglanProfiles.ts convex/xianxia/actions.ts
npm run godot:check-source
npm run godot:check-static
npm run godot:check-core
npm run godot:check-release-source
npm run godot:check-clean-snapshot
node godot-taixu-client/tools/check_clean_snapshot.mjs --full-local
npm run godot:check-contracts
npm run godot:check-agent-soak
npm run godot:check-agent-soak-long
npm run qinglan:audit-mask
node godot-taixu-client/tools/check_bridge.mjs
git diff --check
```

Results:

- `convex codegen`: passed.
- Backend, map, auth, idempotency, and contract tests: 18 suites passed, 72
  tests passed.
- Focused bridge TypeScript checking: passed. The previously exposed
  travel-result narrowing error in `convex/xianxia/actions.ts` is fixed.
- `npm run godot:check-static`: passed with the new release-scoped TypeScript
  project and ESLint 8-compatible configuration.
- `npm run godot:check-core`: passed source-boundary checks, static checks, 18
  Jest suites/72 tests, soak-policy checks, and all Godot headless contracts.
- `npm run godot:check-release-source`: intentionally red. The current
  worktree has 132 untracked release-source files plus uncommitted tracked
  changes, so the real repository does not yet contain the proven snapshot.
- `npm run godot:check-production`: intentionally stops at that same first
  release-source gate. It does not run live release verification from a mixed,
  unversioned source state. After the Git baseline is authorized, it will
  continue through full-local snapshot, long soak, mask audit, and final
  source/diff checks.
- `npm run godot:check-clean-snapshot`: passed with all 161 release files
  committed inside an isolated temporary repository. Release-source reported
  zero untracked files; scoped static checks, 18 suites/72 tests, clean-cache
  CJK font/asset import, and all Godot contracts passed. The latest 161-file
  full-local snapshot additionally passed Convex codegen with zero `_generated`
  drift, authenticated bridge smoke, and the three-tick agent soak without
  modifying the real branch or index.
- `npm run godot:check-contracts`: passed. Repeated Godot 4.7 processes had
  reproduced a crash while rotating shared `user://logs`; the runner now gives
  every process a unique temporary log. The Main scene contract also validates
  CJK font coverage, responsive HUD bounds, debug separation, semantic submit
  routing, and replay/trace behavior without making live network calls.
- `npm run qinglan:audit-mask`: passed with `suspiciousWalkableCount: 0`,
  `suspiciousTreeWalkableCount: 0`, and the known
  `suspiciousCollisionCount: 3`.
- `check_bridge.mjs`: passed after local HTTP access was allowed. The sandboxed
  attempt was blocked with `EPERM 127.0.0.1:3211`. The passing run also covered
  missing/invalid credentials, wrong actor/world, forged source, foreign
  origin, player debug-tick denial, same-key sequential/concurrent retries,
  new-key lifecycle creation, conflict rejection, and accepted-gift effect-once
  assertions. The current rerun uses the dedicated `api.godotTesting.*`
  namespace and proves both isolation-fixture and smoke-actor cleanup still run
  through `finally` while durable action/event traces remain available.
- `npm run godot:check-agent-soak`: passed and scheduled all 9/9 eligible
  actors in three ticks using the Convex-owned round-robin cursor. The long
  24-tick profile also passed: 17 actionRecord readbacks, 80 tickOnly rows, 18
  actor-context readbacks, one new memory id, 13 new context
  actions/events, one structured relationship effect (magnitude 2, two visible
  dimensions), 14 resident-change passes, and 97 bounded responses/2,214,246
  bytes in 34,383 ms.
- The first 152-file full-local rerun exposed unbounded fixture cleanup after
  every bridge assertion had passed. Cleanup now uses exact relationship and
  request indexes plus actionRecord -> worldEvent -> sourceEvent memory pages.
  Bridge smoke cleaned 257 artificial memories in 30 bounded calls; long soak
  cleaned 66 in 8 calls; durable action/event traces remain preserved. The
  that initial 152-file full-local snapshot passed end to end; the current
  expanded release unit is the separately verified 161-file snapshot.
- A real connected Godot window loaded 9 residents, 7 locations, and 20 recent
  events. It exposed and drove fixes for integral JSON pagination values,
  clipped fixed HUD layout, dense debug presentation, and missing deterministic
  CJK coverage. Headless contracts, the isolated snapshot, and the repeatable
  windowed live-UI gate now prove the fixes at exact 1024 x 720 and 1440 x 900
  captures with resident selection, actor context/replay, tick, and trace.
- `git diff --check`: passed.
- Root Web/Pixi, external engine source, old prototype, and map-production
  lint/build state are outside this audit. H6 uses only the explicit
  client/bridge source boundary defined in `SOURCE_BOUNDARY.md`.

## Requirement Matrix

| Requirement | Status | Current evidence |
| --- | --- | --- |
| Convex remains durable world source and rule adjudication layer. | Proven for the current action system. | `godot.prepareAction` is read-only; final `submitAction` reloads actor, target, map/location/range and arrival geometry through the shared spatial policy before rule adjudication, and applied effects/event/actionRecord writes remain Convex-owned. |
| Bridge identity, actor/world binding, CORS, and debug isolation. | Proven for production and debug projections. | H2 tests and player-token smoke prove actor/world/source binding, fail-closed CORS/auth, viewer-aware event visibility, NPC-private-field redaction, and a credential-gated unrestricted debug society/replay projection. |
| Semantic action idempotency and duplicate-submit safety. | Proven for H3. | Indexed `clientActionId` + semantic fingerprint in `submitAction`, sequential/concurrent bridge smoke, accepted-gift effect-once assertions, and `check_action_client.gd`. |
| Strict, versioned request/response and error contract. | Proven for H4. | `godot_bridge_v1`, `godotBridgeContract.test.ts`, HTTP negative matrix with unchanged profile/replay snapshots, structured 400/409 mapping, Godot version/shape checks, and `finally` fixture cleanup. |
| Exact multi-map isolation and bounded read continuation. | Proven for H5. | `worldEvents.byMap`, recorded action map ownership, `godotMapBoundary.test.ts`, independent paginated internal queries, bounded actor replay scanning, source-event memory filtering, Godot pagination validation, and restricted two-map/mapless smoke fixtures with `finally` cleanup. |
| Godot remains spatial, presentation, input, collision, and interaction layer. | Proven for current client contracts. | `Main.gd`, `ActionClient.gd`, `ResidentRenderer.gd`, `NavigationMask.gd`, formatter checks, `check_main_scene_contract.gd`, and `npm run godot:check-contracts`. |
| Godot submits semantic actions instead of durable facts or story text. | Proven for current H1/H4 bridge scope. | `ActionClient.gd` submits semantic payloads; the bridge requires spatial evidence and formal arrival, rejects fact/effect fields, and only Convex rules apply location effects. |
| Agent/LLM proposes intent only and cannot directly mutate durable state. | Proven for the current short and 24-tick soak paths. | `POST /godot/tick` calls the internal agent loop; round-robin scheduler tests and both soaks exclude Godot-controlled actors, and every durable row is read back through the formal action/event lifecycle. |
| Real outcomes enter `actionRecords` and `worldEvents`. | Proven for current action set. | `check_bridge.mjs` reads back `actionRecord` and confirming `regionState.recentEvents` for `talk`, `gift`, `trade`, `spar`, `request_teaching`, `cultivate`, `breakthrough`, `arrive`, `explore`, and legacy adapters. |
| Social outcomes enter `relationships` and `memories`. | Proven for formal gift and controlled long-soak social action. | Bridge smoke verifies the gift relationship/memory/event linkage; long soak requires a new memory id and structured relationship effect, and paged fanout tests cover 120-actor public delivery plus local/rumor boundaries. |
| Legacy `/godot/arrive` and `/godot/interact` are compatibility adapters. | Proven. | `convex/http.ts` adapts both through `runPreparedGodotAction`; bridge smoke verifies legacy readback as formal `arrive`/`talk`. |
| Capability availability matches action validation. | Proven for smoke scenarios and durable-location mismatch. | Capability policy requires actor/target durable semantic co-location for non-arrive actions; bridge smoke proves enabled teaching submits, physical proximity alone cannot enable talk from another durable location, and breakthrough stays disabled until fixture-primed. |
| Presentation layer separates durable summary from UI text. | Proven for current rule-template layer and preview-only polish seam. | `convex/godotPresentation.test.ts`, `/godot/presentationPreview`, and bridge smoke verify `durableSummary`, `bubbleText`, `displayText`, `bubbleKind`, `presentationSource`, locked policy, and candidate validation that rejects fact/durable-state fields. |
| Tick returns durable events or explicit tick-only observations. | Proven for smoke and bounded soak paths. | `check_bridge.mjs` and `check_agent_soak.mjs` assert `tickEvents`, actionRecord readback for durable tick rows, and explicit `tickOnly` observations. |
| Event/actionRecord trace is visible to Godot. | Proven for current UI/debug contracts. | `TraceFormatter.gd`, `check_trace_formatter.gd`, `check_main_scene_contract.gd`, `actorContext`, `replay`, and bridge smoke verify `traceChain`, ids, result codes, replay summary, readback status, stale replay rejection, and replay-driven trace panel rebuilds. |
| Qinglan map/navigation contract is aligned. | Proven for current mask assets. | `check_navigation_mask.mjs`, `check_spatial_contract.gd`, navigation tests, and `qinglan:audit-mask`. |
| Selected resident presence, route, schedule, actor context display. | Proven for current system loop. | Formatter/renderer contracts, bridge soak, and the two-size windowed live-UI gate cover Convex-derived presence labels, route/schedule markers, resident selection, actorContext, capabilities, replay, and tick refresh. |
| Godot UI is complete enough for the current system loop. | Proven at the H7 system scope. | Main/formatter/renderer contracts plus exact 1024 x 720 and 1440 x 900 windowed screenshots cover nonblank map rendering, responsive in-bounds HUD, bundled CJK text, resident inspector, semantic controls, real tick, and actionRecord/worldEvent or explicit tickOnly trace. Richer trading and map-content polish remain later product work. |
| Long-term system complete. | Not proven. | Remaining items below. |

## Remaining Gaps

- H1's original read-only preparation and atomic applied-effect defects are
  closed. The H7 stale-state blocker is also closed: preparation and the final
  mutation share one spatial policy, and the mutation reloads current actor,
  resident, location, map, and range state before rule resolution.
- H2 actor/world/source binding and debug tick isolation are closed. The H7
  viewer-projection blocker is also closed: production reads use server-derived
  viewer identity and visibility/memory policy, while unrestricted NPC context
  and replay remain on the debug credential.
- H3 idempotency is closed for Godot semantic writes. Tick lease/idempotency is
  also closed for the current world loop: a Convex-owned expiring lease
  serializes global phases, and completed tick ids remain in a bounded replay
  window.
- H4 strict/versioned contracts are closed for current routes. Future fields or
  action params must update the versioned validator and negative matrix first.
- H5 multi-map/query isolation is closed for current routes. New map-owned
  tables and read paths must use exact ownership, explicit legacy policy, and
  bounded continuation metadata.
- Quality gates and reproducibility: focused lint/typecheck/core gates are
  green and the isolated 161-file clean snapshot passes every scoped runtime
  gate, but the real-worktree release-source gate remains red because 132
  bridge/client source files are not yet versioned in the repository. The
  source gate now cross-checks typecheck/unit ownership and lint coverage
  against the release manifest so new backend files cannot silently fall out
  of the clean snapshot.
- Maintainability: major spatial/capability/read-model/context-policy
  extraction is complete, but `Main.gd` remains the largest client
  orchestration owner and should only be split behind its existing contracts.
- World-loop scalability: current Agent, scheduler, movement, Qinglan presence,
  quest, group-scene, and optional growth tick paths are indexed and explicitly
  bounded. The current evidence includes a 120-actor scheduler window test and
  9/9 live soak; a larger live database fixture remains useful H8 evidence.
- Memory fanout lifecycle is closed at the durable job boundary. Large worlds
  create a persisted cursor/counter job, scheduled pages stop when that row is
  completed or removed, and restricted cleanup removes it before deleting
  memories/events. The transaction conflict prevents an in-flight page from
  repopulating cleaned data. Paged 120-actor policy tests and live bridge
  cleanup pass; a live 120-profile database fixture remains H8 scale evidence.
- Durable schema shape is closed for current writes. Event facts/effects and
  action result/metadata use centralized closed validators; new rows carry
  schema version 1 and bridge readback asserts those versions. Three retired
  legacy shapes remain explicit read-only union members so existing durable
  history remains deployable without restoring a generic value bag.
- Longer system playtest: the 24-tick soak now proves scheduler coverage,
  route/schedule consistency, replay, actor context, memory, relationship, and
  bounded artifacts. The exact two-size windowed gate also proves post-fix
  Godot selection, tick, and actionRecord/worldEvent or explicit tickOnly trace
  behavior.
- Production map/content pass: the spatial contract is stable, but the map
  itself still needs more authored content and visual/gameplay QA.
- Optional LLM polish adapter: `llm_polish` is currently preview-only and
  correctly locked down, including candidate rejection for fact/durable-state
  fields; no bounded real adapter is configured yet.
- Godot UX review is closed for the current system loop. One connected-window
  pass found and drove fixes for pagination, HUD overflow, and CJK rendering;
  the repeatable post-fix gate now captures exact 1024 x 720 and 1440 x 900
  viewports after live resident selection, actor context/replay, and tick.
- Release-unit versioning: 132 required client/bridge files are currently
  untracked, while some tracked bridge dependencies also have uncommitted
  changes. This does not break the runtime, but it remains a collaboration and
  clean-checkout risk until a coherent snapshot is versioned deliberately.

## Next Best Work

1. With explicit repository-owner authorization, version the coherent
   release-source snapshot so `godot:check-release-source` becomes green in
   the real repository.
2. Split further
   orchestration only where current contracts show a concrete maintenance win.
3. Keep richer player trading deferred; map/content production may now progress
   independently while the release-source authorization remains visible.

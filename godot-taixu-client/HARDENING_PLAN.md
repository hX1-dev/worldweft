# Godot Taixu System Hardening Plan

Last updated: 2026-07-10.

This is the authoritative long-running hardening plan for the Convex xianxia
backend and the Godot Taixu client. `IMPLEMENTATION_PLAN.md` remains the product
and phase history; this document owns the order, evidence, and completion gates
for making the current closed loop production-ready and maintainable.

## Non-Negotiable Architecture

- Convex owns durable world facts and rule adjudication.
- Godot owns map rendering, input, collision, local movement feel, selection,
  animation, and display-only presentation.
- Agents and LLMs may propose intent or display polish only.
- A Godot request submits a semantic action. It must not directly set durable
  profile, location, inventory, relationship, memory, event, or action state.
- Every durable action outcome is attributable to an `actionRecords` row and a
  linked `worldEvents` row. System observations that are not durable remain
  explicit `tickOnly` rows.
- Presentation may change display fields only. It may not change durable
  summaries, ids, facts, effects, result codes, or world state.
- There is one formal action path. Compatibility endpoints may adapt into it
  but may not create a second mutation path.

## Long-Running Loop

Work proceeds one active hardening item at a time:

1. Reproduce or prove the risk from current code and runtime evidence.
2. Record the contract and negative acceptance cases before implementation.
3. Make the smallest architecture-aligned change.
4. Run focused tests, then bridge smoke, agent soak, Godot contracts, and static
   checks appropriate to the blast radius.
5. Write the result and exact evidence back into this plan and
   `SYSTEM_AUDIT.md`.
6. Keep the item active if any required gate is red. Do not move to a broader
   feature merely because the happy path works.

Status values:

- `blocked`: external input or environment is required.
- `in_progress`: the only active hardening item.
- `pending`: ordered but not yet active.
- `verified`: implementation and all required evidence are green.

## Current Baseline

The functional closed loop is green as of 2026-07-10:

- formal `talk`, `gift`, `trade`, `spar`, `request_teaching`, `cultivate`,
  `breakthrough`, `arrive`, and `explore` actions;
- legacy `arrive` and `interact` compatibility adapters;
- `actionRecord`, `worldEvent`, relationship, memory, actor-context, and replay
  readback;
- bounded agent tick, durable tick events, and explicit `tickOnly` rows;
- locked rule-template presentation and preview-only polish validation;
- Godot navigation, spatial, formatter, renderer, inspector, trace, Main scene,
  and startup contracts.

Current evidence:

```text
Backend/map/auth/idempotency/contract Jest: 18 suites, 72 tests passed
Godot contract suite: passed
Bridge closed-loop smoke: passed
Short agent soak: 3 ticks, all 9/9 eligible actors scheduled
Long agent soak: 24 ticks, 17 actionRecord readbacks, 80 tickOnly rows,
                 1 new memory, 1 relationship effect,
                 14 visible resident-change passes
Focused bridge TypeScript check: passed
Isolated clean snapshot: 161 release files, release/static/unit/Godot gates passed
Latest 161-file full-local snapshot: codegen stable,
                         authenticated bridge and short soak passed
Qinglan mask audit: passed
git diff --check: passed
```

The baseline is an internal alpha, not a production-ready release. The items
below explain why.

## Ordered Hardening Backlog

### H0. Evidence And Plan Baseline

Status: `verified`

Goal: make the hardening order and current risks explicit before changing
behavior.

Acceptance:

- This document lists every known architecture, production, maintenance, test,
  and client/bridge release-unit risk.
- `IMPLEMENTATION_PLAN.md`, `README.md`, `BRIDGE_TESTS.md`, and
  `SYSTEM_AUDIT.md` point to this plan and do not claim long-term completion.
- Current passing and failing scoped quality gates are recorded without hiding
  delivery-unit failures.

### H1. Durable State Integrity And Semantic Location

Status: `verified`

Risk:

- `POST /godot/action` currently runs `godot.prepareAction` as one committed
  mutation and `xianxia.gm.act` afterward.
- `prepareAction` can create or patch profiles and writes
  `currentLocationId`/`currentIntent` before rule resolution.
- `arrive` currently returns no location effect, so the durable location change
  is performed by preparation rather than by the adjudicated action.
- Missing `actorTile` skips bridge spatial validation.
- A later action failure can therefore leave durable profile state without the
  matching action/event lifecycle.

Required changes:

- Make action preparation read-only with respect to world facts, or reduce it
  to an explicitly audited identity bootstrap that cannot change action facts.
- Move applied location/map/intent changes into the atomic rule mutation and
  expose them in structured effects/readback.
- Require and validate spatial evidence for Godot-local target and location
  actions.
- Do not patch a target profile merely because it was named by an action
  request. Resident/profile synchronization must use a Convex-owned lifecycle.
- Define a traceable first-player/bootstrap contract without allowing arbitrary
  actor creation through `/godot/action`.

Required evidence:

- Rejected and failed actions leave actor/target durable location unchanged.
- Applied `arrive` changes location exactly once inside the action transaction.
- The linked `actionRecord` and `worldEvent` expose the same location result.
- Omitting or forging required spatial fields is rejected without durable
  writes.
- Existing formal actions, legacy adapters, bridge smoke, and agent soak stay
  green.

Verified on 2026-07-10:

- `godot.prepareAction` is now a query and performs no profile, location,
  intent, relationship, memory, event, or action-record writes.
- Qinglan player/resident profile provisioning moved to the Convex-owned
  seed/tick lifecycle. Naming a target in an action no longer creates or
  patches that target.
- Applied `arrive` emits `effects.locationChange`; `submitAction` applies that
  map/location/intent change atomically with its `actionRecord` and
  `worldEvent`.
- Bridge smoke proves the action response, action-record readback, and region
  event expose the same location change. It also proves out-of-range, missing
  `actorTile`, and rejected location actions leave actor and target profiles
  unchanged.
- Godot-local target/location actions require spatial evidence and a formally
  arrived semantic location. The smoke traverses medicine shop -> west gate ->
  tea stall through formal `arrive` actions before cross-location actions.
- A soak failure exposed a resident whose transient current waypoint was not
  in the role route. The generic schedule preview now preserves that current
  stop, with a regression test, and the rerun passed.
- Evidence: codegen passed; focused bridge TypeScript check passed; 5 Jest
  suites/24 tests passed; Godot contracts passed; bridge smoke passed; agent
  soak passed; Qinglan mask audit passed; `git diff --check` passed.

### H2. Identity, Authorization, And Debug Protection

Status: `verified`

Risk:

- The HTTP bridge currently accepts arbitrary `actorId` and action `source`.
- CORS is open and there is no session-to-actor binding.
- `/godot/tick` can advance the world without a production/debug guard.
- HTTP-only authentication would still be bypassable because `godot.*`,
  `xianxia.gm.act`, `xianxia.actions.submitAction`, and
  `xianxia.agent.runAgentTick` are currently public Convex functions.

Required changes:

- Introduce a bridge authentication contract suitable for Godot.
- Bind a session or signed credential to one allowed player actor/world.
- Derive player action source server-side; clients cannot claim `agent` or
  `system`.
- Protect debug tick and fixture behavior with explicit environment/policy
  gates.
- Apply least-privilege CORS and return structured `401`/`403` responses.
- Make bridge queries and the actual action/tick mutation chain internal.
  Preserve any legacy web-console entry only behind an explicit local/admin
  policy; it must not be an unauthenticated production side door.

Required evidence:

- Unauthenticated, wrong-world, wrong-actor, forged-source, and production tick
  requests are rejected without writes.
- Valid local development and configured production clients still pass the
  formal bridge loop.

Contract selected before implementation:

- Native Godot requests use an environment-supplied bearer credential. No
  token is stored in project files or durable world tables.
- A player credential binds to one configured actor and one configured world,
  with read and semantic-action scopes. The server injects those claims and
  always derives player action source as `human`.
- A separate explicitly enabled debug credential may additionally use the
  fixed `godot_smoke_*` fixture namespace and `tick:debug` scope. Production
  omits this credential and cannot call tick.
- Health remains public but reports only non-secret security capability flags.
  Every world/action/read route requires a credential.
- Browser origins are denied unless present in an exact configured allowlist;
  native requests without an `Origin` header remain supported.
- Direct public Convex calls cannot reach bridge queries, action submission, or
  agent tick cores. Legacy xianxia write wrappers fail closed outside an
  explicit local/admin policy.

Verified on 2026-07-10:

- `godotBridgeAuth` fails closed unless a deployment has a sufficiently long
  bearer credential and explicit world binding. Player credentials are bound
  to one actor/world and derive `source: "human"` server-side.
- A separate debug credential owns `tick:debug` and the restricted
  `godot_smoke_*` namespace. Production can omit it; the Godot client hides
  manual/automatic tick controls when no debug credential is present.
- All Godot bridge reads and writes except public health require credentials.
  Exact-origin CORS denies unconfigured browser origins while native requests
  remain supported.
- `godot.*`, action submission, Qinglan resident tick, and agent tick cores are
  internal Convex functions. Public legacy GM/agent wrappers require explicit
  local-debug or authenticated admin policy; smoke fixtures require local
  bridge debug mode.
- `check_bridge.mjs` proves missing/invalid credentials, wrong world, wrong
  actor, forged source, foreign origin, and player attempts to call debug tick
  return stable `401`/`403` responses before writes. Actor profile and replay
  snapshots remain unchanged across the negative matrix.
- The authenticated formal bridge smoke, three-tick agent soak, Godot client
  contracts, focused TypeScript check, 6 Jest suites/29 tests, codegen, and
  `git diff --check` pass.

### H3. Action Idempotency And Duplicate Submission Safety

Status: `verified`

Risk:

- Every action request inserts a new `actionRecords` row.
- Network retry, timeout recovery, or repeated button activation can apply the
  same gift, trade, relationship, cultivation, or inventory effect twice.
- Godot request serialization orders duplicates but does not deduplicate them.

Required changes:

- Add a client-generated semantic action id/idempotency key.
- Persist and enforce uniqueness per world/actor/client action.
- Return the original result for safe retries.
- Disable or debounce the relevant Godot command while its request is pending.
- Keep tick idempotency/lease semantics separate from player action ids.

Required evidence:

- Replaying the same action key returns one action/event/effect lifecycle.
- A new key creates a new lifecycle.
- Timeout-style retry and double-submit Godot contract tests pass.

Verified on 2026-07-10:

- Formal Godot writes require `clientActionId`. `actionRecords` persist the key
  and a canonical semantic fingerprint under a
  `(worldId, actorId, clientActionId)` index.
- `submitAction` checks and replays the original finalized action/event/effects
  inside the same Convex mutation. Reusing a key for changed type, target,
  location, intent, params, source, or map fails with
  `action_idempotency_conflict` before another lifecycle is written.
- `prepareAction` recognizes an existing key before profile/spatial validation,
  so a timeout retry still returns the original result even if the first
  applied action changed semantic location.
- Bridge smoke proves sequential and concurrent same-key `talk` requests return
  one actionRecord/worldEvent, while a new key creates a new lifecycle. A
  same-key accepted gift retry leaves inventory/profile, relationship,
  memory, and trace effects unchanged.
- Godot generates a per-command key, blocks another menu command while an
  action is pending, and retries transport/408/425/429/5xx action failures at
  most once with the exact original payload/key. Location-arrival actions may
  still queue so spatial state is not silently dropped.
- Evidence: codegen passed; focused TypeScript passed; 7 Jest suites/32 tests
  passed; full Godot contracts passed including the action-client contract;
  authenticated bridge smoke passed; three-tick agent soak passed; mask audit
  and `git diff --check` passed.

### H4. Strict Bridge Contract And Error Semantics

Status: `verified`

Risk:

- Unknown action types currently fall back to `talk`.
- Invalid JSON becomes an empty body, and malformed tiles are cast rather than
  validated.
- Many client errors become HTTP `500` responses.
- Open `params`, `metadata`, `facts`, `effects`, and GDScript `Dictionary`
  payloads increase drift risk.
- The bridge has no explicit contract version.

Required changes:

- Reject malformed JSON, missing required fields, unknown actions, invalid
  numbers/tiles, oversized text, and unsafe metadata with structured `400`.
- Add stable error codes and a bridge contract version to health and payloads.
- Define per-action semantic parameter validators while keeping one endpoint.
- Add typed/shared response contracts where practical and runtime validation at
  every network boundary.

Required evidence:

- Negative contract matrix passes and no invalid request becomes another
  action type.
- Godot displays structured errors without inventing facts.
- Existing positive smoke remains green.

Verified on 2026-07-10:

- `godot_bridge_v1` is attached server-side to every bridge JSON success and
  error response. Godot rejects version mismatch and validates route-specific
  minimum success fields before updating UI state.
- POST bodies require `application/json`, a bounded object body, safe keys and
  depth, known top-level fields, finite numeric/tile values, bounded strings,
  whitelisted scalar metadata, and per-action params. Unknown action types are
  rejected and can no longer fall back to `talk`.
- Target/location actions require their semantic target/location and spatial
  evidence at the HTTP boundary. Malformed requests never enter
  `prepareAction`/`submitAction` and therefore create no durable lifecycle.
- GET routes reject unknown, duplicate, empty, oversized, non-finite,
  fractional, and out-of-range query values. POST and public health reject
  query parameters.
- Expected spatial/context conflicts return stable `409` codes; malformed
  contract input returns stable `400`/`413`/`415`; idempotency conflicts return
  `409`; unexpected errors are logged server-side and return a sanitized 500.
- Bridge smoke proves malformed JSON, missing key, unknown action, invalid
  tile, unsafe metadata, oversized intent, forged facts, invalid tick limit,
  invalid/duplicate/unknown query values, POST query drift, and invalid Convex
  ids are rejected without profile or replay writes. Smoke cleanup now runs in
  `finally` and was verified by intentional mid-run failures.
- Evidence: codegen and focused TypeScript passed; 8 Jest suites/36 tests
  passed; full Godot contracts passed; authenticated bridge smoke passed;
  three-tick agent soak passed; mask audit and `git diff --check` passed.

### H5. Multi-Map Isolation And Query Boundaries

Status: `verified`

Risk:

- Region/replay filtering currently includes every Godot-sourced event even
  when its `mapId` belongs to another map.
- Region and resident queries use fixed `take(...)` limits without an explicit
  truncation/page contract.
- Replay and actor-context joins perform bounded per-row reads and need scale
  evidence before the world grows.

Required changes:

- Require exact map ownership for new events; support legacy no-map rows only
  through an explicit compatibility rule.
- Add pagination/truncation metadata and deterministic ordering.
- Add two-map isolation fixtures and query-cost/size checks.
- Keep replay, regionState, actorContext, and tick event filters consistent.

Required evidence:

- Events and residents never leak across maps.
- Truncated results say so and can be continued deterministically.
- Current Qinglan behavior and trace linking remain green.

Verified on 2026-07-10:

- `worldEvents.byMap` and explicit `actionRecords.mapId` now define exact map
  ownership for Godot-facing reads. The documented legacy mapless policy is
  `exclude`; a `facts.source === "godot"` marker no longer bypasses map
  boundaries.
- `worldState`, `regionState`, and replay use deterministic Convex cursor
  pages with `limit`, `returned`, `isDone`, `truncated`, and
  `continueCursor`. Each collection page is an independent internal query and
  read-only orchestrator actions compose the response, respecting Convex's
  one-paginated-query-per-function rule.
- Actor-filtered replay scans bounded map pages until it finds the requested
  rows, reaches the end, or reaches ten scan pages. It returns `scanned`,
  `filtered`, and `scanPages` plus a continuation cursor, so an empty physical
  page is not mistaken for no actor history.
- `actorContext` filters events by exact map, filters fallback action records
  by recorded map, and includes a memory only when its `sourceEventId` resolves
  to an event on the requested map. `contextWindow` exposes scan, return, and
  truncation bounds.
- Debug tick selects profiles on the requested map only. Qinglan resident
  simulation is skipped for non-Qinglan map requests, and returned tick/recent
  events remain on the requested map.
- `ConvexBridge.gd` validates pagination metadata and exposes bounded
  world/region/replay continuation methods. Invalid/expired cursor input maps
  to stable `400 invalid_pagination_cursor` rather than a sanitized 500.
- Restricted `godot_smoke_*` fixtures create Qinglan, second-map, and legacy
  mapless events plus source-bound memories, a second-map resident/location,
  and an adversarial tick candidate. Smoke proves region/world/context/replay
  isolation, deterministic second-page continuation, and tick selection, then
  removes all fixture rows in `finally`, including on intentional failure.
- Evidence: codegen passed; 10 focused Jest suites/42 tests passed; full Godot
  contracts passed; authenticated bridge smoke passed; three-tick agent soak
  passed with 3 actionRecord readbacks, 9 tickOnly observations, 3
  actorContext/replay readbacks, 15 memory rows, and 3 visible resident-change
  passes; mask audit and `git diff --check` passed.

### H6. Scoped Quality Gates, Release Reproducibility, And Module Boundaries

Status: `blocked`

Risk:

- The current relevant implementation includes many untracked files, including
  the Godot client and bridge modules.
- The client/bridge release boundary needs its own stable lint and TypeScript
  configuration without changing quality policy for unrelated old projects.
- `Main.gd` remains a large UI/orchestration script, while the remaining
  `convex/godot.ts` action-preparation and read orchestration still require
  careful contract-protected ownership boundaries.

Required changes:

- Establish an intentional tracked source boundary without reverting unrelated
  user work.
- Restore focused lint/typecheck commands for the bridge and Godot tools, then
  integrate them into the normal verification command.
- Split high-change responsibilities only where tests already define a stable
  contract: HTTP parsing/auth, action preparation/spatial policy, replay, actor
  context, capabilities, Main trace orchestration, and action-menu state.
- Move restricted `godot_smoke_*` fixture mutations from the mixed legacy
  `convex/testing.ts` host to a dedicated `convex/godotTesting.ts` module.
  Preserve local-only guards, actor namespace checks, durable-trace policy,
  and `finally` cleanup while updating smoke API references and codegen.
- Keep smoke fixture cleanup in `finally`, preserving real durable traces while
  deleting restricted artificial isolation rows.
- Document generated-file ownership and avoid mixed-source release states.

Required evidence:

- A clean checkout can reproduce codegen, tests, Godot contracts, bridge smoke,
  and soak.
- Focused lint and typecheck are green.
- Module extraction produces no second action path and no contract regression.

Progress on 2026-07-10:

- Added an ESLint 8-compatible configuration owned by
  `godot-taixu-client/.eslintrc.cjs` and `tsconfig.godot-bridge.json`, without
  replacing or widening the old root project's configuration.
  `npm run godot:check-static` now runs a stable strict TypeScript and ESLint
  boundary for bridge/runtime modules and is green with no warnings.
- Added `godot:check-source`, `godot:check-release-source`,
  `godot:check-unit`, and `godot:check-core`. The core gate runs source
  structure, focused static checks, 18 Jest suites/72 tests, and the complete
  Godot headless contract suite and is green.
- Added `SOURCE_BOUNDARY.md` and executable source-boundary checks. Local
  caches, `.convex` state, secrets, downloaded Godot binaries, and `.godot`
  imports are explicitly excluded. The scoped source check passes for 161
  release files.
- The source gate now derives closure checks from
  `tsconfig.godot-bridge.json` and the focused unit/lint scripts. A typechecked
  or tested file outside the 161-file release unit, or a scoped TypeScript file
  omitted from ESLint, fails immediately instead of surfacing only in the
  isolated snapshot.
- The strict release-source gate remains red by design: 132 required files are
  currently untracked, and tracked release files also contain uncommitted
  changes. H6 cannot be marked verified until the repository owner versions a
  coherent release snapshot; staging alone will not satisfy the gate.
- The old Web/Pixi project, external Godot source trees, old prototype, and map
  production tools are explicitly outside this delivery unit. Their root
  build/lint state is neither changed nor used as an H6 completion gate; the
  release-scoped strict lint and TypeScript gates are green.
- Extracted one-query-per-page reads to `godotMapPages.ts` and pure resident,
  event, action-trace, and replay projections to `godotReadModel.ts`. Removed
  obsolete Qinglan road-graph helpers and fixed `testing.testConvo`, which was
  incorrectly calling `readAll()` on a returned string.
- Moved all six restricted `godot_smoke_*` fixture mutations from the mixed
  legacy `convex/testing.ts` module to `convex/godotTesting.ts`. Smoke calls now
  use the dedicated generated API namespace; local-debug guards, actor-prefix
  checks, durable-trace preservation, and `finally` cleanup remain unchanged.
  `godotTestingPolicy.test.ts` makes the actor namespace guard a pure tested
  policy instead of six duplicated inline checks.
- Extracted the shared range, distance, bounds, entry-point, and nearest
  location policy to `godotSpatial.ts`, then extracted capability menus,
  options, rule gates, and risk previews to `godotCapabilities.ts`.
  `godot.ts` retains the single registered internal query and world/database
  orchestration, while its size dropped from 1639 to 995 lines. Focused tests
  prove same-location teaching, target absence, breakthrough risk, and spatial
  boundary behavior before the authenticated bridge smoke proves the same
  capability/action consistency end to end.
- Extracted stale asynchronous response matching to
  `ResponseContextPolicy.gd`. Capabilities, actor context, and replay now share
  one tested world/actor/tile/location policy while `Main.gd` retains its
  existing wrapper methods and scene wiring. The dedicated policy contract and
  the full Main scene contract both pass; `Main.gd` dropped from 1138 to 1119
  lines without moving UI node lifecycle ownership.
- Added `godot:check-clean-snapshot`. It exports tracked `HEAD`, overlays only
  the release manifest, creates an isolated temporary commit, imports
  Godot assets, and runs the release, static, unit, and Godot gates without
  touching the real branch or index. Its full-local mode also passed Convex
  codegen with zero generated-source drift, authenticated bridge smoke, and
  the three-tick agent soak.
- The first isolated run exposed two false assumptions: navigation contracts
  required out-of-scope `public/assets` duplicates, and Godot resource-load
  errors could pass with exit code zero. The client mask/PNG are now validated
  self-contained while optional public copies still get hash checks when
  present; the snapshot imports assets first, and the contract runner fails on
  script or resource-load errors.
- After the fixture extraction: codegen, the 11-suite/43-test focused backend
  set, strict static checks, the full core gate, authenticated bridge smoke,
  three-tick agent soak, and all Godot contracts passed. No second action or
  event path was introduced.
- The current technical baseline is green at 161 release files, 18 focused
  suites/72 tests, and all Godot contracts. The clean snapshot imports the
  bundled CJK font and Godot 4.7 UID sidecars from an empty local cache and
  proves zero untracked files inside the isolated repository.
- The real repository gate remains red with 132 currently untracked release
  files. Creating the coherent tracked/committed baseline requires explicit
  repository-owner authorization, so H6 is recorded as blocked rather than a
  second active implementation item. No staging, branch, or commit has been
  performed implicitly.

### H7. Existing Phase 4-6 Hardening

Status: `completed`

Goal: finish the currently implemented-but-in-progress movement, presence, and
agent-loop phases after H1-H6 protect their contracts.

Required changes and evidence:

- Longer configurable soak with relationship/memory deltas and bounded runtime
  artifacts.
- Actual Godot-window UX review across desktop sizes: no overlap, stale state,
  unreadable trace text, or duplicate command behavior.
- Collision, location-entry, route-preview, schedule-phase, replay, and actor
  context coherence over sustained movement/tick cycles.
- Clear production/debug separation for manual tick controls and trace panels.
- Optional LLM polish may be added only after deterministic fallback, timeout,
  schema validation, fact-lock rejection, and zero durable-write tests pass.
- Revalidate every Godot spatial and semantic-location precondition inside the
  final `submitAction` mutation. `prepareAction` remains a read-only early
  rejection/read-model step, not the last authority snapshot.
- Split player-safe reads from debug society inspection. A player credential
  must not receive another actor's private memories or hidden event history;
  full actor context and unrestricted replay require explicit debug scope.
- Replace unbounded profile/location/request scans and per-neighbor relationship
  reads in the agent/world loop with indexed, bounded queries or resumable jobs.
- Serialize world/map tick execution with an expiring Convex-owned lease and a
  traceable tick id. Round-robin actor reservation alone is not a tick lease.
- Make large-world memory fanout lifecycle-aware so restricted fixture cleanup
  cannot be followed by a scheduled page re-inserting artificial memories.
- Reduce durable `v.any()` surfaces through versioned validators for action
  results, world-event facts/effects, and bridge-owned metadata.

Map art and authored content may progress independently, but they do not close
this item. Richer player trading remains deferred unless required to prove the
core system.

Active acceptance contract (recorded before the long-soak implementation):

- The daily smoke profile remains short, while a separately configurable long
  profile supports at least 24 ticks without weakening the per-tick route,
  schedule, trace, actionRecord, actorContext, or replay assertions.
- Every HTTP request has an explicit timeout. The whole run has a wall-clock
  deadline, each response has a byte limit, and cumulative response artifacts
  have a byte limit. Exceeding any budget fails with the responsible request
  label instead of hanging or accumulating unbounded diagnostics.
- Memory change is measured from actor-context memory ids before and after the
  tick sequence. Relationship change is measured from structured
  `rules.effects.relationships`; the soak must never infer either fact from
  presentation text.
- Long mode can require positive memory and relationship deltas. Short mode
  still reports zero deltas without becoming flaky when deterministic routines
  happen to choose non-social actions.
- Configuration parsing, budget failure, and delta accounting are covered by
  a network-free policy contract before the live bridge run is accepted.
- A mutation-time race test changes actor/target state after preparation and
  proves the formal action is rejected without applying effects under a stale
  map or location.
- Player-safe region/context/replay tests cover `private`, `local`,
  `witnessed`, and `public` events. Debug-only projections stay available to
  the authenticated local smoke without widening the production player token.
- Scale fixtures exercise at least 120 profiles without an all-profile
  per-agent scan or N+1 relationship query path.
- Two overlapping tick requests produce one active world/map advancement and
  one explicit lease-busy observation; lease expiry permits recovery.
- Cleanup interleaved with a scheduled large-world fanout leaves no artificial
  fixture memory behind.

Reproduced H7 defect on 2026-07-10:

- The first 24-tick profile selected four agents per tick but produced 96
  `tickOnly` rows and no durable action. `runAgentTickInternal` selected
  `profiles.slice(0, limit)` every time, so duty-bound/skipping profiles
  permanently starved later residents. The fix must use a Convex-owned,
  per-map, atomically reserved round-robin cursor; changing or removing the
  durable-action soak assertion is not an acceptable fix.
- The first passing controlled public spar cleaned 66 event-backed memories.
  `generateMemories` currently calls `collect()` for every memorable event, so
  one public event has unbounded mutation work as the world grows. Memory
  delivery must remain synchronous for direct readback in small worlds, but
  large fanout must continue through bounded Convex-owned pages without
  allowing an LLM/client to write memory rows.
- Capability evaluation initially enabled target actions from physical Godot
  proximity while the actor's durable profile remained at another semantic
  location. The formal action correctly rejected the request with
  `actor_not_at_location`, proving capability/action drift. Capability policy
  now requires formal actor arrival for non-arrive actions while preserving
  `arrive` as the transition into the location.
- A real Godot window rejected a valid region response because JSON numbers
  arrive in GDScript as floats while pagination validation required
  `TYPE_INT`. Integral nonnegative JSON numbers are now accepted and
  fractional values are rejected by contract.
- The first real-window review loaded 9 residents, 7 locations, and 20 recent
  events, but exposed a fixed overlay, clipped debug controls, dense trace
  text, and unreliable Chinese glyph coverage. The HUD is now a responsive,
  scrollable right sidebar with debug-only tick/trace controls, long-label
  bounds, map-aware camera offset, and a bundled OFL Noto Sans CJK font.
- Godot 4.7 crashed while rotating the shared `user://logs/godot.log` during
  repeated headless runs. Contract and clean-snapshot import processes now use
  unique temporary log files.
- The first 152-file full-local snapshot passed every action/tick assertion but
  timed out while `cleanupGodotSmokeFixture` scanned and deleted all fixture
  rows in one mutation. A merely paged global scan required 387 calls for one
  accumulated actor, so the final fix also needed exact ownership indexes and
  source-event cleanup rather than only a larger timeout.

H7 progress and evidence on 2026-07-10:

- Agent selection is now a Convex-owned atomic per-map round robin. Pure tests
  cover wraparound, actor removal, uniqueness, and exclusion of
  `godot_player`/`godot_smoke_*`; the short soak schedules all 9/9 eligible
  actors in three ticks.
- The latest 24-tick long profile completed in 34,383 ms with 97 bounded HTTP
  responses/2,214,246 bytes, 17 durable actionRecord readbacks, 80 explicit
  tickOnly rows, 18 actor-context readbacks, one new memory id,
  13 new context actions/events, one structured relationship effect of
  magnitude 2 across two visible dimensions, and 14 resident-change passes.
- Large memory delivery is paged in Convex-owned batches of 50 after
  synchronous principal delivery; 120-actor public, local-boundary, principal
  exclusion, and deterministic-rumor tests pass. Small worlds remain
  synchronous for immediate readback.
- Authenticated bridge smoke passes capability/formal-arrival consistency,
  action/event/actionRecord/presentation readback, scheduler metadata, durable
  tick rows, and explicit tickOnly fallback. The JSON pagination regression is
  also covered in the Godot action-client contract.
- Fixture cleanup now advances through bounded profile, exact relationship
  from/to, action-event memory, and exact request assignee/issuer phases.
  `shortMemories.bySourceEvent`, `relationships.to`, and `requests.byIssuer`
  avoid whole-world scans. Current bridge smoke cleaned 257 artificial memories
  in 30 bounded calls; long soak cleaned 66 in 8 calls; both preserve durable
  action/event traces.
- The 161-file full-local clean snapshot, current 18-suite/72-test core gate, and
  complete Godot contract suite pass after the HUD/font/log changes.
  Main-scene contracts now
  assert responsive sidebar bounds, wrapping/ellipsis, inherited CJK font, and
  a real Chinese glyph without making a network request.
- Added a windowed `godot:check-live-ui` gate. At exact captured viewport sizes
  1024 x 720 and 1440 x 900 it loads the live Convex region, selects the real
  medicine keeper, waits for actorContext/capabilities/replay, runs a real debug
  tick, requires actionRecord/worldEvent or explicit tickOnly trace text, and
  saves PNG evidence. Both sizes pass with eight visible trace entries, bundled
  Chinese text, nonblank map pixels, and an in-bounds responsive HUD.

Production review additions recorded on 2026-07-10:

- `runPreparedGodotAction` validates through a query and later enters
  `submitAction`; the final mutation currently reloads profiles but does not
  reassert the requested map/location or all missing-location cases. H1's
  read-only preparation invariant remains true, but stale-state adjudication is
  now an explicit H7 production blocker.
- `world:read` binds the viewer actor/world, but `actorContext` accepts an
  arbitrary inspected actor and returns that actor's memories and bidirectional
  relationship state. Region/replay event pages also do not apply viewer-aware
  visibility. H2 identity binding remains proven; least-privilege read
  projection is now an explicit H7 production blocker.
- `agentContext`, round-robin reservation, group scenes, quests, and optional
  growth still contain whole-world collects; `agentContext` additionally reads
  one relationship per nearby profile. The nine-resident soak is behavioral
  evidence, not a large-world operation-bound proof.
- `runAgentTickInternal` is a sequence of independent global mutations and
  actor actions with no world/map lease. Cron/debug overlap remains possible
  even though actor reservation itself is atomic.
- Large-world memory fanout continues from scheduled pages keyed only by a
  preserved source event. Restricted cleanup can race a pending page and allow
  artificial memory rows to reappear after cleanup.
- `worldEvents.facts/effects` and `actionRecords.result/metadata` remain runtime
  `v.any()` values. External bridge validation is strict, but durable internal
  shape drift is not yet prevented by the Convex schema.
- Focused source, static, 15-suite/57-test unit, full Godot contract, and
  `git diff --check` gates passed after this review. These tests do not cover
  the new race, visibility, lease, and large-world cleanup acceptance cases.

Mutation-time spatial blocker closed on 2026-07-10:

- Extracted one pure `evaluateGodotSpatialState` policy used by both
  `prepareAction` and the final `submitAction` mutation. The mutation reloads
  the latest actor profile, location geometry, and target resident before rule
  resolution; stale actor location, target location, target tile/range, map,
  or arrival geometry becomes a formal rejected action lifecycle.
- Added `qinglanResidents.byActor` so the final target lookup is exact and does
  not scan every resident on a map. Generic targeted xianxia actions now also
  require non-empty co-location and equal maps instead of allowing missing
  location values to pass.
- Spatial tests cover actor movement, target departure, target range movement,
  and changed arrival geometry after an earlier valid snapshot. Existing
  capability tests and all normal actions remain green.
- Evidence: Convex codegen passed; strict TypeScript/ESLint passed without
  warnings; 15 suites/59 tests passed; all Godot contracts/headless startup
  passed; authenticated bridge smoke passed every formal/legacy action,
  idempotency, trace, presentation, tick, and cleanup assertion.

Player-safe read projection blocker closed on 2026-07-10:

- Added a pure viewer policy for `public`, `local`, `private`, `witnessed`, and
  `rumor` events. Principals always see their own facts; local visibility uses
  the viewer's current semantic location; rumor visibility requires a source
  memory; unrestricted reads require the debug credential.
- HTTP read routes now pass server-derived viewer identity and credential kind
  into world/region state, action-record, presentation-preview, actor-context,
  and replay projections. Query parameters cannot promote a player to debug.
- Production actor context exposes public profile fields, viewer-to-actor
  relationship state, viewer-owned relevant memories, and viewer-visible
  traces. It hides actor-to-viewer relationship state, private cultivation
  internals, health/spirit/inventory counts, and target-owned memories. The
  Godot formatter displays hidden values explicitly instead of replacing them
  with invented zeroes.
- Debug context/replay keeps the previous exact-map behavior and contract.
  Player and debug responses disclose `readProjection`, allowing the client
  and tests to reject accidental projection drift.
- Evidence: Convex codegen, strict static checks, 16 suites/62 tests, full
  Godot contracts/headless startup, `git diff --check`, and authenticated
  bridge smoke passed. The smoke now uses the production player token to prove
  region/context/replay projection and NPC-private-field redaction end to end.

Bounded world-loop and tick-lease blockers closed on 2026-07-10:

- Added `xianxiaProfiles.byMap/byLocation`, `requests.byStatus`, and exact
  resident actor indexes. Agent context now reads one bounded co-location page,
  one bounded relationship page, one bounded map-location page, and a bounded
  request page; it no longer collects all profiles or performs one relationship
  query per neighbor.
- Round-robin reservation now reads lexical after-cursor and beginning windows
  capped at 128 rows each. It preserves current nine-resident fairness, reports
  scan/exactness metadata, and has a 120-actor wrap test without a whole-table
  collect.
- Movement sync, Qinglan presence, group scenes, quests, request listing, and
  autonomous growth no longer call `collect()` in the tick path. Quest trust
  selection uses bounded status/relationship pages; optional growth advances a
  persistent 32-profile lexical batch cursor instead of starving later actors.
- Added a Convex-owned world tick lease with a five-minute expiry, bounded
  recent tick-id completion window, explicit owner/map/timestamps, failed-run
  release, and expired-lease recovery. Qinglan resident movement moved inside
  the leased tick, so it cannot advance before a busy decision.
- Busy, duplicate-active, and completed-id retries return explicit `tickOnly`
  observations. The Godot client submits a tick id and rejects tick responses
  that omit lease metadata.
- Evidence: codegen and strict static checks passed; 17 suites/66 tests passed;
  all Godot contracts passed; full authenticated bridge smoke proved one winner
  for two concurrent ticks plus zero advancement for a completed tick-id retry;
  the post-lease three-tick soak again scheduled all 9/9 actors.

Memory fanout cleanup blocker closed on 2026-07-10:

- Added `memoryFanoutJobs` as the durable continuation boundary for worlds with
  more than 100 profiles. Scheduled pages now receive only a job id and advance
  the persisted cursor/counters transactionally; completed or missing jobs
  cannot write another page.
- Restricted cleanup removes the event's fanout job before deleting memories
  or fixture events. A concurrently executing page has read the same job row,
  so Convex transaction conflict/retry makes it observe cancellation instead
  of recreating data after cleanup.
- The 120-actor fanout tests prove bounded 50-row pagination, principal
  exclusion, visibility behavior, deterministic rumor delivery, and the
  pending/completed/missing job write guard. Full authenticated bridge smoke
  and the post-fix three-tick soak pass cleanup and normal world progression.
- The current local database remains below the asynchronous threshold, so a
  live 120-profile database fixture is still useful H8 scale evidence; the
  durable lifecycle fix is not represented as having that live proof yet.
- Tick overlap evidence was also made timing-stable by carrying the HTTP
  request-arrival timestamp into lease adjudication. A request that arrived
  before the prior tick finished remains lease-busy even if its acquire action
  is scheduled after the prior lease release.

Durable schema blocker closed on 2026-07-10:

- Replaced `worldEvents.facts/effects` and
  `actionRecords.result/metadata` `v.any()` fields with centralized versioned
  validators in `durableContracts.ts`. Effects now match the rule-owned
  `Effects` contract; facts are a closed union of current action, movement,
  group-scene, quest, bond, and restricted-fixture shapes.
- Every new event fact, action result, and stored action metadata object writes
  `schemaVersion: 1`. The action readback/replay model exposes only the three
  version numbers, and bridge smoke requires all three to equal 1 for every
  new semantic action.
- Action metadata is normalized before persistence. Unknown client fields are
  dropped; only Godot map/tile/range/preparation evidence, legacy endpoint,
  and bounded test provenance may be stored.
- Runtime schema deployment found three historical shapes. Compatibility is
  explicit and read-only: retired `legacyTile` metadata plus the former
  standalone interact/arrive event facts. Current adapters cannot emit those
  facts because they resolve through the formal action lifecycle.
- The scoped TypeScript/ESLint gate now explicitly owns viewer policy, lease,
  durable contracts, event/movement/quest/group/growth modules, and xianxia
  schema instead of relying on incidental imports.
- Evidence: current local runtime schema validation passed against existing
  data; codegen and expanded static checks passed; 18 suites/72 tests passed;
  full authenticated bridge smoke passed every action, version readback,
  tick-lease, projection, presentation, replay, and cleanup assertion.

### H8. Final Production Readiness Audit

Status: `blocked`

`PRODUCTION_RUNBOOK.md` now defines deployment profiles, the automated
`godot:check-production` release gate, the two-size manual client matrix,
failure triage, and non-destructive rollback. The automation is intentionally
red until H6's real Git baseline is authorized and versioned. The separate H7
windowed live-UI gate now passes at both required capture sizes.

Completion requires current evidence for all of the following:

- authority and durable-state invariants;
- authenticated and idempotent semantic actions;
- strict versioned bridge contracts;
- multi-map isolation;
- deterministic rule and presentation separation;
- Godot UI, movement, collision, interaction, and trace behavior;
- agent tick, route/schedule life-loop, relationships, and memories;
- mutation-time spatial consistency, viewer-safe reads, bounded world-loop
  execution, and overlapping-tick lease behavior;
- focused lint, typecheck, codegen, unit, integration, soak, and manual UX gates;
- reproducible client/bridge release state and release/run documentation.

Only after every item is `verified` may the system hardening goal be called
complete and the main engineering focus shift to map/content production.

Current H8 audit evidence on 2026-07-10:

- Authority, auth, idempotency, strict bridge contracts, exact-map isolation,
  rule/presentation separation, mutation-time spatial adjudication,
  viewer-safe projection, bounded world loops, tick lease, fanout lifecycle,
  and versioned durable schema are verified by current focused tests and the
  authenticated bridge smoke.
- The 24-tick long soak and exact 1024 x 720 / 1440 x 900 windowed live-UI
  gate verify Agent scheduling, route/schedule presence, social memory and
  relationship deltas, resident selection, actorContext/capabilities/replay,
  debug tick, and visible trace behavior.
- `godot:check-core`, `qinglan:audit-mask`, and `git diff --check` pass. The
  161-file full-local isolated Git snapshot passes generated-source stability,
  strict release/static/unit/Godot gates, authenticated bridge smoke, and
  short soak from a clean committed checkout.
- The real-worktree `godot:check-release-source` is the only red gate: 132 of
  the 161 required files are untracked and tracked release dependencies also
  contain uncommitted changes. Staging/committing that coherent unit requires
  explicit repository-owner authorization; this audit does not infer it from
  a broad implementation request.
- `/godot` health advertises explicit version 1 markers for spatial
  adjudication, viewer projection, tick lease, fanout jobs, and durable schema.
  Bridge smoke checks these before creating fixtures, so a stale local runtime
  fails immediately instead of producing misleading late-stage evidence.

## Verification Ladder

Run the smallest relevant check during iteration, then the full ladder before
marking a hardening item verified:

```bash
CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=120 npx convex codegen
npm test -- convex/godotExchange.test.ts convex/godotPresentation.test.ts convex/xianxia/qinglanNavigation.test.ts convex/xianxia/qinglanFangshiZones.test.ts
npm run godot:check-contracts
node godot-taixu-client/tools/check_bridge.mjs
npm run godot:check-agent-soak
npm run qinglan:audit-mask
git diff --check
```

H2-H6 must add focused auth, idempotency, malformed-input, map-isolation,
lint/typecheck, and clean-checkout gates to this ladder before those items can
be marked `verified`.

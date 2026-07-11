# Godot Bridge Tests

These checks prove the first closed loop:

```text
Godot-style HTTP request
-> Convex /godot/action
-> xianxia.gm.act
-> submitAction
-> actionRecords + worldEvents
-> /godot/actionRecord + /godot/regionState read-back
-> /godot/replay read-only timeline
```

They do not yet prove all production hardening. `HARDENING_PLAN.md` owns the
ordered negative-test backlog. H1 durable-state tests now prove:

- action preparation is read-only and cannot change profile/location state;
- out-of-range, missing-spatial-evidence, and rejected actions leave actor and
  target profiles unchanged;
- applied `arrive` changes semantic location inside the linked action/event
  transaction and exposes the same `locationChange` in all three readbacks.

H2 identity and authorization tests now prove:

- missing/invalid credentials, wrong actor/world, forged action source, foreign
  browser origin, and player attempts to call debug tick return stable
  `401`/`403` responses;
- rejected auth requests do not change the temporary actor profile or create
  actor replay entries;
- native Godot uses an environment-supplied player credential, debug tick uses
  a separate credential, and production may omit debug access entirely.

H3 action idempotency tests now prove:

- every Godot semantic write carries a persisted `clientActionId`;
- sequential and concurrent retries with the same key return the original
  `actionRecordId` and `worldEventId`;
- a new key creates a new lifecycle, while changed semantics under an existing
  key are rejected without another replay row;
- an accepted gift retry applies inventory, relationship, memory, and trace
  effects exactly once;
- Godot blocks double-submit while pending and its single automatic action
  retry preserves the original key/payload.

H4 strict-contract tests now prove:

- every JSON response carries `contractVersion: "godot_bridge_v1"`, and Godot
  rejects version or minimum-shape drift;
- malformed JSON, unsupported media/type/action, unknown fields or query
  parameters, invalid/duplicate query values, invalid tiles/numbers, oversized
  text, unsafe metadata, forged facts, and invalid per-action params produce
  stable structured errors before action submission;
- expected spatial and idempotency conflicts are stable `409` responses rather
  than generic internal failures;
- smoke cleanup runs in `finally`, including when a negative assertion fails.

H5 multi-map and bounded-query tests now prove:

- world/region events, residents, locations, actor context, source-bound
  memories, replay rows, and debug tick selection do not cross map boundaries;
- legacy mapless events are excluded from Godot reads by explicit policy;
- world/region/replay responses expose bounded pagination metadata and valid
  continuation cursors, and a second location page does not repeat page one;
- actor-filtered replay scans bounded pages instead of treating an empty
  physical page as no actor history;
- invalid cursors return stable `400 invalid_pagination_cursor` responses;
- restricted second-map fixtures are removed in `finally` on success or
  failure.

## Start Convex

From the repository root:

```bash
npm run dev:backend
```

Expected HTTP base URL:

```text
http://127.0.0.1:3211
```

## Run The Bridge Smoke Test

```bash
GODOT_BRIDGE_WORLD_ID=... \
GODOT_BRIDGE_TOKEN=... \
GODOT_BRIDGE_DEBUG_TOKEN=... \
node godot-taixu-client/tools/check_bridge.mjs
```

## Run The Reproducible Core Gates

```bash
npm run godot:check-source
npm run godot:check-static
npm run godot:check-unit
npm run godot:check-core
GODOT_BRIDGE_TOKEN=... GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-live-ui
```

Before a release snapshot, also run:

```bash
npm run godot:check-release-source
```

The release-source form additionally requires every declared source file to be
tracked and committed. It is intentionally red in the current mixed worktree;
the normal source/static/core gates are green.

The live-UI form opens real Godot windows at exact 1024 x 720 and 1440 x 900
capture sizes. It loads the connected region, selects a real resident, waits
for actorContext/capabilities/replay, runs a debug tick, validates trace output,
and reports the temporary PNG artifact directory.

The three values must match the configured local Convex deployment. The smoke
uses the debug credential because it owns the restricted `godot_smoke_*`
fixture namespace and debug tick scope; the player credential is used only to
prove that production player access cannot call tick.

The smoke generates `clientActionId` values automatically. Hand-written bridge
requests must provide their own stable key and reuse it only for a retry of the
same semantic command.

The test intentionally writes `talk`, `gift`, `trade`, `spar`,
`request_teaching`, `cultivate`, `breakthrough`, `arrive`, and `explore`
actions as a one-off `godot_smoke_*` actor, then checks that each returned
`actionRecordId` can be read from
`GET /godot/actionRecord?actionRecordId=...` and that each returned `eventId`
appears in `GET /godot/regionState?mapId=qinglan`. Before writing actions it
calls `POST /godot/capabilities` to prove that nearby targets enable
`talk`, `gift`, `trade`, at least one `spar`, and one qualified
`request_teaching` target, target menu entries include default `intent`,
`params`, and `options`, and `trade.options` include the buyer balance, seller
stock, requested quantity, offered quantity, total/unit price, exchange terms,
quantity choice previews, and quote multipliers needed by the Godot trade
panel. The
qualified `request_teaching` capability includes actor/teacher realm,
relationship, and reputation gates for the Godot detail panel. A nearby
location enables `arrive`, another location enables `cultivate`, and an
out-of-range target disables `talk` with a reason. It also proves
`gift` and `trade` options include Convex-sourced `inventoryDeltaPreview`
before/after item deltas and `confirmationPreview` display lines/policy for
the Godot confirmation panels. When resolved actions produce
`effects.items`, the response, `actionRecord` readback, and confirming
`regionState.recentEvents` entry must also expose `settlementPreview` sourced
from `rules.effects.items`, proving post-action inventory settlement is already
adjudicated by Convex and Godot only displays it. The smoke submits a
multi-quantity `trade` option through the same `POST /godot/action` path and
reads back its `actionRecord` plus `worldEvent`, proving quantity terms are
resolved by Convex rules rather than a Godot-side shortcut. It also proves
`request_teaching`, enabled `spar`, disabled `breakthrough`, and primed enabled
`breakthrough` capabilities include Convex-sourced `riskPreview` with rule
gates, possible result codes, durable effect notes, and
`presentationSource: "rule_template"`. It also proves `breakthrough` starts
disabled with realm, XP threshold, and a rule reason, then uses the restricted
`godotTesting.primeGodotBreakthroughCandidate` fixture to place only the temporary
`godot_smoke_*` actor at a realm gate before submitting the formal
`POST /godot/action` breakthrough. It also calls `POST /godot/tick` with a small
limit to verify the debug agent tick bridge and Qinglan resident movement tick.
The tick result must not select the Godot-controlled `godot_player` or
`godot_smoke_*` fixture actors for autonomous agent proposals; those actors are
only allowed as explicit bridge action actors.
After the formal `gift` action, the smoke immediately reads the selected
target's `actorContext` again and verifies that the accepted gift is visible as
a linked recent action trace, a target -> viewer relationship increase, and a
short memory whose `sourceEventId` points at the gift `worldEvent`. This proves
social side effects are durable Convex facts, not temporary client text.
After the closed-loop assertions pass, the script calls the restricted
`godotTesting.cleanupGodotSmokeFixture` mutation to remove the temporary smoke
profile, smoke relationships, smoke memories, and smoke requests. It explicitly
preserves durable `worldEvents` and `actionRecords` so replay/debug readback
remains auditable.
If the backend reports resident updates, the test compares pre/post
`regionState.residents` signatures to prove the update is visible to Godot. The
tick response must also include post-tick `recentEvents` plus tick-specific
`tickEvents` with `worldEventId`, `bubbleText`, `displayText`, `bubbleKind`, and
`presentationSource`, so Godot can show immediate debug-world feedback before
the confirming `regionState` refresh lands. All Godot-facing presentation
payloads also include `durableSummary` and `presentationPolicy`, proving that
the rule-produced summary is locked separately from UI text or future LLM
polish. They also include structured `traceChain` data with source,
linkStatus, durable/tickOnly flags, actionRecord/worldEvent ids, and a display
label. `traceChain.steps` exposes the lifecycle sequence for Godot debug UI,
and the smoke asserts linked traces include actionRecord/worldEvent steps while
tick-only traces include an explicit tickOnly step. For each formal action
readback, the smoke also calls
`GET /godot/presentationPreview?mode=llm_polish` and verifies that the preview
uses the safe adapter, remains unapplied while no LLM adapter is configured,
keeps `durableSummary` equal to the action record summary, and exposes policy
flags, input snapshot, durable summary hash, allowed output fields, locked
fields, forbidden effects, enforced guardrails, and candidate validation that
forbid fact or durable-state changes. Tick events backed by an
`actionRecordId` are read back through `GET /godot/actionRecord` to prove the
event can be traced to Convex durable state. If a tick produces no durable
action, the bridge returns explicit `tickOnly` observations instead of faking a
world event. It also checks `GET /godot/replay` after a formal `talk` so the
selected target timeline can be rebuilt from Convex `worldEvents` joined to
`actionRecords`. The replay response also includes a Convex-sourced `summary`
with row counts, linked/event-only/tick-only counts, durable count, generated
timestamp, exact time-window span and label, source/link-status facets, action
type counts, result code counts, and top action/result/link/source fields for
the Godot trace header.
Before the valid `talk`, it sends an intentionally out-of-range `actorTile` and
expects the bridge to reject it. It snapshots both profiles before and after
that request, repeats the check with missing `actorTile`, and verifies no
durable location or intent changed. Cross-location smoke actions first submit a
formal `arrive`; the action response, action-record readback, and region event
must carry matching `effects.locationChange` data.

Useful overrides:

```bash
GODOT_BRIDGE_WORLD_ID=... GODOT_BRIDGE_TOKEN=... GODOT_BRIDGE_DEBUG_TOKEN=... node godot-taixu-client/tools/check_bridge.mjs
GODOT_BRIDGE_URL=http://127.0.0.1:3211 node godot-taixu-client/tools/check_bridge.mjs
GODOT_CONVEX_URL=http://127.0.0.1:3210 node godot-taixu-client/tools/check_bridge.mjs
GODOT_TARGET_ACTOR_ID=qinglan:qinglan-liu-qiaoer node godot-taixu-client/tools/check_bridge.mjs
GODOT_ACTION_INTENT="询问今日坊市传闻" node godot-taixu-client/tools/check_bridge.mjs
GODOT_TICK_LIMIT=1 node godot-taixu-client/tools/check_bridge.mjs
```

## Run The Agent/NPC Soak Check

```bash
GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-agent-soak
GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-agent-soak-long
```

This HTTP bridge check complements the one-shot smoke test. It runs several
bounded `/godot/tick` calls against the local Convex backend, waits between
ticks so Qinglan resident movement can advance, and asserts:

- autonomous ticks do not select `godot_player` or `godot_smoke_*` actors;
- each `tickEvents` row includes Godot presentation fields and `traceChain`;
- durable tick rows can be read back through `GET /godot/actionRecord`;
- non-durable observations remain explicitly marked `tickOnly`;
- refreshed `regionState.residents` still exposes route and schedule preview
  metadata after every tick, with internally consistent waypoint labels,
  destination locations, movement phases, ETA/progress labels,
  current/next/upcoming schedule stops, and route path tiles;
- durable tick actions can be rebuilt for several residents through
  `GET /godot/actorContext` and `GET /godot/replay`;
- actor context includes structured relationship dimensions and memory rows
  with source event ids when memories exist.
- every request, the full run, each response, and cumulative response bytes
  stay within explicit budgets;
- baseline/final actor-context memory ids produce an observable delta report,
  while relationship changes are counted only from durable structured
  `rules.effects.relationships` that match actionRecord readback.

The default command is the short daily profile. `godot:check-agent-soak-long`
runs 24 ticks, covers up to 12 resident contexts, and requires at least one new
memory id and one structured relationship effect. It remains debug-credential
only and fails instead of silently weakening those positive-delta gates.

Useful overrides:

```bash
GODOT_SOAK_TICKS=5 npm run godot:check-agent-soak
GODOT_SOAK_TICK_LIMIT=2 npm run godot:check-agent-soak
GODOT_SOAK_DELAY_MS=2500 npm run godot:check-agent-soak
GODOT_SOAK_CONTEXT_ACTORS=5 npm run godot:check-agent-soak
GODOT_SOAK_REQUEST_TIMEOUT_MS=60000 npm run godot:check-agent-soak
GODOT_SOAK_MAX_RUNTIME_MS=900000 npm run godot:check-agent-soak
GODOT_SOAK_MAX_RESPONSE_BYTES=2000000 npm run godot:check-agent-soak
GODOT_SOAK_MAX_TOTAL_RESPONSE_BYTES=64000000 npm run godot:check-agent-soak
GODOT_SOAK_REQUIRE_MEMORY_DELTA=1 npm run godot:check-agent-soak
GODOT_SOAK_REQUIRE_RELATIONSHIP_DELTA=1 npm run godot:check-agent-soak
```

## Run The Backend Presentation Contract Check

```bash
npm test -- convex/godotPresentation.test.ts convex/godotExchange.test.ts
```

This pure-function check complements the HTTP bridge smoke. It asserts that
`durableSummary` remains the exact rule-produced text, warning presentations
cannot unlock facts, settlement previews are derived from resolved
`rules.effects.items`, LLM polish preview exposes only display fields and
forbids durable writes, and `traceChain` labels linked action records,
event-only rows, action-record readback, and `tickOnly` observations
separately. The exchange test asserts that backend-owned gift/trade capability
options carry semantic submit params, quantity choices, exchange terms,
inventory deltas, confirmation preview policy, and `POST /godot/action`
submit-path metadata for Godot to display only.

## Run The Map/Navigation Contract Check

The usual local Godot/client check is:

```bash
npm run godot:check-contracts
```

That command runs the map/navigation file contract, the Godot runtime spatial
contract, action, resident-renderer, resident-inspector, trace formatter, and
Main scene UI/submit-path contracts, plus the headless startup check. Use the
individual commands below when debugging one layer. Each Godot subprocess uses
an isolated temporary log file so repeated checks cannot collide while
rotating `user://logs`. The Main contract also checks responsive sidebar
bounds, debug-control separation, long-label clipping/wrapping, and bundled CJK
font coverage without calling the live HTTP bridge.

```bash
node godot-taixu-client/tools/check_navigation_mask.mjs
```

This confirms the Godot client copy of `qinglanRegions.json` matches the
generated source file, the Godot client map PNG matches the generated source
PNG, the mask image metadata matches the PNG dimensions, the runtime map
contract is still `96 x 72` tiles at `32px` per tile, `Main.gd` and
`NavigationMask.gd` agree on the map/mask paths and world-tile size, and the
known audit watch points still classify as expected.

## Run The Godot Spatial Contract Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_spatial_contract.gd
```

This checks the runtime Godot spatial layer rather than the source files. It
loads `NavigationMask.gd`, verifies representative walkable/blocked/out-of-bounds
tiles, tile-to-cell mapping, segment blocking, and nearest-walkable snapping,
then instantiates `LocationProbe.gd` with representative Convex-shaped
locations to assert bounds, entry-point proximity, location change signals, and
location clear signals. It does not call Convex or mutate durable state.

## Run The Trace Formatter Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_trace_formatter.gd
```

This is a display-only Godot check. It instantiates `TraceFormatter.gd` with
representative replay/action/tick payloads and asserts that the trace panel text
shows replay facets, trace health for linked/event-only/action-only/tick-only
rows plus readback ok/pending/failed counts, actionRecord/worldEvent ids,
settlement previews, presentation source, bubble kind, locked policy flags,
readback status, polish preview status, and explicit tick-only lifecycle rows.
It does not call Convex or write durable world state.

## Run The Main Scene Contract Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_main_scene_contract.gd
```

This headless Godot check instantiates `scenes/Main.tscn`, feeds it
Convex-shaped region, capability, action, tick, and replay payloads, and
verifies the HUD/action menu wiring: selected-resident inspector visibility,
option selectors, hidden `arrive`, disabled-action reasons, stale capability
rejection, risky-action confirmation, stale confirmation cancellation,
semantic `ActionClient.submit_capability` submission, action/tick trace
rendering, stale replay rejection, and replay-driven trace panel rebuilds with
summary facets, trace health, linked actionRecord/worldEvent steps, and
event-only rows. It does not call Convex or mutate durable state.

## Run The Action Presentation Formatter Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_action_presentation_formatter.gd
```

This is another display-only Godot check. It instantiates
`ActionPresentationFormatter.gd` with representative Convex capability payloads
and asserts that trade, gift, request-teaching, spar, and breakthrough detail
and confirmation text display backend-provided `confirmationPreview`,
`inventoryDeltaPreview`, selected-option policy, quantity choices, exchange
terms, risk previews, disabled reasons, and `POST /godot/action` submit policy.
The selected-option text confirms quantity choice index/count, requested/max
quantity, total price, preview-only status, Convex ownership, Godot
display-only policy, and durable-state lock before submit. It does not submit
an action, call Convex, or derive inventory/risk facts in Godot.

## Run The Resident Renderer Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_resident_renderer.gd
```

This is a display-only Godot check for spatial resident overlays. It
instantiates `ResidentRenderer.gd` with representative Convex-shaped
`routePreview.pathTiles`, `routePreview.schedulePreview`, and
`routePreview.scheduleRoute` payloads and asserts that the renderer normalizes
route points and current/next/upcoming schedule markers into Godot world
positions. It also verifies the map presence label is derived from
Convex-owned activity, destination, ETA, and waypoint state, with a fallback to
resident intent. It does not call Convex, compute schedules, or mutate durable
world state.

## Run The Resident Inspector Formatter Check

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_resident_inspector_formatter.gd
```

This is a display-only Godot check for the selected-resident HUD. It
instantiates `ResidentInspectorFormatter.gd` with representative
Convex-shaped resident, route preview, schedule preview, schedule route,
profile, relationship, recent action, memory, and event payloads. It asserts
that the inspector renders backend-owned activity, intent, route, life-loop,
relationship, memory, and trace summary data without calling Convex or deriving
resident facts locally.

## Run Godot Headless Parse/Startup Check

After opening or importing the project once, this should start without script or
resource errors:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --quit-after 120
```

If the PNG map has not been imported yet, run:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --import \
  --quit
```

## Current Passing Baseline

- `GET /godot` advertises `POST /godot/action`.
- `GET /godot` advertises `POST /godot/capabilities`.
- `GET /godot/regionState?mapId=qinglan` returns Qinglan residents, locations,
  and recent events.
- `GET /godot/worldState`, `/godot/regionState`, and `/godot/replay` return
  exact-map rows plus explicit `limit`, `returned`, `isDone`, `truncated`, and
  `continueCursor` metadata. Godot validates that metadata and can request
  subsequent world, region, or replay pages without deriving state locally.
- `GET /godot/regionState?mapId=qinglan` includes resident presence metadata
  used by Godot rendering: `activityLabel`, `intent`, `waypointId`,
  `targetTile`, `finalTargetTile`, `nextActionAt`, `updatedAt`, and
  Convex-owned `routePreview` path data. `routePreview` also includes
  `remainingTiles`, `etaSeconds`, `etaLabel`, `nextStepLabel`,
  `nextStepDistanceTiles`, `pathStepCount`, `progressLabel`, `routeSummary`,
  `movementState`, and `schedulePreview` with phase, destination, intent,
  summary, and next-action timing. It also includes `scheduleRoute` with
  resident/role route source, route index/count, previous/current/next stops,
  upcoming stops, and a loop summary so Godot can show route progress and life
  loops without deriving schedule facts locally.
- Godot headless startup covers the selected-resident schedule inspector that
  reads those fields for activity/status, waypoint, next-action timing, and
  current -> target -> final route display. The inspector also reads
  `routePreview` to show waypoint label, route summary, route length, remaining
  distance, ETA label, path step count, source, movement state, next tile, and
  the Convex-owned life-loop preview.
- `GET /godot/actionRecord?actionRecordId=...` returns a compact lifecycle
  summary for smoke tests, including action type, actor, target/location,
  status, resultCode, and `settlementPreview` when the recorded rule result
  contains item transfer effects.
- `GET /godot/presentationPreview?actionRecordId=...&mode=llm_polish`
  returns a read-only safe polish preview for an existing action trace. The
  preview keeps the durable rule summary locked, exposes rule-template
  candidate text, reports `llm_not_configured` until a bounded adapter exists,
  exposes input/guardrail/validation metadata for future bounded LLM polish,
  accepts only preview-only `bubbleText` / `displayText` / `bubbleKind`
  candidate fields, rejects fact or durable-state fields, and never writes
  `worldEvents` or `actionRecords`.
- `GET /godot/actorContext?actorId=...` returns a compact read-only actor
  context for selected residents, including resident schedule, initialized
  profile, relationship dimensions to/from the viewer, recent events, recent
  action traces, and short memories. Recent action traces include actions where
  the selected actor was either the actor or target, plus `actionRecordId`,
  `worldEventId`, result code, and presentation fields.
- `GET /godot/replay?mapId=qinglan` returns a compact read-only replay
  timeline from Convex events and action records. Actor-filtered replay is used
  by Godot to rebuild the trace panel after selection changes or refreshes. It
  includes a `summary` block so Godot can show replay/debug counts,
  time-window labels, and top source/link-status facets without deriving
  lifecycle state locally.
- `POST /godot/arrive` remains available for legacy clients but adapts into the
  formal `arrive` action pipeline and returns `actionRecordId`, `resultCode`,
  `bubbleText`, `displayText`, `bubbleKind`, and `presentationSource`.
- `POST /godot/interact` remains available for legacy clients but adapts into
  the formal `talk` action pipeline and returns `actionRecordId`, `resultCode`,
  `bubbleText`, `displayText`, `bubbleKind`, and `presentationSource`.
- `POST /godot/capabilities` returns menu-ready target and location actions for
  the current actor context.
- `POST /godot/capabilities` enables nearby `talk`/`gift`, includes default
  `trade`/`gift` params, returns priced `trade.options` with buyer balance,
  seller stock, requested/offered quantities, exchange terms, quote details, and
  quantity choices, and inventory delta previews, includes `gift.options` with
  inventory delta previews, includes `request_teaching` rule gates and risk
  preview, includes `spar` risk preview, hides automatic `arrive`, disables
  out-of-range `talk`, and disables premature `breakthrough` with realm/XP
  details, a rule reason, and risk preview before action submission.
- `POST /godot/action` can submit a formal `talk` action.
- `POST /godot/action` can submit a formal `gift` action from a capability menu
  item.
- `POST /godot/action` can submit a formal `trade` action from a priced
  capability option, including a multi-quantity option whose total price and
  item transfer are adjudicated by Convex rules.
- `POST /godot/action` can submit a formal `spar` action where Qinglan zone
  permissions allow it.
- `POST /godot/action` can submit a formal `request_teaching` action with a
  qualified Qinglan elder.
- `POST /godot/action` can submit a formal `cultivate` action where Qinglan
  location permissions allow it.
- `POST /godot/action` can submit a formal `breakthrough` action where Qinglan
  location permissions and realm-gate cultivation rules allow it.
- `POST /godot/action` rejects an out-of-range `talk` action when `actorTile`
  exceeds the Godot interaction range.
- `POST /godot/action` can submit a formal `arrive` action.
- `POST /godot/action` can submit a formal `explore` action.
- `POST /godot/tick` can advance Qinglan residents and the xianxia agent loop
  in debug mode.
- `POST /godot/tick` returns post-tick `recentEvents` and tick-specific
  `tickEvents` with Convex presentation and trace fields, so Godot can render
  immediate NPC/world bubbles after a debug tick and inspect their
  `worldEventId` / `actionRecordId` when a durable event was produced. A
  no-action agent result is marked `tickOnly`. Presentation fields include
  locked `durableSummary` and policy flags forbidding fact or durable-state
  changes by presentation polish.
- `GET /godot/actionRecord?actionRecordId=...` links back to `worldEventId`,
  proving action records and Godot-visible world events are mutually traceable.
  The returned presentation includes `traceChain.linkStatus:
  "action_record_linked"` when both durable rows are present.
- A post-tick `regionState` read still includes the resident presence metadata,
  so Godot can keep drawing schedule labels and destination hints after world
  progression.
- The bridge smoke test verifies `actorContext` after a formal `talk`, proving
  the selected target profile, relationship/event readbacks, and viewer ->
  target action trace are visible to Godot.
- The bridge smoke test verifies `actorContext` again after a formal accepted
  `gift`, proving the target -> viewer relationship delta and the source-event
  memory row are readable through the Godot bridge.
- The bridge smoke test verifies actor-filtered `/godot/replay` after the same
  formal `talk`, proving the trace panel can be reconstructed from durable
  Convex rows rather than only immediate client memory. Replay action entries
  expose `traceChain.source: "replay_action"` and linked action/event ids.
- Godot exposes both a manual `Tick` button and an optional low-frequency
  `Auto Tick` toggle; the automated path skips cycles while the bridge is busy
  so player actions stay ahead of background simulation.
- The action returns `eventId`, `actionRecordId`, `actorIds`, `targetActorIds`,
  `locationId`, `resultCode`, `bubbleText`, `displayText`, `bubbleKind`, and
  `presentationSource` so Godot can anchor immediate scene bubbles and choose
  richer HUD/log text without changing durable facts. The same payload includes
  `durableSummary` and `presentationPolicy` so future LLM polish cannot rewrite
  rule facts. Exchange actions with item-transfer effects also include
  `settlementPreview` from the rule result, and Godot displays that in the
  action log/trace instead of deriving post-action inventory changes locally.
- A follow-up region read includes the new event with the same presentation
  fields.
- The Godot bridge client serializes outbound HTTP calls, coalesces queued
  capability reads, and ignores stale capability responses when player tile,
  selected target, or current location has changed.
- Godot routes risky menu actions through a confirmation step before submission.
  The panel covers `trade`, `gift`, `request_teaching`, `spar`, `steal`, and
  `breakthrough`; bridge smoke still submits these actions directly over HTTP
  to prove the backend action contract remains stable, while Godot headless
  startup imports the confirmation UI code. `trade` and `gift` confirmation
  panels display Convex-provided `inventoryDeltaPreview` instead of calculating
  before/after item deltas locally. Trade panels also display Convex-provided
  `exchangeTerms` and quantity/price fields. `request_teaching`, `spar`, and
  `breakthrough` detail/confirmation panels display Convex-provided
  `riskPreview` instead of owning the risk model locally.
- The Godot navigation mask copy matches `public/assets/qinglanRegions.json`.
- Godot 4.7 headless can import and start the new project, including the
  capability action menu and option selectors.

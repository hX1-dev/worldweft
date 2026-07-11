# Godot Taixu Client Implementation Plan

This plan describes how to run the existing system, then adapt it into the new
clean Godot client without dragging the old prototype complexity forward.

## Current Reality

The repository already contains a working but mixed prototype:

- Convex backend and xianxia world logic live in `convex/`.
- The xianxia rule system lives in `convex/xianxia/`.
- The existing Godot bridge prototype lives in `godot-zongmen-prototype/`.
- The Web/Pixi client still renders the inherited AI Town world and the Qinglan
  surface.
- `convex/http.ts` exposes Godot HTTP endpoints.
- `convex/godot.ts` adapts those HTTP requests into Convex queries/mutations.

The new `godot-taixu-client/` folder should become the clean Godot client. The
old prototype stays as reference, not as the main client.

## Target Architecture

```text
Godot Taixu Client
  - map, camera, input, collision, animation, selection
  - visualizes residents, locations, action results
  - submits semantic actions

Convex HTTP Bridge
  - exposes stable Godot-friendly endpoints
  - converts JSON requests into Convex queries/actions/mutations

Convex Xianxia World
  - owns durable state
  - owns actionRecords, worldEvents, relationships, memories, locations
  - resolves consequences through xianxia.gm.act / submitAction

Agent Layer
  - proposes NPC intent
  - never mutates state directly
```

## How To Run The Existing System

### 1. Start Convex backend

From the repository root:

```bash
npm run dev:backend
```

Expected local endpoints:

- Convex backend: `http://127.0.0.1:3210`
- Convex HTTP actions: `http://127.0.0.1:3211`

### 2. Ensure the world is seeded

If the world has not been initialized:

```bash
npx convex run init
npx convex run xianxia/seed:seedDemo
npx convex run xianxia/qinglan:seedQinglanFangshi
```

Use destructive reset only when intentionally starting over:

```bash
npx convex run testing:wipeAllTables
npx convex run init
npx convex run xianxia/seed:seedDemo
npx convex run xianxia/qinglan:seedQinglanFangshi
```

### 3. Check the Godot bridge health

```bash
curl http://127.0.0.1:3211/godot
```

Expected shape:

```json
{
  "ok": true,
  "service": "xianxia-godot-convex-bridge",
    "routes": {
      "worldState": "/godot/worldState?mapId=qinglan",
      "regionState": "/godot/regionState?mapId=qinglan",
      "capabilities": "POST /godot/capabilities",
      "action": "POST /godot/action",
      "tick": "POST /godot/tick",
      "arrive": "POST /godot/arrive",
      "interact": "POST /godot/interact"
    }
}
```

### 4. Pull world state

```bash
curl "http://127.0.0.1:3211/godot/worldState?mapId=qinglan"
curl "http://127.0.0.1:3211/godot/regionState?mapId=qinglan"
```

These should return:

- `worldId`
- map metadata
- `actors.residents`
- `locations`
- recent `worldEvents`

### 5. Run the old Godot proof prototype

Open this folder in Godot:

```text
godot-zongmen-prototype/
```

Run its main scene. It can:

- Pull world state.
- Pull region state.
- Draw Convex residents on the Qinglan map.
- Post simple `arrive` and `interact` events.

This confirms connectivity, but it is not the final client.

## Why We Are Not Continuing In The Old Prototype

`godot-zongmen-prototype/` is useful proof, but it mixes too many early ideas:

- local wandering actor logic
- temporary drawing code
- one-file HTTP bridge
- debug HUD
- transitional `interact` events
- map proof assets

The new client should start clean so we can separate systems properly.

## Phase 0: Bridge Contract Audit

Status: implemented for the first formal loop.

Goal: freeze the first stable bridge contract before building Godot UI.

Tasks:

1. Document current response shapes from:
   - `/godot/worldState`
   - `/godot/regionState`
   - `/godot/arrive`
   - `/godot/interact`

2. Decide which endpoints are transitional.
   - Keep: `worldState`
   - Keep: `regionState`
   - Legacy compatibility: `arrive`
   - Legacy compatibility: `interact`

3. Design the first formal action endpoint.

Proposed endpoint:

```text
POST /godot/action
```

Proposed payload:

```json
{
  "worldId": "...",
  "actorId": "godot_player",
  "type": "talk",
  "targetActorId": "qinglan:qinglan-medicine-keeper",
  "mapId": "qinglan",
  "locationId": "market_medicine_shop",
  "intent": "打个招呼，询问今日灵药行情",
  "params": {}
}
```

Expected behavior:

- HTTP route calls a Convex action.
- Convex action calls `xianxia.gm.act`.
- `xianxia.gm.act` routes into `submitAction`.
- Result writes `actionRecords`, `worldEvents`, memories, and relationship
  changes.
- HTTP returns the structured action result.

4. Add a backend-informed capability endpoint.

Endpoint:

```text
POST /godot/capabilities
```

Payload includes `actorId`, optional `targetActorId`, optional `locationId`,
`actorTile`, and `interactionRangeTiles`. The response returns an `actions`
array with menu-ready capability objects for target actions such as `talk`,
`trade`, `gift`, `request_teaching`, and `spar`, plus location actions such as
`arrive`, `explore`, `cultivate`, and `breakthrough`:

```json
{
  "type": "talk",
  "label": "Talk",
  "enabled": true,
  "reason": null,
  "category": "target",
  "intent": "打个招呼，询问今日坊市见闻",
  "params": {},
  "options": [],
  "visible": true,
  "distanceTiles": 1.2,
  "rangeTiles": 5
}
```

`trade` and `gift` capabilities may include `options`; Godot renders those as
option selectors next to the action button and submits the selected option's
`params`. The trade detail and confirmation panels show selected inventory,
quote breakdown, and relationship/suspicion price modifiers. The same
confirmation shell is also used for risky actions such as `gift`, `spar`,
`request_teaching`, and `breakthrough`, while Convex remains the only authority
that adjudicates durable consequences.

Godot still performs local collision/range feedback, but the final UI action
availability should reflect Convex location rules and bridge validation.

## Phase 1: New Godot Project Skeleton

Status: implemented in this folder.

Goal: create a small Godot project in this folder.

Files:

```text
godot-taixu-client/
  project.godot
  scenes/Main.tscn
  scripts/ConvexBridge.gd
  scripts/WorldStateStore.gd
  scripts/ResidentRenderer.gd
  scripts/ActionClient.gd
  scripts/PlayerController.gd
  scripts/InteractionProbe.gd
  scripts/NavigationMask.gd
  scripts/LocationProbe.gd
  tools/check_bridge.mjs
  tools/check_godot_contracts.mjs
  tools/check_navigation_mask.mjs
  tools/check_action_presentation_formatter.gd
  tools/check_resident_renderer.gd
  tools/check_resident_inspector_formatter.gd
  tools/check_spatial_contract.gd
  tools/check_trace_formatter.gd
  tools/check_main_scene_contract.gd
  ../convex/godotExchange.test.ts
  ../convex/godotPresentation.test.ts
  assets/README.md
  assets/qinglan-reference-town-footprint-no-bamboo-v1.png
  assets/qinglanRegions.json
```

Responsibilities:

- `ConvexBridge.gd`
  - Owns base URL.
  - Owns HTTPRequest node.
  - Provides `get_world_state`, `get_region_state`, `post_capabilities`,
    `post_action`, and `post_tick`.

- `WorldStateStore.gd`
  - Stores latest worldId, residents, locations, recent events.
  - Emits signals when state changes.

- `ResidentRenderer.gd`
  - Creates resident nodes from Convex residents.
  - Updates position/status/labels.

- `ActionClient.gd`
  - Builds semantic action payloads.
  - Calls `ConvexBridge.post_action`.
  - Can submit any capability menu item with default `intent` and `params`.
  - Emits result signal.

- `PlayerController.gd`
  - Handles local movement and camera target.
  - Later becomes collision-aware.

- `InteractionProbe.gd`
  - Detects selected resident/location.
  - Offers local selection state; Convex capabilities provide backend action
    availability.

- `NavigationMask.gd`
  - Loads the generated Qinglan mask JSON.
  - Maps Godot tile coordinates into source-image mask cells.
  - Blocks movement through `collision`, `occlusion`, `water`, or
    unclassified cells.
  - Keeps the runtime map contract aligned with `Main.gd`: Qinglan currently
    runs as `96 x 72` Godot tiles at `32px` per tile, backed by a
    `1448 x 1086` source PNG and an 8-source-pixels-per-cell mask.

- `LocationProbe.gd`
  - Detects when the player enters/leaves nearby Convex locations.
  - Emits location changes without mutating durable state directly.

## Phase 2: Read-Only Qinglan Viewer

Status: implemented as a minimal debug viewer.

Goal: new Godot client can pull and display Convex state.

Acceptance criteria:

- Main scene opens without the old prototype.
- Client can call `GET /godot/regionState?mapId=qinglan`.
- Residents render at Convex tile positions.
- Locations render as markers.
- Recent events show in a small debug panel.
- Refresh button updates the view.

No action submission yet.

## Phase 3: Formal Action Submission

Status: implemented for `talk`/`gift`/`trade`/`spar`/`request_teaching` against
Qinglan residents and `arrive`/`explore`/`cultivate`/`breakthrough` against
Qinglan locations. Godot now sends `actorTile`; the bridge validates target
range and location proximity before submitting the formal action. Godot also
asks `POST /godot/capabilities` so the action menu reflects backend action
availability before submission.

Goal: Godot submits real xianxia actions.

Backend changes:

- Add `POST /godot/action` in `convex/http.ts`.
- Add `POST /godot/capabilities` in `convex/http.ts`.
- Add `GET /godot/actionRecord?actionRecordId=...` as a debug/test readback
  route so smoke tests can prove action lifecycle rows were written.
- Add `GET /godot/actorContext?actorId=...` as a read-only observation route so
  Godot can inspect a selected resident's profile, relationships, recent
  actions/events, and short memories without mutating state.
- Add `action` wrapper in `convex/godot.ts`, or call `api.xianxia.gm.act`
  from the HTTP action.
- Add a `capabilities` query in `convex/godot.ts` that shares spatial and
  location-rule assumptions with action preparation.

Godot changes:

- Select a resident.
- Click `Talk`.
- Submit a `talk` action.
- Include `actorTile` and `interactionRangeTiles` for target actions.
- Enter a snapped location entry point.
- Submit an `arrive` action.
- Submit an `explore` action from the current location.
- Submit a `cultivate` action from a Qinglan location that allows short
  meditation.
- Submit a `request_teaching` action from a qualified Qinglan elder.
- Submit a `breakthrough` action from a Qinglan location when the actor is at a
  realm gate with enough cultivation.
- Render capability-driven action buttons from Convex, including `Talk`, `Gift`,
  `Trade`, `Spar`, `Request Teaching`, and `Breakthrough` where the current
  location allows it.
- Show the selected `trade` option with price, buyer balance, seller stock, and
  quote multiplier details supplied by Convex. Trade options may include
  quantity-aware `requestedQty`/`offeredQty`, total/unit prices, and
  `exchangeTerms`, but still submit the same formal `trade` action.
- Show the selected `gift` option with item and quantity details supplied by
  Convex.
- Show `request_teaching` and `breakthrough` rule gates from Convex
  capabilities, including realm, relationship, reputation, XP threshold, and
  disabled reasons.
- Show Convex-sourced `riskPreview` for risky rule actions, including
  `request_teaching`, `spar`, and `breakthrough`, so Godot confirmation UI
  renders rule-template risk information without owning the risk model.
- Require confirmation for risky menu actions before submission: `trade`,
  `gift`, `request_teaching`, `spar`, and `breakthrough`.
- Enable/disable menu actions from Convex capabilities plus local range/location
  state.
- Display returned result.
- Refresh recent events.

Acceptance criteria:

- `worldEvents` includes the action result.
- `actionRecords` includes the lifecycle row.
- Out-of-range Godot target actions are rejected before rule submission.
- If action affects relationships or memories, those changes are visible from
  Godot-facing read APIs. The bridge smoke now verifies an accepted `gift`
  writes a target -> viewer relationship delta and a source-event short memory
  readable through `GET /godot/actorContext`.
- Godot never writes durable facts directly.

## Phase 4: Local Movement And Arrive

Status: implemented and hardened for the current Qinglan system loop. The
navigation/mask/spatial contracts, formal `arrive`, and exact two-size live UI
gate pass. Richer movement feel and authored collision polish now belong to
ongoing map/content production rather than this backend hardening gate.

Current completed slice:

- `NavigationMask.gd` reads `assets/qinglanRegions.json`.
- `PlayerController.gd` samples the mask before moving and slides along blocked
  cells.
- `LocationProbe.gd` detects nearby snapped Convex entry points.
- `ActionClient.gd` submits formal `arrive` through `POST /godot/action`.
- `ActionClient.gd` submits formal `explore` through `POST /godot/action`.
- `ConvexBridge.gd` requests `POST /godot/capabilities`.
- `Main.gd` renders a backend-driven action menu from capabilities, including
  option selectors for `trade`/`gift` entries and a trade detail panel sourced
  from Convex option data.
- `Main.gd` routes risky actions through a confirmation panel before action
  submission. `trade` shows price/balance/stock/quote data; `gift` shows item
  and quantity; `request_teaching`, `spar`, and `breakthrough` show rule gates
  or risk notes. The panel rechecks selected target/location context before
  calling `POST /godot/action`. Display-only action detail and confirmation
  copy now lives in `ActionPresentationFormatter.gd`, keeping `Main.gd` focused
  on context validation and the single semantic submit path.
- `trade` and `gift` capability options include Convex-sourced
  `inventoryDeltaPreview` before/after item deltas, and Godot displays those in
  the detail and confirmation panels instead of deriving inventory facts
  locally. They also include Convex-sourced `confirmationPreview` display lines,
  durable effect notes, and a display-only policy, so Godot can show exchange
  confirmation copy without owning the confirmation facts or creating another
  submit path. The Godot formatter also renders a selected-option summary for
  quantity choice index/count, requested/max quantity, total price,
  preview-only status, Convex ownership, Godot display-only policy, and
  durable-state lock before submit. `convex/godotExchange.test.ts` covers the
  backend source of those option params, quantity choices, exchange terms,
  inventory deltas, confirmation preview policy, and submit-path metadata.
  `tools/check_action_presentation_formatter.gd` exercises those display-only
  formatter paths headlessly with representative Convex capability payloads.
- Resolved exchange actions return Convex-sourced `settlementPreview` when rule
  effects contain item transfers. Action responses, region events,
  actionRecord/replay readbacks, and the Godot trace UI all read the same
  `rules.effects.items` source, so post-action inventory settlement remains a
  display-only projection of Convex adjudication.
- Exchange capability option construction now lives in `convex/godotExchange.ts`
  instead of the main Godot bridge module, keeping trade/gift previews,
  quantity terms, inventory deltas, and confirmation copy isolated from
  endpoint/query orchestration.
- `trade` capability options now include quantity-aware Convex terms:
  `requestedQty`, `offeredQty`, total/unit prices, `exchangeTerms`, and matching
  inventory deltas. Each option also includes backend `quantityChoices` for the
  same item, so Godot displays available quantity/price selections without
  deriving prices locally and still submits the selected option through the
  same `POST /godot/action` semantic `trade` path.
- `request_teaching`, `spar`, and `breakthrough` capabilities include
  Convex-sourced `riskPreview` with level, summary, rule gates, possible result
  codes, durable effect notes, and `presentationSource: "rule_template"`.
  Godot detail and confirmation panels display that preview as backend-owned
  rule information.
- `Main.gd` renders gift, spar, request-teaching, and breakthrough detail lines
  from Convex capability metadata where available.
- `ConvexBridge.gd` serializes outbound HTTP requests so player actions, region
  refreshes, debug ticks, and capability reads are not dropped while another
  request is active. Queued capability reads are coalesced, and `Main.gd`
  ignores stale capability responses whose target, location, or actor tile no
  longer matches the current Godot context.
- `tools/check_navigation_mask.mjs` verifies the Godot map PNG/mask contract,
  public/client asset hashes, mask image metadata, `Main.gd`/`NavigationMask.gd`
  world-tile consistency, and key watch points.
- `tools/check_spatial_contract.gd` verifies Godot runtime navigation/location
  behavior headlessly: representative walkable and blocked tiles, tile-to-cell
  mapping, segment blocking, nearest-walkable snapping, and `LocationProbe.gd`
  bounds/entry/clear signals using Convex-shaped location payloads.
- `tools/check_godot_contracts.mjs` runs the local Godot/client contract suite:
  map/mask file contract, runtime spatial contract, action formatter contract,
  resident renderer route-overlay contract, resident inspector formatter
  contract, trace formatter contract, Main scene UI/submit-path contract, and
  Godot headless startup. It does not call the Convex bridge or write durable
  world state.
- `tools/check_bridge.mjs` verifies capabilities plus formal `talk`, `gift`,
  `trade`, `spar`, `request_teaching`, `cultivate`, `breakthrough`, `arrive`,
  and `explore` read/write loops, including direct `actionRecords` readback
  for each submitted action. It also verifies an accepted `gift` produces
  relationship and memory readback through `actorContext`.

Goal: Godot movement becomes meaningful to Convex.

Tasks:

- Add local player movement on Qinglan map.
- Add map bounds.
- Add simple collision from Qinglan mask or collision volume data.
- Detect when player enters a location bound/entry point.
- Submit `arrive` or formal `travel/arrive` action.

Design note:

Godot should own collision feel, but Convex should own semantic location. The
client can say "the player reached tile X,Y"; Convex maps that to a location and
records the event.

## Phase 5: Microverse-Inspired Presence

Status: implemented and hardened for the current system loop. The presence
slices render Convex events as short
resident/location bubbles when `targetActorIds`, `actorIds`, or `locationId`
match visible entities. Recent `regionState` events maintain bubbles after
refresh, while `/godot/action` responses now create immediate outcome bubbles
before the refresh arrives. Convex also supplies `bubbleText`, `displayText`,
`bubbleKind`, and `presentationSource` so Godot can distinguish dialogue,
reactions, narration, and warnings without inventing facts. Durable event
`summary` remains rule-produced; Godot-facing presentation also includes
`durableSummary` and `presentationPolicy` so the presentation layer can evolve
toward LLM polish later without changing action adjudication or durable state.
The bridge now has a read-only polish preview seam at
`GET /godot/presentationPreview?actionRecordId=...&mode=llm_polish`: it joins an
existing `actionRecord` to its durable event, returns the same locked
`durableSummary`, rule-template candidate display text, and a safe
`godot_safe_polish_v1` preview status (`llm_not_configured` until a bounded
adapter exists), plus input snapshot, durable summary hash, allowed output
fields, locked fields, forbidden durable effects, enforced guardrails, and
candidate validation. Candidate validation accepts only preview-only
`bubbleText`, `displayText`, and `bubbleKind`; fact, id, effect, summary, or
durable-state fields are rejected and fall back to rule-template display text.
It writes no durable state. Godot requests this after actionRecord readback and
shows the preview status/guardrail count in the trace panel without creating
another action path.
Resident positions
interpolate toward fresh Convex tiles
instead of teleporting on refresh, and event bubbles expire locally. The bridge
now also exposes resident schedule metadata (`activityLabel`, `waypointId`,
`targetTile`, `finalTargetTile`, `nextActionAt`, `updatedAt`) so Godot can draw
short activity labels and destination guide lines from backend-owned movement
intent. Selecting a resident also opens a compact schedule inspector in the HUD
that shows activity/status, location, waypoint, intent, next-action timing, and
current -> target -> final route tiles without writing any durable state. The
same selected-resident panel now fetches read-only actor context from Convex:
profile, bidirectional relationship dimensions, recent action records, recent
world events, and short memories. Recent actions are now replay/debug traces:
actions where the selected actor was either actor or target include linked
`actionRecordId`, `worldEventId`, result code, presentation fields, and
structured `traceChain` link metadata. The inspector display formatting now
lives in `ResidentInspectorFormatter.gd`, with
`tools/check_resident_inspector_formatter.gd` covering representative resident,
route, schedule, relationship, memory, event, and recent-action payloads. The
bridge also returns Convex-owned `routePreview` data for each resident and the
selected actor context, including waypoint label, next tile, path tiles, route
length, remaining tiles, ETA seconds, ETA label, next-step label, next-step
distance, path step count, route/progress summary, movement state, source,
connectivity, and `schedulePreview` with phase, destination, intent, summary,
and next-action timing. It also returns `scheduleRoute`, a Convex-owned
resident/role life-loop preview with route source, previous/current/next stops,
upcoming stops, and loop summary, so Godot can render route hints without
deriving schedule facts locally.

Goal: borrow the useful product feel from Microverse.

Features:

- NPC status labels.
- Short intent labels.
- Backend activity labels and destination hints from resident schedules.
- Map-level resident presence labels derived from Convex `schedulePreview`
  activity, destination, ETA, and waypoint state, with intent fallback when no
  schedule is present.
- Convex-owned route preview path tiles, waypoint labels, and route lengths.
- Convex-owned route progress metadata: remaining tiles, ETA labels,
  next-step labels/distances, path step counts, progress labels, route
  summaries, and movement state.
- Convex-owned schedule preview metadata: phase, destination, intent, summary,
  and next-action timing.
- Convex-owned resident life-loop preview metadata: resident/role route source,
  previous/current/next stops, upcoming stops, route index/count, and loop
  summary.
- Selected-resident schedule inspector for debugging Convex-owned NPC plans.
- Selected-resident actor context inspector for profile, relationship, event,
  action, and memory readback.
- Dialogue/reaction bubbles. Recent events and immediate action outcomes share
  the same bubble renderer and Convex presentation metadata.
- Nearby interaction range.
- Residents move between life spots. First Godot slice interpolates fresh
  `regionState` resident tiles and draws current/final movement targets from
  Convex schedule fields.
- Optional camera follow.

Keep the authority model different:

- Microverse-style presence in Godot.
- Convex-backed state and consequence.
- No Godot-side LLM decisions.

## Phase 6: Agent Loop Integration

Status: implemented and hardened for the current system loop. Godot has a
bounded debug `Tick` button and an optional
low-frequency `Auto Tick` toggle backed by `POST /godot/tick`, which calls
`xianxia.qinglan.tickQinglanResidents`, `xianxia.agent.runAgentTick`, and
refreshes `regionState`. The tick response now also returns post-tick
`recentEvents` and tick-specific `tickEvents` with the same presentation fields
as `regionState`, allowing Godot to show immediate debug-world bubbles before
the confirming refresh. Godot-facing events expose `worldEventId`,
`actionRecordId`, `resultCode`, `displayText`, `presentationSource`, and
`presentationVersion` when available, plus locked `durableSummary` and policy
flags forbidding presentation/LLM polish from changing facts or durable state.
The agent tick excludes Godot-controlled player actors and `godot_smoke_*`
fixture profiles from autonomous selection, and smoke fixtures are also omitted
from normal NPC nearby-person context, so repeated bridge smoke runs do not
become long-lived LLM actors in the world. Agent decision context also filters
short memories that involve `godot_smoke_*`, while the durable event/action
records remain in Convex for trace/debug readback. Those actors can still
submit explicit semantic actions through the bridge and Convex rules. The
bridge smoke also runs a restricted fixture cleanup that removes temporary
smoke profiles, smoke relationships, smoke memories, and smoke requests after a
successful closed-loop run without deleting durable `worldEvents` or
`actionRecords`.
If a tick advances agents but no durable action/event is produced, the bridge
returns explicit `tickOnly` observations instead of pretending a world event
exists. The Godot HUD also keeps a compact trace panel for the latest
action/tick rows and confirms action-backed rows via `GET /godot/actionRecord`.
Action responses, tick events, replay entries, region events, and actionRecord
readbacks now share `traceChain`, so Godot can display link status and durable
vs tick-only semantics without inferring lifecycle state locally. `traceChain`
also includes `steps`, a display-ready lifecycle sequence for action/tick,
actionRecord, worldEvent, replay, and tickOnly nodes.
The selected-resident inspector uses the same
trace-shaped actor context, so replay/debug evidence is visible even when
inspecting an NPC after the immediate bubble has faded. Godot can now also
request `GET /godot/replay` to rebuild the trace panel from Convex
`worldEvents` joined to `actionRecords`, keeping replay/debug views read-only
and authoritative. Replay responses also include a Convex-sourced `summary`
with row counts, linked/event-only/tick-only counts, durable count, generated
timestamp, exact time-window span and label, source/link-status facets, action
type counts, result code counts, and top action/result/link/source fields;
Godot uses that to render the trace header and replay facet line without
deriving lifecycle statistics locally. It now also renders a display-only trace
health line with linked/event-only/action-only/tick-only counts and
readback-ok/pending/failed counts, so testers can spot link gaps without
opening Convex. Each row also shows display-only ids, presentation source,
bubble kind, locked presentation policy, readback status, and polish-preview
status so a tester can follow action/tick -> actionRecord -> worldEvent without
opening Convex. The Godot trace text formatter now lives in
`TraceFormatter.gd`, so `Main.gd` keeps bridge state/readback orchestration
separate from presentation-only trace formatting. `tools/check_trace_formatter.gd`
now exercises the formatter headlessly with representative replay facets,
linked action records, world events, settlement previews, policy locks, polish
preview status, pending readback, event-only rows, and tick-only observations.
`tools/check_main_scene_contract.gd` instantiates the real Main scene with
Convex-shaped fake payloads and checks HUD/action-menu wiring, option
selectors, hidden legacy actions, stale capability filtering, risky-action
confirmation, stale confirmation cancellation, semantic submit routing, and
action/tick trace rendering without calling Convex. It also feeds stale and
current replay payloads through the Main scene, proving stale replay responses
are ignored and current `/godot/replay` responses rebuild the trace panel with
Convex summary facets, trace health, linked actionRecord/worldEvent lifecycle
steps, and event-only gap rows.
`tools/check_agent_soak.mjs` adds a bounded multi-tick system check: it runs
repeated `/godot/tick` calls, verifies Godot-controlled actors are not chosen
for autonomous proposals, reads back durable tick action records, keeps
tick-only observations explicit, checks resident route previews after each
refresh, asserts route/schedule internal consistency across waypoint labels,
destination locations, movement phases, ETA/progress labels,
current/next/upcoming stops, stop offsets, and path tiles, and proves durable
tick traces can be rebuilt for multiple residents through `actorContext` and
`replay`, including relationship and memory readback shapes.

Goal: make the world feel alive while Godot observes.

Tasks:

- Use existing `xianxia.agent.runAgentTick` for world progression.
- Keep auto tick optional.
- Allow Godot to request a local tick in debug mode only. First slice is
  implemented with limit clamping and Qinglan resident movement. The optional
  auto tick uses a small limit and skips a cycle when the bridge is busy rather
  than queuing simulation updates behind player actions.
- Render changes after each tick. First slice refreshes `regionState` after
  tick completion and immediately renders tick response `tickEvents` through the
  shared bubble renderer, falling back to the recent-event window when no
  tick-specific event is available.

Acceptance criteria:

- NPC actions produce event logs.
- Godot refresh shows new statuses/events and smooths resident tile changes.
- Godot receives post-tick `tickEvents` with `worldEventId`,
  `actionRecordId`, `bubbleText`, `displayText`, `bubbleKind`, and
  `presentationSource` when durable events exist, or `tickOnly` presentation
  records when agents intentionally skip. It can display NPC/world feedback
  immediately after a debug tick either way.
- Player action responses show immediate bubbles anchored to actor, target, or
  location ids returned by the bridge.
- Player actions and NPC actions share the same event/action system.

## Phase 7: Replace Transitional Endpoints

Status: implemented as compatibility adapters.

Goal: retire prototype-only bridge behavior.

Actions:

- Keep `/godot/worldState`.
- Keep `/godot/regionState`.
- Use `/godot/action` from the new Godot Taixu client.
- Keep `/godot/arrive` only as a legacy adapter for old prototype clients; it
  now prepares and submits a formal `arrive` action through `xianxia.gm.act`.
- Keep `/godot/interact` only as a legacy adapter for old prototype clients; it
  now prepares and submits a formal `talk` action through `xianxia.gm.act`.
- Remove the old public `api.godot.arrive` and `api.godot.interact` mutations so
  there is no direct worldEvent-only bypass in the Convex API surface.
- Return the same action anchors and presentation fields as `/godot/action`,
  including `actionRecordId`, `resultCode`, `bubbleText`, `displayText`,
  `bubbleKind`, and `presentationSource`.

The bridge should be boring, stable, and explicit.

## System Hardening Track

Status: technically complete and blocked only on the real Git release baseline.
H1-H5 and the Phase 4-6/H7 system work are verified; H6/H8 cannot be called
closed until the repository owner explicitly versions the coherent release
unit.

The ordered backlog, risk evidence, negative tests, and completion gates live
in `HARDENING_PLAN.md`. Its current sequence is:

1. Eliminate pre-rule durable profile/location writes. Verified 2026-07-10.
2. Add identity binding, authorization, and production/debug protection.
   Verified 2026-07-10.
3. Add action idempotency and Godot duplicate-submit protection. Verified
   2026-07-10.
4. Make the HTTP/Convex contract strict, versioned, and explicit about errors.
   Verified 2026-07-10.
5. Prove multi-map isolation and bounded query behavior. Verified 2026-07-10.
6. Restore focused quality gates, client/bridge release reproducibility, and
   maintainable module boundaries. Technical gates verified; real Git baseline
   blocked on explicit repository-owner authorization.
7. Finish the movement, presence, agent-loop, long-soak, and real-window UX
   hardening already listed under Phases 4-6. Verified 2026-07-10.
8. Run the final production-readiness audit. Technical evidence verified;
   final release-source status shares the item 6 authorization block.

Each item must pass focused negative tests plus the existing bridge smoke,
agent soak, Godot contract suite, and static checks before the next item becomes
active. Map art/content may be authored in parallel, but it does not substitute
for these system gates.

## Immediate Next Step

Use this folder as the new baseline after Phase 7. The current verified loop is:
Godot reads Convex, submits semantic actions, receives action/event
presentation, advances a bounded debug tick, and confirms the result through
read-after-write bridge checks.

Next work follows `HARDENING_PLAN.md` and strengthens that loop rather than
broadening the game surface:

The only hardening action still requiring input is repository-owner approval
to version the 161-file release unit. Until then, keep the gates below green;
map/content work may continue independently but does not turn the red real-Git
release gate green.

1. Keep `node godot-taixu-client/tools/check_bridge.mjs` passing after each
   backend bridge change.
   Keep `npm test -- convex/godotPresentation.test.ts` passing after
   presentation, trace, polish-preview, or settlement-preview changes.
   Keep `npm test -- convex/godotExchange.test.ts` passing after gift/trade
   capability option, inventory-delta, quantity-choice, or confirmation-preview
   changes.
2. Keep `npm run godot:check-contracts` passing after each Godot/client,
   GDScript, resource, map, or display formatter change.
3. Keep `npm run godot:check-agent-soak` passing after agent tick, Qinglan
   resident movement, actorContext, replay, trace, or tick presentation changes.
4. Keep Godot headless startup passing after each GDScript/resource change.
   When navigation, movement, or location-probe code changes, also run
   `res://tools/check_spatial_contract.gd`.
   When action detail/confirmation display code changes, also run
   `res://tools/check_action_presentation_formatter.gd`. When resident
   spatial overlay code changes, also run
   `res://tools/check_resident_renderer.gd`. When selected-resident
   inspector display code changes, also run
   `res://tools/check_resident_inspector_formatter.gd`. When trace/debug
   display code changes, also run the headless
   `res://tools/check_trace_formatter.gd` formatter check. When `Main.gd`,
   action-menu wiring, confirmation behavior, stale capability filtering, or
   trace orchestration changes, also run
   `res://tools/check_main_scene_contract.gd`.
5. Preserve `POST /godot/tick` as a debug/observer bridge. Keep response events
   anchored, presentable, and traceable back to Convex `worldEvents` /
   `actionRecords`; next refinements should add richer replay/debug views, not a
   second event path. The first read-only replay route is now `/godot/replay`,
   and the shared `traceChain` contract exposes link status for live and replay
   rows. Replay responses also include a Convex-owned summary for trace header
   counts, time-window labels, top source/link-status context, and displayed
   action/result/link/source facets.
5. Refine confirmation UX for multi-item exchange terms without creating a
   second action path. Inventory delta previews for `gift`/`trade` and risk
   previews for `request_teaching`/`spar`/`breakthrough` now come from Convex
   capabilities. Exchange `confirmationPreview` text/policy and the first
   quantity-aware trade terms are now backend-sourced and verified by the bridge
   smoke. Submitted exchange actions also expose `settlementPreview` from
   Convex rule effects so Godot can display resolved item transfers without
   deriving facts locally.
6. Add richer generated dialogue text for action outcomes by replacing or
   augmenting the presentation layer, while keeping durable consequences
   deterministic and rule-adjudicated. The current presentation contract already
   exposes locked `durableSummary` and policy flags for this.
7. Enrich NPC schedules and route previews, then verify the Godot inspector,
   labels, and destination hints still match Convex-owned resident state.
8. Keep bridge requests serialized and capability menus tied to the current
   selection/location/tile context as more UI flows are added.

Do not add combat, inventory-heavy workflows, or large art assets until action
submission, tick progression, presentation, and readback share the same verified
loop.

## Definition Of Good Architecture

The architecture is good when:

- A Godot click becomes a semantic action, not a handwritten story event.
- Every durable outcome is visible in Convex tables.
- The same action path works for human, NPC, and Godot-originated actions.
- Godot can be replaced without losing world state.
- Convex can be inspected without opening Godot.
- LLM failures do not corrupt the world.
- The client can stay visually rich while the backend stays authoritative.

# Godot Taixu Client

This folder is the clean starting point for the formal Godot + Convex client.

The current functional loop is now in system hardening. See
`HARDENING_PLAN.md` for the authoritative order, evidence, and completion gates.
The immediate priority is production safety and maintainability across the
backend/client contract; map art and content can progress independently but are
not the only remaining work.

Current hardening state: H1 durable-state integrity, H2 bridge identity and
authorization, H3 action idempotency, H4 strict versioned contracts, and H5
multi-map isolation/bounded query behavior are verified. H6 technical quality
and clean-snapshot gates are green; its real Git release baseline awaits
explicit repository-owner authorization. H7 long-running agent/presence,
durable schema, and exact two-size windowed client hardening are verified. H8
technical evidence is green and is blocked only on deliberately versioning the
161-file release unit in the real repository.

The old workspace already proves that Godot can talk to Convex, but it contains
AI Town legacy code, Web/Pixi rendering, Qinglan map tooling, temporary assets,
and several experiments mixed together. This folder should stay small and
purposeful: one Godot client, one Convex bridge contract, and one clear path
toward a playable xianxia living-world prototype.

## Why This Exists

We want the architecture to be stable before adding more game features.

The intended split is:

- Godot owns the body of the world: map rendering, camera, input, collision,
  movement, range checks, selection, animation, and local visual feedback.
- Convex owns the truth of the world: persistent state, locations, residents,
  events, action records, relationships, memories, quests, and time.
- The agent layer owns intent: NPC planning, LLM proposals, dialogue text, and
  inner reasoning, but it must submit actions through Convex rules.
- The rule layer owns consequences: success, failure, refusal, reputation,
  relationship changes, memory creation, and event logs.

In short:

```text
Godot = world body
Convex = world ledger
Agent/LLM = character mind
Rules/GM = consequence engine
```

## What We Are Building First

The first milestone is a formal minimal loop:

```text
Godot pulls world state from Convex
Godot renders Qinglan residents and locations
Godot lets the player click a resident or location
Godot submits a structured action to Convex
Convex resolves the action through xianxia rules
Convex writes actionRecords, worldEvents, memories, and relationship changes
Godot refreshes and displays the result
```

This is intentionally narrower than a full game. The goal is to prove that the
architecture is clean.

## Initial Scope

1. Pull state
   - `GET /godot/worldState`
   - `GET /godot/regionState`
   - `POST /godot/capabilities`

2. Render state
   - Qinglan map background.
   - Convex `qinglanResidents`.
   - Convex `locations`.
   - Recent world events.

3. Submit real actions
   - Replace the old prototype-style `interact` event with formal xianxia
     actions such as `talk`, `trade`, `explore`, `spar`, and `arrive`.
   - Actions should go through `xianxia.gm.act` / `submitAction`, not bypass
     the rules layer.
   - Button/action availability should come from Convex capabilities plus
     Godot local range checks, not from hardcoded UI guesses.

4. Display consequences
   - Show action result text.
   - Show short dialogue or reaction bubbles.
   - Show changed NPC status when available.
   - Surface recent event summaries.

## Current Delivery Shape

```text
godot-taixu-client/
  HARDENING_PLAN.md
  SYSTEM_AUDIT.md
  PRODUCTION_RUNBOOK.md
  SOURCE_BOUNDARY.md
  IMPLEMENTATION_PLAN.md
  README.md
  BRIDGE_TESTS.md
  .eslintrc.cjs
  project.godot
  scenes/
    Main.tscn
  scripts/
    ConvexBridge.gd
    WorldStateStore.gd
    ActionClient.gd
    ResidentRenderer.gd
    PlayerController.gd
    InteractionProbe.gd
    NavigationMask.gd
    LocationProbe.gd
    ActionMenuPolicy.gd
    TraceState.gd
    *Formatter.gd
  tools/
    check_bridge.mjs
    check_agent_soak.mjs
    check_godot_contracts.mjs
    check_production_readiness.mjs
    check_source_boundary.mjs
    check_navigation_mask.mjs
    check_*.gd
  assets/
    README.md
    fonts/
      NotoSansCJKsc-Regular.otf
      OFL.txt
    qinglan-reference-town-footprint-no-bamboo-v1.png
    qinglanRegions.json
```

The server half remains in the repository's `convex/` tree because Convex owns
the world facts and rule transaction. It is bounded by `convex/godot*.ts`,
`convex/http.ts`, restricted fixtures, and only the xianxia modules reached by
the formal action/tick path. See `SOURCE_BOUNDARY.md` for the executable
release manifest and explicit exclusions.

Do not add large generated assets here without a runtime/release reason. The
bundled CJK font is an intentional exception because world names must render
consistently without host fonts. If a map asset already exists elsewhere in
the repository, reference or copy only the minimum needed version. The current
Qinglan runtime map contract is:

- visual source/client PNG:
  `qinglan-reference-town-footprint-no-bamboo-v1.png`
- navigation/client mask: `qinglanRegions.json`
- source image coordinate space: `1448 x 1086` pixels
- Godot world space: `96 x 72` tiles at `32px` per tile
- Godot runtime world size: `3072 x 2304` pixels

`tools/check_navigation_mask.mjs` always verifies the self-contained client PNG
and mask, mask metadata, world-tile contract, and key
collision/walkability watch points. When the optional generated
`public/assets/` sources are present in the wider workspace, it also verifies
their hashes match the client copies.

## Current Known Bridge

The existing prototype already has:

- Godot HTTP base URL: `http://127.0.0.1:3211`
- Convex HTTP routes:
  - `GET /godot/worldState?mapId=qinglan`
  - `GET /godot/regionState?mapId=qinglan`
  - `GET /godot/actionRecord?actionRecordId=...`
  - `GET /godot/actorContext?actorId=...`
  - `GET /godot/replay?mapId=qinglan`
  - `POST /godot/capabilities`
  - `POST /godot/action`
  - `POST /godot/tick` (debug credential only)
  - `POST /godot/arrive`
  - `POST /godot/interact`

The new client should keep `worldState` and `regionState`, but treat `arrive`
and `interact` as legacy compatibility routes. Formal xianxia action submission
now starts at `POST /godot/action`; the legacy routes adapt into the same
prepareAction -> GM action pipeline rather than writing standalone events.

## Bridge Credentials

Every bridge route except `GET /godot` requires a bearer credential. Configure
the Convex deployment with `GODOT_BRIDGE_WORLD_ID`, `GODOT_BRIDGE_ACTOR_ID`,
and `GODOT_BRIDGE_TOKEN`. Tokens must contain at least 32 non-whitespace
characters and must be supplied through deployment/process environment, never
through committed Godot resources or durable world tables.

Local smoke, soak, and manual tick controls additionally require
`GODOT_BRIDGE_DEBUG_ENABLED=true` and a different
`GODOT_BRIDGE_DEBUG_TOKEN`. Production should omit the debug token and keep
debug mode disabled. The Godot client reads `GODOT_BRIDGE_TOKEN` from its
process environment; when a debug token is absent it hides Tick and Auto Tick.

`GODOT_BRIDGE_ALLOWED_ORIGINS` is an optional comma-separated exact origin
allowlist for browser clients. Native Godot requests do not send `Origin` and
remain supported. See `BRIDGE_TESTS.md` for the required smoke command shape.

Every `POST /godot/action`, `/godot/arrive`, or `/godot/interact` request also
requires a client-generated `clientActionId`. The key is unique per semantic
command and is reused only when retrying that same command. Convex persists it
on `actionRecords` and returns the original action/event lifecycle for safe
retries; changing semantics under an existing key is rejected.

All bridge JSON uses contract version `godot_bridge_v1`. Invalid JSON,
unsupported actions, unknown fields/query parameters, non-finite tiles,
oversized text, unsafe metadata, and invalid per-action params return structured
errors before durable action submission. Godot validates both the version and
the minimum payload shape for each response type.

## Design Rules

- Convex is the source of truth. Godot may predict or animate locally, but it
  should not invent durable facts.
- Godot should submit semantic actions, not raw story text.
- Godot action payloads include the local actor tile so the Convex bridge can
  validate basic range/location constraints before rule resolution.
- LLM output must never directly mutate world state.
- Every meaningful consequence should become a `worldEvents` row.
- Player-facing interaction should be simple first: select, inspect, act,
  receive result.
- Keep this folder clean. Experiments belong in a separate scratch folder or a
  clearly marked prototype file.

## Inspirations

Microverse proves that Godot can be a strong container for AI societies: agents
can move, perceive nearby characters, show dialogue, and feel spatially present.

Our version should borrow that product shape, but keep a different authority
model:

```text
Microverse-style presence
+ Convex-backed persistent world
+ xianxia rule adjudication
+ event-sourced memory and relationships
```

## First Implementation Target

The first target is now in place. The scene can:

1. Load `regionState`.
2. Draw residents at their Convex tile positions.
3. Select a resident.
4. Submit a `talk` action against that resident.
5. Show the returned result and latest related event.
6. Detect nearby location entry and submit a formal `arrive` action.
7. Enable nearby-only `Talk` and current-location `Explore` actions.
8. Render recent Convex events as short resident/location bubbles.
9. Trigger a bounded debug tick that advances Qinglan residents, runs the agent
   loop, and refreshes the scene.
10. Smoothly interpolate resident positions after each `regionState` refresh and
    fade event bubbles over time.
11. Send `actorTile` with actions so the bridge can reject out-of-range local
    interactions.
12. Ask `POST /godot/capabilities` for backend-informed action availability.
13. Render a small action menu from capabilities instead of hardcoding the
    playable actions; `gift` and `trade` use Convex-provided option selectors.
14. Enable `spar` in appropriate public Qinglan zones and submit it through the
    same formal action loop.
15. Enable `cultivate` at the Qinglan tea-stall quiet spot and submit it as a
    location action through the same loop.
16. Enable `request_teaching` with a qualified Qinglan elder and submit it
    through the same target action loop.
17. Enable `breakthrough` at a realm gate, with Convex capabilities explaining
    why the action is disabled before the actor is ready.
18. Show a trade detail panel from Convex `trade.options`, including selected
    item, price, buyer balance, seller stock, and quote multipliers.
19. Show request-teaching and breakthrough detail lines from Convex
    capabilities, including rule gates and disabled reasons.
20. Show immediate action outcome bubbles from `/godot/action` response anchors,
    then let the next `regionState` refresh confirm the same event.
21. Classify bubbles as dialogue, reaction, narration, or warning through
    Convex-provided `bubbleKind` and short `bubbleText`.
22. Serialize Godot bridge requests so actions, ticks, and refreshes are queued
    instead of being dropped while another HTTP call is active; stale capability
    responses are ignored when the selected resident, location, or player tile
    no longer matches the current scene context.
23. Route `trade` through a confirmation panel that shows the selected item,
    price, balance change, seller stock, and quote multipliers before submitting
    the formal Convex action; confirmation is cancelled if the target or
    location context changes.
24. Offer an optional low-frequency `Auto Tick` toggle. It advances the local
    debug world loop with a small tick limit only when the Convex bridge is
    idle, so simulation updates do not pile up behind player actions.
25. Render Convex resident presence metadata: `activityLabel`, `intent`,
    `waypointId`, `targetTile`, and `finalTargetTile` now flow through
    `regionState`, with Godot showing short activity labels and destination
    guide lines for scheduled movement.
26. Show a selected-resident schedule inspector in the HUD. It displays the
    backend-owned activity/status, location, waypoint, intent, next-action
    countdown, and current -> target -> final tile route without mutating world
    state.
27. Fetch selected resident actor context from Convex, including profile,
    bidirectional relationship dimensions, recent actions, recent events, and
    short memories. The HUD shows a compact read-only summary for debugging the
    AI society loop. The selected-resident inspector formatting lives in
    `ResidentInspectorFormatter.gd`, with a headless formatter check covering
    route, schedule, relationship, memory, event, and recent-action text.
28. Return post-tick `recentEvents` and per-tick `tickEvents` from
    `POST /godot/tick`, then render the tick-specific events immediately in
    Godot using the same `bubbleText`/`bubbleKind` presentation path as player
    actions and region refreshes. If a tick produces no durable action event,
    the bridge returns explicit `tickOnly` observations instead of inventing a
    world event.
29. Expose trace ids on Godot-facing events: `worldEventId`, `actionRecordId`,
    and `resultCode`. Action record readback also returns the linked
    `worldEventId`, so a Godot bubble can be traced back to Convex durable
    records.
30. Route risky actions through the confirmation panel. `gift`, `spar`,
    `request_teaching`, and `breakthrough` now show Convex-sourced details or
    risk notes before submission, while `trade` keeps its priced confirmation
    flow. The display-only action detail and confirmation copy now lives in
    `ActionPresentationFormatter.gd`, while `Main.gd` keeps context validation
    and the single semantic submit path.
31. Add a safe presentation layer for Godot-facing events. Convex still writes
    deterministic `summary` facts, while `bubbleText`, `displayText`, and
    `presentationSource` provide UI-ready expression that can later swap from
    rule templates to an LLM without changing action adjudication. Every
    Godot-facing presentation also returns `durableSummary` plus a
    `presentationPolicy` that locks durable facts and forbids presentation or
    LLM polish from changing world state.
32. Show a compact trace/debug panel in Godot. Player actions and tick events
    append `actionRecord -> worldEvent` rows with result codes and presentation
    text, then read back `/godot/actionRecord` when an `actionRecordId` is
    available. Tick-only observations stay explicitly marked `tickOnly`. Convex
    also returns a structured `traceChain` with link status, durability, source,
    actionRecord/worldEvent ids, and a display label, so the panel does not need
    to infer lifecycle state locally. `traceChain.steps` now carries the
    display-ready lifecycle sequence, such as semantic action or tick,
    actionRecord, and worldEvent. The display formatting now lives in
    `TraceFormatter.gd`, leaving `Main.gd` to collect bridge state and request
    authoritative readbacks. The trace panel also expands Convex replay
    summary facets for action/result/link/source counts, adds a display-only
    trace health line for linked/event-only/action-only/tick-only rows and
    readback ok/pending/failed counts, and shows each row's presentation
    source, bubble kind, locked presentation policy, ids, readback status, and
    polish-preview status as display-only debug metadata.
    `tools/check_trace_formatter.gd` runs that formatter headlessly against
    representative action, replay, settlement, polish, pending-readback, and
    tick-only rows. `tools/check_main_scene_contract.gd` also feeds replay
    payloads into the real Main scene and verifies stale replay rejection plus
    replay-driven trace panel rebuilds.
33. Enrich selected-resident actor context with replay traces. `recentActions`
    now include actions involving the selected actor, linked `worldEventId`,
    result code, and presentation fields, so the inspector can show the same
    durable action/event chain as bubbles and tick feedback.
34. Expose Convex-owned resident route previews. `regionState`, `worldState`,
    and selected `actorContext` resident payloads include `routePreview` with
    waypoint label, next tile, path tiles, length, source, and connectivity.
    The preview also includes remaining tiles, ETA seconds, next-step label,
    next-step distance, ETA label, path step count, route/progress summary,
    movement state, and `schedulePreview` with phase, destination, intent,
    summary, and next-action timing. It also includes `scheduleRoute`, a
    Convex-owned resident/role life-loop preview with previous/current/next and
    upcoming stops. Godot renders the path and inspector text without deriving
    schedule facts locally. The selected resident route now gets a stronger
    read-only overlay with current/next/upcoming schedule markers derived from
    `routePreview.scheduleRoute`. Resident map labels also prefer
    `schedulePreview` activity, destination, and ETA, falling back to resident
    intent when no schedule is present; `tools/check_resident_renderer.gd`
    covers the normalized path, marker, and presence-label contract
    headlessly.
35. Add a read-only replay trace route. `GET /godot/replay` returns recent
    `worldEvents` joined to `actionRecords` with presentation fields, so Godot
    can rebuild the trace panel from Convex authority after refresh, selection
    changes, actions, or ticks. Replay entries include the same `traceChain`
    contract as live action and tick responses. Replay responses also include a
    Convex-sourced `summary` with row counts, linked/event-only/tick-only
    counts, durable count, generated timestamp, exact time-window span and
    label, source/link-status facets, action type counts, result code counts,
    and top action/result/link/source fields for the Godot trace header and
    replay facet line.
36. Add Convex-sourced inventory delta previews for exchange actions. `gift`
    and `trade` capability options now include `inventoryDeltaPreview`, and
    Godot detail/confirmation panels display those backend-provided before/after
    item changes instead of deriving inventory facts locally. They also include
    `confirmationPreview` with rule-template summary lines, inventory/terms
    text, durable effect notes, and a display-only policy that keeps submission
    on `POST /godot/action`. The action formatter also renders a `Selection:`
    line for the chosen Convex option, including quantity choice index/count,
    requested/max quantity, total price, preview-only status, Convex ownership,
    Godot display-only policy, and durable-state lock before submit.
37. Extend trade capabilities to quantity-aware terms while keeping the same
    formal action path. `trade.options` can include multi-quantity offers with
    `requestedQty`, `offeredQty`, total/unit prices, `exchangeTerms`, and
    inventory deltas. Each option also carries backend `quantityChoices` for
    the same item so Godot can show selectable quantity/price context without
    computing prices locally; `POST /godot/action` still submits a semantic
    `trade` action resolved by Convex rules.
38. Return Convex-sourced settlement previews after resolved exchange actions.
    When rule effects contain item transfers, action responses, recent events,
    replay/actionRecord readbacks, and the Godot trace UI expose
    `settlementPreview` from `rules.effects.items`, proving post-action
    inventory settlement is display-only in Godot and already adjudicated by
    Convex.
39. Add Convex-sourced risk previews for risky rule actions.
    `request_teaching`, `spar`, and `breakthrough` capabilities now include
    `riskPreview` with level, summary, rule gates, possible result codes,
    durable effect notes, and `presentationSource: "rule_template"`. Godot
    detail/confirmation panels display that backend preview instead of owning
    the risk model locally.
40. Add a read-only safe polish preview adapter for the presentation layer.
    `GET /godot/presentationPreview` joins an `actionRecord` to its durable
    event and returns `polishPreview` with the `godot_safe_polish_v1` adapter.
    Requested LLM polish reports `status: "llm_not_configured"` until a bounded
    adapter exists, keeps `durableSummary` unchanged, exposes rule-template
    candidate text, and includes policy flags, input snapshot, durable summary
    hash, allowed output fields, locked fields, forbidden effects, enforced
    guardrails, and candidate validation. A future bounded adapter may preview
    only `bubbleText`, `displayText`, and `bubbleKind`; candidates that try to
    change facts, ids, effects, summaries, or durable state are rejected and
    fall back to rule-template display text. Godot can request this after
    actionRecord readback and show the preview status/guardrail count in the
    trace panel without creating a second action path.

Next, we can add fuller generated dialogue, refine multi-item exchange UX, and
keep enriching NPC schedules and route previews.

## Current Verification

See `SYSTEM_AUDIT.md` for the latest evidence matrix showing which architecture
requirements are currently proven and which parts remain open.

Run the bridge smoke test from the repository root:

```bash
npm run qinglan:audit-mask
npm test -- convex/godotBridgeContract.test.ts convex/xianxia/actionIdempotency.test.ts convex/godotBridgeAuth.test.ts convex/xianxia/access.test.ts convex/godotPresentation.test.ts convex/godotExchange.test.ts
GODOT_BRIDGE_WORLD_ID=... GODOT_BRIDGE_TOKEN=... GODOT_BRIDGE_DEBUG_TOKEN=... node godot-taixu-client/tools/check_bridge.mjs
GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-agent-soak
GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-agent-soak-long
npm run godot:check-contracts
GODOT_BRIDGE_TOKEN=... GODOT_BRIDGE_DEBUG_TOKEN=... npm run godot:check-live-ui
```

`convex/godotPresentation.test.ts` covers the backend-only presentation
contract: rule summaries stay locked, settlement previews come from resolved
rule effects, LLM polish is preview-only, and trace chains distinguish linked
action records, event-only rows, action-record readback, and tick-only
observations.
`convex/godotExchange.test.ts` covers backend-owned gift/trade capability
options: semantic params, quantity choices, exchange terms, inventory deltas,
confirmation preview policy, and `POST /godot/action` submit-path metadata.

`npm run godot:check-contracts` runs the local Godot/client contract suite:
map/mask file contract, runtime spatial contract, action formatter contract,
resident route-renderer contract, resident inspector formatter contract, trace
formatter contract, Main scene UI/submit-path contract, and Godot headless
startup. You can also run the individual checks below when narrowing a failure.

`npm run godot:check-agent-soak` runs a bounded multi-tick HTTP bridge soak. It
calls `/godot/tick` several times, verifies that autonomous ticks do not select
Godot-controlled actors, reads back action-backed tick events through
`/godot/actionRecord`, confirms tick-only observations stay explicit, checks
resident route previews after each refresh, and asserts that waypoint labels,
destination locations, movement phases, ETA/progress text, current/next stops,
upcoming stop offsets, and path tiles remain internally consistent. It then
proves durable tick traces can be rebuilt for multiple residents through
`/godot/actorContext` and `/godot/replay`, including relationship and memory
readback shapes. The short profile also enforces per-request, wall-clock,
per-response, and cumulative-response budgets and reports actor-context memory,
action, event, and relationship deltas. The separate 24-tick long profile
requires positive memory and structured rule-owned relationship deltas.

Run Godot headless after importing assets:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --quit-after 120
```

Run the spatial contract check after changing navigation, player movement, or
location-probe code:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_spatial_contract.gd
```

Run the trace formatter check after changing replay/debug display code:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_trace_formatter.gd
```

Run the Main scene contract after changing `Main.gd`, action menu wiring,
confirmation behavior, stale capability filtering, or trace orchestration:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_main_scene_contract.gd
```

Run the action presentation formatter check after changing action detail or
confirmation display code:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_action_presentation_formatter.gd
```

Run the resident inspector formatter check after changing selected-resident,
schedule, route, relationship, memory, or actor-context display code:

```bash
/Users/henry/Desktop/仙侠模拟器/tmp/godot-download/Godot.app/Contents/MacOS/Godot \
  --headless \
  --path /Users/henry/Desktop/仙侠模拟器/godot-taixu-client \
  --script res://tools/check_resident_inspector_formatter.gd
```

See `BRIDGE_TESTS.md` for the full closed-loop test contract.

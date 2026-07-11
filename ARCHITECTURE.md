# Worldweft Architecture

## Boundary

The system is deliberately split by authority:

```text
Godot input / collision / local UI
              |
              | semantic action or tick request
              v
Convex HTTP bridge
              |
              v
Convex rules and durable world state
              |
              | actionRecord + worldEvent + relationship/memory changes
              v
Godot read models, event bubbles, replay/debug UI
```

Godot never writes world facts. It sends semantic requests such as `talk`,
`gift`, `trade`, `spar`, `request_teaching`, `cultivate`, `breakthrough`,
`arrive`, and `explore`. Convex determines whether the request is legal and
persists the resulting state.

## Runtime Flow

1. Godot loads `worldState`, `regionState`, capabilities, and actor context.
2. The player selects an enabled semantic action; Godot submits action data,
   never authored story text or a claimed outcome.
3. Convex validates identity, current semantic location, capabilities,
   idempotency, rule prerequisites, and risk confirmation.
4. Convex resolves the action and writes durable records.
5. The bridge returns `summary` as rule-owned fact text plus presentation fields
   (`bubbleText`, `displayText`, `bubbleKind`, `presentationSource`).
6. Godot displays the result and can follow the trace from tick to action to
   event to `actionRecord`.

`/godot/tick` may return a durable event or a `tickOnly` observation. A tick
without a durable state change must not fabricate a world event.

## Contract Surfaces

The authenticated Godot bridge is implemented in `convex/http.ts` and
`convex/godot*.ts`:

- `/godot/worldState`
- `/godot/regionState`
- `/godot/capabilities`
- `/godot/action`
- `/godot/tick`
- `/godot/actorContext`
- `/godot/actionRecord`

Legacy arrive/interact endpoints are compatibility adapters only. They must
enter the same formal action pipeline and cannot create standalone events.

## Agent and Presentation Rules

LLM involvement is constrained to proposing intent or optionally polishing a
presentation string. The durable summary, action result code, world event, and
action record remain rule-owned Convex data. `presentationSource` preserves the
origin of display text so a future LLM polish layer cannot be mistaken for a
world fact.

## Content Status

The core includes a small Qinglan fixture because a bridge needs a real spatial
surface to verify location, navigation, capabilities, and resident presence.
It is testing scaffolding, not the final game map. Sect systems, final maps,
art pipelines, player economy, and broad content authoring are intentionally
outside this repository baseline.

The current reference-world implementation still uses internal `xianxia` and
`godot-taixu-client` paths. These are implementation residues from the first
reference world, not the public identity of Worldweft. They will be
replaced by a neutral example world without changing the authority boundary.

## Compatibility Layer

Some Convex schema and utility modules still descend from the earlier AI Town
implementation. They are backend-only dependencies retained to keep this
baseline executable. They do not reintroduce the old Web/Pixi client.
See [COMPATIBILITY.md](COMPATIBILITY.md) for the migration boundary.

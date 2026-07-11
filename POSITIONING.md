# Positioning

## The Promise

**Build worlds that continue to live without a player at the center.**

Worldweft gives a game developer an authoritative simulation layer and a
Godot spatial client. An agent can attempt something in language, but the world
decides what actually happened through rules and records the result durably.

This is the design line:

```text
language proposes intent -> rules adjudicate -> durable records persist -> Godot presents
```

The player is a participant in the world, not the reason the world is running.

## What We Borrow, What We Change

[AI Town](https://github.com/a16z-infra/ai-town) is a MIT-licensed starter kit
for extensible AI-character towns. Its use of a shared stateful backend and
simulation engine is a meaningful ancestor of this project.

[Microverse](https://github.com/KsanaDock/Microverse) is a MIT-licensed Godot
multi-agent social-simulation sandbox. Its commitment to a visible, autonomous
agent society is aligned with the experience we want to create.

Worldweft focuses on a different operational contract:

- Godot is never the durable-world authority.
- An LLM never writes durable world state directly.
- A semantic action has an auditable causal chain through `actionRecords` and
  `worldEvents`.
- A tick may observe without inventing an event; durable changes must be real.
- The same world contract can power a game, a simulation viewer, a replay tool,
  or future clients without creating a second action path.

Autonomy alone is not the differentiator; both inspiration projects also
describe autonomous agents with memory. The differentiator here is making
autonomy **rule-governed, durable, replayable, and independent from a single
client or protagonist**.

## What "Evolving" Means

In this foundation, evolution means the world changes over time through agent
ticks and resolved actions: location, schedule, memory, relationships, action
history, and events may change even without player input. It does **not** mean
an LLM can silently rewrite rules or facts. Future learning systems must enter
through the same semantic-intent and rule-adjudication boundary.

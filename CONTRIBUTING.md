# Contributing

Agentic Worlds accepts contributions that preserve the authority boundary.

- Convex is the only durable source of world facts and rule outcomes.
- Godot may render, navigate, collect input, and submit semantic actions; it
  must not write durable world state directly.
- LLM output may propose an intent or presentation text. It must not directly
  create `worldEvents`, `actionRecords`, relationships, or memories.
- New actions must enter the formal action pipeline and produce traceable
  durable results when they change the world.
- Changes to a bridge contract need focused tests and a passing
  `npm run godot:check-core`.

For substantial work, open an issue first with the authority boundary it
affects, the durable records it may change, and the verification you plan to
add. Please do not submit generated code that you have not reviewed and tested.

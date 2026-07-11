# Compatibility Boundary

`convex/aiTown/`, `convex/agent/`, selected `convex/engine/` files, and small
legacy data modules are present because the current Convex schema and runtime
import them transitively. They are not the canonical Worldweft client
architecture.

They are kept for three concrete reasons:

- existing schema tables and historical objects must continue to deserialize;
- the focused action and tick path imports shared utilities from that layer;
- tests need the same runtime closure as the deployed bridge.

The old React/Pixi client, its routes, editor, maps, and presentation code are
not included in this repository. Future cleanup can replace these backend
compatibility modules only after a migration verifies durable data and action
history remain readable.

Do not delete this layer merely to make the tree look smaller. Treat its
removal as a schema migration with contract tests, not as a cosmetic refactor.

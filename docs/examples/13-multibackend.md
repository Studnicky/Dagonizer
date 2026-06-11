# Example 13 — Multi-backend DAG with per-role colors

Demonstrates a DAG that spans two distinct container backends:

- **`cpu` role** — `WorkerThreadContainer` (Node.js worker-thread pool). Runs a `ScatterNode` that squares every item in a list concurrently.
- **`io` role** — `ForkContainer` (child-process fork pool). Runs an `EmbeddedDAGNode` that sums all squared results.

The primary demonstration is visual: `MermaidRenderer` emits **two distinct `classDef` lines** — `classDef contained-cpu` and `classDef contained-io` — each with a different fill color. The secondary demonstration is operational: the DAG actually executes over both real backends and prints the results.

## Run

```bash
pnpm example:13
```

This compiles the example and its registry module to `examples/dist/`, then runs the compiled JS with Node.js (required because worker threads and forked processes cannot import TypeScript source at runtime).

## Mermaid output

Running the example prints the DAG's Mermaid representation. Look for the two classDef lines near the end:

```
classDef contained-cpu fill:#b45309,stroke:#d97706,color:#eef3f7
classDef contained-io  fill:#be185d,stroke:#db2777,color:#eef3f7
```

`cpu` resolves to palette slot 0 (amber-orange). `io` resolves to palette slot 2 (rose-red). The mapping is deterministic via FNV-1a hash of the role name — the same role always yields the same color.

## Color scheme

`RoleColorUtils.forRole(role)` maps any role string to a `{fill, stroke, text}` triple from an 8-hue curated palette. The palette hues are chosen to:

- Read clearly as "offloaded / running elsewhere" (warm and cool accents, never the in-process teal `#22e8ff`).
- Not clash with the retry-route orange `#f5a623`.
- Remain legible on the dark `#020306` canvas background.

| Slot | Fill      | Stroke    | Typical role |
|------|-----------|-----------|--------------|
| 0    | `#b45309` | `#d97706` | cpu          |
| 1    | `#7c3aed` | `#8b5cf6` | gpu          |
| 2    | `#be185d` | `#db2777` | io           |
| 3    | `#0f766e` | `#14b8a6` | network      |
| 4    | `#3730a3` | `#4f46e5` | storage      |
| 5    | `#3f6212` | `#65a30d` | batch        |
| 6    | `#0369a1` | `#0ea5e9` | streaming    |
| 7    | `#86198f` | `#c026d3` | ml           |

## Architecture

```
multibackend DAG
│
├── square-all  [ScatterNode, container: "cpu"]
│   │  body: square-item-mb (sub-DAG per item)
│   │  gather: append → results[]
│   └── sum-all
│
└── sum-all  [EmbeddedDAGNode, container: "io"]
       body: sum-results (embedded DAG)
       writes state.total
```

Both Mermaid and Cytoscape use `RoleColorUtils.forRole` from `viz/internal` so the colors are consistent across all renderers.

## Source files

- `examples/13-multibackend.ts` — entry point; prints Mermaid then runs dual-backend
- `examples/dags/13-multibackend.ts` — state, nodes, DAG consts
- `examples/dags/13-multibackend.registry.ts` — registry module loaded inside workers
- `examples/tsconfig.multibackend.json` — compile config for workers build

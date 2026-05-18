---
title: 'Phase 06 · DAGBuilder'
description: 'The Archivist parent DAG authored with the chainable DAGBuilder API. Compile-time route exhaustiveness, deep-DAG placements, parallel nodes, and auto-entrypoint — all in one fluent chain.'
---

# Phase 06 · DAGBuilder

The same [Archivist](./the-archivist) DAG, authored with the chainable `DAGBuilder` API. The builder is a thin layer over plain-object DAG configs — `.build()` returns the exact same `DAG` data structure the dispatcher consumes. The win is compile-time exhaustiveness: each `.node(name, nodeImpl, routes)` call narrows `routes` to the node's `TOutput` union, so TypeScript flags any missing or stray output mapping before the code ships.

## Flow

```mermaid
flowchart TB
  recall[recall-context]
  classify[classify-intent]
  on-topic([on-topic-search\n.deepDAG])
  author([author-search\n.deepDAG])
  similar([similar-search\n.deepDAG])
  reviews([reviews-fan-out\n.parallel inline])
  describe([describe-fan-out\n.parallel inline])
  compose([compose-loop\n.deepDAG])
  decline([decline-off-topic / decline-empty])
  END([end])
  recall --> classify
  classify --> on-topic & author & similar & reviews & describe
  on-topic & author & similar & reviews & describe -->|success| compose
  compose --> END
  classify -->|off-topic| decline --> END
```

## Code

The complete `archivistDAG` — the parent DAG as a single DAGBuilder chain. The full source file includes inline branches for reviews and describe (which use distinct post-scout ranking steps):

<<< ../../examples/the-archivist/dag.ts

## What it demonstrates

- **Chainable authoring** — every `.node()`, `.parallel()`, and `.deepDAG()` returns `this` for fluent composition. The chain calls `build()` once at the end to produce the plain `DAG` object.
- **Compile-time route exhaustiveness** — the `routes` argument is typed as `Record<TOutput, null | string>`. TypeScript catches missing outputs (forgot `'error'`) and stray outputs (typo in output name) at compile time.
- **Auto-entrypoint** — the first `.node()` call (`'recall-context'`) sets the DAG entrypoint automatically. Override with `.entrypoint(name)` if needed.
- **Deep-DAG placements via `.deepDAG()`** — `on-topic-search`, `author-search`, `similar-search`, and `compose-loop` are deep-DAG placements. Each references a registered child DAG by name and declares its `stateMapping.output`.
- **Parallel nodes via `.parallel()`** — `reviews-fan-out` and `describe-fan-out` run four scouts concurrently per branch (inlined because they use `rankByRating` / `pickBestMatch` instead of the standard `rankCandidates`).
- **Same output as a literal `DAG`** — `.build()` returns the identical wire shape `Dagonizer.load()` expects. The builder is a convenience layer, not a separate runtime.

See this in action in the [Archivist live demo](./the-archivist).

## See also

- [Running domain: The Archivist](./the-archivist)
- [DAGBuilder guide](../guide/builder)
- [Phase 07 · JSON DAG load](./07-schema) — the same topology loaded from a JSON file instead
- [Phase 03 · Deep-DAG composition](./03-deepflows) — the deep-DAG internals
- [Reference: Entities — `DAG`, `SingleNode`, `ParallelNode`](../reference/entities)

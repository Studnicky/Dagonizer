---
title: 'Phase 02: DAGBuilder'
description: 'The Archivist parent DAG authored with the chainable DAGBuilder API. Compile-time route exhaustiveness, scatter placements, auto-entrypoint, one fluent chain.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'DAGBuilder guide'
    link: '../guide/builder'
  - text: 'Phase 03: JSON-LD schema'
    link: './03-schema'
    description: 'the same topology loaded from a JSON file instead'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'the embedded-DAG sub-DAG internals'
  - text: 'Reference: Entities, `DAG`, `SingleNode`, `ScatterNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { archivistDAG } from '@archivist/dag.ts';
import { BookSearchScatterDAG } from '@archivist/embedded-dags/BookSearchScatterDAG.ts';
import { ComposeRetryLoopDAG } from '@archivist/embedded-dags/ComposeRetryLoopDAG.ts';

const archivistRegistry = new Map([
  ['book-search-scatter', BookSearchScatterDAG],
  ['compose-retry-loop', ComposeRetryLoopDAG],
]);
</script>

# Phase 02: DAGBuilder

The same [Archivist](./the-archivist) DAG, authored with the chainable `DAGBuilder` API. The builder is a thin layer over plain-object DAG configs; `.build()` returns the exact same `DAG` data structure the dispatcher consumes. The win is compile-time exhaustiveness: each `.node(name, nodeImpl, routes)` call narrows `routes` to the node's `TOutput` union, so TypeScript flags any missing or stray output mapping before the code ships.

<DagGraph :dag="archivistDAG" :embedded-d-a-gs="archivistRegistry" :expand-all="true" aria-label="The Archivist DAG authored via DAGBuilder, with sub-DAGs expanded." />

## Code

The complete `archivistDAG`, the parent DAG as a single `DAGBuilder` chain. The full source file includes inline branches for reviews and describe (which use distinct post-scout ranking steps):

<<< @/../examples/the-archivist/dag.ts

## What it demonstrates

- **Chainable authoring.** Every `.node()` and `.scatter()` returns `this` for fluent composition. The chain calls `build()` once at the end to produce the plain `DAG` object.
- **Compile-time route exhaustiveness.** The `routes` argument is typed as `Record<TOutput, null | string>`. TypeScript catches missing outputs (forgot `'error'`) and stray outputs (typo in output name) at compile time.
- **Auto-entrypoint.** The first `.node()` call (`'recall-context'`) sets the DAG entrypoint automatically. Override with `.entrypoint(name)` if needed.
- **Embedded-DAG placements via `.embeddedDAG()`.** `on-topic-search`, `author-search`, `similar-search`, and `compose-loop` are `EmbeddedDAGNode` placements. Each references a registered sub-DAG by name and declares its `stateMapping.outputs`.
- **Scatter placements via `.scatter()`.** `reviews-scatter` and `describe-scatter` scatter over a descriptor source (`state.scoutProviders`) with a dispatching body node. Each clone reads `state.metadata.currentItem` and executes the matching scout logic; four sources run concurrently with `concurrency: 4`.
- **Same output as a literal `DAG`.** `.build()` returns the identical wire shape `Dagonizer.load()` expects. The builder is a convenience layer, not a separate runtime.

See this in action in the [Archivist live demo](./the-archivist).

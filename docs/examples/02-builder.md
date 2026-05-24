---
title: 'Phase 02: DAGBuilder'
description: 'The Archivist parent DAG authored with the chainable DAGBuilder API. Compile-time route exhaustiveness, embedded-DAG placements, parallel nodes, auto-entrypoint, one fluent chain.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'DAGBuilder guide'
    link: '../guide/builder'
  - text: 'Phase 03: JSON-LD schema'
    link: './03-schema'
    description: 'the same topology loaded from a JSON file instead'
  - text: 'Phase 05: Embedded-DAG composition'
    link: './05-embedded-dags'
    description: 'the embedded-DAG internals'
  - text: 'Reference: Entities, `DAG`, `SingleNode`, `ParallelNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
import { archivistDAG } from '@archivist/dag.ts';
import { BookSearchFanoutDAG } from '@archivist/embedded-dags/BookSearchFanoutDAG.ts';
import { ComposeRetryLoopDAG } from '@archivist/embedded-dags/ComposeRetryLoopDAG.ts';

const elements = CytoscapeRenderer.render(archivistDAG, {
  embeddedDAGs: new Map([
    ['book-search-fanout', BookSearchFanoutDAG],
    ['compose-retry-loop', ComposeRetryLoopDAG],
  ]),
}) as ElementDefinition[];
</script>

# Phase 02: DAGBuilder

The same [Archivist](./the-archivist) DAG, authored with the chainable `DAGBuilder` API. The builder is a thin layer over plain-object DAG configs; `.build()` returns the exact same `DAG` data structure the dispatcher consumes. The win is compile-time exhaustiveness: each `.node(name, nodeImpl, routes)` call narrows `routes` to the node's `TOutput` union, so TypeScript flags any missing or stray output mapping before the code ships.

<DagGraph :elements="elements" aria-label="The Archivist DAG authored via DAGBuilder, with embedded-DAGs expanded." />

## Code

The complete `archivistDAG`, the parent DAG as a single `DAGBuilder` chain. The full source file includes inline branches for reviews and describe (which use distinct post-scout ranking steps):

<<< @/../examples/the-archivist/dag.ts

## What it demonstrates

- **Chainable authoring.** Every `.node()`, `.parallel()`, and `.embeddedDAG()` returns `this` for fluent composition. The chain calls `build()` once at the end to produce the plain `DAG` object.
- **Compile-time route exhaustiveness.** The `routes` argument is typed as `Record<TOutput, null | string>`. TypeScript catches missing outputs (forgot `'error'`) and stray outputs (typo in output name) at compile time.
- **Auto-entrypoint.** The first `.node()` call (`'recall-context'`) sets the DAG entrypoint automatically. Override with `.entrypoint(name)` if needed.
- **Embedded-DAG placements via `.embeddedDAG()`.** `on-topic-search`, `author-search`, `similar-search`, and `compose-loop` are embedded-DAG placements. Each references a registered child DAG by name and declares its `stateMapping.output`.
- **Parallel nodes via `.parallel()`.** `reviews-fan-out` and `describe-fan-out` run four scouts concurrently per branch (inlined because they use `rankByRating` or `pickBestMatch` instead of the standard `rankCandidates`).
- **Same output as a literal `DAG`.** `.build()` returns the identical wire shape `Dagonizer.load()` expects. The builder is a convenience layer, not a separate runtime.

See this in action in the [Archivist live demo](./the-archivist).

---
title: 'Phase 04: Scatter scout'
description: 'Four-source parallel scout cluster in The Archivist: OpenLibrary, Google Books, Subject search, and Wikipedia run concurrently, combine with the collect strategy, then feed rank and merge.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 01: Linear intake'
    link: './01-linear'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
  - text: 'Reference: Core, `GatherStrategies`'
    link: '../reference/core'
  - text: 'Reference: Entities, `ParallelNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '@archivist/embedded-dags/BookSearchScatterDAG.ts';
</script>

# Phase 04: Scatter scout

[The Archivist](./the-archivist) queries four book sources at once: OpenLibrary keyword search, Google Books, OpenLibrary subject search, and Wikipedia enrichment. All four scouts run in a `parallel` placement with `combine: 'collect'`. The gather waits for all four and merges their `state.candidates` mutations before routing forward to rank and merge. The `BookSearchScatterDAG` packages this entire cluster as a reusable sub-DAG body in an embedded-DAG placement.

<DagGraph :dag="BookSearchScatterDAG" aria-label="book-search-scatter DAG: parallel scouts merge into ranked candidates." />

## Code

The complete `BookSearchScatterDAG`, the sub-DAG the Archivist places three times for on-topic, author, and similar-search branches:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## What it demonstrates

- **`parallel` placement.** `.parallel('book-search-scatter', ['openlibrary-scout', 'google-books-scout', 'subject-scout', 'wikipedia-scout'], 'collect', routes)` runs all four scout nodes concurrently. `combine: 'collect'` waits for every branch and merges their state mutations before routing forward.
- **Scout gating via `state.toolPlan`.** Each scout checks `state.toolPlan` before making a network call. `decideTools` (an LLM call) populates the plan; scouts that find no matching plan entry return `'empty'` immediately. `wikipediaScout` is the exception; it runs on terms alone, always.
- **`scoutRetry` pass-through.** Every scout calls `scoutRetry.run(() => tool.execute(..., context.signal), context.signal)`. The signal propagates from the dispatcher through the retry policy: if the parent flow is cancelled, retries abort mid-backoff.
- **Aggregate routing.** The `parallel` node reports `'success'`, `'error'`, or a partial aggregate once all branches settle. Both `'success'` and `'error'` route to `rank-candidates` here; the cluster always attempts ranking regardless of partial failures.
- **`bookSearchScatterBundle`.** The sub-DAG module exports a `DispatcherBundle` packaging the exact node set plus the sub-DAG; `dispatcher.registerBundle(bookSearchScatterBundle)` installs the nodes before the DAG, ahead of the parent.

See this in action in the [Archivist live demo](./the-archivist).

## Running in a container

A scatter placement whose body is a DAG (rather than a single node) can run each clone's sub-DAG in an isolate. Add `container: "cpu"` to the scatter placement and bind a `DagContainerInterface` backend at dispatcher construction:

```ts
import { WorkerThreadContainer } from '@noocodex/dagonizer-executor-node';

const dispatcher = new Dagonizer<AppState, AppServices>({
  services,
  containers: {
    cpu: new WorkerThreadContainer({
      registryModule: new URL('./registry.js', import.meta.url).href,
      registryVersion: '1.0.0',
    }),
  },
});
```

The scatter inbox, gather strategies, and outcome reducer are identical in both paths. See [Example 12: Worker pool](./12-workers) for a complete walkthrough, including the registry module that reconstructs the bundle inside the worker.

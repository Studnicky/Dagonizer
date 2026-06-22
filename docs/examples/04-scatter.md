---
title: 'Phase 04: Scatter scout'
description: 'Four-source scatter scout in The Archivist: OpenLibrary, Google Books, Subject search, and Wikipedia run concurrently via ScatterNode, each clone gathers candidates, then feed rank and merge.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 01: Linear intake'
    link: './01-linear'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
  - text: 'Reference: Core, `GatherStrategies`'
    link: '../reference/core'
  - text: 'Reference: Entities, `ScatterNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Phase 04: Scatter scout

[The Archivist](./the-archivist) queries four book sources at once: OpenLibrary keyword search, Google Books, OpenLibrary subject search, and Wikipedia enrichment. All four scouts run as a single `ScatterNode` over a descriptor source (`state.scoutProviders = ['openlibrary', 'googlebooks', 'subject', 'wikipedia']`). Each clone reads its `currentItem` descriptor, the `scoutDispatch` body node routes to the matching scout logic, and a `collect` gather strategy accumulates per-clone candidates before routing forward to rank and merge. The `BookSearchScatterDAG` packages this entire cluster as a reusable sub-DAG body in an embedded-DAG placement.

`gather` is required on every scatter. This cluster uses `{ strategy: 'collect', target: 'scoutResults' }` so the engine writes each clone's `candidates` output into `state.scoutResults` in source-index order. The `any-success` outcome reducer routes `'success'` as soon as at least one scout finds candidates; mixed or all-empty results route accordingly.

<DagGraph :dag="BookSearchScatterDAG" aria-label="book-search-scatter DAG: scatter scouts merge into ranked candidates." />

## Code

The complete `BookSearchScatterDAG`, the sub-DAG the Archivist places three times for on-topic, author, and similar-search branches:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## What it demonstrates

- **`ScatterNode` with a descriptor source.** The source is a static provider list (`['openlibrary', 'googlebooks', 'subject', 'wikipedia']`). One clone runs per descriptor with `concurrency: 4`, so all four run concurrently.
- **Heterogeneous fan-out via a dispatching body.** `scoutDispatch` reads `state.metadata.currentItem` (the provider name) and routes to the matching scout implementation. The engine runs four clones and is indifferent to whether the bodies are identical; the dispatcher is the body.
- **Required gather.** Every scatter declares `gather`. This one uses `{ strategy: 'collect', target: 'scoutResults' }` — each clone's output lands at `state.scoutResults[index]` in source order.
- **`any-success` outcome reducer.** Routes `'success'` when at least one clone succeeded; routes `'error'` when every clone errored; routes `'empty'` when there were no source items.
- **Scout gating via `state.toolPlan`.** Each scout checks `state.toolPlan` before making a network call. `decideTools` (an LLM call) populates the plan; scouts that find no matching plan entry return `'empty'` immediately. `wikipediaScout` is the exception; it runs on terms alone, always.
- **`scoutRetry` pass-through.** Every scout calls `scoutRetry.run(() => tool.execute(..., context.signal), context.signal)`. The signal propagates from the dispatcher through the retry policy: if the parent flow is cancelled, retries abort mid-backoff.
- **`bookSearchScatterBundle`.** The sub-DAG module exports a `DispatcherBundleType` packaging the exact node set plus the sub-DAG; `dispatcher.registerBundle(bookSearchScatterBundle)` installs the nodes before the DAG, ahead of the parent.

See this in action in the [Archivist live demo](./the-archivist).

## Running in a container

A scatter placement whose body is a DAG (rather than a single node) can run each clone's sub-DAG in an isolate. Add `container: "cpu"` to the scatter placement and bind a `DagContainerInterface` backend at dispatcher construction:

The scatter inbox, gather strategies, and outcome reducer are identical in both paths. See [Example 12: Worker pool](./12-workers) for a complete runnable example of the container binding, including the `WorkerThreadContainer` instantiation and registry module.

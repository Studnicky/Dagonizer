---
title: 'Example 04: Scatter Scout'
description: 'Four-source scatter scout in The Archivist: OpenLibrary, Google Books, Subject search, and Wikipedia run concurrently via ScatterNode, each clone gathers candidates, then feed rank and merge.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Example 01: Linear Intake'
    link: './01-linear'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
  - text: 'Reference: Core, `GatherStrategies`'
    link: '../reference/core'
  - text: 'Reference: Entities, `ScatterNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 04: Scatter Scout

## What It Is

Scatter Scout is The Archivist's "send four librarians into the stacks at once" pattern. One visitor question becomes four concurrent source probes: OpenLibrary keyword search, Google Books, OpenLibrary subject search, and Wikipedia enrichment.

The point is not raw parallelism for its own sake. The parent DAG asks for one ranked answer, while the scatter branch lets each source work independently, report its own outcome, and return candidates in a deterministic shape that downstream ranking can trust.

## How It Works

All four scouts run as one `ScatterNode` over a descriptor source (`state.scoutProviders = ['openlibrary', 'googlebooks', 'subject', 'wikipedia']`). Each clone reads its `currentItem` descriptor, the `scoutDispatch` body node routes to the matching scout logic, and a `collect` gather strategy accumulates per-clone candidates before routing forward to rank and merge.

`gather` is required on every scatter. This cluster uses `{ strategy: 'collect', target: 'scoutResults' }` so the engine writes each clone's `candidates` output into `state.scoutResults` in source-index order. The `any-success` outcome reducer routes `'success'` as soon as at least one scout finds candidates; mixed or all-empty results route accordingly.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

[The Archivist](./the-archivist) queries four book sources at once: OpenLibrary keyword search, Google Books, OpenLibrary subject search, and Wikipedia enrichment. The `BookSearchScatterDAG` packages the full scout cluster as a reusable sub-DAG body that the parent embeds from multiple branches.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="book-search-scatter" aria-label="book-search-scatter JSON-LD DAG beside Mermaid generated from it." />

The JSON-LD and Mermaid are generated from the same `BookSearchScatterDAG` export. If the source shows a scatter, a retry loop, a salvage node, or a terminal edge, the diagram shows the same structure rather than a hand-drawn approximation.

### Running in a container

A scatter placement whose body is a DAG (rather than a single node) can run each clone's sub-DAG in an isolate. Add `container: "cpu"` to the scatter placement and bind a `DagContainerInterface` backend at dispatcher construction:

The scatter inbox, gather strategies, and outcome reducer are identical in both paths. See [Example 12: Worker Containers](./12-workers) for a complete runnable example of the container binding, including the `WorkerThreadContainer` instantiation and registry module.

## What It Lets You Do

Scatter lets an application fan out similar work without hand-writing orchestration loops. Use it when one parent state contains a source collection, each item should run through the same placement or body DAG, and the parent needs one merged result before continuing.

In product terms, this gives you a clean way to ask several services, tools, model prompts, parsers, or data partitions the same question. The DAG owns the fan-out, the gather contract owns the merge surface, and the next node receives normal state instead of a pile of ad hoc promises.

## Code Samples

The complete `BookSearchScatterDAG`, the sub-DAG the Archivist places three times for on-topic, author, and similar-search branches:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## Details for Nerds

- **`ScatterNode` with a descriptor source.** The source is a static provider list (`['openlibrary', 'googlebooks', 'subject', 'wikipedia']`). One clone runs per descriptor; `execution: { mode: 'item', concurrency: 2 }` caps how many clones run at once.
- **Heterogeneous fan-out via a dispatching body.** `scoutDispatch` reads `state.metadata.currentItem` (the provider name) and routes to the matching scout implementation. The engine runs four clones and is indifferent to whether the bodies are identical; the dispatcher is the body.
- **Required gather.** Every scatter declares `gather`. This one uses `{ strategy: 'collect', target: 'scoutResults' }` — each clone's output lands at `state.scoutResults[index]` in source order.
- **`any-success` outcome reducer.** Routes `'success'` when at least one clone succeeded; routes `'error'` when every clone errored; routes `'empty'` when there were no source items.
- **Scout gating via `state.toolPlan`.** Each scout checks `state.toolPlan` before making a network call. `decideTools` (an LLM call) populates the plan; scouts that find no matching plan entry return `'empty'` immediately. `wikipediaScout` is the exception; it runs on terms alone, always.
- **`scoutRetry` pass-through.** Every scout calls `scoutRetry.run(() => tool.execute(..., context.signal), context.signal)`. The signal propagates from the dispatcher through the retry policy: if the parent flow is cancelled, retries abort mid-backoff.
- **`bookSearchScatterDAG`.** The sub-DAG module exports the canonical JSON-LD DAG. The caller registers `{ nodes: nodes.bookSearchScatterNodes, dags: [bookSearchScatterDAG] }` before the parent DAG so every embedded reference resolves.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Example 01: Linear Intake](./01-linear)
- [Example 05: Embedded DAGs](./05-embedded-dags)
- [Reference: Core, `GatherStrategies`](../reference/core)
- [Reference: Entities, `ScatterNode`](../reference/entities)

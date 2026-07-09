---
title: 'Example 04: Scatter Scout'
description: 'The Archivist scatters JSON-serializable tool worksets through dynamic tool DAG references, then routes clone outputs into a first-class gather before ranking and merge.'
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

Scatter Scout is The Archivist's "send several librarians into the stacks at once" pattern. One visitor question becomes a set of JSON-serializable tool worksets: OpenLibrary keyword search, Google Books, OpenLibrary subject search, Wikipedia enrichment, or whichever registered tool DAGs the plan selects.

The point is not raw parallelism for its own sake. The parent DAG asks for one ranked answer, while the scatter branch lets each source work independently, report its own outcome, and return candidates in a deterministic shape that downstream ranking can trust.

## How It Works

The scout cluster runs as one `ScatterNode` over `state.bookWorksets`. Each clone reads its item-scoped `dagIri` value as a DAG IRI, resolves that value through a dynamic `DagReference` with explicit tool DAG candidates, and executes the selected tool DAG as the clone body.

Clone output does not disappear into scatter-local magic. The scatter routes `success` and `error` to the first-class `book-search-gather` placement, whose `tool-candidate-merge` strategy folds each clone's tool output into parent `state.candidates`. The `any-success` reducer decides whether the scatter leaves through `success`, `error`, or `empty`; the gather placement owns the parent-state merge.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

[The Archivist](./the-archivist) queries registered book tools from one scatter shape. The `BookSearchScatterDAG` packages the full scout cluster as a reusable sub-DAG body that the parent embeds from multiple branches.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="book-search-scatter" aria-label="book-search-scatter JSON-LD DAG beside Mermaid generated from it." />

The JSON-LD and Mermaid are generated from the same `BookSearchScatterDAG` export. The static graph view shows the scatter, the dynamic DAG reference body, the `book-search-gather` fan-in barrier, retry/salvage edges, and terminal exits rather than a hand-drawn approximation.

### Running in a container

A scatter placement whose body is a DAG (rather than a single node) can run each clone's sub-DAG in an isolate. Add `container: "cpu"` to the scatter placement and bind a `DagContainerInterface` backend at dispatcher construction:

The scatter inbox, first-class gather placement, and outcome reducer are identical in both paths. See [Example 12: Worker Containers](./12-workers) for a complete runnable example of the container binding, including the worker container role and registry module.

## What It Lets You Do

Scatter lets an application fan out similar work without hand-writing orchestration loops. Use it when one parent state contains a source collection, each item should run through the same placement or body DAG, and the parent needs one merged result before continuing.

In product terms, this gives you a clean way to ask several services, tools, model prompts, parsers, or data partitions the same question. The DAG owns the fan-out, the gather contract owns the merge surface, and the next node receives normal state instead of a pile of ad hoc promises.

## Code Samples

The complete `BookSearchScatterDAG`, the sub-DAG the Archivist places three times for on-topic, author, and similar-search branches:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## Details for Nerds

- **`ScatterNode` with workset source.** The source is `state.bookWorksets`, written by `build-book-worksets` from the selected tool plan. One clone runs per workset; `execution: { mode: 'item', concurrency: 4 }` caps how many clones run at once.
- **Heterogeneous fan-out via `DagReference`.** Each workset carries `dagIri` as a DAG IRI, and the scatter body resolves `{ dag: { from: 'item', path: 'dagIri', candidates: [...] } }` against explicit tool DAG candidates.
- **First-class gather.** `book-search-gather` is a `GatherNode` placement after the scatter. It uses `tool-candidate-merge` to fold clone tool outputs into parent `state.candidates`.
- **`any-success` outcome reducer.** Routes `'success'` when at least one clone succeeded; routes `'error'` when every clone errored; routes `'empty'` when there were no source items.
- **Scout gating via `state.toolPlan`.** `decideTools` populates the plan; `build-book-worksets` turns only selected calls into scatter items. Wikipedia enrichment still enters when useful terms exist, so the deep-one context can surface even when the model under-plans.
- **`scoutRetry` pass-through.** Every scout calls `scoutRetry.run(() => tool.execute(..., context.signal), context.signal)`. The signal propagates from the dispatcher through the retry policy: if the parent flow is cancelled, retries abort mid-backoff.
- **`bookSearchScatterDAG`.** The sub-DAG module exports the canonical JSON-LD DAG. The caller registers `{ nodes: nodes.bookSearchScatterNodes, dags: [bookSearchScatterDAG] }` before the parent DAG so every embedded reference resolves.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Example 01: Linear Intake](./01-linear)
- [Example 05: Embedded DAGs](./05-embedded-dags)
- [Reference: Core, `GatherStrategies`](../reference/core)
- [Reference: Entities, `ScatterNode`](../reference/entities)

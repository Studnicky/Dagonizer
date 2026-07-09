---
title: 'Example 05: Embedded DAGs'
description: 'The Archivist parent DAG places the same book-search-scatter sub-DAG three times and the compose-retry-loop sub-DAG once via EmbeddedDAGNode. One definition, multiple placements, with stateMapping to copy fields between parent and child state.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
  - text: 'Example 02: DAGBuilder'
    link: './02-builder'
    description: 'the full parent DAG authored with DAGBuilder'
  - text: 'Reference: Entities, `EmbeddedDAGNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 05: Embedded DAGs

## What It Is

Embedded DAGs are how reusable flow parts become first-class assembly pieces. The Archivist parent DAG places the same `book-search-scatter` sub-DAG three times and the `compose-retry-loop` sub-DAG once via `EmbeddedDAGNode`.

This is the plugin-shaped mental model: ship a DAG IRI with its node registrations, then let a higher-level DAG place that graph wherever the product flow needs it. One definition, multiple placements, explicit state boundaries.

## How It Works

The child DAG is registered in the same dispatcher registry as the parent. The parent placement references the child by DAG IRI, maps selected parent fields into child state before execution, waits for the child terminal outcome, maps selected child fields back to parent state, and then follows the parent placement's `success` or `error` route.

`stateMapping` keeps the boundary honest. The child receives only the parent fields it needs, and the parent receives only the child fields it asks for. The sub-DAG remains reusable because it is not secretly reaching into parent-specific state.

An `EmbeddedDAGNode` placement can also run the sub-DAG in an isolate by adding a `container` key to the placement and binding a `DagContainerInterface` backend at dispatcher construction. The Cartographer worker flow uses the same idea for contained work: execution location changes, but state mapping and routes stay part of the DAG contract.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

[The Archivist](./the-archivist) uses two packaged sub-DAGs, each placed via `.embed()`:

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist parent JSON-LD DAG beside Mermaid generated from it." />

The generated diagram shows the parent graph, not a whiteboard sketch. `on-topic-search`, `author-search`, and `similar-search` all place `book-search-scatter`; `compose-loop` places `compose-retry-loop`; the edges around those placements remain normal parent-DAG routes.

## What It Lets You Do

Embedded DAGs let applications package a reusable flow once and place it anywhere a parent DAG needs that behavior. Use this when a branch is large enough to own its own topology, state transfer boundary, and terminal semantics, but still belongs inside a larger product flow.

For plugin authors, this is the dev-ex target: a plugin can expose an embedded DAG IRI and node registry; the host can place it through the same interface it uses for local embedded DAGs. No second plugin assembly language, no hidden callback convention.

## Code Samples

#### Sub-DAG: the packaged scout cluster

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

#### Parent DAG: the embedded-DAG placements

The `#embedded-dag-placements` region covers only the `.embed(...)` calls: the three placements of `book-search-scatter` and the one placement of `compose-retry-loop`:

<<< @/../examples/the-archivist/dag.ts#embedded-dag-placements

#### Container-ready embedded placement

The Cartographer worker DAG shows the same contained-execution seam from a runnable browser example. A contained embedded placement adds a `container` role to the DAG document; the `stateMapping.input` seed and `stateMapping.output` copy operate identically in both paths. An unbound role uses in-process execution and fires `contractWarning`.

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

## Details for Nerds

### Typed `stateMapping` and growing shared state

The `.embed()` call accepts `TChildState` and `TParentState` generic parameters that narrow `options.inputs` keys and `options.outputs` paths to dotted paths that exist on the respective state at compile time. The Archivist placements above use those generic parameters for parent/child transfer.

A misspelled parent-state path is a compile error.

`stateMapping` is the right tool when the relationship between parent and child is a pure field transfer at a single boundary. When multiple embedded-DAG placements accumulate to a single growing structure (agent memory, a ranked-results list, an audit log), pass a `Store` into each node's constructor instead. The store lives outside the DAG topology; every placement reads and writes to the same instance without threading values through stateMapping at every hop. See [Shared state](../guide/shared-state) for the decision matrix, the concurrency contract, and checkpoint integration.

### What it demonstrates
- **`.embed(placementIri, dagIri, routes, options)`.** The placement references the sub-DAG by its registered DAG IRI. The parent and child run in the same dispatcher; the child shares the same node registry.
- **`book-search-scatter`**: the full 4-source scout cluster (extract query, decide tools, 4 parallel scouts, rank, merge, record, gate, recall). Placed three times in the parent: `on-topic-search`, `author-search`, and `similar-search`.
- **`compose-retry-loop`**: the compose, validate, retry, respond terminal. Placed once as `compose-loop`; every successful search branch converges on it.

Each embedded-DAG placement uses the wire field `stateMapping.input` to seed child fields from parent paths before the body runs and `stateMapping.output` to copy produced child fields back into the parent after the body completes. (The builder option object spells these `inputs` / `outputs`; the serialized JSON-LD wire form is singular.)

- **`stateMapping.input` (wire) / `inputs` (builder option).** Before the body runs, the dispatcher copies the listed parent fields into the child. The child receives the seed; the body then reads from the child.
- **`stateMapping.output` (wire) / `outputs` (builder option).** After the body completes, the dispatcher copies the listed child fields back into the parent. Fields not listed stay isolated.
- **One definition, three placements.** `urn:noocodec:dag:book-search-scatter` is registered once and placed three times with distinct placement IRIs and display names. Each placement routes its `'success'` and `'error'` outputs differently (`compose-loop`, `group-by-year`, or `compose-empty`).
- **Errors bubble up.** Anything the child accumulates via `state.collectError` reaches the parent's error accumulator automatically. The child's terminal outcome determines the `'error'` output.
- **`bookSearchScatterDAG` and `composeRetryLoopDAG`.** Each sub-DAG module exports a canonical JSON-LD DAG. Register literal bundles with the matching concrete node groups before the parent `archivistDAG` so embedded references resolve before parent validation.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Example 04: Scatter Scout](./04-scatter)
- [Example 02: DAGBuilder](./02-builder) - the full parent DAG authored with DAGBuilder
- [Reference: Entities, `EmbeddedDAGNode`](../reference/entities)

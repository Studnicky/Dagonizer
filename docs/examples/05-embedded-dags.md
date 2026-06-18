---
title: 'Phase 05: EmbeddedDAGNode composition'
description: 'The Archivist parent DAG places the same book-search-scatter sub-DAG three times and the compose-retry-loop sub-DAG once via EmbeddedDAGNode. One definition, multiple placements, with stateMapping to copy fields between parent and child state.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
  - text: 'Phase 02: DAGBuilder'
    link: './02-builder'
    description: 'the full parent DAG authored with DAGBuilder'
  - text: 'Reference: Entities, `EmbeddedDAGNode`'
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

# Phase 05: EmbeddedDAGNode composition

[The Archivist](./the-archivist) uses two packaged sub-DAGs, each placed via `.embeddedDAG()`:

- **`book-search-scatter`**: the full 4-source scout cluster (extract query, decide tools, 4 parallel scouts, rank, merge, record, gate, recall). Placed three times in the parent: `on-topic-search`, `author-search`, and `similar-search`.
- **`compose-retry-loop`**: the compose, validate, retry, respond terminal. Placed once as `compose-loop`; every successful search branch converges on it.

Each embedded-DAG placement uses the wire field `stateMapping.input` to seed child fields from parent paths before the body runs and `stateMapping.output` to copy produced child fields back into the parent after the body completes. (The builder option object spells these `inputs` / `outputs`; the serialized JSON-LD wire form is singular.)

<DagGraph :dag="archivistDAG" :embedded-d-a-gs="archivistRegistry" :expand-all="true" aria-label="The Archivist parent DAG with both sub-DAGs expanded inline." />

## Sub-DAG: the packaged scout cluster

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## Parent DAG: the embedded-DAG placements

The `#embedded-dag-placements` region covers only the `.embeddedDAG(...)` calls: the three placements of `book-search-scatter` and the one placement of `compose-retry-loop`:

<<< @/../examples/the-archivist/dag.ts#embedded-dag-placements

## EmbeddedDAGNode output routing to named terminals

An `EmbeddedDAGNode` placement's outputs map routes each output to a named `TerminalNode` placement declared via `.terminal(name, options?)`. Every output must target a named node — all flow branches end at an explicit `TerminalNode`.

<<< @/../examples/dags/05-embedded-dags.ts#parent-dag

See [Phase 09: Terminal placements](./09-terminals) for the full pattern with runnable examples.

## What it demonstrates

- **`.embeddedDAG(name, dagName, routes, options)`.** The placement references the sub-DAG by its registered name. The parent and child run in the same dispatcher; the child shares the same node registry.
- **`stateMapping.input` (wire) / `inputs` (builder option).** Before the body runs, the dispatcher copies the listed parent fields into the child. The child receives the seed; the body then reads from the child.
- **`stateMapping.output` (wire) / `outputs` (builder option).** After the body completes, the dispatcher copies the listed child fields back into the parent. Fields not listed stay isolated.
- **One definition, three placements.** `book-search-scatter` is registered once and placed three times with distinct placement names. Each placement routes its `'success'` and `'error'` outputs differently (`compose-loop`, `group-by-year`, or `compose-empty`).
- **Errors bubble up.** Anything the child accumulates via `state.collectError` reaches the parent's error accumulator automatically. The child's terminal outcome determines the `'error'` output.
- **`bookSearchScatterBundle` and `composeRetryLoopBundle`.** Each sub-DAG module exports a `DispatcherBundle` packaging its nodes plus its DAG. `dispatcher.registerBundle(bundle)` installs the nodes before the DAG; register both embedded-DAG bundles before the parent `archivistBundle`.

See this in action in the [Archivist live demo](./the-archivist).

## Running in a container

An `EmbeddedDAGNode` placement can run the sub-DAG in an isolate by adding a `container` key to the placement and binding a `DagContainerInterface` backend at dispatcher construction:

<<< @/../examples/12-workers.ts#dispatcher

In the DAG document, add `container: "isolated"` to the `EmbeddedDAGNode` placement. The `stateMapping.input` seed and `stateMapping.output` copy operate identically in both paths — only the execution location changes. An unbound role falls back to in-process and fires `contractWarning`. See [Example 12: Worker pool](./12-workers) for a complete walkthrough of the registry module and pool lifecycle.

## Typed `stateMapping` and growing shared state

The `.embeddedDAG()` call accepts `TChildState` and `TParentState` generic parameters that narrow `options.inputs` keys and `options.outputs` paths to dotted paths that exist on the respective state at compile time:

<<< @/../examples/dags/05-embedded-dags.ts#builder-state-mapping

A misspelled parent-state path is a compile error.

`stateMapping` is the right tool when the relationship between parent and child is a pure field transfer at a single boundary. When multiple embedded-DAG placements accumulate to a single growing structure (agent memory, a ranked-results list, an audit log), thread a `Store` through the services bag instead. The store lives outside the DAG topology; every placement reads and writes to the same instance without threading values through stateMapping at every hop. See [Shared state](../guide/shared-state) for the decision matrix, the concurrency contract, and checkpoint integration.

## Composing the same flow via `DAGDeriver.embeddedDAGs`

The DAGBuilder `.embeddedDAG(...)` path above is the deterministic authoring surface. The same `EmbeddedDAGNode` can be produced declaratively via the `DAGDeriver` `embeddedDAGs` annotation when the surrounding flow is agent-style:

<<< @/../examples/dags/derive.ts#derive

- The contract's `produces` to `hardRequired` chain still drives topology; the `embeddedDAGs` annotation renders an `EmbeddedDAGNode`. `stateMapping.input` seeds the child; `stateMapping.output` copies child fields back.
- Every port in `embeddedDAG.outputs` auto-wires to the next derived stage. `terminals` overrides individual ports if the error path needs a different target.
- Body references resolve at `registerDAG` time; the dispatcher's existing cycle check rejects self-referential embedded-DAG bodies.
- A runnable demonstration ships in [`examples/derive.ts`](https://github.com/Studnicky/Dagonizer/blob/main/examples/derive.ts) (`npm run example:derive`).

See [Authoring DAGs](../guide/authoring) for the decision matrix between the imperative `.embeddedDAG()` path and the declarative `embeddedDAGs` annotation.

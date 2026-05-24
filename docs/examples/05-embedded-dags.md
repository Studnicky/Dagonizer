---
title: 'Phase 05: Embedded-DAG composition'
description: 'The Archivist parent DAG places the same book-search-fanout embedded-DAG three times and the compose-retry-loop embedded-DAG once. One definition, multiple placements, with stateMapping to copy fields between parent and child state.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 04: Fan-out scout'
    link: './04-fanout'
  - text: 'Phase 02: DAGBuilder'
    link: './02-builder'
    description: 'the full parent DAG authored with DAGBuilder'
  - text: 'Reference: Entities, `EmbeddedDAGNode`'
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

# Phase 05: Embedded-DAG composition

[The Archivist](./the-archivist) uses two packaged embedded-DAGs:

- **`book-search-fanout`**: the full 4-source scout cluster (extract query, decide tools, 4 parallel scouts, rank, merge, record, gate, recall). Placed three times in the parent: `on-topic-search`, `author-search`, and `similar-search`.
- **`compose-retry-loop`**: the compose, validate, retry, respond terminal. Placed once as `compose-loop`; every successful search branch converges on it.

The parent DAG references both embedded-DAGs by name via `.embeddedDAG(placementName, dagName, routes, options)`. Each placement has its own `stateMapping.output` that copies the embedded-DAG's writes back into the named parent state fields.

<DagGraph :elements="elements" aria-label="The Archivist parent DAG with both embedded-DAGs expanded inline." />

## Embedded-DAG: the packaged fan-out cluster

<<< @/../examples/the-archivist/embedded-dags/BookSearchFanoutDAG.ts

## Parent DAG: the embedded-DAG placements

The `#embedded-dag-placements` region covers only the `.embeddedDAG(...)` calls: the three placements of `book-search-fanout` and the one placement of `compose-retry-loop`:

<<< @/../examples/the-archivist/dag.ts#embedded-dag-placements

## Embedded-DAG output routing: null and named terminals

A `EmbeddedDAGNode` placement's outputs map accepts two target forms:

- **`null`**: the branch ends with `outcome: completed`. Identical to any other null route, sugar for an implicit completed terminal. Use it when the parent flow has a single clean termination path and the lifecycle outcome is always `completed`.
- **Named `TerminalNode` placement**: target an explicit terminal declared via `.terminal(name, outcome?)`. The idiomatic form when the `error` output should mark the parent flow as `failed`, or when the diagram should show the endpoint as a discrete node.

```ts
// null route: both success and error end with outcome=completed
.embeddedDAG('invoke', 'child', { success: null, error: null })

// named terminals: error path marks the parent flow as failed
.embeddedDAG('invoke', 'child', { success: 'end-ok', error: 'end-fail' })
.terminal('end-ok')
.terminal('end-fail', 'failed')
```

See [Phase 09: Terminal placements](./09-terminals) for the full pattern with runnable examples.

## What it demonstrates

- **`.embeddedDAG(name, dagName, routes, options)`.** The placement references the embedded-DAG by its registered name. The parent and child run in the same dispatcher; the child shares the same node registry.
- **`stateMapping.output`.** After the embedded-DAG completes, the dispatcher copies the listed fields from the child's final state back into the parent state. Fields not listed stay isolated.
- **One definition, three placements.** `book-search-fanout` is registered once and placed three times with distinct placement names. Each placement routes its `'success'` and `'error'` outputs differently (`compose-loop`, `group-by-year`, or `decline-empty`).
- **Errors bubble up.** Anything the child collects via `state.collectError` reaches the parent's error accumulator automatically. The `executeEmbeddedDAG` router uses child-state errors to decide the `'error'` output.
- **`registerBookSearchFanoutNodes` and `registerComposeRetryLoopNodes`.** Each embedded-DAG module exports a helper that registers exactly the nodes it needs. Call both before registering the parent DAG.

See this in action in the [Archivist live demo](./the-archivist).

## Typed `inputs` / `outputs` and growing shared state

The `.embeddedDAG()` call accepts a generic `TChildState` parameter that narrows
the left side of `inputs` to keys declared on the child state at compile time:

```ts
class ChildState extends NodeStateBase {
  query = '';
  results: string[] = [];
}

builder.embeddedDAG<ChildState>('search', 'book-search-fanout',
  { success: 'compose-loop', error: 'decline-empty' },
  {
    inputs:  { query: 'userQuery' },          // 'query' must be a key of ChildState
    outputs: { 'searchResults': 'results' },
  },
);
```

A misspelled child-state key is a compile error. Parent-side path narrowing
(`Path<TParentState>`) is a v0.12 follow-up; `outputs` stays `Record<string, string>`.

`stateMapping` (`inputs`, `outputs`) is the right tool when the relationship between parent and child is a pure field transfer at a single boundary. When multiple embedded-DAGs accumulate to a single growing structure (agent memory, a ranked-results list, an audit log), thread a `Store` through the services bag instead. The store lives outside the DAG topology; every placement reads and writes to the same instance without threading values through stateMapping at every hop. See [Shared state](../guide/shared-state) for the decision matrix, the concurrency contract, and checkpoint integration.

## Composing the same flow via `DAGDeriver.embeddedDAGs`

The DAGBuilder `.embeddedDAG(...)` path above is the deterministic authoring surface. The same `EmbeddedDAGNode` placement can be produced declaratively via the `DAGDeriver` `embeddedDAGs` annotation when the surrounding flow is agent-style (operations declare dependencies; topology emerges):

```ts
DAGDeriver.derive({
  name: 'parent',
  version: '1',
  entrypoint: 'prepare',
  contracts: [
    { name: 'prepare',       hardRequired: ['input'],         produces: ['intermediate'], outputs: ['success'] },
    { name: 'invoke-plugin', hardRequired: ['intermediate'],  produces: ['childResult'],  outputs: ['success', 'error'] },
    { name: 'finalize',      hardRequired: ['childResult'],   produces: ['final'],        outputs: ['success'] },
  ],
  annotations: {
    embeddedDAGs: {
      'invoke-plugin': {
        dag:     'plugin:transform',
        outputs: ['success', 'error'],
        stateMapping: {
          input:  { intermediate: 'intermediate' },
          output: { childResult:  'childResult' },
        },
      },
    },
  },
});
```

- The contract's `produces` to `hardRequired` chain still drives topology; the `embeddedDAGs` annotation swaps the rendered placement from `SingleNode` to `EmbeddedDAGNode`.
- Every port in `embeddedDAG.outputs` auto-wires to the next derived stage. `terminals` overrides individual ports if the error path needs a different target.
- Embedded-DAG references resolve at `registerDAG` time; the dispatcher's existing cycle check rejects self-referential embeddedDAGs.
- A runnable demonstration ships in [`examples/derive.ts`](https://github.com/Studnicky/Dagonizer/blob/main/examples/derive.ts) (`npm run example:derive`).

See [Authoring DAGs](../guide/authoring) for the decision matrix between the imperative `.embeddedDAG()` path and the declarative `embeddedDAGs` annotation.

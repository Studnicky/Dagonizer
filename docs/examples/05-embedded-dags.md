---
title: 'Phase 05: Scatter sub-DAG composition'
description: 'The Archivist parent DAG places the same book-search-fanout sub-DAG three times and the compose-retry-loop sub-DAG once via ScatterNode. One definition, multiple placements, with projection and gather to copy fields between parent and clone state.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 04: Scatter scout'
    link: './04-fanout'
  - text: 'Phase 02: DAGBuilder'
    link: './02-builder'
    description: 'the full parent DAG authored with DAGBuilder'
  - text: 'Reference: Entities, `ScatterNode`'
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

# Phase 05: Scatter sub-DAG composition

[The Archivist](./the-archivist) uses two packaged sub-DAGs, each placed via `.scatter()` with `body: { dag }`:

- **`book-search-fanout`**: the full 4-source scout cluster (extract query, decide tools, 4 parallel scouts, rank, merge, record, gate, recall). Placed three times in the parent: `on-topic-search`, `author-search`, and `similar-search`.
- **`compose-retry-loop`**: the compose, validate, retry, respond terminal. Placed once as `compose-loop`; every successful search branch converges on it.

Each scatter placement uses `projection` to seed clone fields from parent paths before the body runs and `gather` to merge produced clone fields back into the parent after the body completes.

<DagGraph :elements="elements" aria-label="The Archivist parent DAG with both sub-DAGs expanded inline." />

## Sub-DAG: the packaged scout cluster

<<< @/../examples/the-archivist/embedded-dags/BookSearchFanoutDAG.ts

## Parent DAG: the scatter placements

The `#embedded-dag-placements` region covers only the `.scatter(...)` calls: the three placements of `book-search-fanout` and the one placement of `compose-retry-loop`:

<<< @/../examples/the-archivist/dag.ts#embedded-dag-placements

## Scatter output routing: null and named terminals

A `ScatterNode` placement's outputs map accepts two target forms:

- **`null`**: the branch ends with `outcome: completed`. Identical to any other null route, sugar for an implicit completed terminal. Use it when the parent flow has a single clean termination path and the lifecycle outcome is always `completed`.
- **Named `TerminalNode` placement**: target an explicit terminal declared via `.terminal(name, outcome?)`. The idiomatic form when the `error` output should mark the parent flow as `failed`, or when the diagram should show the endpoint as a discrete node.

```ts
// null route: both success and error end with outcome=completed
.scatter('invoke', { dag: 'child' }, { success: null, error: null })

// named terminals: error path marks the parent flow as failed
.scatter('invoke', { dag: 'child' }, { success: 'end-ok', error: 'end-fail' })
.terminal('end-ok')
.terminal('end-fail', 'failed')
```

See [Phase 09: Terminal placements](./09-terminals) for the full pattern with runnable examples.

## What it demonstrates

- **`.scatter(name, { dag: dagName }, routes, options)`.** The placement references the sub-DAG by its registered name. The parent and child run in the same dispatcher; the child shares the same node registry.
- **`projection`.** Before the body runs, the dispatcher copies the listed parent fields into the clone. The clone receives the seed; the body then reads from the clone.
- **`gather: { strategy: 'map', mapping }`.** After the body completes, the dispatcher copies the listed clone fields back into the parent. Fields not listed stay isolated.
- **One definition, three placements.** `book-search-fanout` is registered once and placed three times with distinct placement names. Each placement routes its `'success'` and `'error'` outputs differently (`compose-loop`, `group-by-year`, or `decline-empty`).
- **Errors bubble up.** Anything the clone collects via `state.collectError` reaches the parent's error accumulator automatically. The `terminal` reducer uses clone-state errors to decide the `'error'` output.
- **`registerBookSearchFanoutNodes` and `registerComposeRetryLoopNodes`.** Each sub-DAG module exports a helper that registers exactly the nodes it needs. Call both before registering the parent DAG.

See this in action in the [Archivist live demo](./the-archivist).

## Typed `projection` / `gather` and growing shared state

The `.scatter()` call accepts a `TState` generic parameter that narrows `options.projection` values and `options.gather.mapping` values to dotted paths that exist on the state at compile time:

```ts
class ParentState extends NodeStateBase {
  userQuery = '';
  candidates: string[] = [];
}

builder.scatter<ParentState>('search', { dag: 'book-search-fanout' },
  { success: 'compose-loop', error: 'decline-empty' },
  {
    projection: { query: 'userQuery' },               // 'userQuery' must be a path on ParentState
    gather: { strategy: 'map', mapping: { 'candidates': 'searchResults' } },
  },
);
```

A misspelled parent-state path is a compile error.

`projection` and `gather` are the right tool when the relationship between parent and clone is a pure field transfer at a single boundary. When multiple scatter placements accumulate to a single growing structure (agent memory, a ranked-results list, an audit log), thread a `Store` through the services bag instead. The store lives outside the DAG topology; every placement reads and writes to the same instance without threading values through projection/gather at every hop. See [Shared state](../guide/shared-state) for the decision matrix, the concurrency contract, and checkpoint integration.

## Composing the same flow via `DAGDeriver.embeddedDAGs`

The DAGBuilder `.scatter(...)` path above is the deterministic authoring surface. The same `ScatterNode` with `body: { dag }` can be produced declaratively via the `DAGDeriver` `embeddedDAGs` annotation when the surrounding flow is agent-style:

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

- The contract's `produces` to `hardRequired` chain still drives topology; the `embeddedDAGs` annotation renders a `ScatterNode` with `body: { dag }`. `stateMapping.input` becomes `projection`; `stateMapping.output` becomes a `map` gather.
- Every port in `embeddedDAG.outputs` auto-wires to the next derived stage. `terminals` overrides individual ports if the error path needs a different target.
- Scatter body references resolve at `registerDAG` time; the dispatcher's existing cycle check rejects self-referential scatter bodies.
- A runnable demonstration ships in [`examples/derive.ts`](https://github.com/Studnicky/Dagonizer/blob/main/examples/derive.ts) (`npm run example:derive`).

See [Authoring DAGs](../guide/authoring) for the decision matrix between the imperative `.scatter()` path and the declarative `embeddedDAGs` annotation.

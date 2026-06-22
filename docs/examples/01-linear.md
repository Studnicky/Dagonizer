---
title: 'Phase 01: Linear intake'
description: 'The Archivist demo end-to-end: dispatcher wiring, molecular sub-DAG registration, and a single execute call. Demonstrates Dagonizer node registration, DAG registration order, and lifecycle output.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'the `book-search-scatter` sub-DAG internals'
  - text: 'DAGBuilder'
    link: '../guide/builder'
  - text: 'Reference: Dagonizer'
    link: '../reference/dagonizer'
  - text: 'Reference: Entities, `SingleNode`'
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

# Phase 01: Linear intake

The simplest slice of [The Archivist](./the-archivist): wire a dispatcher, register its nodes and DAGs in dependency order, execute one visitor query, and read the lifecycle result. The full runner is below; this is the real code.

<DagGraph :dag="archivistDAG" :embedded-d-a-gs="archivistRegistry" :expand-all="true" aria-label="The Archivist DAG with sub-DAGs expanded." />

## Code

The `#linear-run` region covers the dispatcher construction, molecular sub-DAG registration, and the `execute` call that drives the full flow:

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

## What it demonstrates

- **Bundle registration order.** Each sub-DAG ships a `DispatcherBundleType` (its nodes plus its DAG); `dispatcher.registerBundle(bundle)` installs every node before the DAG. Register the embedded-DAG bundles (`bookSearchScatterBundle`, `composeRetryLoopBundle`) before the parent `archivistBundle`. The dispatcher validates all node references at registration time.
- **Single execute call.** `dispatcher.execute('the-archivist', visitor)` drives the entire multi-branch flow. The caller sees one `ExecutionResult<ArchivistState>` containing the final state and lifecycle.
- **Lifecycle result.** `result.state.lifecycle.variant` is `'completed'`, `'cancelled'`, or `'timed_out'`. Nodes never throw; the dispatcher always returns.
- **Services record.** Every node receives `context.services` (LLM, search tools, memory, logger). Nodes never construct their own clients.

See this in action in the [Archivist live demo](./the-archivist).

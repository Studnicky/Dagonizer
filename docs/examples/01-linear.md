---
title: 'Phase 01: Linear intake'
description: 'The Archivist demo end-to-end: dispatcher wiring, molecular sub-DAG registration, and a single execute call. Demonstrates Dagonizer node registration, DAG registration order, and lifecycle output.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Phase 04: Fan-out scout'
    link: './04-fanout'
    description: 'the `book-search-fanout` sub-DAG internals'
  - text: 'DAGBuilder'
    link: '../guide/builder'
  - text: 'Reference: Dagonizer'
    link: '../reference/dagonizer'
  - text: 'Reference: Entities, `SingleNode`'
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

# Phase 01: Linear intake

The simplest slice of [The Archivist](./the-archivist): wire a dispatcher, register its nodes and DAGs in dependency order, execute one visitor query, and read the lifecycle result. The full runner is below; this is the real code.

<DagGraph :elements="elements" aria-label="The Archivist DAG with sub-DAGs expanded." />

## Code

The `#linear-run` region covers the dispatcher construction, molecular sub-DAG registration, and the `execute` call that drives the full flow:

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

## What it demonstrates

- **Molecular registration order.** Sub-DAG nodes must be registered before their DAG is registered (`registerBookSearchFanoutNodes` then `dispatcher.registerDAG(BookSearchFanoutDAG)`), and both sub-DAGs before the parent `archivistDAG`. The dispatcher validates all node references at registration time.
- **Single execute call.** `dispatcher.execute('the-archivist', visitor)` drives the entire multi-branch flow. The caller sees one `ExecutionResult<ArchivistState>` containing the final state and lifecycle.
- **Lifecycle result.** `result.state.lifecycle.kind` is `'completed'`, `'cancelled'`, or `'timed_out'`. Nodes never throw; the dispatcher always returns.
- **Services bag.** Every node receives `context.services` (LLM, search tools, memory, logger). Nodes never construct their own clients.

See this in action in the [Archivist live demo](./the-archivist).

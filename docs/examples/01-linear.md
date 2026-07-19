---
title: 'Example 01: Linear Intake'
description: 'The Archivist end-to-end host: dispatcher wiring, sub-DAG registration, and a single execute call over the canonical parent DAG.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Example 04: Scatter Scout'
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
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 01: Linear Intake

## CLI Host

Example 01 is the smallest host shell around the real Archivist bundle. It builds the dispatcher, registers the packaged sub-DAGs and parent DAG, executes one visitor state, and reads back the lifecycle result.

This is the startup contract behind every Dagonizer host. A CLI entrypoint, request handler, worker task, or browser shell still begins by loading a registry-backed DAG bundle and calling `execute` on a state object.

## Canonical Document and Runtime

The diagram and CLI entrypoint below are the same parent DAG and host file the product example uses. Keep them together: the graph shows what must already exist in the registry, and the host shows when that registration happens and what result shape the runtime returns.

### DAG registration and diagram

The host registers `bookSearchScatterDAG` and `composeRetryLoopDAG` first, then registers `archivistDAG`, so every `EmbeddedDAGNode` reference resolves during registration rather than halfway through a run.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## Registration and Execution Model

The dispatcher owns registries, not host globals. The runner gives it a `DispatcherBundleType` containing node instances and canonical DAG documents. Once the bundle is registered, `dispatcher.execute('urn:noocodec:dag:the-archivist', visitor)` starts at the DAG entrypoint and follows the declared output route from each node.

The result is one `ExecutionResult<ArchivistState>`: final state, lifecycle variant, cursor, executed nodes, skipped nodes, warnings, and errors. This is the same result shape handed back to a CLI, request handler, test harness, or interactive host.

## Code Samples

This code is the host shell for the Archivist DAG. It is the piece most hosts write first: construct dependencies, register the bundle, call `execute`, and read the returned lifecycle.

### Code

The `#linear-run` region covers the dispatcher construction, sub-DAG registration, and the `execute` call that drives the full flow:

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

## Operational Uses

Use this host shape when you want a thin host shell around a packaged workflow. Keep the graph in a package, construct dependencies in host code, register the bundle at startup, and drive execution from one state object.

It is also the fastest registry check: if a node or embedded DAG appears in JSON-LD but is not registered, `registerDAG` fails before any request, model call, or data job reaches runtime.

## Runtime Notes

Registration is a runtime contract, not a convenience cache. DAG registration checks that placement IRIs resolve, node outputs have routes, and embedded DAG references do not form circular references before any execution begins.

This host shell is the shortest registry and entrypoint check for the Archivist bundle: if it boots, node registration, DAG registration, and entrypoint resolution agree. Later examples add richer placement types, but they still rely on this same startup contract.

### Runtime contract
- **Registration order.** Each sub-DAG ships as a canonical JSON-LD DAG constant; the caller registers a literal `DispatcherBundleType` with the concrete node group and that DAG. Register the embedded DAGs (`bookSearchScatterDAG`, `composeRetryLoopDAG`) before the parent `archivistDAG`. The dispatcher validates all node references at registration time.
- **Single execute call.** `dispatcher.execute('urn:noocodec:dag:the-archivist', visitor)` drives the entire multi-branch flow. The caller sees one `ExecutionResult<ArchivistState>` containing the final state and lifecycle.
- **Lifecycle result.** `result.state.lifecycle.variant` is `'completed'`, `'cancelled'`, or `'timed_out'`. Nodes never throw; the dispatcher always returns.
- **Constructor injection.** Every node receives its dependencies (LLM adapter, search tools, memory, logger) through its constructor. Nodes hold them as private fields and never construct their own clients.

The larger workflow built on the same DAG style is [The Archivist](./the-archivist).

## Related Concepts

These related pages expand the same minimal flow into richer graph features.

- [Running domain: The Archivist](./the-archivist)
- [Example 04: Scatter Scout](./04-scatter) - the `book-search-scatter` sub-DAG internals
- [DAGBuilder](../guide/builder)
- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Entities, `SingleNode`](../reference/entities)

---
title: 'Example 01: Linear Intake'
description: 'The Archivist demo end-to-end: dispatcher wiring, sub-DAG registration, and a single execute call. Demonstrates Dagonizer node registration, DAG registration order, and lifecycle output.'
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
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 01: Linear Intake

## What It Is

Example 01 is the smallest host around the real Archivist DAG. It shows the boring but essential part every application needs: create the dispatcher, register nodes, register the DAGs in dependency order, execute one state object, and inspect the result.

Nothing clever happens here, and that is why the page matters. Before scatter, plugins, checkpoint stores, or browser runners enter the picture, an application author needs to see the plain runtime handshake between registry entries and JSON-LD graph shape.

## How It Works

The dispatcher owns registries, not application globals. The runner gives it a `DispatcherBundleType` containing node instances and canonical DAG documents. Once the bundle is registered, `dispatcher.execute('urn:noocodec:dag:the-archivist', visitor)` starts at the DAG entrypoint and follows the declared output route from each node.

The result is one `ExecutionResult<ArchivistState>`: final state, lifecycle variant, cursor, executed nodes, skipped nodes, warnings, and errors. This is the shape to copy when embedding Dagonizer inside a CLI, request handler, test harness, or browser runner.

## Diagrams, Examples, and Outputs

The diagram is the live Archivist parent DAG. It is large because Example 01 intentionally does not simplify the domain: this is the real graph, with embedded search and compose sub-DAG placements visible in the JSON-LD and Mermaid pairing.

Use it to connect registration order to graph resolution. The parent DAG references embedded DAG IRIs, so those sub-DAGs must be present in the registry before execution starts.

### DAG registration and diagram

The graph is the live [Archivist](./the-archivist) parent DAG. The runner registers the embedded sub-DAGs first, then registers this parent DAG, so every `EmbeddedDAGNode` reference resolves before execution starts.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## What It Lets You Do

This lets you build the simplest possible host for a serious graph. You can keep the graph in a package, construct dependencies in application code, register the bundle at startup, and drive execution with a single state object.

It also gives reviewers an easy first check: if a node or embedded DAG appears in JSON-LD but is not registered, `registerDAG` fails before a customer request, model call, or data job ever runs.

## Code Samples

This code is the host shell for the Archivist DAG. It is the piece applications usually write first: construct dependencies, register the bundle, call `execute`, and inspect the returned lifecycle.

### Code

The `#linear-run` region covers the dispatcher construction, sub-DAG registration, and the `execute` call that drives the full flow:

<<< @/../examples/the-archivist/runArchivist.ts#linear-run

## Details for Nerds

The important detail is that registration is validation, not just storage. DAG registration checks that placement IRIs resolve, node outputs have routes, and embedded DAG references do not form circular references.

That makes Example 01 a useful smoke test: if this host boots, the registry and the parent graph agree. Later examples add richer placement types, but they still rely on this same startup contract.

### What it demonstrates
- **Registration order.** Each sub-DAG ships as a canonical JSON-LD DAG constant; the caller registers a literal `DispatcherBundleType` with the concrete node group and that DAG. Register the embedded DAGs (`bookSearchScatterDAG`, `composeRetryLoopDAG`) before the parent `archivistDAG`. The dispatcher validates all node references at registration time.
- **Single execute call.** `dispatcher.execute('urn:noocodec:dag:the-archivist', visitor)` drives the entire multi-branch flow. The caller sees one `ExecutionResult<ArchivistState>` containing the final state and lifecycle.
- **Lifecycle result.** `result.state.lifecycle.variant` is `'completed'`, `'cancelled'`, or `'timed_out'`. Nodes never throw; the dispatcher always returns.
- **Constructor injection.** Every node receives its dependencies (LLM adapter, search tools, memory, logger) through its constructor. Nodes hold them as private fields and never construct their own clients.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

Read these next when you want to expand the same host pattern into richer graph features.

- [Running domain: The Archivist](./the-archivist)
- [Example 04: Scatter Scout](./04-scatter) - the `book-search-scatter` sub-DAG internals
- [DAGBuilder](../guide/builder)
- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Entities, `SingleNode`](../reference/entities)

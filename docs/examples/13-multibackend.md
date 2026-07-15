---
title: 'Example 13: Multi-Backend Roles'
description: 'The Cartographer browser workers DAG assigns the canonical event scatter to a cpu container and the summary embedded DAG to an io container while preserving the same JSON-LD graph.'
seeAlso:
  - text: 'The Cartographer'
    link: './the-cartographer'
    description: 'in-browser runnable demo that owns the multi-backend worker role pattern'
  - text: 'Example 12: Worker Containers'
    link: './12-workers'
    description: 'single worker-role container binding'
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'container and deployment patterns'
---

<script setup lang="ts">
import { cartographerWorkersDAG, eventPipelineTypedDAG, insightsSummaryDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 13: Multi-Backend Roles

## What It Is

Multi-Backend Roles let one application DAG send different placements to different execution backends. The Cartographer assigns canonical event processing to `cpu` and summary generation to `io` while preserving the same JSON-LD graph.

The role names are deployment labels, not new workflow primitives. The graph stays portable because it asks for `cpu` and `io`; the host decides whether those roles mean browser workers, Node worker threads, forked processes, or in-process execution.

## How It Works

Each placement declares only a logical role name. The host decides what backend satisfies that role: a browser worker pool, Node worker threads, forked processes, or in-process execution. The JSON-LD graph remains portable because topology references roles, not concrete transports.

### Runtime behavior

Run the browser demo from the docs dev server:

```bash
pnpm run docs:dev
```

Then open [The Cartographer](./the-cartographer), click **Run**, and watch the
**DAG** pane. The graph expands the same registered DAGs shown above:

- `process-stream` fans out through `event-pipeline-typed` on the `cpu` role.
- `summarize-insights` invokes `insights-summary` on the `io` role.
- The parent DAG stays a JSON-LD graph of placements, routes, and container
  role names.

## Diagrams, Examples, and Outputs

The diagrams are generated from the Cartographer worker DAGs the browser demo executes, so role labels and embedded body DAGs stay visible beside their JSON-LD.

### DAG registration and diagram

The in-browser [Cartographer](./the-cartographer) demo is the executable example
for multi-backend role binding. The same JSON-LD assembly expresses both:

- `process-stream` is a `ScatterNode` delegated to container role `cpu`.
- `summarize-insights` is an `EmbeddedDAGNode` delegated to container role `io`.

The browser runner binds both roles to real `WebWorkerContainer` pools. The DAG
does not change when a role is in-process, in a worker, or supplied by a plugin
registry; the canonical assembly remains JSON-LD produced by the builder.

#### Top-level browser DAG

`cartographerWorkersDAG` is the DAG rendered and executed by the Cartographer
page. The Mermaid diagram is generated from the JSON-LD below it, so the
container-role labels are visible in the same shape the dispatcher executes.

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer workers DAG" aria-label="Cartographer workers JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

#### `cpu` body DAG

The `cpu` role runs the `event-pipeline-typed` body for every canonical event.
This is not a synthetic worker sample; it is the live Cartographer typed
enrichment and routing pipeline after producer feed DAGs unpack and normalize
the raw payloads.

<DagJsonMermaid :dag="eventPipelineTypedDAG" title="event-pipeline-typed body DAG" aria-label="Typed event pipeline JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/dag.ts#event-pipeline-typed-dag

#### `io` body DAG

The `io` role runs the summary body as an embedded DAG after the scatter gather
fold completes. Packaging the summary as a DAG keeps plugins, embedded flows,
and container delegation on one interface.

<DagJsonMermaid :dag="insightsSummaryDAG" title="insights-summary body DAG" aria-label="Insights summary JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/dag.ts#insights-summary-dag

## What It Lets You Do

Multi-backend roles let applications bind different parts of one DAG to different execution backends without changing the canonical graph. Use this when CPU-bound stream processing, IO-bound summary work, and in-process orchestration need separate pools, quotas, or deployment targets.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Browser role binding

The runnable page creates two role bindings from the same registry-backed worker
entry. The registry contains every DAG the worker can execute: the stream-event
compatibility tree, the event-pipeline-typed tree for `cpu`, and the
insights-summary DAG for `io`.

<<< @/../docs/.vitepress/theme/components/CartographerRunner.vue#cartographer-browser-containers

<<< @/../docs/.vitepress/theme/components/cartographerWorkerRegistry.ts#cartographer-worker-registry

## Details for Nerds

### Node CLI companion

The repository also keeps `examples/13-multibackend.ts` as a Node CLI companion
for worker-thread plus fork-container execution:

```bash
pnpm example:13
```

That CLI exercises the same renderer role-color path, but the browser runnable
for this principle is the Cartographer code above.

- **Role names preserve portability.** `cpu` and `io` are deployment labels, not new placement types.
- **Multiple backends share one registry interface.** The worker registry contains every DAG either role can execute.
- **JSON-LD remains canonical.** Container delegation is a placement attribute in the same document the builder emits and the dispatcher consumes.
- **Browser and Node hosts choose different backends.** The docs runnable uses `WebWorkerContainer`; the CLI companion can exercise Node container implementations.

## Related Concepts

- [The Cartographer](./the-cartographer) - in-browser runnable demo that owns the multi-backend worker role pattern
- [Example 12: Worker Containers](./12-workers) - single worker-role container binding
- [Guide: Distribution and Cloud](../guide/distribution) - container and deployment patterns

---
title: 'Example 13: Multi-Backend Roles'
description: 'The Cartographer worker DAG assigns the canonical event scatter to a cpu container and the summary embedded DAG to an io container while preserving the same JSON-LD graph.'
seeAlso:
  - text: 'The Cartographer'
    link: './the-cartographer'
    description: 'Cartographer worker DAG using separate cpu and io container roles'
  - text: 'Example 12: Worker Containers'
    link: './12-workers'
    description: 'single worker-role container binding'
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'container and deployment patterns'
---

<script setup lang="ts">
import { cartographerWorkersDAG, insightsSummaryDAG } from '../../examples/the-cartographer/dag.ts';
import { streamEventDAG } from '../../examples/the-cartographer/embedded-dags/StreamEventDAG.ts';
</script>

# Example 13: Multi-Backend Roles

## Role-bound Execution Surface

Multi-Backend Roles let one DAG send different placements to different execution backends. The Cartographer assigns canonical event processing to `cpu` and summary generation to `io` while preserving the same JSON-LD graph.

The role names are deployment labels, not new workflow primitives. The graph stays portable because it asks for `cpu` and `io`; the host decides whether those roles mean browser workers, Node worker threads, forked processes, or in-process execution.

## Multi-role Worker Topology

The diagrams are generated from the Cartographer worker DAGs the runtime executes, so role labels and embedded body DAGs stay visible beside their JSON-LD.

### DAG registration and diagram

The [Cartographer](./the-cartographer) workflow is the concrete example
for multi-backend role binding. The same JSON-LD assembly expresses both:

- `process-stream` is a `ScatterNode` delegated to container role `cpu`.
- `summarize-insights` is an `EmbeddedDAGNode` delegated to container role `io`.

The Cartographer runtime binds both roles to real `WebWorkerContainer` pools. The DAG
does not change when a role is in-process, in a worker, or supplied by a plugin
registry; the canonical assembly remains JSON-LD produced by the builder.

#### Top-level Cartographer DAG

`cartographerWorkersDAG` is the DAG rendered and executed by the Cartographer
runtime. The Mermaid diagram is generated from the JSON-LD below it, so the
container-role labels are visible in the same shape the dispatcher executes.

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer workers DAG" aria-label="Cartographer workers JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

#### `cpu` body DAG

The `cpu` role runs the `stream-event` body for every source payload. This is
not a synthetic worker sample; it is the live Cartographer decoding,
enrichment, and per-event-type routing pipeline.

<DagJsonMermaid :dag="streamEventDAG" title="stream-event body DAG" aria-label="Stream event pipeline JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/embedded-dags/StreamEventDAG.ts#stream-event-dag

#### `io` body DAG

The `io` role runs the summary body as an embedded DAG after the scatter gather
fold completes. Packaging the summary as a DAG keeps plugins, embedded flows,
and container delegation on one interface.

<DagJsonMermaid :dag="insightsSummaryDAG" title="insights-summary body DAG" aria-label="Insights summary JSON-LD DAG beside Mermaid generated from it." />

<<< @/../examples/the-cartographer/dag.ts#insights-summary-dag

## Role-to-Backend Model

Each placement declares only a logical role name. The host decides what backend satisfies that role: a browser worker pool, Node worker threads, forked processes, or in-process execution. The JSON-LD graph remains portable because topology references roles, not concrete transports.

### Runtime behavior

Start the local site:

```bash
pnpm run site:dev
```

Then visit [The Cartographer](./the-cartographer), click **Run**, and watch the
**DAG** pane. The graph expands the same registered DAGs shown above:

- `process-stream` fans out through `stream-event` on the `cpu` role.
- `summarize-insights` invokes `insights-summary` on the `io` role.
- The parent DAG stays a JSON-LD graph of placements, routes, and container
  role names.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Browser role binding

The Cartographer runner creates two role bindings from the same registry-backed worker
entry. The registry contains every DAG the worker can execute: the stream-event
tree for `cpu`, its per-event-type child DAGs, and the insights-summary DAG for
`io`.

<<< @/../examples/the-cartographer/app/CartographerRunner.vue#cartographer-browser-containers

<<< @/../examples/the-cartographer/app/cartographerWorkerRegistry.ts#cartographer-worker-registry

## Operational Uses

Multi-backend roles let hosts bind different parts of one DAG to different execution backends without changing the canonical graph. They fit CPU-bound stream processing, IO-bound summary work, and in-process orchestration that need separate pools, quotas, or deployment targets.

## Runtime Notes

### Node CLI companion

The same role-binding model also has a Node CLI entrypoint in
`examples/13-multibackend.ts` for worker-thread plus fork-container execution:

```bash
pnpm example:13
```

That CLI and the Cartographer runner exercise the same role-binding contract
through different execution backends.

- **Role names preserve portability.** `cpu` and `io` are deployment labels, not new placement types.
- **Multiple backends share one registry interface.** The worker registry contains every DAG either role can execute.
- **JSON-LD remains canonical.** Container delegation is a placement attribute in the same document the builder emits and the dispatcher consumes.
- **Interactive and Node deployments choose different backends.** The Cartographer runtime uses `WebWorkerContainer`; the CLI companion can exercise Node container implementations.

## Related Concepts

- [The Cartographer](./the-cartographer) - multi-role worker host using separate cpu and io container bindings
- [Example 12: Worker Containers](./12-workers) - single worker-role container binding
- [Guide: Distribution and Cloud](../guide/distribution) - container and deployment patterns

---
title: 'Example 04C: Container-Bound Scatter'
description: 'ScatterNode with a container role declared. Runs in-process when no backend is bound; activates the WorkerThreadContainer path when the role is wired at dispatch time.'
seeAlso:
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body DAG, gather placement, reduce'
  - text: 'Example 04B: Scatter Collect'
    link: './04b-scatter-collect'
    description: 'first-class gather: generate-and-select pattern'
  - text: 'Example 12: Worker Containers'
    link: './12-workers'
    description: 'full WorkerThreadContainer walkthrough with registry module'
  - text: 'Reference: Contracts, DagContainerInterface'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { cartographerWorkersDAG, eventPipelineTypedDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 04C: Container-Bound Scatter

## What It Is

Container-Bound Scatter is the same scatter contract with a deployment seam attached. The Cartographer keeps the graph shape readable, but declares that each canonical event pipeline clone can run behind the `cpu` container role.

That role is late-bound. In the browser demo it maps to a `WebWorkerContainer`; in CLI worker mode it maps to a `WorkerThreadContainer`.

## How It Works

The JSON-LD placement declares `container: 'cpu'`. At runtime, the dispatcher looks up the `cpu` backend in its `containers` option. If the role is bound, each scatter clone's body DAG runs through that backend. First-class gather and outcome reduction are identical in both modes.

This makes the container role an assembly concern, not a business-logic concern. The scatter body DAG, gather placement, strategy key, and routes stay in the canonical DAG; hosts decide where the work runs.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

[The Cartographer](./the-cartographer) is the runnable container-bound scatter example. Its `process-stream` scatter declares `container: 'cpu'`, and the browser runner binds that role to a real `WebWorkerContainer`.

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer worker parent DAG" aria-label="Cartographer worker parent JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="eventPipelineTypedDAG" title="event-pipeline-typed worker body DAG" aria-label="Cartographer typed event pipeline JSON-LD DAG beside Mermaid generated from it." />

A `ScatterNode` placement that declares `container: "cpu"` runs each clone's sub-DAG in the bound backend. In the browser demo, the backend is a `WebWorkerContainer` pool; in CLI worker mode it is a `WorkerThreadContainer` pool. The DAG document stays the same.

The parent DAG and the body DAG above are exactly what the Cartographer page renders and executes.

### Run

```bash
npm run docs:dev
```

Open [The Cartographer](./the-cartographer), click **Run**, and watch the DAG pane expand `process-stream` into the `event-pipeline-typed` body.

## What It Lets You Do

Container-bound scatter lets applications move scatter clone execution out of the main process without changing the DAG topology. Use it when each item can run independently and the host should isolate CPU-heavy, memory-heavy, or deployment-specific work behind a named container role.

For a host application, this is the difference between "rewrite the workflow for workers" and "bind the same workflow to a worker-capable host." The JSON-LD still documents the flow; the container binding documents the runtime envelope.

## Code Samples

The parent DAG declares the container role; the browser runner binds it. Those two files are the whole seam.

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

<<< @/../docs/.vitepress/theme/components/CartographerRunner.vue#cartographer-browser-containers

## Details for Nerds

- **`container` key on a scatter placement.** Adding `container: "cpu"` to a `ScatterNode` with a dag body tells the dispatcher to run each clone's sub-DAG in the backend bound to `"cpu"`.
- **No node-body containers.** A scatter whose body is a single node (no `dag` key) cannot be contained — validation rejects `container` on a node-body scatter.
- **Transition to workers is one config change.** Bind a `WorkerThreadContainer` to `"cpu"` in the dispatcher constructor's `containers` option without touching the DAG document or the node implementations.

## Related Concepts

- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body DAG, gather placement, reduce
- [Example 04B: Scatter Collect](./04b-scatter-collect) - first-class gather: generate-and-select pattern
- [Example 12: Worker Containers](./12-workers) - full WorkerThreadContainer walkthrough with registry module
- [Reference: Contracts, DagContainerInterface](../reference/contracts)

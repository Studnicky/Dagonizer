---
title: 'Example 19: Phase Nodes'
description: 'DAGBuilder.phase() attaches side-effect work that wraps the main execution loop. Pre-phase nodes run before the entrypoint; post-phase nodes run after every exit path without participating in output-port routing.'
seeAlso:
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'sub-DAG composition with stateMapping'
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'lifecycle hooks for cross-cutting concerns'
  - text: 'Reference: Nodes'
    link: '../reference/nodes'
    description: 'PhaseNode placement type reference'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 19: Phase Nodes

## What It Is

Phase Nodes attach setup and cleanup work around the routed DAG without pretending that work is part of normal output routing. The Dispatcher uses a `setup` pre-phase to stamp run metadata before the customer-support graph starts.

Use phase nodes for cross-cutting application work that must happen before or after the graph, but should not create fake edges or fake output ports.

## How It Works

`pre` phase placements run before the entrypoint in declaration order. `post` phase placements run after the main loop resolves on every exit path. The node can mutate state and emit observability events, but its output does not route the graph because phase placements are outside normal node-output flow.

That distinction matters for application structure. A preflight validator, run-id stamper, metrics flush, or lock release can live in the DAG document without obscuring the business graph.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

Phase placements sit beside the routed graph rather than participating in output routing. [The Dispatcher](./the-dispatcher) shows the smallest browser-runnable form: `setup` is a pre-phase placement that stamps per-run metadata before `classify-message`.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher phase DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

`DAGBuilder.phase()` attaches side-effect work that wraps the main execution loop without participating in output-port routing:

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Phase nodes let applications attach setup and cleanup work around the routed DAG without adding fake graph edges. Use them for per-run IDs, resource acquisition, input normalization, final audit writes, lock release, or metrics flushing.

They are a better fit than normal nodes when the work is about the execution envelope rather than a decision in the domain flow.

## Code Samples

The Dispatcher bundle shows the `.phase(...)` placement beside the routed support graph. `SetupNode` shows the kind of state mutation that belongs in a phase: run metadata, not branch routing.

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

<<< @/../examples/the-dispatcher/nodes/SetupNode.ts

## Details for Nerds

- **`DAGBuilder.phase(name, 'pre', node)`.** Registers a pre-phase placement. The node runs before the entrypoint. Multiple pre-phases run in declaration order. A throw in any pre-phase aborts the run.
- **`DAGBuilder.phase(name, 'post', node)`.** Registers a post-phase placement. The node runs after every exit path — success, abort, timeout, or failed terminal. Errors in post-phase nodes are appended as warnings on state (`state.warnings`), not re-thrown.
- **Phase nodes do not route.** Phase placements have no outputs map. The node's return value is ignored for routing; only the side-effect (state mutation, metrics flush, lock release) matters.
- **Lifecycle is set before post-phase runs.** The post-phase node reads `state.lifecycle.variant` to see whether the main loop completed, aborted, or failed — useful for conditional cleanup.
- **Runnable ordering guarantee.** `setup` runs before `classify-message` on every Dispatcher browser run.

## Related Concepts

- [Example 05: Embedded DAGs](./05-embedded-dags) - sub-DAG composition with stateMapping
- [Example 18: Observability](./18-observability) - lifecycle hooks for cross-cutting concerns
- [Reference: Nodes](../reference/nodes) - PhaseNode placement type reference

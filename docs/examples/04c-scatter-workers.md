---
title: 'Example 04c: Scatter with container binding'
description: 'ScatterNode with a container role declared. Runs in-process when no backend is bound; activates the WorkerThreadContainer path when the role is wired at dispatch time.'
seeAlso:
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 04b: Scatter collect'
    link: './04b-scatter-collect'
    description: 'map gather: generate-and-select pattern'
  - text: 'Example 12: Worker pool'
    link: './12-workers'
    description: 'full WorkerThreadContainer walkthrough with registry module'
  - text: 'Reference: Contracts, DagContainerInterface'
    link: '../reference/contracts'
---

# Example 04c: Scatter with container binding

A `ScatterNode` placement that declares `container: "cpu"` runs each clone's sub-DAG in the bound backend. When no container is bound, the scatter falls back to in-process execution — no code changes, byte-identical output.

This example demonstrates the container key on the scatter placement and shows the in-process fallback path. The companion [Example 12: Worker pool](./12-workers) covers the full `WorkerThreadContainer` setup including the registry module.

## Code

<<< @/../examples/04c-scatter-workers.ts

## What it demonstrates

- **`container` key on a scatter placement.** Adding `container: "cpu"` to a `ScatterNode` with a dag body tells the dispatcher to run each clone's sub-DAG in the backend bound to `"cpu"`. The key is ignored (with a `contractWarning`) when no backend is bound.
- **In-process fallback.** Remove `containers` from the dispatcher options or omit the `container` key on the placement to run the scatter in-process. Output is byte-identical.
- **No node-body containers.** A scatter whose body is a single node (no `dag` key) cannot be contained — validation rejects `container` on a node-body scatter.
- **Transition to workers is one config change.** Bind a `WorkerThreadContainer` to `"cpu"` in the dispatcher constructor's `containers` option without touching the DAG document or the node implementations.

## Run

```bash
npx tsx examples/04c-scatter-workers.ts
```

To activate the worker-thread path, see [Example 12: Worker pool](./12-workers).

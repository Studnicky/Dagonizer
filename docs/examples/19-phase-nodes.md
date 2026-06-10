---
title: 'Example 19: Phase nodes (pre + post)'
description: 'DAGBuilder.phase() attaches side-effect work that wraps the main execution loop. Pre-phase nodes run before the entrypoint; post-phase nodes run after every exit path without participating in output-port routing.'
seeAlso:
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'sub-DAG composition with stateMapping'
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'lifecycle hooks for cross-cutting concerns'
  - text: 'Reference: Nodes'
    link: '../reference/nodes'
    description: 'PhaseNode placement type reference'
---

# Example 19: Phase nodes (pre + post)

`DAGBuilder.phase()` attaches side-effect work that wraps the main execution loop without participating in output-port routing:

- **`pre` phase** — declared with `.phase('name', 'pre', node)`. Runs before the DAG entrypoint, in declaration order. An error thrown in a pre-phase aborts the run; the main loop never starts. Use cases: acquire resources, seed state, validate preconditions.
- **`post` phase** — declared with `.phase('name', 'post', node)`. Runs after the main loop drains, on every exit path (completion, abort, timeout, terminal-failed, or node throw). Errors are collected as warnings on state; they do not change the already-set lifecycle. Use cases: flush metrics, release locks, audit final state.

```
Execution order:
  pre-setup → compute → post-audit → final-result:computed:84
```

## Code

<<< @/../examples/19-phase-nodes.ts

## What it demonstrates

- **`DAGBuilder.phase(name, 'pre', node)`.** Registers a pre-phase placement. The node runs before the entrypoint. Multiple pre-phases run in declaration order. A throw in any pre-phase aborts the run.
- **`DAGBuilder.phase(name, 'post', node)`.** Registers a post-phase placement. The node runs after every exit path — success, abort, timeout, or failed terminal. Errors in post-phase nodes are appended as warnings on state (`state.warnings`), not re-thrown.
- **Phase nodes do not route.** Phase placements have no outputs map. The node's return value is ignored for routing; only the side-effect (state mutation, metrics flush, lock release) matters.
- **Lifecycle is set before post-phase runs.** The post-phase node reads `state.lifecycle.kind` to see whether the main loop completed, aborted, or failed — useful for conditional cleanup.
- **`executionLog` ordering guarantee.** The example verifies that the log is `['pre-setup', 'compute', 'post-audit']` — pre runs first, post runs last, regardless of the main loop's exit path.

## Run

```bash
npx tsx examples/19-phase-nodes.ts
```

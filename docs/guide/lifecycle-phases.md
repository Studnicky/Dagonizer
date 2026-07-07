---
title: 'Lifecycle Phases'
description: 'PhaseNode placements run before or after the main DAG loop. DAGBuilder.phase wires them in declaration order. onPhaseEnter / onPhaseExit hooks fire around each placement.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: '`.phase(name, "pre" | "post", node)` registers a phase placement'
  - text: 'Observability'
    link: './observability'
    description: '`onPhaseEnter` and `onPhaseExit` observe phase boundaries'
---

<script setup lang="ts">
import { dag as phaseDag } from '../../examples/dags/19-phase-nodes.ts';
</script>

# Lifecycle Phases

## What It Is

Lifecycle phases are DAG placements that run around the main graph walk. A `pre` phase runs before the entrypoint; a `post` phase runs after the main loop exits. They are useful for setup and teardown work that belongs to the execution but should not participate in routing.

Phase placements are authored in the DAG, executed in declaration order, and observed by `onPhaseEnter` / `onPhaseExit` hooks.

## How It Works

Phase placements are registered beside normal nodes. The dispatcher runs pre phases before the entrypoint and post phases after the main loop has a lifecycle outcome. Phase node return values do not route the graph; side effects and observability hooks are the point.

`PhaseNode` placements run around the main DAG loop rather than inside it. They are registered like any other placement, mutate state, can throw, and are observed by the dispatcher's protected `on*` hooks.

## Diagrams, Examples, and Outputs

Example 19 builds a `phase-demo` DAG with a pre setup placement, one routed main node, and a post audit placement. The JSON-LD contains all three placement types; the Mermaid view shows how phases sit beside the routed main path.

<<< @/../examples/dags/19-phase-nodes.ts#phase-dag

<DagJsonMermaid :dag="phaseDag" title="Example 19 phase DAG" aria-label="Example 19 phase JSON-LD DAG beside Mermaid generated from it." />

Open [Example 19: Phase Nodes](../examples/19-phase-nodes) for the runnable output and execution-order assertions. See [Observability](./observability) for phase hooks in dispatcher subclasses.

## What It Lets You Do

### Use when

Use lifecycle phases when setup or cleanup belongs around the flow but should not participate in output routing. Pre phases seed or validate state before the entrypoint; post phases flush or release resources after every exit path.

## Code Samples

### API surface

| Symbol | Source | Role |
|--------|--------|------|
| `PhaseNode` | `@studnicky/dagonizer/entities` | JSON Schema-derived placement type |
| `PhaseNodeSchema` | `@studnicky/dagonizer/entities` | The JSON Schema |
| `DAGBuilder.phase(name, phase, nodeRef)` | `@studnicky/dagonizer/builder` | Fluent registration |
| `Dagonizer.onPhaseEnter` | `@studnicky/dagonizer` | Protected hook — fires before each phase placement |
| `Dagonizer.onPhaseExit` | `@studnicky/dagonizer` | Protected hook — fires after each phase placement |

## Details for Nerds

### Two arms

- `phase: 'pre'`: runs before the entrypoint, in DAG declaration order.
- `phase: 'post'`: runs after the main loop drains, in DAG declaration order, on every exit path.

Phase placements have no `outputs` field. They never route to other placements. They are never the main-loop entrypoint.

### When to reach for it

Pre/post phases fit the bootstrap/teardown shape:

- Pre: warm a cache, attach an observability span, validate environment, bind a request-scoped logger to `state.metadata`.
- Post: flush metrics, close a database handle, persist a final checkpoint, emit a `flow-finished` event.

These are real units of work that participate in the DAG. They are not the same as the `onFlowStart` / `onFlowEnd` observer hooks; those are observability-only, do not register as nodes, do not show up in `executedNodes`, and cannot mutate state through the `NodeInterface` contract.

### Failure semantics

| Path | Pre-phase throws | Main loop throws | Post-phase throws |
|------|------------------|------------------|-------------------|
| Lifecycle | `failed` | already-set (`failed`, `cancelled`, `timed_out`) | unchanged |
| Main loop executes | no | partially | n/a |
| Post-phases execute | yes | yes | yes (errors collected as warnings) |

Pre-phase failures abort the run before the entrypoint sees state. Post-phase failures never overwrite the lifecycle; they are collected as warnings on `state` with code `POST_PHASE_FAILED` and the loop continues with the next post-phase. This matches the best-effort teardown shape: a failed log flush does not flip a successful run into a failure.

### `ExecutionResult.executedNodes`

- Pre-phase names appear at the START (every pre-phase that ran without throwing).
- Main-loop nodes appear in the MIDDLE.
- Post-phase names appear at the END (every post-phase that completed without throwing).

A pre-phase that threw is not appended. A post-phase that threw is not appended.

### Authoring

The fluent surface lives on `DAGBuilder`:

<<< @/../examples/dags/19-phase-nodes.ts#phase-dag

Phase placements are recorded in DAG declaration order. Order matters: `warm-cache` runs strictly before `ingest`; `flush-logs` runs strictly before `close-db`.

The hand-written JSON form is also accepted:

```jsonc
{
  "@id":   "urn:noocodex:dag:pipeline/node/warm-cache",
  "@type": "PhaseNode",
  "name":  "warm-cache",
  "node":  "warm-cache-node",
  "phase": "pre"
}
```

### Validation

At `registerDAG` time the engine verifies that every `PhaseNode.node` resolves to a registered node. A missing reference raises `DAGError`. The schema rejects an `outputs` field (no routing) and rejects any `phase` value outside `'pre' | 'post'`.

### Observability hooks

For every phase placement the dispatcher calls the protected hooks on the `Dagonizer` subclass:

<<< @/../examples/19-phase-nodes.ts#phase-observer

See [Observability](./observability) for the full hook reference.

## Related Concepts

- [DAGBuilder](./builder) - `.phase(name, "pre" | "post", node)` registers a phase placement
- [Observability](./observability) - `onPhaseEnter` and `onPhaseExit` observe phase boundaries
- [Reference: Builder](../reference/dagonizer)
- [Example 19: Phase Nodes](../examples/19-phase-nodes)

---
title: 'Example 07: Retry Flow'
description: 'Retry as a flow shape in The Archivist: a node routes a retry output that loops back in the DAG, bounded by a counter on the conceptual-root state, or routes salvage to a deterministic recovery node. The compose/validate loop is the same shape across two nodes.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Retry guide'
    link: '../guide/retry'
  - text: 'Example 06: Cancellation'
    link: './06-cancellation'
  - text: 'Reference: Runtime, `RetryPolicy`, `BackoffStrategy`'
    link: '../reference/runtime'
  - text: 'Reference: Contracts, `RetryPolicyOptionsType`'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { ComposeRetryLoopDAG } from '../exampleDags.ts';
</script>

# Example 07: Retry Flow

## Retry Surface

Retry in The Archivist is visible flow control for model calls, parsers, and quality gates that need another attempt. A node routes a `retry` output that loops back through the DAG, bounded by state, or routes `salvage` to deterministic recovery.

The important part is visibility. Retry is not a hidden `while` loop in the dispatcher and not an exception swallowed inside a node; it is a named edge in the graph that appears in JSON-LD, Mermaid, traces, and checkpoints.

## Retry and Salvage Flow

### DAG registration and diagram

In [The Archivist](./the-archivist) retry is a flow shape. The `compose-retry-loop` sub-DAG renders the retry edge, salvage path, and final success path as normal JSON-LD routes.

<DagJsonMermaid :dag="ComposeRetryLoopDAG" title="compose-retry-loop" aria-label="compose-retry-loop JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## Flow-loop versus Policy Model

When a node fails its own deadline or an LLM call throws, it makes a flow decision rather than swallowing the failure: it routes a `retry` output that loops back in the DAG, bounded by a counter on the state, or routes `salvage` to a deterministic recovery node once the budget is spent. The node never fabricates a result to take the happy path, and there is no hidden retry loop inside the dispatcher.

The same shape appears in two places:

1. **Self-loop retry.** Each agent node (`extract-query`, `decide-tools`, `rank-candidates`, the composers) routes `retry` to itself and `salvage` to a recovery node.
2. **Two-node retry loop.** `validate-response` routes `retry` back to `compose-response` when a draft fails the quality gate, bounded by the same `compose` budget.

Both are loop edges in the topology. The dispatcher always sees a named output; nothing throws.

## Code Samples

#### The retrying node

`extract-query` arms its own deadline and asks the conceptual-root retry budget which way to route. `withinRetryBudget(context.nodeName, RETRY_BUDGET)` records the attempt and returns whether another remains:

<<< @/../examples/the-archivist/nodes/extractQuery.ts#retry-salvage-node

#### Closing the loop in the DAG

The `retry` output is a self-edge; `salvage` routes to a recovery node that performs the deterministic recovery step and rejoins the happy path:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts#retry-salvage-wiring

#### Two-node retry loop

`ComposeRetryLoopDAG` is the same shape spread across two nodes (compose, validate, and a `retry` edge back to compose), built from plain `.node()` routes and bounded by `state.retriesFor('compose')`:

<<< @/../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

## Operational Uses

Retry flow lets teams represent recovery as visible graph topology instead of hidden exception handling. It fits model calls, parsers, or validation steps that can make another attempt while the DAG still needs to show the loop, budget, and salvage path explicitly.

This is useful for model-backed products because retry policy becomes debuggable. A workflow author can read the graph and see the recovery story, then trace exactly which placement retried, how many attempts remain, and where salvage rejoins the flow.

## Runtime Notes

- **The retry budget on the conceptual root.** `state.recordAttempt(key)`, `state.retriesFor(key)`, `state.withinRetryBudget(key, max)`, and `state.clearAttempts(key)` live on `NodeStateBase`, keyed by `context.nodeName`, and ride along in the snapshot; a budget survives checkpoint/resume.
- **Retry is a loop edge.** `retry` routes back to the same placement (a self-edge) or, for the compose loop, from `validate-response` to `compose-response`. The bound lives in state; the loop lives in the DAG. No special loop placement type, no acyclic constraint.
- **Salvage is a recovery route, not a fabrication.** When the budget is spent the node routes `salvage` to a dedicated node: `extract-query-salvage` splits the query on whitespace, `decide-tools-salvage` emits a minimal tool plan. Recovery stays out of the failing node's `catch`.
- **External cancellation is not a retry.** When `context.signal` is already aborted the node re-throws, so the engine records the run as cancelled rather than looping.

For per-operation retry with backoff (a flaky network call inside a tool or adapter), see `RetryPolicy` in the [Retry guide](../guide/retry).

The same retry loop is visible in [The Archivist](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Retry guide](../guide/retry)
- [Example 06: Cancellation](./06-cancellation)
- [Reference: Runtime, `RetryPolicy`, `BackoffStrategy`](../reference/runtime)
- [Reference: Contracts, `RetryPolicyOptionsType`](../reference/contracts)

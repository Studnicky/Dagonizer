---
title: 'Phase 07: Retry'
description: 'Retry as a flow shape in The Archivist: a node routes a retry output that loops back in the DAG, bounded by a counter on the conceptual-root state, or routes salvage to a deterministic recovery node. The compose/validate loop is the same shape across two nodes.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Retry guide'
    link: '../guide/retry'
  - text: 'Phase 06: Cancellation'
    link: './06-cancellation'
  - text: 'Reference: Runtime, `RetryPolicy`, `BackoffStrategy`'
    link: '../reference/runtime'
  - text: 'Reference: Contracts, `RetryPolicyOptionsType`'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { ComposeRetryLoopDAG } from '@archivist/embedded-dags/ComposeRetryLoopDAG.ts';
</script>

# Phase 07: Retry

In [The Archivist](./the-archivist) retry is a flow shape. When a node fails (its own deadline fires, or its LLM call throws), it makes a flow decision rather than swallowing the failure: it routes a `retry` output that the DAG loops back to the node, bounded by a counter on the state, or a `salvage` output to a deterministic recovery node once the budget is spent. The node never fabricates a result to take the happy path, and there is no `RetryPolicy` hidden inside it.

The same shape appears in two places:

1. **Self-loop retry.** Each agent node (`extract-query`, `decide-tools`, `rank-candidates`, the composers) routes `retry` to itself and `salvage` to a recovery node.
2. **Two-node retry loop.** `validate-response` routes `retry` back to `compose-response` when a draft fails the quality gate, bounded by the same `compose` budget.

Both are loop edges in the topology. The dispatcher always sees a named output; nothing throws.

<DagGraph :dag="ComposeRetryLoopDAG" aria-label="ComposeRetryLoopDAG: compose, validate, retry loop bounded by the retry budget on state." />

## Code

### The retrying node

`extract-query` arms its own deadline and asks the conceptual-root retry budget which way to route. `withinRetryBudget(context.nodeName, RETRY_BUDGET)` records the attempt and returns whether another remains:

<<< @/../examples/the-archivist/nodes/extractQuery.ts#retry-salvage-node

### Closing the loop in the DAG

The `retry` output is a self-edge; `salvage` routes to a recovery node that does the deterministic fallback and rejoins the happy path:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts#retry-salvage-wiring

### Two-node retry loop

`ComposeRetryLoopDAG` is the same shape spread across two nodes (compose, validate, and a `retry` edge back to compose), built from plain `.node()` routes and bounded by `state.retriesFor('compose')`:

<<< @/../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

## What it demonstrates

- **The retry budget on the conceptual root.** `state.recordAttempt(key)`, `state.retriesFor(key)`, `state.withinRetryBudget(key, max)`, and `state.clearAttempts(key)` live on `NodeStateBase`, keyed by `context.nodeName`, and ride along in the snapshot; a budget survives checkpoint/resume.
- **Retry is a loop edge.** `retry` routes back to the same placement (a self-edge) or, for the compose loop, from `validate-response` to `compose-response`. The bound lives in state; the loop lives in the DAG. No special loop placement type, no acyclic constraint.
- **Salvage is a recovery route, not a fabrication.** When the budget is spent the node routes `salvage` to a dedicated node: `extract-query-salvage` splits the query on whitespace, `decide-tools-salvage` emits a minimal tool plan. Recovery stays out of the failing node's `catch`.
- **External cancellation is not a retry.** When `context.signal` is already aborted the node re-throws, so the engine records the run as cancelled rather than looping.

For per-operation retry with backoff (a flaky network call inside a tool or adapter), see `RetryPolicy` in the [Retry guide](../guide/retry).

See this in action in the [Archivist live demo](./the-archivist).

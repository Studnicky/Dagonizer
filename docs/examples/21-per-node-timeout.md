---
title: 'Example 21: Per-Node Timeout'
description: 'Engine-level per-node timeout on NodeInterface. Set timeout: Timeout.ofMs(n) on a node to give it a wall-clock budget. When the budget expires, the engine derives a child AbortController, throws NodeTimeoutError, and marks the run failed.'
seeAlso:
  - text: 'Example 06: Cancellation'
    link: './06-cancellation'
    description: 'run-level deadlineMs and AbortSignal'
  - text: 'Example 07: Retry Flow'
    link: './07-retry'
    description: 'retry budget and backoff after a timeout'
  - text: 'Example 22: Backoff strategies'
    link: './22-backoff-strategies'
    description: 'RetryPolicy with each BackoffStrategy via VirtualScheduler'
  - text: 'Reference: Runtime'
    link: '../reference/runtime'
    description: 'Scheduler, RetryPolicy, BackoffStrategy'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 21: Per-Node Timeout

## What It Is

Per-Node Timeout gives one node its own wall-clock budget. The Dispatcher uses it to keep slow model-backed support steps from hanging the browser runner indefinitely.

Set `timeout: Timeout.ofMs(n)` on a node implementation when that operation should fail fast on its own schedule. The rest of the DAG keeps the normal run-level signal unless the caller also cancels or sets `deadlineMs`.

## How It Works

The engine wraps one node execution in a child signal derived from the run signal. If the timeout fires, the child signal aborts, the engine raises `NodeTimeoutError`, and the run records a structured interrupted point for that node. The parent run signal stays independent unless the caller also supplied a run-level deadline or abort signal.

That scope is the useful part. A timeout on `classify-message` means that node exceeded its budget; it does not mean every other in-flight branch must inherit a cancelled run signal.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

Timeout is node configuration, not a new placement shape. [The Dispatcher](./the-dispatcher) uses real engine-level node timeouts on its LLM-backed `classify-message` and `ai-compose` nodes so slow model calls are bounded in the browser runnable.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher timeout DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

Set `timeout: Timeout.ofMs(n)` on a node's `NodeInterface` definition to activate engine-level per-node timeout. When the node's `execute()` call does not resolve within the budget:

1. The engine derives a child `AbortController` from the run's signal.
2. The child signal is aborted after the budget expires.
3. The engine throws `NodeTimeoutError`, fires `onError`, and marks the run `failed` with `result.interruptedAt.reason === 'timeout'`.

Key difference from run-level `deadlineMs` (in `ExecuteOptions`):

- `timeout` is scoped to one node's `execute()` only. The parent run-level signal is **not** aborted; other nodes are unaffected.
- `deadlineMs` aborts the entire run; `timeout` aborts just the node.

In the runnable Dispatcher, the timeout is attached to the node implementation. The JSON-LD placement stays ordinary; timeout behavior belongs to the registered node contract.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Per-node timeout lets applications bound one slow node without aborting the whole run-level signal. Use it when a model call, tool call, API adapter, or parser has its own wall-clock budget and should fail cleanly without cancelling unrelated work.

For product code, this keeps latency policy close to the operation that owns the risk. A support classifier can have a short budget, while a downstream operator hand-off or cleanup phase still follows its own contract.

## Code Samples

The node snippets show the timeout on real Dispatcher nodes. The DAG snippet shows that placements remain ordinary; the timeout belongs to the registered node implementation.

<<< @/../examples/the-dispatcher/nodes/ClassifyMessageNode.ts

<<< @/../examples/the-dispatcher/nodes/AiComposeNode.ts

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

## Details for Nerds

- **`timeout` on `NodeInterface`.** Set `override readonly timeout = Timeout.ofMs(n)` on the node class to activate the per-node deadline. Import `Timeout` from `@studnicky/dagonizer/runtime`. The engine arms the timer before calling `execute()` and cancels it when `execute()` resolves normally.
- **`NodeTimeoutError`.** Thrown by the engine (not the node) when the deadline fires. Carries `nodeName` and the timeout budget for diagnostic reporting.
- **Child `AbortController`.** The node's `context.signal` is the child signal derived from the run signal. Aborting the child does not abort the parent run or any other running node.
- **`result.interruptedAt.reason`.** After a per-node timeout, `result.interruptedAt.reason === 'timeout'` and `result.interruptedAt.nodeName` identifies the timed-out node. The run lifecycle is `failed`.
- **Contrast with `deadlineMs`.** Run-level `deadlineMs` aborts `context.signal` (the run signal), which propagates to all running nodes. Per-node `timeout` aborts only the node's child signal.

## Related Concepts

- [Example 06: Cancellation](./06-cancellation) - run-level deadlineMs and AbortSignal
- [Example 07: Retry Flow](./07-retry) - retry budget and backoff after a timeout
- [Example 22: Backoff strategies](./22-backoff-strategies) - RetryPolicy with each BackoffStrategy via VirtualScheduler
- [Reference: Runtime](../reference/runtime) - Scheduler, RetryPolicy, BackoffStrategy

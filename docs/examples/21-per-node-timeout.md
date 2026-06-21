---
title: 'Example 21: Per-node timeout'
description: 'Engine-level per-node timeout on NodeInterface. Set timeout: Timeout.ofMs(n) on a node to give it a wall-clock budget. When the budget expires, the engine derives a child AbortController, throws NodeTimeoutError, and marks the run failed.'
seeAlso:
  - text: 'Phase 06: Cancellation'
    link: './06-cancellation'
    description: 'run-level deadlineMs and AbortSignal'
  - text: 'Phase 07: Retry'
    link: './07-retry'
    description: 'retry budget and backoff after a timeout'
  - text: 'Example 22: Backoff strategies'
    link: './22-backoff-strategies'
    description: 'RetryPolicy with each BackoffStrategy via VirtualScheduler'
  - text: 'Reference: Runtime'
    link: '../reference/runtime'
    description: 'Scheduler, RetryPolicy, BackoffStrategy'
---

# Example 21: Per-node timeout

Set `timeout: Timeout.ofMs(n)` on a node's `NodeInterface` definition to activate engine-level per-node timeout. When the node's `execute()` call does not resolve within the budget:

1. The engine derives a child `AbortController` from the run's signal.
2. The child signal is aborted after the budget expires.
3. The engine throws `NodeTimeoutError`, fires `onError`, and marks the run `failed` with `result.interruptedAt.reason === 'timeout'`.

Key difference from run-level `deadlineMs` (in `ExecuteOptions`):

- `timeout` is scoped to one node's `execute()` only. The parent run-level signal is **not** aborted; other nodes are unaffected.
- `deadlineMs` aborts the entire run; `timeout` aborts just the node.

```
(a) fastNode (Timeout.ofMs(200)): resolves in ~0 ms → completed normally.
(b) slowNode (Timeout.ofMs(50)):  tries to wait 5 s → NodeTimeoutError after 50 ms.
```

## Code

<<< @/../examples/21-per-node-timeout.ts

## What it demonstrates

- **`timeout` on `NodeInterface`.** Set `override readonly timeout = Timeout.ofMs(n)` on the node class to activate the per-node deadline. Import `Timeout` from `@studnicky/dagonizer/runtime`. The engine arms the timer before calling `execute()` and cancels it when `execute()` resolves normally.
- **`NodeTimeoutError`.** Thrown by the engine (not the node) when the deadline fires. Carries `nodeName` and the timeout budget for diagnostic reporting.
- **Child `AbortController`.** The node's `context.signal` is the child signal derived from the run signal. Aborting the child does not abort the parent run or any other running node.
- **`result.interruptedAt.reason`.** After a per-node timeout, `result.interruptedAt.reason === 'timeout'` and `result.interruptedAt.nodeName` identifies the timed-out node. The run lifecycle is `failed`.
- **Contrast with `deadlineMs`.** Run-level `deadlineMs` aborts `context.signal` (the run signal), which propagates to all running nodes. Per-node `timeout` aborts only the node's child signal.

## Run

```bash
npx tsx examples/21-per-node-timeout.ts
```

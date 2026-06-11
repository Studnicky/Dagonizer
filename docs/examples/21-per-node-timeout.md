---
title: 'Example 21: Per-node timeout'
description: 'Engine-level per-node timeoutMs on NodeInterface. When set, the engine derives a child AbortController, arms a scheduler timer, and races the node''s execute() against the deadline. On expiry: throws NodeTimeoutError and marks the run failed.'
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

`timeoutMs` set directly on a node's `NodeInterface` definition activates engine-level per-node timeout. When the node's `execute()` call does not resolve within `timeoutMs` milliseconds:

1. The engine derives a child `AbortController` from the run's signal.
2. The child signal is aborted after `timeoutMs` ms.
3. The engine throws `NodeTimeoutError`, fires `onError`, and marks the run `failed` with `result.interruptedAt.reason === 'timeout'`.

Key difference from run-level `deadlineMs` (in `ExecuteOptions`):

- `timeoutMs` is scoped to one node's `execute()` only. The parent run-level signal is **not** aborted; other nodes are unaffected.
- `deadlineMs` aborts the entire run; `timeoutMs` aborts just the node.

```
(a) fastNode (timeoutMs=200): resolves in ~0 ms → completed normally.
(b) slowNode (timeoutMs=50):  tries to wait 5 s → NodeTimeoutError after 50 ms.
```

## Code

<<< @/../examples/21-per-node-timeout.ts

## What it demonstrates

- **`timeoutMs` on `NodeInterface`.** Set `timeoutMs: N` on the node object to activate the per-node deadline. The engine arms the timer before calling `execute()` and cancels it when `execute()` resolves normally.
- **`NodeTimeoutError`.** Thrown by the engine (not the node) when the deadline fires. Carries `nodeName` and `timeoutMs` for diagnostic reporting.
- **Child `AbortController`.** The node's `context.signal` is the child signal derived from the run signal. Aborting the child does not abort the parent run or any other running node.
- **`result.interruptedAt.reason`.** After a per-node timeout, `result.interruptedAt.reason === 'timeout'` and `result.interruptedAt.nodeName` identifies the timed-out node. The run lifecycle is `failed`.
- **Contrast with `deadlineMs`.** Run-level `deadlineMs` aborts `context.signal` (the run signal), which propagates to all running nodes. Per-node `timeoutMs` aborts only the node's child signal.

## Run

```bash
npx tsx examples/21-per-node-timeout.ts
```

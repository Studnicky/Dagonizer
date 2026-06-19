---
title: 'Cancellation'
description: 'Cancellation flows through the Web AbortSignal API. The dispatcher accepts a caller signal and a deadline; both compose into the signal every node receives in context.signal. interruptedAt records the structured reason on the ExecutionResult.'
seeAlso:
  - text: 'Retry'
    link: './retry'
    description: 'RetryPolicy.run honors context.signal so retries abort cleanly'
  - text: 'Checkpoint and resume'
    link: './checkpoint'
    description: 'abort and persist the cursor; resume continues from that point'
  - text: 'Observability'
    link: './observability'
    description: 'onError fires when an abort or deadline interrupts a node'
nextSteps:
  - text: 'Phase 06, Cancellation demo'
    link: '../examples/06-cancellation'
    description: 'runnable AbortController and deadlineMs example'
---

# Cancellation

Cancellation flows through the standard Web `AbortSignal` API. The dispatcher accepts two optional fields in the `execute()` and `resume()` options object: a caller-supplied `signal` and a `deadlineMs` budget. Internally the two compose via `AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)])` and the result lands on `context.signal` for every node.

## `signal` and `deadlineMs`

The Phase 06 demo runs the same slow DAG twice: once with a caller `AbortController` and once with a dispatcher deadline.

Caller-controlled abort:

<<< @/../examples/06-cancellation.ts#abort-signal

Dispatcher deadline (fires automatically after the budget):

<<< @/../examples/06-cancellation.ts#deadline

Both produce a non-`null` `result.cursor` and a non-`null` `result.interruptedAt`; the only difference is the discriminator on `interruptedAt.reason` (`'abort'` versus `'timeout'`).

## `NodeContextType`

Nodes receive the composed signal in the `context` argument and must propagate it into every IO call to be cancellable. The Phase 06 node wires `context.signal` into its delay primitive:

<<< @/../examples/dags/06-cancellation.ts#node-cancellation-aware

`context` also carries `context.dagName` and `context.nodeName` for logging.

## Detecting abort inside a node

<<< @/../examples/dags/06-cancellation.ts#signal-iteration

A node that ignores `context.signal` runs to completion even after the signal fires. The dispatcher stops the iterator once the current node returns, but the in-flight node body still races to finish on its own.

## After cancellation

Once the signal fires:

- The iterator stops without starting the next node.
- `result.cursor` holds the node that would have run next. Pass it to `dispatcher.resume()` to continue from that point.
- `result.state.lifecycle.kind` is `'cancelled'` (caller signal) or `'timed_out'` (deadline).

<<< @/../examples/06-cancellation.ts#cursor-check

## `interruptedAt`

When a flow exits via abort or timeout, `result.interruptedAt` carries structured cancellation telemetry: `{ nodeName: string; reason: 'abort' | 'timeout' }`.

`result.interruptedAt` is `null` on clean exits (completed, terminal-reached, configuration error, node throw without abort). When a signal aborts the run or a deadline expires, it carries the node that was current when the signal fired and the discriminant:

<<< @/../examples/06-cancellation.ts#interrupted-at

`reason: 'timeout'` is set when the abort reason is a `TimeoutError` (either the run-level `deadlineMs` deadline or a per-node `timeoutMs` budget). `reason: 'abort'` is set when the caller-supplied `signal` fired with any other reason.

## Signal composition

The dispatcher uses `AbortSignal.any()` to merge signals. Callers can do the same to compose multiple concerns before passing them in:

<<< @/../examples/06-cancellation.ts#signal-composition

This is equivalent to passing both as `signal` plus `deadlineMs`. Pick whichever form fits the call site.

## Related reference

- [Phase 06, Cancellation demo](../examples/06-cancellation)
- [Reference, Runtime, `SignalComposer`](../reference/runtime)
- [Reference, Contracts, `ExecuteOptionsType`](../reference/contracts)

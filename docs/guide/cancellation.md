---
title: 'Cancellation'
description: 'Cancellation flows through the Web AbortSignal API. The dispatcher accepts a caller signal and a deadline; both compose into the signal every node receives in context.signal. interruptedAt records the structured reason on the ExecutionResult.'
seeAlso:
  - text: 'Retry'
    link: './retry'
    description: 'RetryPolicy.run honors context.signal so retries abort cleanly'
  - text: 'Checkpoint and Resume'
    link: './checkpoint'
    description: 'abort and persist the cursor; resume continues from that point'
  - text: 'Observability'
    link: './observability'
    description: 'onError fires when an abort or deadline interrupts a node'
nextSteps:
  - text: 'Example 06: Cancellation'
    link: '../examples/06-cancellation'
    description: 'runnable AbortController and deadlineMs example'
---

<script setup lang="ts">
import { dag as cancellationDag } from '../../examples/dags/06-cancellation.ts';
</script>

# Cancellation

## What It Is

Cancellation flows through the standard Web `AbortSignal` API. The dispatcher accepts a caller signal and an optional `deadlineMs`; both compose into the signal every node receives as `context.signal`.

The goal is not to crash the run. The goal is to stop safely, return a structured `ExecutionResult`, preserve `interruptedAt`, and keep a cursor when the run can be resumed.

## How It Works

The dispatcher composes all cancellation inputs into one signal and passes it through `NodeContextType`. Nodes and runtime helpers propagate that signal into adapters, tools, schedulers, and retry policies. When it fires, the dispatcher records `interruptedAt`, keeps `cursor` when resume is possible, and returns a normal `ExecutionResult`.

Cancellation flows through the standard Web `AbortSignal` API. The dispatcher accepts two optional fields in the `execute()` and `resume()` options object: a caller-supplied `signal` and a `deadlineMs` budget. Internally the two compose via `Signal.compose({ signal, deadlineMs })` and the result lands on `context.signal` for every node.

## Diagrams, Examples, and Outputs

Example 06 runs a slow DAG twice: once with a caller abort and once with a deadline. The topology is intentionally small so the lifecycle result is easy to read:

<DagJsonMermaid :dag="cancellationDag" title="Example 06 cancellation DAG" aria-label="Example 06 cancellation JSON-LD DAG beside Mermaid generated from it." />

- [Retry](./retry) - RetryPolicy.run honors context.signal so retries abort cleanly
- [Checkpoint and Resume](./checkpoint) - abort and persist the cursor; resume continues from that point
- [Observability](./observability) - onError fires when an abort or deadline interrupts a node
- [Example 06: Cancellation](../examples/06-cancellation) - runnable AbortController and deadlineMs example

## What It Lets You Do

### Use when

Use cancellation when a caller must stop work safely: a browser tab closes, an HTTP request disconnects, a queue lease expires, or a host-level deadline fires. The goal is to interrupt execution with a structured lifecycle result and a resumable cursor, not to let nodes throw arbitrary errors.

## Code Samples

The snippets below show the call-site options, the cancellation-aware node, and the cursor checks Example 06 asserts.

### `signal` and `deadlineMs`

Example 06 runs the same slow DAG twice: once with a caller `AbortController` and once with a dispatcher deadline.

Caller-controlled abort:

<<< @/../examples/06-cancellation.ts#abort-signal

Dispatcher deadline (fires automatically after the budget):

<<< @/../examples/06-cancellation.ts#deadline

Both produce a non-`null` `result.cursor` and a non-`null` `result.interruptedAt`; the only difference is the discriminator on `interruptedAt.reason` (`'abort'` versus `'timeout'`).

### `NodeContextType`

Nodes receive the composed signal in the `context` argument and must propagate it into every IO call to be cancellable. The Example 06 node wires `context.signal` into its delay primitive:

<<< @/../examples/dags/06-cancellation.ts#node-cancellation-aware

`context` also carries `context.dagName` and `context.nodeName` for logging.

### Detecting abort inside a node

<<< @/../examples/dags/06-cancellation.ts#signal-iteration

A node that ignores `context.signal` runs to completion even after the signal fires. The dispatcher stops the iterator once the current node returns, but the in-flight node body still races to finish on its own.

### After cancellation

Once the signal fires:

- The iterator stops without starting the next node.
- `result.cursor` holds the node that would have run next. Pass it to `dispatcher.resume()` to continue from that point.
- `result.state.lifecycle.variant` is `'cancelled'` (caller signal) or `'timed_out'` (deadline).

<<< @/../examples/06-cancellation.ts#cursor-check

### `interruptedAt`

When a flow exits via abort or timeout, `result.interruptedAt` carries structured cancellation telemetry: `{ nodeName: string; reason: 'abort' | 'timeout' }`.

`result.interruptedAt` is `null` on clean exits (completed, terminal-reached, configuration error, node throw without abort). When a signal aborts the run or a deadline expires, it carries the node that was current when the signal fired and the discriminant:

<<< @/../examples/06-cancellation.ts#interrupted-at

`reason: 'timeout'` is set when the abort reason is a `TimeoutError` (either the run-level `deadlineMs` deadline or a per-node `timeoutMs` budget). `reason: 'abort'` is set when the caller-supplied `signal` fired with any other reason.

### Signal composition

The dispatcher uses `Signal.compose(...)` to merge cancellation concerns. Callers can do the same before passing a single signal in:

<<< @/../examples/06-cancellation.ts#signal-composition

This is equivalent to passing both as `signal` plus `deadlineMs`. Pick whichever form fits the call site.

## Details for Nerds

### Runtime contract

Cancellation is cooperative at the node boundary. The dispatcher can stop before starting the next placement, but it cannot interrupt arbitrary synchronous work inside an already-running node. A node that performs IO or waits should pass `context.signal` into the underlying API, adapter, scheduler, or retry helper.

## Related Concepts

- [Retry](./retry) - RetryPolicy.run honors context.signal so retries abort cleanly
- [Checkpoint and Resume](./checkpoint) - abort and persist the cursor; resume continues from that point
- [Observability](./observability) - onError fires when an abort or deadline interrupts a node
- [Example 06: Cancellation](../examples/06-cancellation) - runnable AbortController and deadlineMs example
- [`@studnicky/signal`, `Signal`](https://github.com/Studnicky/noocodec-substrate/tree/main/packages/signal)
- [Reference, Contracts, `ExecuteOptionsType`](../reference/contracts)

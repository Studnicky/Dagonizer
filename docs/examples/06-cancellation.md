---
title: 'Example 06: Cancellation'
description: 'Abort the Archivist mid-scout when the visitor closes the connection, or cap the entire flow with a hard deadline. The signal propagates through RetryPolicy to every node.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Cancellation guide'
    link: '../guide/cancellation'
  - text: 'Example 07: Retry Flow'
    link: './07-retry'
    description: '`RetryPolicy.run` honors the same signal'
  - text: 'Example 08: Checkpoint and Resume'
    link: './08-checkpoint'
  - text: 'Reference: Runtime, `Signal`'
    link: '../reference/runtime'
  - text: 'Reference: Lifecycle'
    link: '../reference/lifecycle'
---

<script setup lang="ts">
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 06: Cancellation

## Cancellation Contract

Cancellation is the execution control plane for long-running DAGs. A visitor can close the tab, an HTTP request can disconnect, or the caller can enforce a hard deadline; the same signal reaches every node in The Archivist.

The DAG does not change for cancellation. The execution options change, the lifecycle records the interrupted terminal state, and the result cursor says where a later resume can continue.

## Abort and Deadline Flow

### DAG registration and diagram

[The Archivist](./the-archivist) sometimes talks to slow external APIs. The graph is unchanged by cancellation; the caller supplies execution options, and the same DAG records a structured interrupted lifecycle when the signal fires.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## Signal Propagation

The dispatcher composes the caller `AbortSignal` with `deadlineMs` and passes the resulting signal to every node as `context.signal`. Nodes pass that signal into adapters, tools, and retry policies. When the signal aborts, work exits through the dispatcher lifecycle as `cancelled` or `timed_out`, and `result.cursor` records where a checkpoint can resume later.

The Archivist scouts are the critical path here. External calls and `RetryPolicy` waits both receive `context.signal`, so aborting during a backoff or slow provider call does not wait for the happy-path timeout.

## Code Samples

#### Dispatcher + signal + deadline

The `#cancellation-run` region shows the `AbortController`, the `signal` + `deadlineMs` execute options, and the lifecycle switch that reads the terminal state:

<<< @/../examples/the-archivist/runArchivist.ts#cancellation-run

#### Scout signal pass-through

The `#tool-candidate-gather-strategy` region shows how `openLibraryScout` propagates `context.signal` through the `scoutRetry` policy and into the tool call. When the signal fires, the retry policy aborts mid-backoff instead of waiting:

<<< @/../examples/the-archivist/nodes/scouts.ts#tool-candidate-gather-strategy

## Operational Uses

Cancellation lets hosts stop work without corrupting DAG state or leaking in-flight retries. It fits browser tabs closing, HTTP requests disconnecting, user-driven cancellation, or hosts enforcing a hard execution budget.

For product teams, this means long-running model or tool workflows can behave like normal web infrastructure. They can be cancelled, observed, checkpointed, and resumed instead of being treated as fire-and-forget background jobs.

## Runtime Notes

- **`signal` + `deadlineMs` composition.** `Signal.compose` (from `@studnicky/signal`) combines the caller-supplied `AbortSignal` with the deadline into one internal signal passed to every node via `context.signal`. Neither option is required; both can be used together — when neither is supplied, `context.signal` is `Signal.never()`, a valid never-aborting `AbortSignal`.
- **Nodes propagate the signal.** Every scout passes `context.signal` as the second argument to `scoutRetry.run(task, signal)`. The retry policy aborts mid-wait when the signal fires, so scouts do not wait through the full backoff window.
- **Lifecycle records the exact terminal state.** `cancelled` carries the abort `reason` string; `timed_out` carries the deadline-finished timestamp. `completed` means all nodes ran to their terminal outputs.
- **`result.cursor`.** Records the next node that would have run. When non-null, the flow was interrupted. Pair with `Checkpoint.capture` (see [Example 08](./08-checkpoint)) to resume in a later process.

The same cancellation path is wired to the cancel control in [The Archivist](./the-archivist).

## Related Concepts

- [Running domain: The Archivist](./the-archivist)
- [Cancellation guide](../guide/cancellation)
- [Example 07: Retry Flow](./07-retry) - `RetryPolicy.run` honors the same signal
- [Example 08: Checkpoint and Resume](./08-checkpoint)
- [Reference: Runtime, `Signal`](../reference/runtime)
- [Reference: Lifecycle](../reference/lifecycle)

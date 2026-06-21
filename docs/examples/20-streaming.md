---
title: 'Example 20: Streaming execution'
description: 'Dagonizer.execute() returns an Execution<TState> that is both awaitable and AsyncIterable. Iterating yields a NodeResultType<NodeStateInterface> for each node as it completes, before the flow resolves.'
seeAlso:
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'lifecycle hooks: onNodeStart, onNodeEnd, onFlowEnd'
  - text: 'Phase 06: Cancellation'
    link: './06-cancellation'
    description: 'AbortSignal + deadlineMs to interrupt a running flow'
  - text: 'Reference: Execution'
    link: '../reference/execution'
    description: 'ExecutionResult, NodeResult, Execution type reference'
---

# Example 20: Streaming execution

`Dagonizer.execute()` returns an `Execution<TState>` that is both:

- **Awaitable** — `await dispatcher.execute(...)` waits for the final summary (`ExecutionResultType<TState>`).
- **AsyncIterable** — `for await (const stage of dispatcher.execute(...))` yields a `NodeResultType<NodeStateInterface>` for each node as it completes. The base type is used because embedded-child nodes may carry different concrete state shapes.

The two consumption modes share a single internal generator. Iterating and then awaiting returns the cached final result; the flow body runs exactly once.

<<< @/../examples/20-streaming.ts#streaming

## Code

<<< @/../examples/20-streaming.ts

## What it demonstrates

- **`Execution<TState>` dual interface.** `execute()` returns an object that satisfies both `Promise<ExecutionResultType<TState>>` and `AsyncIterable<NodeResultType<NodeStateInterface>>`. No separate streaming method needed.
- **Per-node `NodeResultType<NodeStateInterface>`.** Each yielded value carries `nodeName`, `output`, `state` (typed as the base `NodeStateInterface` so embedded-child nodes with different concrete states are covered), and the node's own lifecycle snapshot. Downcast `stage.state` locally when you need concrete state access.
- **Single pass.** The internal generator runs once. Awaiting after iteration returns the same resolved value; the flow does not re-execute.
- **Compose with cancellation.** Pass `signal` in the execute options to cancel the stream mid-flight; any in-flight node resolves or throws, and the async iterator drains cleanly.

## Run

```bash
npx tsx examples/20-streaming.ts
```

---
title: 'Example 20: Streaming execution'
description: 'Dagonizer.execute() returns an Execution<TState> that is both awaitable and AsyncIterable. Iterating yields a NodeResultInterface<TState> for each node as it completes, before the flow resolves.'
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

- **Awaitable** — `await dispatcher.execute(...)` waits for the final summary (`ExecutionResultInterface<TState>`).
- **AsyncIterable** — `for await (const stage of dispatcher.execute(...))` yields a `NodeResultInterface<TState>` for each node as it completes.

The two consumption modes share a single internal generator. Iterating and then awaiting returns the cached final result; the flow body runs exactly once.

```ts twoslash
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';

declare const dispatcher: Dagonizer<NodeStateBase>;
declare const state: NodeStateBase;
// ---cut---
// Mode A: await only
const result = await dispatcher.execute('pipeline', state);

// Mode B: stream then await
const execution = dispatcher.execute('pipeline', state);
for await (const stage of execution) {
  console.log(stage.nodeName, stage.output);
}
const streamedResult = await execution; // returns cached final result
```

## Code

<<< @/../examples/20-streaming.ts

## What it demonstrates

- **`Execution<TState>` dual interface.** `execute()` returns an object that satisfies both `Promise<ExecutionResultInterface<TState>>` and `AsyncIterable<NodeResultInterface<TState>>`. No separate streaming method needed.
- **Per-node `NodeResultInterface`.** Each yielded value carries `nodeName`, `output`, `state` (the mutable state reference after that node ran), and the node's own lifecycle snapshot. Inspect intermediate state between nodes without subclassing.
- **Single pass.** The internal generator runs once. Awaiting after iteration returns the same resolved value; the flow does not re-execute.
- **Compose with cancellation.** Pass `signal` in the execute options to cancel the stream mid-flight; any in-flight node resolves or throws, and the async iterator drains cleanly.

## Run

```bash
npx tsx examples/20-streaming.ts
```

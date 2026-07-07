---
title: 'Execution'
description: 'Execution handle reference for streaming per-stage results, promise-like final results, single-consumption semantics, await behavior, and cancellation.'
seeAlso:
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: '`execute`, `resume`'
  - text: 'Reference: Lifecycle'
    link: './lifecycle'
  - text: 'Reference: Checkpoint'
    link: './checkpoint'
---

# Execution

## What It Is

`Execution<TState>` is the handle returned by `Dagonizer.execute()` and `Dagonizer.resume()`. It can be awaited for the final result or iterated for per-stage results.

Use this page when a host needs progress updates, final state, cancellation behavior, checkpoint cursor inspection, or one clear rule for consuming a run exactly once.

## How It Works

The execution object wraps one underlying async generator. Awaiting it drains the generator and resolves to `ExecutionResultType<TState>`. Iterating it yields `NodeResultType` values as stages complete and then marks the handle consumed.

Cancellation and deadlines flow through `ExecuteOptionsType`. Checkpoint cursors are captured from yielded node results and final execution results; the execution handle itself does not own persistence.

## Diagrams, Examples, and Outputs

Execution is a runtime handle, not a DAG document, so this page does not add a reference-only diagram. The links below show the same handle in runnable examples and adjacent contracts:

- [Reference: Dagonizer](./dagonizer) - `execute`, `resume`
- [Reference: Lifecycle](./lifecycle)
- [Reference: Checkpoint](./checkpoint)

## What It Lets You Do

The execution reference lets applications consume a DAG run as both a final result and a per-stage stream. Use it when a host needs progress updates, final state, cancellation handling, or checkpoint cursor inspection from one execution handle.

`Execution<TState>` is the handle returned by `Dagonizer.execute()` and `Dagonizer.resume()`. It is both an `AsyncIterable` (streaming per stage) and a `PromiseLike` (awaitable for the final result). The underlying generator runs exactly once regardless of how it is consumed.

## Code Samples

The code below covers streaming iteration, await behavior, single-consumption rules, terminal outcomes, and cancellation.

### Import

```ts twoslash
import type { Execution, ExecutionResultType, NodeResultType } from '@studnicky/dagonizer';
```

### Class: `Execution<TState>`

```ts twoslash
import { Execution } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const _: Execution<NodeStateInterface>;
export {};
```

Not instantiated directly; returned by the dispatcher.

---

#### `[Symbol.asyncIterator]()`

Iterate stage results as they complete:

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { NodeResultType } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const state: MyState;

const execution = dispatcher.execute('my-flow', state);
for await (const node of execution) {
  console.log(node.nodeName, node.output);
}
const result = await execution; // cached, no second run
```

Each yielded `NodeResultType<TState>` carries:

| Field | Type | Description |
|-------|------|-------------|
| `nodeName` | `string` | Name of the node that completed |
| `output` | `string \| null` | Output name returned by the operation; `null` when no route was emitted |
| `skipped` | `boolean` | `true` for an empty scatter source that bypassed execution |
| `state` | `TState` | Reference to the shared state object (mutated in place) |
| `intermediateResults` | `readonly NodeResultType<TState>[]` | Per-step results from composite nodes (scatter / embedded-DAG); `[]` for leaf nodes |

For scatter and embedded-DAG placements, the iterator first yields intermediate results for each constituent clone or inner node, then yields the group result.

Phase placements (`PhaseNode`) run out of band and do not yield through the iterator. They surface via the `onPhaseEnter` / `onPhaseExit` subclass hooks on `Dagonizer` and are appended to `result.executedNodes`.

---

#### `.then(onfulfilled, onrejected)`

`Execution` implements `PromiseLike`. Await it for the final `ExecutionResultType<TState>`:

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const state: MyState;

const result: ExecutionResultType<MyState> = await dispatcher.execute('my-flow', state);
```

If the iterator has already been consumed, the cached result is returned; the generator is not re-run.

`ExecutionResultType<TState>` carries:

| Field | Type | Description |
|-------|------|-------------|
| `state` | `TState` | Final state (same reference passed in) |
| `cursor` | `string \| null` | Next node to run on resume; `null` when the flow completed |
| `executedNodes` | `string[]` | Nodes that ran (in order), including pre/post phase placements |
| `skippedNodes` | `string[]` | Nodes skipped (empty scatter source) |
| `terminalOutcome` | `'completed' \| 'failed' \| null` | Outcome declared by the `TerminalNode` placement the flow exited through; `null` on error or abort exits (no `TerminalNode` reached) |
| `interruptedAt` | `InterruptionInfo \| null` | Cancellation telemetry; `null` on clean exits |

`InterruptionInfo`:

```ts twoslash
import type { ExecutionResultType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const result: ExecutionResultType<NodeStateInterface>;
const interrupted = result.interruptedAt;
if (interrupted !== null) {
  const nodeName: string = interrupted.nodeName;
  const reason: 'abort' | 'timeout' = interrupted.reason;
}
```

Populated when the flow exited via signal abort or per-run / per-node timeout. `reason: 'abort'` corresponds to lifecycle `cancelled`; `reason: 'timeout'` corresponds to lifecycle `timed_out`.

---

### Consumption patterns

**One-shot await:**

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const state: MyState;

const result = await dispatcher.execute('flow', state);
if (result.cursor !== null) {
  // interrupted: checkpoint it
}
```

**Streaming with early exit:**

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const state: MyState;
declare function isHeavyNode(name: string): boolean;

const ctl = new AbortController();
const execution = dispatcher.execute('flow', state, { signal: ctl.signal });
for await (const node of execution) {
  if (isHeavyNode(node.nodeName)) {
    ctl.abort(new Error('pause here'));
  }
}
const result = await execution; // result.cursor holds where we stopped
```

**Consuming both modes:**

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
class MyState extends NodeStateBase {}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const state: MyState;

const execution = dispatcher.execute('flow', state);
const nodes: string[] = [];
for await (const n of execution) nodes.push(n.nodeName);
const result = await execution; // same run, cached
console.log(nodes, result.cursor);
```

The iterator never throws. Cancellation and operation errors resolve to a final `ExecutionResultType` with a non-`null` `cursor`, populated `interruptedAt`, and the appropriate `state.lifecycle.variant`.

## Details for Nerds

`Execution<TState>` is single-consumption by design. The first await or iteration starts the generator; later awaits return the cached final result. That prevents double-running nodes when UI code both streams progress and awaits completion.

The iterator resolves errors into the final execution result instead of throwing from the loop. Application code can keep one `for await` loop for progress, then inspect `result.state.lifecycle` and `result.cursor` to decide whether to resume, retry, or surface failure.

## Related Concepts

- [Reference: Dagonizer](./dagonizer) - `execute`, `resume`
- [Reference: Lifecycle](./lifecycle) - terminal state variants carried by the final result
- [Reference: Checkpoint](./checkpoint) - cursor capture and restore path
- [Cancellation](../guide/cancellation) - abort signals and deadlines in practice
- [Checkpoint](../guide/checkpoint) - resumable execution flow

---
title: 'Runner'
description: 'Runner reference for DagRunner, TriggerInterface, OnceTrigger, CLI, event, and request triggers around registered DAG execution.'
seeAlso:
  - text: 'Guide: Chat Event Orchestration'
    link: '../guide/chat-event-orchestration'
    description: 'one registered agent DAG per inbound event or request turn'
  - text: 'Example 28: Runner and Triggers'
    link: '../examples/28-runner'
    description: 'Full working example for all trigger variants'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: 'TriggerInterface adapter contract'
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'The dispatcher DagRunner drives'
  - text: 'Example 08: Checkpoint and Resume'
    link: '../examples/08-checkpoint'
    description: 'DagRunner.resume() from a checkpoint cursor'
---

# Runner

## What It Is

`DagRunner` is the reusable host loop around a registered DAG. It accepts trigger input, creates initial state, executes a DAG reference resolved by the dispatcher, and projects the final execution result into an application-specific output.

Use this page when a CLI command, queue worker, HTTP route, browser action, or scheduled job should invoke the same registered DAG without rewriting the register→seed→execute→project loop.

## How It Works

Subclass `DagRunner<TInput, TState, TOutput>` and implement two hooks: `seedState(input)` and `projectResult(result)`. Triggers feed inputs into the runner; the runner delegates execution to a registered `Dagonizer`.

The runner does not change DAG semantics. It is a hosting convenience for applications that want one stable adapter around many trigger shapes.

## Diagrams, Examples, and Outputs

The runner reference is about host integration rather than graph shape. For executable examples, start with [Example 28: Runner and Triggers](../examples/28-runner), then compare the triggered DAG registration with the `Dagonizer` reference.

## What It Lets You Do

Use `DagRunner` to keep trigger plumbing outside DAG node code. The DAG stays portable; the runner adapts external input and output to the host environment.

## Code Samples

### Abstract class: `DagRunner<TInput, TState, TOutput>`

The canonical DAG execution harness. Owns the register→seed→execute→route→project loop once. Applications subclass and override `seedState` and `projectResult`.

```ts twoslash
import { NodeStateBase } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';
import { DagRunner } from '@studnicky/dagonizer/runner';
import type { DagRunnerOptionsType } from '@studnicky/dagonizer/runner';

class MyState extends NodeStateBase { value = 0; }
type MyInput  = { value: number };
type MyOutput = { value: number; done: boolean };

// ---cut---
class MyRunner extends DagRunner<MyInput, MyState, MyOutput> {
  protected override seedState(input: MyInput): MyState {
    const state = new MyState();
    state.value = input.value;
    return state;
  }

  protected override projectResult(result: ExecutionResultType<MyState>): MyOutput {
    return {
      'value': result.state.value,
      'done':  result.state.lifecycle.variant === 'completed',
    };
  }
}
```

`TInput` is the trigger-specific input type; `TState` must satisfy `NodeStateInterface` (extend `NodeStateBase`); `TOutput` is the projected output.

#### Constructor

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { DagRunner } from '@studnicky/dagonizer/runner';
import type { DagRunnerOptionsType } from '@studnicky/dagonizer/runner';
class MyState extends NodeStateBase {}
type MyInput = unknown; type MyOutput = unknown;
class MyRunner extends DagRunner<MyInput, MyState, MyOutput> {
  protected override seedState(_i: MyInput): MyState { return new MyState(); }
  protected override projectResult(): MyOutput { return {}; }
}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
const options: DagRunnerOptionsType<MyState> = { 'dispatcher': dispatcher };
const runner = new MyRunner(options);
```

`DagRunnerOptionsType` has one required field:

| Field | Type | Description |
|---|---|---|
| `dispatcher` | `Dagonizer<TState>` | The configured dispatcher the runner drives. Injected via constructor; the runner does not own construction. |

#### `registerBundle(bundle)`

Delegates to `dispatcher.registerBundle`. Call before `run`.

#### `run(dagIri, input, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { DagRunner } from '@studnicky/dagonizer/runner';
import type { DagRunnerOptionsType } from '@studnicky/dagonizer/runner';
class MyState extends NodeStateBase { value = 0; }
type MyInput = { value: number }; type MyOutput = { value: number };
class MyRunner extends DagRunner<MyInput, MyState, MyOutput> {
  protected override seedState(i: MyInput): MyState { const s = new MyState(); s.value = i.value; return s; }
  protected override projectResult(r: import('@studnicky/dagonizer').ExecutionResultType<MyState>): MyOutput { return { value: r.state.value }; }
}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
const runner = new MyRunner({ dispatcher });
const output = await runner.run('urn:noocodec:dag:my-dag', { value: 1 });
```

Builds initial state via `seedState(input)`, calls `dispatcher.execute(dagIri, state, options)`, and returns `projectResult(result)`. Never throws — unexpected errors route through `onRunError`.

#### `resume(dagIri, state, fromStage, options?)`

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { DagRunner } from '@studnicky/dagonizer/runner';
import type { DagRunnerOptionsType } from '@studnicky/dagonizer/runner';
class MyState extends NodeStateBase { value = 0; }
type MyInput = { value: number }; type MyOutput = { value: number };
class MyRunner extends DagRunner<MyInput, MyState, MyOutput> {
  protected override seedState(i: MyInput): MyState { const s = new MyState(); s.value = i.value; return s; }
  protected override projectResult(r: import('@studnicky/dagonizer').ExecutionResultType<MyState>): MyOutput { return { value: r.state.value }; }
}
// ---cut---
declare const dispatcher: Dagonizer<MyState>;
declare const rehydrated: MyState;
const runner = new MyRunner({ dispatcher });
const output = await runner.resume('urn:noocodec:dag:my-dag', rehydrated, 'urn:noocodec:dag:my-dag/node/node-b');
```

Resumes from placement IRI `fromStage` with a pre-rehydrated state. The caller is responsible for rehydrating state before the call (typically via `Checkpoint.load(raw).restoreState(fn)`). Never throws.

#### `seedState(input)` — abstract

Override to build the initial `TState` from the trigger input. Runs inside `run()` before `dispatcher.execute`.

#### `projectResult(result)` — abstract

Override to project `ExecutionResultType<TState>` to the application's `TOutput` shape. Runs after each `execute`/`resume` call.

#### `onRunError(dagIri, error)` — protected

Called when an unexpected error escapes the engine. Default re-throws. Override to absorb the error and return a replacement `TOutput` when callers need continuity.

---

### Interface: `DagRunnerInterface<TInput, TState, TOutput>`

```ts twoslash
import type { DagRunnerInterface } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare function acceptRunner(
  runner: DagRunnerInterface<unknown, NodeStateInterface, unknown>
): void;
```

The public face of `DagRunner`. Trigger implementations accept this interface rather than the concrete class so they are portable across runner subclasses.

---

### Interface: `TriggerInterface<TInput, TState, TOutput>`

```ts twoslash
import type { TriggerInterface } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const trigger: TriggerInterface<unknown, NodeStateInterface, unknown>;
```

Adapter contract for the timing signal. Ships through `@studnicky/dagonizer/runner` for ergonomic co-import with the runner classes. Canonical source is `@studnicky/dagonizer/contracts`.

| Method | Description |
|--------|-------------|
| `attach(runner)` | Wire the trigger to a runner. Returns a promise that resolves when the trigger's lifecycle ends (all planned invocations done, or `detach` was called). |
| `detach()` | Tear down any pending subscription. Idempotent. |

---

### Class: `OnceTrigger<TInput, TState, TOutput>`

```ts twoslash
import { OnceTrigger } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
declare const runner: import('@studnicky/dagonizer/runner').DagRunnerInterface<{ text: string }, NodeStateInterface, { words: number }>;
const trigger = new OnceTrigger<{ text: string }, NodeStateInterface, { words: number }>(
  'urn:noocodec:dag:word-count',
  { text: 'hello world' },
);
await trigger.attach(runner);
const result = trigger.result; // available after attach resolves
```

Fires `runner.run(dagIri, input, options)` exactly once when `attach` is called. `detach()` before `attach` makes attach a no-op.

| Member | Description |
|--------|-------------|
| `constructor(dagIri, input, options?)` | Supply the DAG IRI, literal input, and optional `ExecuteOptionsType`. |
| `result` | `TOutput \| null`. Available after `attach` resolves; `null` before or if detached before attach. |
| `attach(runner)` | Fires the run and resolves when done. |
| `detach()` | Marks the trigger as detached; future `attach` is a no-op. |

---

### Abstract class: `CliTrigger<TInput, TState, TOutput>`

```ts twoslash
import { CliTrigger } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
class MyCli extends CliTrigger<{ text: string }, NodeStateInterface, { words: number }> {
  protected override parseArgs(_command: string, args: string[]): { text: string } {
    return { text: args.join(' ') };
  }
  protected override selectDag(_command: string): string {
    return 'urn:noocodec:dag:word-count';
  }
}
const trigger = new MyCli('word-count', process.argv.slice(2));
```

Abstract base for CLI harnesses. Subclass and override `parseArgs`.

| Member | Description |
|--------|-------------|
| `constructor(command, args, options?)` | `command` is the primary command token; `args` are remaining argv tokens. |
| `result` | `TOutput \| null`. Available after `attach` resolves. |
| `parseArgs(command, args)` — abstract | Map raw argv tokens to `TInput`. Must override. |
| `selectDag(command)` — protected | Map the command token to a registered DAG IRI. Default returns the command token unchanged, so the command token must already be an IRI unless overridden. |
| `attach(runner)` | Calls `parseArgs`, then `runner.run(selectDag(command), input, options)`. |
| `detach()` | Marks trigger as detached; future `attach` is a no-op. |

---

### Abstract class: `EventTrigger<TMessage, TInput, TState, TOutput>`

```ts twoslash
import { EventTrigger } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
type Msg = { text: string };
class MyEvent extends EventTrigger<Msg, { text: string }, NodeStateInterface, { words: number }> {
  protected override subscribe(onMessage: (msg: Msg) => void): () => void {
    // wire to a real event source and return unsubscribe
    return () => { /* teardown */ };
  }
  protected override toInput(msg: Msg): { text: string } {
    return { text: msg.text };
  }
}
```

Abstract base for subscription-driven harnesses (WebSocket, EventEmitter, message queue). Each inbound message triggers a parallel `runner.run` call. `detach` tears down the subscription and resolves the `attach` promise.

`TMessage` is the raw message type emitted by the subscription; `TInput` is the runner input built from it.

| Member | Description |
|--------|-------------|
| `subscribe(onMessage)` — abstract | Register a handler with the event source. Return an unsubscribe function. |
| `toInput(message)` — abstract | Convert a raw message to `TInput`. |
| `selectDag(message)` — protected | Choose the DAG IRI for a message. Default returns `urn:noocodec:dag:default`. |
| `attach(runner)` | Registers the subscription and returns a promise that resolves only after `detach()` is called. |
| `detach()` | Unsubscribes and resolves the `attach` promise. |

---

### Abstract class: `RequestTrigger<TRequest, TInput, TState, TOutput>`

```ts twoslash
import { RequestTrigger } from '@studnicky/dagonizer/runner';
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
type Req = { body: string };
class MyRequest extends RequestTrigger<Req, { text: string }, NodeStateInterface, { words: number }> {
  protected override toInput(req: Req): { text: string } {
    return { text: req.body };
  }
}
const trigger = new MyRequest();
// await trigger.attach(runner);
// const output = await trigger.fire({ body: 'hello world' });
```

Abstract base for per-turn HTTP harnesses. `attach` stores the runner reference (no subscription); `fire(request)` is the entry point from the HTTP handler or turn loop.

| Member | Description |
|--------|-------------|
| `toInput(request)` — abstract | Convert a raw request to `TInput`. |
| `selectDag(request)` — protected | Choose the DAG IRI per request. Default returns `urn:noocodec:dag:default`. |
| `requestOptions(request)` — protected | Supply per-turn `ExecuteOptionsType` (signal, deadlineMs). Default returns `{}`. |
| `attach(runner)` | Stores the runner reference. Resolves immediately — no subscription. |
| `detach()` | Clears the runner reference. Subsequent `fire` calls throw. |
| `fire(request)` | Calls `runner.run(selectDag(request), toInput(request), requestOptions(request))`. Throws if called before `attach`. |

### Import path

```ts twoslash
import {
  DagRunner,
  OnceTrigger,
  CliTrigger,
  EventTrigger,
  RequestTrigger,
} from '@studnicky/dagonizer/runner';
import type {
  DagRunnerInterface,
  DagRunnerOptionsType,
  TriggerInterface,
} from '@studnicky/dagonizer/runner';
```

## Details for Nerds

`@studnicky/dagonizer/runner` ships the `DagRunner` abstract base class and trigger variants. Every callable hangs off a class; there are no freestanding functions.

Triggers are adapters around external input. They should translate host-specific request shape into `TInput`, choose a DAG reference, and pass execution options. They should not mutate DAG state directly or bypass `DagRunner.run()`.

## Related Concepts

- [Example 28: Runner and Triggers](../examples/28-runner) - Full working example for all trigger variants
- [Guide: Chat Event Orchestration](../guide/chat-event-orchestration) - one registered agent DAG per inbound event or request turn
- [Reference: Contracts](./contracts) - TriggerInterface adapter contract
- [Reference: Dagonizer](./dagonizer) - The dispatcher DagRunner drives
- [Example 08: Checkpoint and Resume](../examples/08-checkpoint) - DagRunner.resume() from a checkpoint cursor
- [Example 32: Dispatcher CLI](../examples/32-dispatcher) - the Dispatcher flow from a command-line runner

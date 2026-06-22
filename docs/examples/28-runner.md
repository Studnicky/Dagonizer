---
title: 'Example 28: DagRunner and triggers'
description: 'Subclass DagRunner to own the register→seed→execute→project loop once, then wire a trigger to decide when it fires.'
seeAlso:
  - text: 'Reference: Runner'
    link: '../reference/runner'
    description: 'Full API surface for DagRunner and all trigger variants'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'TriggerInterface adapter contract'
  - text: 'Phase 08: Checkpoint + resume'
    link: './08-checkpoint'
    description: 'DagRunner.resume() picks up from a checkpoint cursor'
  - text: 'Authoring DAGs'
    link: '../guide/authoring'
---

# Example 28: DagRunner and triggers

Every consumer of `@studnicky/dagonizer` that runs a DAG from a CLI script, an HTTP handler, or an event loop independently derives the same loop: build a dispatcher, register bundles, seed initial state, call `execute`, route the outcome, and project a result. `DagRunner` owns that loop once. Subclass it and override two methods; the triggers decide when it fires.

## The word-count DAG

The example drives a two-node pipeline: `TrimNode` strips whitespace, then `CountNode` counts tokens. A `TerminalNode` ends the flow.

<<< @/../examples/dags/28-runner.ts#dag

## Subclassing DagRunner

Override `seedState` to build initial state from trigger input, and `projectResult` to project the final `ExecutionResultType` to a domain value. Nothing else belongs in the subclass.

<<< @/../examples/28-runner.ts#runner

## Building the runner

Construct a `Dagonizer`, register the bundle, and hand the dispatcher to the runner via `DagRunnerOptionsType`. The runner holds a reference to the dispatcher; it does not own construction of it, so consumers can configure containers or channels before handing it over.

<<< @/../examples/28-runner.ts#harness

## OnceTrigger: fire exactly once

`OnceTrigger` calls `runner.run(dagName, input)` once when `attach` resolves. The result is available on `trigger.result` after `attach` returns. Calling `detach()` before `attach()` makes the attach a no-op.

<<< @/../examples/28-runner.ts#once-trigger

## CliTrigger: parse argv and fire once

`CliTrigger` is an abstract base. Override `parseArgs` to map raw argv tokens to `TInput`. Override `selectDag` to route the command token to a registered DAG name (default: the command token unchanged).

<<< @/../examples/28-runner.ts#cli-trigger

## EventTrigger: fire once per subscription event

`EventTrigger` (abstract) wires `attach` to an event source via `subscribe`. Each inbound message triggers a parallel `runner.run` call. `detach` tears down the subscription and resolves the `attach` promise.

<<< @/../examples/28-runner.ts#event-trigger

## RequestTrigger: fire once per HTTP turn

`RequestTrigger` (abstract) stores the runner reference on `attach` (no subscription). The caller invokes `trigger.fire(request)` from the HTTP handler or turn loop. Override `toInput`, `selectDag`, and `requestOptions` to adapt the request shape.

<<< @/../examples/28-runner.ts#request-trigger

## What it demonstrates

- **`DagRunner` centralises the loop.** `seedState` + `projectResult` are the only overrides needed. `registerBundle`, `run`, and `resume` come for free.
- **`OnceTrigger`.** The simplest trigger: supply a DAG name and literal input, call `attach(runner)`, read `trigger.result`.
- **`CliTrigger`.** Abstract base for CLI harnesses. `parseArgs` maps argv tokens to `TInput`; `selectDag` maps a command token to a DAG name.
- **`EventTrigger`.** Abstract base for subscription-driven harnesses (WebSocket, EventEmitter, queue). Each message fires a parallel `run`; `detach` cleans up.
- **`RequestTrigger`.** Stateless per-turn base for HTTP handlers. `fire(request)` is the entry point; `attach`/`detach` manage the runner reference.
- **Import path.** All runner surface ships through `@studnicky/dagonizer/runner`.

Run: `npx tsx examples/28-runner.ts` or with CLI text: `npx tsx examples/28-runner.ts "Hello world"`.

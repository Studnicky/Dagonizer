---
title: 'Monadic Node'
description: 'MonadicNode abstract base pattern: concrete subclasses declare name, outputs, and implement execute (or a protected run method). Every code path returns a declared output port — nothing throws past the node boundary.'
seeAlso:
  - text: 'Example 01: Linear Intake'
    link: './01-linear'
    description: 'simplest node implementation'
  - text: 'Example 02: DAGBuilder'
    link: './02-builder'
    description: 'DAGBuilder chainable API'
  - text: 'Reference: Contracts, NodeInterface'
    link: '../reference/contracts'
    description: 'NodeInterface contract'
---

# Monadic Node

## What It Is

Monadic Node is a small base-class pattern for application nodes that must return declared output ports on every code path. The example registers `SearchCatalogueNode` on a two-placement DAG and runs it through both success and error routes.

Use this when node authors want structure around `execute`: declared outputs, a protected `run` hook, and a consistent error route instead of uncaught throws escaping the node boundary.

## How It Works

`MonadicNode` requires concrete subclasses to declare `name` and `outputs`. A logging intermediate class can wrap the protected `run` method, while the concrete node owns domain behavior. The dispatcher sees a normal `NodeInterface`.

## Diagrams, Examples, and Outputs

The example is intentionally tiny: one `SingleNode` placement followed by one completed terminal. The CLI output demonstrates both routes.

### Run

```bash
npx tsx examples/monadic-node.ts
```

## What It Lets You Do

The monadic node pattern lets applications build node classes where every code path returns a declared output port. Use it when node authors need a small base class that catches implementation errors, routes failures explicitly, and keeps node behavior testable outside the dispatcher.

`MonadicNode` is the abstract base for canonical DAG node patterns. Concrete subclasses declare `name`, `outputs`, and implement `execute` (or, as shown here, a protected `run` method called by a logging intermediate class). Every code path must return a declared output port — nothing throws past the node boundary.

`SearchCatalogueNode` is registered on a two-placement DAG (`search → end`) and executed twice:

- With a real query — routes `'success'`.
- With an empty query — routes `'error'`.

## Code Samples

<<< @/../examples/monadic-node.ts

## Details for Nerds

- **`MonadicNode` abstract base.** Subclass it to get structural enforcement: `name` and `outputs` are required abstract members; `execute` is the hook point. The base class catches any unhandled throws from `run` and routes them to `'error'` automatically.
- **Protected `run` method.** A logging intermediate class can override `execute` to wrap `run` with metrics or tracing. The node implementation goes in `run`; the infrastructure goes in `execute`.
- **Every path returns a declared output.** Returning a non-declared output port is a type error. The node must handle all cases (including empty input, network failure) by routing to a declared port rather than throwing.
- **Two-placement DAG.** A `SingleNode` placement followed by a `TerminalNode` with `outcome: 'completed'`. The minimal shape that verifies the node's routing behavior end-to-end.

## Related Concepts

- [Example 01: Linear Intake](./01-linear) - simplest node implementation
- [Example 02: DAGBuilder](./02-builder) - DAGBuilder chainable API
- [Reference: Contracts, NodeInterface](../reference/contracts) - NodeInterface contract

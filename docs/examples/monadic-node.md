---
title: 'Example: Monadic node'
description: 'MonadicNode abstract base pattern: concrete subclasses declare name, outputs, and implement execute (or a protected run method). Every code path returns a declared output port — nothing throws past the node boundary.'
seeAlso:
  - text: 'Phase 01: Linear intake'
    link: './01-linear'
    description: 'simplest node implementation'
  - text: 'Phase 02: DAGBuilder'
    link: './02-builder'
    description: 'DAGBuilder chainable API'
  - text: 'Reference: Contracts, NodeInterface'
    link: '../reference/contracts'
    description: 'NodeInterface contract'
---

# Example: Monadic node

`MonadicNode` is the abstract base for canonical DAG node patterns. Concrete subclasses declare `name`, `outputs`, and implement `execute` (or, as shown here, a protected `run` method called by a logging intermediate class). Every code path must return a declared output port — nothing throws past the node boundary.

`SearchCatalogueNode` is registered on a two-placement DAG (`search → end`) and executed twice:

- With a real query — routes `'success'`.
- With an empty query — routes `'error'`.

## Code

<<< @/../examples/monadic-node.ts

## What it demonstrates

- **`MonadicNode` abstract base.** Subclass it to get structural enforcement: `name` and `outputs` are required abstract members; `execute` is the hook point. The base class catches any unhandled throws from `run` and routes them to `'error'` automatically.
- **Protected `run` method.** A logging intermediate class can override `execute` to wrap `run` with metrics or tracing. The node implementation goes in `run`; the infrastructure goes in `execute`.
- **Every path returns a declared output.** Returning a non-declared output port is a type error. The node must handle all cases (including empty input, network failure) by routing to a declared port rather than throwing.
- **Two-placement DAG.** A `SingleNode` placement followed by a `TerminalNode` with `outcome: 'completed'`. The minimal shape that verifies the node's routing behavior end-to-end.

## Run

```bash
npx tsx examples/monadic-node.ts
```

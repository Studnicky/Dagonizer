---
title: 'Services container'
description: 'Typed services bag wired into the dispatcher; every node reads it via context.services.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'services are dispatcher-scoped; per-execution data lives on state'
  - text: 'Observability'
    link: './observability'
    description: 'pass loggers or tracers through the services bag'
  - text: 'State accessors'
    link: './state-accessor'
    description: 'accessor + services together customize what nodes see'
---

# Services container

`DagonizerOptionsInterface.services` accepts a typed bag of dependencies. The same reference flows through every node as `context.services`. Nodes never construct their own clients; they read from `context.services`.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer<TState, TServices>` | `@noocodex/dagonizer` | Carries the services type as a generic parameter |
| `DagonizerOptionsInterface.services` | `@noocodex/dagonizer` | The bag passed at construction |
| `NodeInterface<TState, TOutput, TServices>` | `@noocodex/dagonizer` | Propagates `TServices` to `context.services` |
| `NodeContextInterface.services` | `@noocodex/dagonizer` | The per-call view of the bag |

`TServices` defaults to `undefined`. Dispatchers that need nothing typed through services work as `new Dagonizer<S>()`.

## Defining the bag

Consumers declare a plain interface. There is no DI container, no provider scope, no factory step.

<<< @/../examples/the-archivist/services.ts#services-shape

## Constructing the dispatcher

<<< @/../examples/the-archivist/main.ts#wire-services

## How services flow

```mermaid
flowchart TB
  ctor([new Dagonizer]):::svc
  bag([services bag]):::svc
  dispatch[dispatcher]:::svc
  ctx([NodeContext.services]):::svc
  node[node.execute]
  bag --> ctor
  ctor --> dispatch
  dispatch -->|every node| ctx
  ctx --> node
  classDef svc fill:transparent,stroke:var(--mermaid-state-stroke,#b18cff),stroke-dasharray:3 3
```

The diagram captures the wiring, not a DAG. The bag is constructor-scoped; the dispatcher hands the same reference to every node in every execution.

## Receiving services in a node

`NodeInterface<TState, TOutput, TServices>` propagates the same parameter to `context.services`:

```ts twoslash
import { ScalarNode, NodeOutputBuilder } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';
import type { NodeStateInterface } from '@noocodex/dagonizer';

interface AppServices {
  logger: { info(msg: string): void; error(meta: object, msg: string): void };
  cache: { get(key: string): Promise<unknown> };
  db: { query(sql: string): Promise<unknown> };
}

interface S extends NodeStateInterface {
  key: string;
  out: unknown;
}

class FetchNode extends ScalarNode<S, 'success' | 'error', AppServices> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'error'] as const;

  protected async executeOne(state: S, context: NodeContextInterface<AppServices>) {
    context.services.logger.info('fetch start');
    const cached = await context.services.cache.get(state.key);
    if (cached) {
      state.out = cached;
      return NodeOutputBuilder.of('success');
    }
    try {
      const rows = await context.services.db.query('SELECT 1');
      state.out = rows;
      return NodeOutputBuilder.of('success');
    } catch (error) {
      context.services.logger.error({ err: error }, 'fetch failed');
      return NodeOutputBuilder.of('error');
    }
  }
}
```

The generic parameter narrows `context.services` inside the node body.

## Mixing services-aware and services-free nodes

Nodes without a services parameter (`NodeInterface<S, 'success'>`, default `TServices = undefined`) cannot register on a dispatcher with non-`undefined` services because the registration signature requires the same `TServices`. Either:

- Always declare the bag (most consistent).
- Or split into two dispatchers, one with services and one without, when nodes truly cannot share a bag.

In practice the bag is wide enough to cover everything a flow needs, and every node accepts the same parameter.

## Lifetime

Services live on the dispatcher instance. There is no per-execution scope; the same bag is handed to every node in every execution, including scatter clones and sub-DAG bodies.

If a service needs per-execution state (such as a request ID), put the per-execution data in `state` instead. The bag is for things that outlive any one execution.

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Demo: The Archivist](../examples/the-archivist) wires a real services bag

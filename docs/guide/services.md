---
seeAlso:

  - text: 'Subclassing State'

    link: './subclassing'
    description: 'services are dispatcher-scoped; per-execution data lives on state'

  - text: 'Observability'

    link: './observability'
    description: 'pass loggers / tracers through the services bag'

  - text: 'State accessors'

    link: './state-accessor'
    description: 'accessor + services together customize what nodes see'
---

# Services container

Nodes often need shared dependencies — loggers, database clients, registries, retry pools. The dispatcher accepts a typed services bag at construction; the same reference flows through every node's `context.services`.

## Defining the bag

The services bag is a plain interface defined by the consumer. There is no DI container, no provider scope, no factory step.

```ts
interface AppServices {
  readonly logger: Logger;
  readonly db: Database;
  readonly cache: Cache;
}
```

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

## Constructing the dispatcher

`Dagonizer<TState, TServices>` carries the services type as a generic parameter:

```ts
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';

class S extends NodeStateBase {
  out: unknown = null;
}

const dispatcher = new Dagonizer<S, AppServices>({
  services: {
    logger,
    db,
    cache,
  },
});
```

`TServices` defaults to `undefined` — dispatchers that don't need services work unchanged with `new Dagonizer<S>()`.

## Receiving services in a node

`NodeInterface<TState, TOutput, TServices>` propagates the same parameter to `context.services`:

```ts
import type { NodeInterface } from '@noocodex/dagonizer';

const fetchNode: NodeInterface<S, 'success' | 'error', AppServices> = {
  name: 'fetch',
  outputs: ['success', 'error'],
  async execute(state, context) {
    context.services.logger.info('fetch start');
    const cached = await context.services.cache.get(state.key);
    if (cached) {
      state.out = cached;
      return { output: 'success' };
    }
    try {
      const rows = await context.services.db.query('SELECT 1');
      state.out = rows;
      return { output: 'success' };
    } catch (error) {
      context.services.logger.error({ err: error }, 'fetch failed');
      return { output: 'error' };
    }
  },
};
```

The generic parameter ensures `context.services` is fully typed inside the node body.

## Mixing services-aware and services-free nodes

Nodes without a services parameter (`NodeInterface<S, 'success'>`, default `TServices = undefined`) cannot register on a dispatcher with non-`undefined` services because the registration signature requires the same `TServices`. Either:

- Always declare the bag (most consistent).
- Or split into two dispatchers — one with services, one without — when nodes truly cannot share a bag.

In practice the bag is wide enough to cover everything a flow needs, and every node accepts the same parameter.

## Lifetime

Services live on the dispatcher instance. There is no per-execution scope; the same bag is handed to every node in every execution, including sub-DAG nested calls and fan-out items.

If a service needs per-execution state (e.g. a request ID), put the per-execution data in `state` instead. The bag is for things that outlive any one execution.
## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts — `NodeInterface`](../reference/contracts)

---
title: 'Dependency injection'
description: 'Nodes receive external dependencies through their constructors and hold them as fields. The dispatcher carries no ambient services record.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'per-execution data lives on state; constructor deps are dispatcher-scoped'
  - text: 'Observability'
    link: './observability'
    description: 'subclass Dagonizer to wire loggers and tracers at the dispatcher level'
  - text: 'State accessors'
    link: './state-accessor'
    description: 'how dotted-path reads and writes resolve on state'
---

# Dependency injection

Nodes receive external dependencies through their constructors and hold them as private fields. The dispatcher is generic over state only — `Dagonizer<TState>`. There is no ambient services record and no `context.services`.

## Pattern

Declare the dependency as a private field on the node class. Accept it via the constructor. Register the node with an injected instance: `dispatcher.registerNode(new FetchNode(db))`.

```ts
import { Batch, MonadicNode, NodeStateBase, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import type { StoreInterface } from '@studnicky/dagonizer/contracts';

class WriteNode extends MonadicNode<NodeStateBase, 'done'> {
  private readonly store: StoreInterface;
  readonly name    = 'write';
  readonly outputs: readonly 'done'[] = ['done'];

  constructor(store: StoreInterface) {
    super();
    this.store = store;
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  async execute(batch: Batch<NodeStateBase>, context: NodeContextType) {
    if (context.signal.aborted) return RoutedBatch.create();
    await this.store.set('key', 'value');
    return RoutedBatch.create('done', batch);
  }
}
```

Registration with the injected dependency:

```ts
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { MemoryStore } from '@studnicky/dagonizer/store';

const store  = new MemoryStore();
const d      = new Dagonizer<NodeStateBase>();
d.registerNode(new WriteNode(store));
```

## Why constructor injection

Constructor injection is explicit, statically typed, and testable. Each node declares its dependencies in its constructor signature — there is no implicit runtime contract to read through. Tests instantiate nodes with stubs or fakes passed directly, with no dispatcher scaffolding required.

The dispatcher carries no ambient state. Every object a node needs is held by that node as a field, visible in the class declaration and verifiable at construction time.

## Multiple dependencies

Accept multiple dependencies as individual constructor parameters or as a single typed record. Either form is fine; the key constraint is that the dependencies are positional or named at the call site, not injected through a runtime registry.

```ts
interface CartographerDeps {
  readonly geo:    GeoResolverInterface;
  readonly logger: LoggerInterface;
}

class GeoEnrichNode extends MonadicNode<CartographerState, 'enriched' | 'error'> {
  private readonly deps: CartographerDeps;
  readonly name    = 'geo-enrich';
  readonly outputs: readonly ('enriched' | 'error')[] = ['enriched', 'error'];

  constructor(deps: CartographerDeps) {
    super();
    this.deps = deps;
  }

  override get outputSchema(): Record<'enriched' | 'error', SchemaObjectType> {
    return MonadicNode.permissiveSchema(this.outputs);
  }

  async execute(batch: Batch<CartographerState>) {
    const enriched: ItemType<CartographerState>[] = [];
    const failed: ItemType<CartographerState>[] = [];
    for (const item of batch) {
      const result = await this.deps.geo.resolve(item.state.ipAddress);
      if (result === null) {
        failed.push(item);
      } else {
        item.state.geoData = result;
        enriched.push(item);
      }
    }
    return RoutedBatch.create([
      ['enriched', Batch.from(enriched)],
      ['error', Batch.from(failed)],
    ]);
  }
}
```

## Shared dependencies across nodes

When several nodes share the same dependency — a store, a logger, an LLM adapter — construct the dependency once and pass the same reference to each node's constructor.

```ts
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { MemoryStore } from '@studnicky/dagonizer/store';

const log  = new MemoryStore();
const d    = new Dagonizer<NodeStateBase>();

d.registerNode(new StepANode(log));
d.registerNode(new ChildStepNode(log));
d.registerNode(new StepBNode(log));
```

All three nodes share the same `MemoryStore` instance. Any write by one is visible to the others within the same execution. See [Shared state](./shared-state) for the concurrency contract and checkpoint integration.

## Lifetime

A node's dependencies live on the node instance. The node instance lives on the dispatcher. Construct dependencies before constructing nodes; construct nodes before registering them. There is no per-execution scope — the same instance is used across every execution, including scatter clones and sub-DAG bodies.

If a dependency needs per-execution state (such as a request identifier), put that data on `state` instead. Constructor-injected dependencies are for things that outlive any single execution.

## Testing nodes in isolation

Because dependencies are constructor arguments, a node can be tested directly without wiring a dispatcher:

```ts
import { Batch, NodeStateBase } from '@studnicky/dagonizer';

const fakeStore: StoreInterface = {
  async set() { /* no-op */ },
  async get() { return null; },
  // ... other stubs
};

const node  = new WriteNode(fakeStore);
const state = new NodeStateBase();
```

Stub the dependencies at construction time, call `execute(Batch.of(state), context)` directly, and assert on state mutations and routing output.

## Related reference

- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Guide: Shared state](./shared-state)
- [Demo: The Archivist](../examples/the-archivist) — nodes receive an LLM adapter through their constructors
- [Demo: The Cartographer](../examples/the-cartographer) — nodes receive geo resolvers through their constructors

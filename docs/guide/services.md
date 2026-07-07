---
title: 'Dependency Injection'
description: 'Nodes receive external dependencies through their constructors and hold them as fields. The dispatcher carries no ambient services record.'
seeAlso:
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'per-execution data lives on state; constructor deps are dispatcher-scoped'
  - text: 'Observability'
    link: './observability'
    description: 'subclass Dagonizer to wire loggers and tracers at the dispatcher level'
  - text: 'State Accessors'
    link: './state-accessor'
    description: 'how dotted-path reads and writes resolve on state'
---

# Dependency Injection

## What It Is

Dependency injection in Dagonizer is plain TypeScript constructor injection. The host application creates services, passes them into node constructors, and registers those node instances with the dispatcher.

The dispatcher carries DAG state and lifecycle; it does not carry an ambient service bag. That keeps node dependencies visible in the class signature and easy to replace in tests.

## How It Works

The host constructs service objects, passes them into node constructors, then registers those node instances. The dispatcher remains generic over state only. Tests instantiate the same nodes with fakes or stubs, and DAG JSON-LD remains independent of concrete service wiring.

Nodes receive external dependencies through their constructors and hold them as private fields. The dispatcher is generic over state only — `Dagonizer<TState>`. There is no ambient services record and no `context.services`.

## Diagrams, Examples, and Outputs

Dependency injection is node construction, not DAG topology, so this page uses runnable source snippets instead of a graph.

Use these examples:

- [The Cartographer](../examples/the-cartographer) injects geo resolvers, delivery transports, and stores into nodes before registering DAG bundles.
- [The Archivist](../examples/the-archivist) injects model adapters, embedders, and graph-backed memory services into the nodes used by the parent and embedded DAGs.
- [Shared State](./shared-state) explains when a shared store dependency is safe and how it interacts with checkpointing.
- [Observability](./observability) shows dispatcher subclass hooks for cross-cutting logging and tracing that do not belong inside node constructors.

## What It Lets You Do

### Use when

Use constructor dependency injection when nodes need external services: LLM adapters, embedders, stores, geocoders, HTTP clients, loggers, clocks, or domain repositories. Dependencies should be explicit on the node class, not hidden behind dispatcher globals.

## Code Samples

### Why constructor injection

Constructor injection is explicit, statically typed, and testable. Each node declares its dependencies in its constructor signature — there is no implicit runtime contract to read through. Tests instantiate nodes with stubs or fakes passed directly, with no dispatcher scaffolding required.

The dispatcher carries no ambient state. Every object a node needs is held by that node as a field, visible in the class declaration and verifiable at construction time.

## Details for Nerds

### Pattern

Declare the dependency as a private field on the node class. Accept it via the constructor. Register the node with an injected instance. The Cartographer resolver nodes are the runnable example: `ResolveIpNode` receives an `IpGeolocator`, holds it as a field, and calls it from `execute()`.

<<< @/../examples/the-cartographer/nodes/geo/resolveIp.ts#resolve-ip-node

`GeoSourceResolveDAG.build(...)` constructs the resolver nodes with the selected transports and returns a `DispatcherBundleType` containing the nodes plus their sub-DAGs:

<<< @/../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts#geo-source-resolve-dag

### Multiple dependencies

Accept multiple dependencies as individual constructor parameters or as a single typed record. Either form is fine; the key constraint is that the dependencies are positional or named at the call site, not injected through a runtime registry.

The Cartographer groups its external transports in `CartographerServices`, then selects live or recorded implementations before building bundles:

<<< @/../examples/the-cartographer/CartographerServices.ts#cartographer-services

<<< @/../examples/the-cartographer/services/GeoResolvers.ts#geo-resolvers

### Shared dependencies across nodes

When several nodes share the same dependency — a store, a logger, an LLM adapter — construct the dependency once and pass the same reference to each node's constructor.

The Archivist uses this shape for model adapters, embedder adapters, and graph-backed memory services across parent and embedded-DAG placements. The focused `examples/10-shared-state.ts` runner isolates the store variant: `StepANode`, `ChildStepNode`, and `StepBNode` all receive the same `MemoryStore` instance, so writes by one are visible to the others within the same execution. See [Shared state](./shared-state) for the concurrency contract and checkpoint integration.

### Lifetime

A node's dependencies live on the node instance. The node instance lives on the dispatcher. Construct dependencies before constructing nodes; construct nodes before registering them. There is no per-execution scope — the same instance is used across every execution, including scatter clones and sub-DAG bodies.

If a dependency needs per-execution state (such as a request identifier), put that data on `state` instead. Constructor-injected dependencies are for things that outlive any single execution.

### Testing nodes in isolation

Because dependencies are constructor arguments, a node can be tested directly without wiring a dispatcher. Stub the dependencies at construction time, call `execute(Batch.of(state), context)` directly, and assert on state mutations and routing output.

## Related Concepts

- [Subclassing State](./subclassing) - per-execution data lives on state; constructor deps are dispatcher-scoped
- [Observability](./observability) - subclass Dagonizer to wire loggers and tracers at the dispatcher level
- [State Accessors](./state-accessor) - how dotted-path reads and writes resolve on state
- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Guide: Shared state](./shared-state)
- [Demo: The Archivist](../examples/the-archivist) — nodes receive an LLM adapter through their constructors
- [Demo: The Cartographer](../examples/the-cartographer) — nodes receive geo resolvers through their constructors

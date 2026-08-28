---
title: 'Import Map'
description: 'Package export map reference showing each @studnicky/dagonizer subpath, representative exports, and when to import from each entrypoint.'
seeAlso:
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'root barrel: `Dagonizer`, constants, errors, schemas, types'
  - text: 'Guide: DAGBuilder'
    link: '../guide/builder'
    description: 'fluent authoring API'
---

# Import Map

## Public API Surface

The import map is the public boundary of `@studnicky/dagonizer`. It shows which subpath owns each runtime class, schema, contract, renderer, plugin utility, adapter base, and test harness.

The import map is the package-level API boundary for hosts, plugin packages, and tests. Use the root package for the dispatcher and common types; use focused subpaths when the code only needs one subsystem such as builder, runtime, validation, checkpoint, store, or visualization.

## Entry-point References

The export map is the contract between package internals and consumer code. These links show where the public entrypoints appear in runtime code and DAG authoring:

- [Reference: Dagonizer](./dagonizer) - root barrel: `Dagonizer`, constants, errors, schemas, types
- [Guide: DAGBuilder](../guide/builder) - fluent authoring API

## Export Boundary Model

Dagonizer publishes stable `package.json` `exports` entries. Each entry is a barrel for one seam: builder authoring, runtime primitives, JSON-LD entities, plugin loading, visualization, stores, containers, channels, adapters, patterns, or tools.

That separation mirrors the architecture: JSON-LD documents describe topology by DAG and placement IRI, registries bind implementation references, and the dispatcher executes routed outputs. Imports should follow the same boundary.

## Code Samples

The table below is the contract. If a symbol is not available through one of these entrypoints, consumer and plugin code should treat it as internal.

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer/builder';
import type { NodeInterface } from '@studnicky/dagonizer/types';
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
```

### API

| Subpath | Representative exports | What it's for |
|---|---|---|
| `.` | `Dagonizer`, `NodeStateBase`, `DAGError`, constants, wire schemas | Root barrel: the dispatcher class, base node-state class, error taxonomy, and the JSON-LD schemas — the core engine entrypoint |
| `./types` | `DagonizerInterface`, `NodeInterface`, `DAGType`, `ExecuteOptionsType` | Every public type and interface, no runtime classes — for host or plugin code that only needs type-level imports |
| `./contracts` | `NodeInterface`, `ClockProviderInterface`, `SchedulerProviderInterface`, `StoreInterface` | Every adapter contract a host implements to swap a backend or author a node |
| `./entities` | `DAGSchema`, `DAGType`, `NodeContextType`, `ExecutionResultType` | JSON Schema 2020-12 definitions and their `FromSchema`-derived TypeScript types for every wire-shape entity |
| `./errors` | `DAGError` | The single error class and its `DAGErrorInterface`, distinguished by `.code` |
| `./constants` | `NodeTypes`, `MetadataKeys`, `Output`, `GatherStrategyName`, `ScatterOutput` | Constant value+type pairs shared across the wire format and the engine |
| `./lifecycle` | `DAGLifecycleMachine` | The DAG-run lifecycle finite-state-machine and its phase types |
| `./runtime` | `Clock`, `Scheduler`, `RealTimeScheduler`, `RetryPolicy`, `DottedPathAccessor` | Time and retry primitives: monotonic clock, scheduler, retry-with-backoff policy, dotted-path state access |
| `./builder` | `DAGBuilder`, `ScatterOptionsType`, `TypedEmbeddedDAGOptionsType` | The fluent, compile-checked authoring API for constructing a `DAGType` |
| `./validation` | `Validator`, `WellFormedValidator` | Ajv-backed validators compiled once at module load against the package's own schemas |
| `./checkpoint` | `Checkpoint`, `CheckpointRestoreAdapter`, `MemoryCheckpointStore` | Deterministic-resume persistence: capture and recall a run's cursor and state |
| `./testing` | `VirtualClockProvider`, `VirtualScheduler`, `LoopbackChannel`, `DagConformance` | Test-only doubles for the clock/scheduler contracts and a DAG-conformance test harness |
| `./core` | `MonadicNode`, `PlaceholderNode`, `Batch`, `RoutedBatch` | Pluggable execution primitives: the node base class hosts extend and the batch/item entities they operate on |
| `./viz` | `MermaidRenderer`, `JsonLdRenderer`, `CytoscapeRenderer`, `CytoscapeGraph`, `CompositeLayout`, `MermaidExplorer` | DAG visualization: Mermaid, JSON-LD, and Cytoscape renderers, layout helpers, plus the Mermaid explorer widget |
| `./store` | `BaseStore`, `MemoryStore`, `TypedStore`, `StoreInterface` | Shared key-value store hosts extend for cross-node or cross-run state |
| `./container` | `DagContainerBase`, `DagHost`, `DagTask`, `DagOutcome` | Embedded-DAG container entrypoint: channel dispatch and worker-container transport contracts |
| `./channels` | `InMemoryChannel`, `StreamChannel`, `StreamCursor` | Message channels: in-memory transport and resumable streaming channels with cursor tracking |
| `./runner` | `DagRunner`, `TriggerInterface`, `OnceTrigger`, `CliTrigger`, `EventTrigger`, `RequestTrigger` | Long-running DAG host: register triggers (once, CLI, event, HTTP request) that invoke a registered DAG |
| `./progress` | `EventBus`, `SseStream` | Progress and observability event bus, plus a Server-Sent-Events stream adapter for the same envelope |
| `./adapter` | `BaseAdapter`, `OpenAiCompatibleAdapter`, `LlmAdapterRegistry`, `LlmAdapterCascade` | LLM adapter entrypoint: chat/tool schemas, streaming chunk types, capability descriptors, and cascading multi-backend dispatch |
| `./patterns` | `AgentTraceProducer`, `BuildChatRequestNode`, `CallModelNode`, `BuildToolWorksetsNode`, `MonadicNode`, `DagStreamProducer` | Pattern-tier base classes, trace producers, and stream producers hosts extend for LLM loops and routed streaming |
| `./tool` | `ToolInterface`, `HttpTransport`, `ToolError` | Tool entrypoint for LLM function/tool calling: the interface a tool implements plus HTTP transport and error types |
| `./dag` | `DAGDocument` | JSON-LD DAG document loading and parsing outside the dispatcher |
| `./plugin` | `PluginDiscovery`, `PluginLoader`, `PluginSpecifier` | Plugin discovery and loading for the plugin registry described in the [Plugins](../guide/plugins) |
| `./observe` | `ObservedDag` | A `Dagonizer` subclass with structured logging and optional substrate timing wired into every lifecycle hook, for drop-in observability |
| `./viz/explorer.css` | - | Stylesheet asset for `MermaidExplorer`; import it directly, it has no JS exports |

## Operational Uses

The export map keeps the public API explicit: each subpath is a focused barrel for one subsystem. Import from the subpath that matches the responsibility in the file instead of defaulting everything to the root package.

That keeps intent obvious in code review and reduces accidental coupling to entrypoints a module does not actually use.

## Runtime Notes

Type-only imports belong on `./types` or `./contracts`. Runtime helpers belong on the entrypoint that owns the behavior: `./builder` for authoring, `./runtime` for clocks/retry/accessors, `./validation` for schema validation, `./viz` for rendering, and `./plugin` for plugin loading/discovery.

## Related Concepts

- [Reference: Dagonizer](./dagonizer) - root barrel: `Dagonizer`, constants, errors, schemas, types
- [Getting Started](../getting-started) - root package import path in the quickstart
- [DAGBuilder](../guide/builder) - fluent authoring API exposed from `./builder`
- [Plugins](../guide/plugins) - adapter, tool, pattern, and plugin subpath usage

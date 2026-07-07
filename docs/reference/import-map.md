---
title: 'Import Map'
description: 'Package export map reference showing each @studnicky/dagonizer subpath, representative exports, and when to import from each surface.'
seeAlso:
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'root barrel: `Dagonizer`, constants, errors, schemas, types'
  - text: 'Guide: DAGBuilder'
    link: '../guide/builder'
    description: 'fluent authoring API'
---

# Import Map

## What It Is

The import map is the public boundary of `@studnicky/dagonizer`. It shows which subpath owns each runtime class, schema, contract, renderer, plugin utility, adapter base, and test harness.

Use this page when deciding where an application, plugin package, or test should import from. The root package is convenient for the dispatcher and common types; focused subpaths keep packages smaller and make intent obvious in code review.

## How It Works

Dagonizer publishes stable `package.json` `exports` entries. Each entry is a barrel for one seam: builder authoring, runtime primitives, JSON-LD entities, plugin loading, visualization, stores, containers, channels, adapters, patterns, or tools.

That separation mirrors the architecture: JSON-LD documents describe topology, registries bind implementation names, and the dispatcher executes routed outputs. Imports should follow the same boundary.

## Diagrams, Examples, and Outputs

The import map itself is not a DAG, so this reference page does not render a graph. The links below show where the exported surfaces appear in runnable code and generated diagrams:

- [Reference: Dagonizer](./dagonizer) - root barrel: `Dagonizer`, constants, errors, schemas, types
- [Guide: DAGBuilder](../guide/builder) - fluent authoring API

## What It Lets You Do

The import map lets teams choose the narrow package subpath for each public surface. Use it to avoid importing from the root barrel when a focused builder, runtime, validation, checkpoint, store, plugin, or visualization surface is available.

`@studnicky/dagonizer` ships every public surface through a dedicated
`package.json` `exports` subpath. Each subpath is a focused barrel — import
from the subpath that matches what you need rather than the root package
for anything beyond the core `Dagonizer` class and its immediate satellites.

## Code Samples

The table below is the contract. If a symbol is not available through one of these surfaces, application and plugin code should treat it as internal.

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer/builder';
import type { NodeInterface } from '@studnicky/dagonizer/types';
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
```

### API surface

| Subpath | Representative exports | What it's for |
|---|---|---|
| `.` | `Dagonizer`, `NodeStateBase`, `DAGError`, constants, wire schemas | Root barrel: the dispatcher class, base node-state class, error taxonomy, and the JSON-LD schemas — the core engine surface |
| `./types` | `DagonizerInterface`, `NodeInterface`, `DAGType`, `ExecuteOptionsType` | Every public type and interface, no runtime classes — for application code that only needs type-level imports |
| `./contracts` | `NodeInterface`, `ClockProviderInterface`, `SchedulerProviderInterface`, `StoreInterface` | Every adapter contract an application implements to swap a backend or author a node |
| `./entities` | `DAGSchema`, `DAGType`, `NodeContextType`, `ExecutionResultType` | JSON Schema 2020-12 definitions and their `FromSchema`-derived TypeScript types for every wire-shape entity |
| `./errors` | `DAGError` | The single error class and its `DAGErrorInterface`, distinguished by `.code` |
| `./constants` | `NodeTypes`, `MetadataKeys`, `Output`, `GatherStrategyName`, `ScatterOutput` | Constant value+type pairs shared across the wire format and the engine |
| `./lifecycle` | `DAGLifecycleMachine` | The DAG-run lifecycle finite-state-machine and its phase types |
| `./runtime` | `Clock`, `Scheduler`, `RealTimeScheduler`, `RetryPolicy`, `DottedPathAccessor` | Time and retry primitives: monotonic clock, scheduler, retry-with-backoff policy, dotted-path state access |
| `./builder` | `DAGBuilder`, `ScatterOptionsType`, `TypedEmbeddedDAGOptionsType` | The fluent, compile-checked authoring API for constructing a `DAGType` |
| `./validation` | `Validator`, `WellFormedValidator` | Ajv-backed validators compiled once at module load against the package's own schemas |
| `./checkpoint` | `Checkpoint`, `CheckpointRestoreAdapter`, `MemoryCheckpointStore` | Deterministic-resume persistence: capture and recall a run's cursor and state |
| `./testing` | `VirtualClockProvider`, `VirtualScheduler`, `LoopbackChannel`, `DagConformance` | Test-only doubles for the clock/scheduler contracts and a DAG-conformance test harness |
| `./core` | `MonadicNode`, `PlaceholderNode`, `Batch`, `RoutedBatch` | Pluggable execution primitives: the node base class applications extend and the batch/item entities they operate on |
| `./viz` | `MermaidRenderer`, `CytoscapeRenderer`, `MermaidExplorer` | DAG visualization: Mermaid and Cytoscape renderers, plus an interactive explorer widget |
| `./store` | `BaseStore`, `MemoryStore`, `TypedStore`, `StoreInterface` | Shared key-value store applications extend for cross-node or cross-run state |
| `./container` | `DagContainerBase`, `DagHost`, `DagTask`, `DagOutcome` | Embedded-DAG container surface: channel dispatch and worker-container transport contracts |
| `./channels` | `InMemoryChannel`, `StreamChannel`, `StreamCursor` | Message channels: in-memory transport and resumable streaming channels with cursor tracking |
| `./runner` | `DagRunner`, `TriggerInterface`, `OnceTrigger`, `CliTrigger`, `EventTrigger`, `RequestTrigger` | Long-running DAG host: register triggers (once, CLI, event, HTTP request) that invoke a registered DAG |
| `./progress` | `EventBus`, `SseStream` | Progress and observability event bus, plus a Server-Sent-Events stream adapter for the same envelope |
| `./adapter` | `BaseAdapter`, `OpenAiCompatibleAdapter`, `LlmAdapterRegistry`, `LlmAdapterCascade` | LLM adapter contract surface: chat/tool schemas, streaming chunk types, capability descriptors, and cascading multi-backend dispatch |
| `./patterns` | `AgentTraceProducer`, `BuildChatRequestNode`, `CallModelNode`, `BuildToolWorksetsNode`, `MonadicNode`, `DagStreamProducer` | Pattern-tier base classes, trace producers, and stream producers applications extend for LLM loops and routed streaming |
| `./tool` | `ToolInterface`, `HttpTransport`, `ToolError` | Tool contract surface for LLM function/tool calling: the interface a tool implements plus HTTP transport and error types |
| `./dag` | `DAGDocument` | JSON-LD DAG document loading and parsing outside the dispatcher |
| `./plugin` | `PluginDiscovery`, `PluginLoader`, `PluginSpecifier` | Plugin discovery and loading for the plugin registry described in the [Plugins](../guide/plugins) |
| `./observe` | `ObservedDag` | A `Dagonizer` subclass with structured logging and optional substrate timing wired into every lifecycle hook, for drop-in observability |
| `./viz/explorer.css` | - | Stylesheet asset for `MermaidExplorer`; import it directly, it has no JS exports |

## Details for Nerds

Subpaths are compatibility promises. Prefer them over deep package paths, because deep paths bypass the package export map and may change without being part of the public API.

Type-only imports belong on `./types` or `./contracts`. Runtime helpers belong on the surface that owns the behavior: `./builder` for authoring, `./runtime` for clocks/retry/accessors, `./validation` for schema validation, `./viz` for rendering, and `./plugin` for plugin loading/discovery.

## Related Concepts

- [Reference: Dagonizer](./dagonizer) - root barrel: `Dagonizer`, constants, errors, schemas, types
- [Getting Started](../getting-started) - root package import path in the quickstart
- [DAGBuilder](../guide/builder) - fluent authoring API exposed from `./builder`
- [Plugins](../guide/plugins) - adapter, tool, pattern, and plugin subpath usage

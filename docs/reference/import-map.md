---
seeAlso:
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'root barrel: `Dagonizer`, constants, errors, schemas, types'
  - text: 'Guide: DAGBuilder'
    link: '../guide/builder'
    description: 'fluent authoring API'
---

# Import Map

`@studnicky/dagonizer` ships every public surface through a dedicated
`package.json` `exports` subpath. Each subpath is a focused barrel — import
from the subpath that matches what you need rather than the root package
for anything beyond the core `Dagonizer` class and its immediate satellites.

| Subpath | Representative exports | What it's for |
|---|---|---|
| `.` | `Dagonizer`, `NodeStateBase`, `DAGError`, constants, wire schemas | Root barrel: the dispatcher class, base node-state class, error taxonomy, and the JSON-LD schemas — the core engine surface |
| `./types` | `DagonizerInterface`, `NodeInterface`, `DAGType`, `ExecuteOptionsType` | Every public type and interface, no runtime classes — for consumers that only need type-level imports |
| `./contracts` | `NodeInterface`, `ClockProviderInterface`, `SchedulerProviderInterface`, `StoreInterface` | Every adapter contract a consumer implements to swap a backend or author a node |
| `./entities` | `DAGSchema`, `DAGType`, `NodeContextType`, `ExecutionResultType` | JSON Schema 2020-12 definitions and their `FromSchema`-derived TypeScript types for every wire-shape entity |
| `./errors` | `DAGError` | The single error class and its `DAGErrorInterface`, distinguished by `.code` |
| `./constants` | `NodeTypes`, `MetadataKeys`, `Output`, `GatherStrategyName`, `ScatterOutput` | Constant value+type pairs shared across the wire format and the engine |
| `./lifecycle` | `DAGLifecycleMachine` | The DAG-run lifecycle finite-state-machine and its phase types |
| `./runtime` | `Clock`, `Scheduler`, `RealTimeScheduler`, `RetryPolicy`, `DottedPathAccessor` | Time and retry primitives: monotonic clock, scheduler, retry-with-backoff policy, dotted-path state access |
| `./builder` | `DAGBuilder`, `ScatterOptionsType`, `TypedEmbeddedDAGOptionsType` | The fluent, compile-checked authoring API for constructing a `DAGType` |
| `./validation` | `Validator`, `WellFormedValidator` | Ajv-backed validators compiled once at module load against the package's own schemas |
| `./checkpoint` | `Checkpoint`, `CheckpointRestoreAdapter`, `MemoryCheckpointStore` | Deterministic-resume persistence: capture and recall a run's cursor and state |
| `./testing` | `VirtualClockProvider`, `VirtualScheduler`, `LoopbackChannel`, `DagConformance` | Test-only doubles for the clock/scheduler contracts and a DAG-conformance test harness |
| `./core` | `MonadicNode`, `PlaceholderNode`, `Batch`, `RoutedBatchBuilder` | Pluggable execution primitives: the node base class consumers extend and the batch/item entities they operate on |
| `./viz` | `MermaidRenderer`, `CytoscapeRenderer`, `MermaidExplorer` | DAG visualization: Mermaid and Cytoscape renderers, plus an interactive explorer widget |
| `./store` | `BaseStore`, `MemoryStore`, `TypedStore`, `StoreInterface` | Shared key-value store consumers extend for cross-node or cross-run state |
| `./container` | `DagContainerBase`, `DagHost`, `DagTask`, `DagOutcome` | Embedded-DAG container surface: channel dispatch and worker-container transport contracts |
| `./channels` | `InMemoryChannel`, `StreamChannel`, `StreamCursor` | Message channels: in-memory transport and resumable streaming channels with cursor tracking |
| `./runner` | `DagRunner`, `TriggerInterface`, `OnceTrigger`, `CliTrigger`, `EventTrigger`, `RequestTrigger` | Long-running DAG host: register triggers (once, CLI, event, HTTP request) that invoke a registered DAG |
| `./progress` | `EventBus`, `SseStream` | Progress and observability event bus, plus a Server-Sent-Events stream adapter for the same envelope |
| `./adapter` | `BaseAdapter`, `OpenAiCompatibleAdapter`, `LlmAdapterRegistry`, `LlmAdapterCascade` | LLM adapter contract surface: chat/tool schemas, streaming chunk types, capability descriptors, and cascading multi-backend dispatch |
| `./patterns` | `MonadicNode`, `LlmDispatchNode`, `DecisionNode`, `ComposeNode`, `DagStreamProducer` | Pattern-tier base classes consumers extend for agent loops, LLM-backed routing, and streaming producers |
| `./tool` | `ToolInterface`, `HttpTransport`, `ToolError` | Tool contract surface for LLM function/tool calling: the interface a tool implements plus HTTP transport and error types |
| `./dag` | `DAGDocument` | JSON-LD DAG document loading and parsing outside the dispatcher |
| `./plugin` | `PluginDiscovery`, `PluginLoader`, `PluginSpecifier` | Plugin discovery and loading for the plugin registry described in the [Plugins overview](../guide/plugins) |
| `./observe` | `ObservedDag` | A `Dagonizer` subclass with structured logging wired into every lifecycle hook, for drop-in observability |
| `./viz/explorer.css` | — | Stylesheet asset for `MermaidExplorer`; import it directly, it has no JS exports |

See [Guide: DAGBuilder](../guide/builder) for the recommended authoring path
and [Reference: Dagonizer](./dagonizer) for the root barrel's full class API.

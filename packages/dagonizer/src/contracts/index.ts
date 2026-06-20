/**
 * Adapter-contract barrel: the single import surface for every contract a
 * consumer implements to swap a backend or contribute behavior.
 *
 * Each contract is the source of truth in its own `contracts/*.ts` file and is
 * re-exported here for ergonomic co-import. The section comments below group the
 * re-exports by the subsystem a consumer plugs into: time sources, channels,
 * checkpoint/restore, registry composition, the embedded-DAG container,
 * observability, gather and LLM adapters, the nodes and derivation contracts,
 * scatter execution, and the key-value/triple/remote stores.
 */

// Time sources and abortable-call options.
export type { AbortableOptionsType } from './AbortableOptionsType.js';

// Channels and cross-DAG handoff.
export type { HandoffChannelInterface } from './HandoffChannelInterface.js';

// Checkpoint / restore adapters.
export type { CheckpointRestoreAdapterInterface } from './CheckpointRestoreAdapterInterface.js';
export type { CheckpointStoreInterface } from './CheckpointStoreInterface.js';

// Channels.
export type { MessageChannelInterface } from './MessageChannelInterface.js';

// Registry composition: bundles and modules a plugin package registers as a unit.
export type { RegistryBundleInterface } from './RegistryBundleInterface.js';
export type { RegistryModuleInterface } from './RegistryModuleInterface.js';

// Embedded-DAG container: run a child DAG in an isolate and collect its outcome.
export type { SystemInfoInterface } from './SystemInfoInterface.js';
export type { DagContainerInterface } from './DagContainerInterface.js';
export type { DagOutcomeType } from './DagOutcomeType.js';
export type { DagTaskInterface } from './DagTaskInterface.js';
export type { DispatcherBundleType } from './DispatcherBundle.js';
export type { EmbedderInterface } from './EmbedderInterface.js';

// Observability relay: worker-side hook events forwarded to the parent's hooks.
export type { ObserverRelayInterface } from './ObserverRelayInterface.js';

// Gather execution: strategy invocation and per-record accounting.
export type { GatherExecutionType, GatherRecordType } from './GatherExecution.js';

// LLM adapter surface.
export type { LlmAdapterInterface } from './LlmAdapterInterface.js';
export type { LlmClientInterface } from './LlmClientInterface.js';

// Time sources.
export type { ClockProviderInterface } from './ClockProviderInterface.js';

// Error construction and execution options.
export type { ErrorConstructorType } from './ErrorConstructorType.js';
export type { ExecuteOptionsType } from './ExecuteOptionsType.js';
// Nodes: the node contract and the back-into-the-engine invoker.
export type { NodeInterface } from './NodeInterface.js';
export type { NodeInvokerInterface } from './NodeInvokerInterface.js';

export type { OutcomeRecordType } from './OutcomeRecord.js';

// Scatter execution: reservoir (buffered-batch) and worker-pool drivers.
export type { ReservoirDriverInterface, ScatterItemBatchResultType } from './ReservoirDriver.js';
export type { RetryPolicyOptionsType } from './RetryPolicyOptionsType.js';
export type { ScatterItemResultType, ScatterPoolDriverInterface } from './ScatterPoolDriver.js';

// Time sources.
export type { SchedulerProviderInterface } from './SchedulerProviderInterface.js';

// State access.
export type { StateAccessorInterface } from './StateAccessorInterface.js';

// Triple store: minimal RDF quad-store contract for graph-tier patterns.
export type { BindingType, QuadType, SlotPatternType, TermType, TripleStoreInterface } from './TripleStoreInterface.js';

// Remote store: lease-based remote key-value access.
export type { RemoteStoreInterface } from './RemoteStoreInterface.js';
export type { RemoteStoreEndpointType } from './RemoteStoreEndpoint.js';
export type { RemoteStoreLeaseType } from './RemoteStoreLease.js';

// Key-value store: snapshottable, cross-embedded-DAG shared state.
export type { SnapshottableInterface, StoreSnapshotType, StoreSnapshotEntryType } from './SnapshottableInterface.js';
export type { StoreInterface } from './StoreInterface.js';

// Child-state factory: constructor thunk for isolated sub-DAG child states.
export type { ChildStateFactoryType } from './ChildStateFactoryType.js';

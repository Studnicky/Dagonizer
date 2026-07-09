import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import { DagContainerBase } from '../container/DagContainerBase.js';
import type { BatchRunResultType } from '../container/DagOutcome.js';
import { DagTask } from '../container/DagTask.js';
import { TransportErrorCode } from '../container/TransportErrorCode.js';
import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { NodeInterface, OutputSchemaValidatorInterface } from '../contracts/NodeInterface.js';
import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { ReservoirDriverInterface, ScatterItemBatchResultType } from '../contracts/ReservoirDriver.js';
import type { ScatterItemResultType, ScatterPoolDriverInterface } from '../contracts/ScatterPoolDriver.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { TripleStoreInterface } from '../contracts/TripleStoreInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import { SCATTER_PROGRESS_KEY, WORKSET_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { ScatterNodeDefaults } from '../entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { ScatterInboxItemType } from '../entities/scatter/ScatterProgress.js';
import { Timeout } from '../entities/Timeout.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { ChildStateFactory } from '../runtime/ChildStateFactory.js';

import type { BodyExecutor } from './BodyExecutor.js';
import { DagReferenceResolver } from './DagReferenceResolver.js';
import { OutputContractApplier } from './OutputContractApplier.js';
import { PlacementRouter } from './PlacementRouter.js';

/** Engine-private result envelope returned by every node executor method. */
export type RunNodeResultType = {
  'nextStage': null | string;
  'result': NodeResultType<NodeStateInterface>;
  'gatherRecords'?: readonly GatherRecordType[];
};

export type GatherRecordSinkType = (record: GatherRecordType) => Promise<void>;

/** Engine-private execution context for `runNodes` and `runPostPhasesAndFinalize`. */
export type RunOptionsType = { embedded: boolean };

/**
 * Trailing config for the batch-native embedded-DAG re-entry path of `runNodes`.
 *
 * `inputBatch` seeds the per-item batch the embedded sub-DAG runs over and is
 * typed as `Batch<NodeStateInterface>` because DAG-body scatter paths seed it
 * with isolation-factory child states whose concrete class may differ from the
 * parent dispatcher's `TState`. Neither field references the dispatcher's
 * `TState`, so the type is non-generic.
 */
export type RunNodesBatchType = {
  inputBatch?: Batch<NodeStateInterface>;
  terminalByItemId?: Map<string, 'completed' | 'failed'>;
};

/**
 * Module-private adapter interface that `ScatterPoolDriver` uses to call
 * dispatcher methods without requiring access to private class members.
 *
 * The concrete `ScatterDispatchAdapter` is constructed within
 * `Dagonizer.executeScatter` (where private members are in scope) and passed to
 * `ScatterPoolDriver`. Each member is bound at construction time so the adapter
 * has a stable hidden class (same shape every construction).
 */
export interface ScatterDispatchAdapterInterface {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  readonly executionTopologyStore: TripleStoreInterface;
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  context(dagName: string, nodeName: string, signal: AbortSignal): NodeContextType;
  runNodes(
    dagName: string,
    state: NodeStateInterface,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType,
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<NodeStateInterface>, void>;
  resolveContainer(role: string | undefined): DagContainerInterface | null;
  nextCorrelationId(dagName: string): string;
  relayFor(state: NodeStateInterface): ObserverRelayInterface;
}

/**
 * Dispatcher surface the `ScatterDispatchAdapter` forwards into. `Dagonizer`
 * implements it so the scatter adapter is a named class with a stable shape,
 * not an object-literal of bound arrow closures rebuilt per scatter call.
 */
export interface ScatterDispatchSourceInterface {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  readonly executionTopologyStore: TripleStoreInterface;
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  bodyContext(dagName: string, nodeName: string, signal: AbortSignal): NodeContextType;
  runScatterNodes(
    dagName: string,
    state: NodeStateInterface,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType,
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<NodeStateInterface>, void>;
  resolveContainer(role: string | undefined): DagContainerInterface | null;
  nextCorrelationId(dagName: string): string;
  relayFor(state: NodeStateInterface): ObserverRelayInterface;
}

/**
 * Stable `ScatterDispatchAdapterInterface` implementation bound to a dispatcher.
 *
 * The three collaborator fields (`stateMapper`, `nodes`, `accessor`) are read
 * directly by `ScatterPoolDriver`; the six methods forward into the dispatcher
 * source. Fields are initialised in constructor-declaration order for a
 * consistent hidden class across constructions.
 */
export class ScatterDispatchAdapter
  implements ScatterDispatchAdapterInterface
{
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  readonly executionTopologyStore: TripleStoreInterface;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  readonly #source: ScatterDispatchSourceInterface;

  constructor(source: ScatterDispatchSourceInterface) {
    this.stateMapper = source.stateMapper;
    this.nodes = source.nodes;
    this.dags = source.dags;
    this.accessor = source.accessor;
    this.stateFactories = source.stateFactories;
    this.executionTopologyStore = source.executionTopologyStore;
    this.outputSchemaValidator = source.outputSchemaValidator;
    this.#source = source;
  }

  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    return this.#source.withNodeTimeout(node, signal, fn);
  }

  context(dagName: string, nodeName: string, signal: AbortSignal): NodeContextType {
    return this.#source.bodyContext(dagName, nodeName, signal);
  }

  runNodes(
    dagName: string,
    state: NodeStateInterface,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType,
    placementPath: readonly string[],
    batch?: RunNodesBatchType,
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<NodeStateInterface>, void> {
    return this.#source.runScatterNodes(dagName, state, fromStage, options, runOptions, placementPath, batch);
  }

  resolveContainer(role: string | undefined): DagContainerInterface | null {
    return this.#source.resolveContainer(role);
  }

  nextCorrelationId(dagName: string): string {
    return this.#source.nextCorrelationId(dagName);
  }

  relayFor(state: NodeStateInterface): ObserverRelayInterface {
    return this.#source.relayFor(state);
  }
}

/**
 * Context bundle for a single `executeScatter` invocation.
 *
 * Captures the scatter placement config plus the mutable accumulators that
 * `ScatterPoolDriver.ackItem` writes to. All fields are initialised before the
 * driver is constructed; the driver never creates its own accumulators.
 *
 * `state` and `intermediateResults` are typed `NodeStateInterface` (not the
 * dispatcher's narrower `TState`) because child states from isolation factories
 * may be heterogeneous with respect to the parent type.
 */
export type ScatterRunContextType = {
  readonly scatter: ScatterNodeType;
  readonly state: NodeStateInterface;
  readonly dagName: string;
  readonly signal: AbortSignal;
  readonly placementPath: readonly string[];
  readonly itemKey: string;
  readonly inbox: ScatterInboxItemType[];
  readonly allFreshRecords: GatherRecordType[];
  readonly intermediateResults: Array<NodeResultType<NodeStateInterface>>;
  readonly watermarkRef: { value: number };
  readonly aheadAcked: Map<number, string>;
  readonly outcomeTally: Map<string, number>;
  readonly gatherRecordSink: GatherRecordSinkType | null;
}

/**
 * Engine-private driver: bridges `ScatterWorkerPool` to `Dagonizer` internals.
 *
 * Constructed once per `executeScatter` call with a stable adapter + context.
 * Implements `ScatterPoolDriverInterface` without accessing private
 * members on `Dagonizer` directly.
 */
export class ScatterPoolDriver
  implements ScatterPoolDriverInterface, ReservoirDriverInterface
{
  readonly #adapter: ScatterDispatchAdapterInterface;
  readonly #ctx: ScatterRunContextType;
  readonly #bodyExecutor: BodyExecutor;
  readonly #dagContextValue: Record<string, unknown>;
  readonly #bodyCandidateIris: ReadonlySet<string> | null;

  constructor(
    adapter: ScatterDispatchAdapterInterface,
    ctx: ScatterRunContextType,
    bodyExecutor: BodyExecutor,
  ) {
    this.#adapter = adapter;
    this.#ctx = ctx;
    this.#bodyExecutor = bodyExecutor;
    this.#dagContextValue = this.#composeDagContext();
    this.#bodyCandidateIris = 'dag' in ctx.scatter.body
      ? DagReferenceResolver.candidateIris(ctx.scatter.body.dag, this.#dagContextValue)
      : null;
  }

  /**
   * VALIDATE stage. The scatter analogue of the scheduler's output-contract
   * stage: applied to each body firing's routed output before the item is
   * routed and emitted into the gather. Zero overhead when `validateOutputs` is
   * off (`outputSchemaValidator` is null). On a violation, the item is re-routed
   * to `'error'` with a collected `outputContractViolation` NodeError.
   */
  #validateOutputContract(
    dagNode: NodeInterface<NodeStateInterface, string>,
    routed: RoutedBatchType<string, NodeStateInterface>,
  ): RoutedBatchType<string, NodeStateInterface> {
    return OutputContractApplier.applyToRouted(
      dagNode.name,
      dagNode.outputSchema,
      routed,
      this.#adapter.outputSchemaValidator,
    );
  }

  #composeDagContext(): Record<string, unknown> {
    const dag = this.#adapter.dags.get(this.#ctx.dagName);
    return dag !== undefined ? ContextResolver.contextOf(dag['@context']) : {};
  }

  #dagContext(): Record<string, unknown> {
    return this.#dagContextValue;
  }

  #itemBodyIri(itemIndex: number): string {
    return `${this.#ctx.scatter['@id']}/item/${String(itemIndex)}`;
  }

  #bindItemSelectedDag(itemIndex: number, selectedDagIri: string): void {
    DagReferenceResolver.bindSelectedDag({
      'store': this.#adapter.executionTopologyStore,
      'ownerPlacementIri': this.#itemBodyIri(itemIndex),
      selectedDagIri,
    });
  }

  persistCheckpoint(): void {
    const { scatter, state, inbox, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;
    ScatterCheckpoint.writeBounded(
      state,
      scatter['@id'],
      [...inbox],
      watermarkRef.value,
      [...aheadAcked.entries()].map(([index, output]) => ({ index, output })),
      Object.fromEntries(outcomeTally),
    );
  }

  async executeItem(itemIndex: number, item: unknown): Promise<ScatterItemResultType> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;
    const dagContext = this.#dagContext();

    if ('node' in scatter.body) {
      // Node body: clone parent — no isolation factory for node bodies.
      const cloneState = this.#adapter.stateMapper.cloneChild(
        state,
        ScatterNodeDefaults.inputMapping(scatter),
      );
      // Strip engine-internal metadata keys from the clone. The parent state's
      // scatter-progress and work-set-progress metadata are engine bookkeeping for
      // the PARENT scatter/workset loop — the child body DAG must not inherit them.
      // Without this, each clone carries the full parent inbox (O(N) payload), and
      // serializing the clone for the container transport sends that inbox N times,
      // producing O(N²) heap growth across concurrent batches.
      cloneState.deleteMetadata(SCATTER_PROGRESS_KEY);
      cloneState.deleteMetadata(WORKSET_PROGRESS_KEY);
      // item must be JSON-serialisable: scatter sources are checkpointed to
      // metadata (SCATTER_PROGRESS_KEY) and require JSON-safe values at snapshot
      // time. The engine contract requires callers to provide JSON-safe scatter
      // sources for checkpointing to succeed.
      cloneState.setMetadata(itemKey, item);
      cloneState.setMetadata('itemIndex', itemIndex);

      // Node body: build a size-1 Batch and execute.
      const nodeIri = ContextResolver.expand(scatter.body.node, dagContext);
      const dagNode = this.#adapter.nodes.get(nodeIri);
      if (!dagNode) {
        throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
      }

      // cloneState is NodeStateInterface (cloneChild returns NodeStateInterface).
      const batch = Batch.from([{ 'id': String(itemIndex), 'state': cloneState }]);

      // Execute the node over the batch.
      const routed = await this.#adapter.withNodeTimeout(dagNode, signal, async (nodeSignal) => {
        const context = this.#adapter.context(dagName, scatter.name, nodeSignal);
        return dagNode.execute(batch, context);
      });

      // VALIDATE stage — between the body firing and the per-item emit/route.
      const validatedRouted = this.#validateOutputContract(dagNode, routed);

      // Derive output from the single routed entry.
      let output = 'error';
      for (const [routeKey, routeBatch] of validatedRouted.entries()) {
        for (const batchEntry of routeBatch) {
          if (batchEntry.id === String(itemIndex)) {
            output = routeKey;
          }
        }
      }

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);
      return { 'index': itemIndex, item, output, 'terminalOutcome': null, 'cloneState': cloneState, 'selectedDagIri': null };
    } else {
      const bodyDagName = DagReferenceResolver.resolve({
        'reference': scatter.body.dag,
        'source': 'item',
        'value': item,
        'context': dagContext,
        'dags': this.#adapter.dags,
        'accessor': this.#adapter.accessor,
        ...(this.#bodyCandidateIris === null ? {} : { 'candidateIris': this.#bodyCandidateIris }),
      });
      if (bodyDagName === null) {
        const errorClone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
        errorClone.deleteMetadata(SCATTER_PROGRESS_KEY);
        errorClone.deleteMetadata(WORKSET_PROGRESS_KEY);
        errorClone.setMetadata(itemKey, item);
        errorClone.setMetadata('itemIndex', itemIndex);
        return { 'index': itemIndex, item, 'output': 'error', 'terminalOutcome': 'failed', 'cloneState': errorClone, 'selectedDagIri': null };
      }

      this.#bindItemSelectedDag(itemIndex, bodyDagName);

      // Build the child clone using the body dag's registered factory (spawnChild
      // returns NodeStateInterface; isolation factory may produce a different class).
      const factory = this.#adapter.stateFactories.get(bodyDagName) ?? ChildStateFactory.cloneParent;
      const cloneState = this.#adapter.stateMapper.spawnChild(
        state,
        ScatterNodeDefaults.inputMapping(scatter),
        factory,
      );
      // Strip engine-internal metadata keys from the clone (see node-body path above).
      cloneState.deleteMetadata(SCATTER_PROGRESS_KEY);
      cloneState.deleteMetadata(WORKSET_PROGRESS_KEY);
      // item must be JSON-serialisable (see node-body path above).
      cloneState.setMetadata(itemKey, item);
      cloneState.setMetadata('itemIndex', itemIndex);

      // Run the resolved dag body in-process or through a bound container via
      // the shared BodyExecutor. The in-process drain and the container
      // snapshot/error collection live there; the scatter path never buffers
      // intermediates (bufferIntermediates: false) — at scatter scale (N items
      // × M inner nodes) that accumulation is O(N*M) and inner-node
      // observability is delivered live through the observer relay regardless.
      const body = await this.#bodyExecutor.run(
        bodyDagName,
        scatter.name,
        cloneState,
        state,
        scatter.container,
        signal,
        placementPath,
        false,
      );

      // Infrastructure/transport failure (worker died, channel lost): the child
      // DAG never ran to a terminal. Throw so the pool takes the reject branch →
      // poolError set → item is NOT acked → it stays in the inbox → resume
      // reprocesses it. This matches the in-process path (a body crash throws)
      // and preserves at-least-once. A legitimate body that ran and routed to
      // 'error' (terminalOutput 'failed' from a TerminalNode) is NOT an
      // infrastructure failure and acks normally. BodyExecutor has already
      // collected the error into cloneState; the throw is the scatter-only
      // re-queue policy (embedded routes the collected error instead).
      if (body.infrastructureError !== null) {
        this.persistCheckpoint();
        throw new DAGError(
          `ScatterNode '${scatter.name}': container infrastructure failure — ${body.infrastructureError.message ?? 'transport lost'}`,
          { 'code': 'EXECUTION_ERROR' },
        );
      }

      const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
      const output = PlacementRouter.route(body.terminalOutcome, hasUnrecoverable);

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);

      return { 'index': itemIndex, item, output, 'terminalOutcome': body.terminalOutcome, 'cloneState': cloneState, 'selectedDagIri': bodyDagName };
    }
  }

  #freshRecord(res: ScatterItemResultType): GatherRecordType {
    const { scatter } = this.#ctx;
    return {
      'source': scatter['@id'],
      'index': res.index,
      'item': res.item,
      'output': res.output,
      'terminalOutcome': res.terminalOutcome,
      'result': undefined,
      'cloneState': res.cloneState,
    };
  }

  async ackItem(res: ScatterItemResultType): Promise<void> {
    const { scatter, state, inbox, allFreshRecords, watermarkRef, aheadAcked, outcomeTally, gatherRecordSink } = this.#ctx;
    const { 'index': itemIndex, 'output': output } = res;

    // Remove from inbox.
    const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
    if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

    const freshRecord = this.#freshRecord(res);
    if (gatherRecordSink === null) {
      allFreshRecords.push(freshRecord);
    } else {
      await gatherRecordSink(freshRecord);
    }

    ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
    ScatterCheckpoint.writeBounded(
      state, scatter['@id'], [...inbox], watermarkRef.value,
      [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
      Object.fromEntries(outcomeTally),
    );
  }

  /**
   * Execute a batch of buffered reservoir items.
   *
   * Dispatches to one of three branches depending on the scatter body:
   *
   * - **Branch A (node body):** builds a size-N Batch, calls `node.execute(batch)`
   *   once, and derives each item's output from the routed entries.
   * - **Branch B (DAG body, in-process):** runs the released batch through the
   *   sub-DAG in a single batch-native `runNodes` call (the `inputBatch` +
   *   `terminalByItemId` seam), deriving each item's `terminalOutcome` from the map.
   * - **Branch C (DAG body, container):** routes to `DagContainerBase.runDagBatch`
   *   when the container is a `DagContainerBase` instance (one transport round-trip
   *   for all items); uses per-item `container.runDag` for plain
   *   `DagContainerInterface` implementations.
   *
   * Errors and warnings from each clone are collected into the parent state.
   */
  async executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResultType> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;
    const dagContext = this.#dagContext();

    if ('node' in scatter.body) {
      // ── Branch A: node body ─────────────────────────────────────────────────
      const batchNodeIri = ContextResolver.expand(scatter.body.node, dagContext);
      const dagNode = this.#adapter.nodes.get(batchNodeIri);
      if (!dagNode) {
        throw new DAGError(`ScatterNode '${scatter.name}': unknown node '${scatter.body.node}'`);
      }

      // Build N child clones (clone-parent) and a size-N Batch.
      // Node body never uses an isolation factory; cloneChild returns NodeStateInterface.
      const clones: NodeStateInterface[] = [];
      const batchItems: { id: string; state: NodeStateInterface }[] = [];
      for (const buffered of items) {
        const clone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
        // Strip engine-internal metadata keys — the child body must not inherit
        // the parent scatter/workset progress (O(N) payload, see executeItem).
        clone.deleteMetadata(SCATTER_PROGRESS_KEY);
        clone.deleteMetadata(WORKSET_PROGRESS_KEY);
        clone.setMetadata(itemKey, buffered.item);
        clone.setMetadata('itemIndex', buffered.index);
        clones.push(clone);
        batchItems.push({ 'id': String(buffered.index), 'state': clone });
      }

      // cloneChild returns NodeStateInterface — no cast needed.
      const batch = Batch.from(batchItems);
      const routed = await this.#adapter.withNodeTimeout(dagNode, signal, async (nodeSignal) => {
        const context = this.#adapter.context(dagName, scatter.name, nodeSignal);
        return dagNode.execute(batch, context);
      });

      // VALIDATE stage — between the body firing and the per-item emit/route.
      const validatedRouted = this.#validateOutputContract(dagNode, routed);

      // Map item id → route key.
      const outputById = new Map<string, string>();
      for (const [routeKey, routeBatch] of validatedRouted.entries()) {
        for (const batchEntry of routeBatch) {
          outputById.set(batchEntry.id, routeKey);
        }
      }

      // Collect errors/warnings from each clone and build results.
      // Paired iteration over items+clones (same length: both built from `items`).
      const results: ScatterItemResultType[] = [];
      for (let i = 0; i < items.length; i++) {
        const buffered = items[i];
        if (buffered === undefined) throw new DAGError(`ScatterDispatch: invariant — items[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
        const clone = clones[i];
        if (clone === undefined) throw new DAGError(`ScatterDispatch: invariant — clones[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        results.push({
          'index': buffered.index,
          'item': buffered.item,
          'output': outputById.get(String(buffered.index)) ?? 'error',
          'terminalOutcome': null,
          'cloneState': clone,
          'selectedDagIri': null,
        });
      }

      return { results };
    }

    // ── Branch B / C: DAG body ────────────────────────────────────────────────
    const innerPath: readonly string[] = [...placementPath, scatter.name];
    const container = this.#adapter.resolveContainer(scatter.container);
    const inputMapping = ScatterNodeDefaults.inputMapping(scatter);
    const results: ScatterItemResultType[] = [];
    const partitions = new Map<string, {
      readonly items: { index: number; item: unknown; bufferKey: string }[];
      readonly clones: NodeStateInterface[];
      readonly batchItems: { id: string; state: NodeStateInterface }[];
    }>();

    for (const buffered of items) {
      const selectedDagIri = DagReferenceResolver.resolve({
        'reference': scatter.body.dag,
        'source': 'item',
        'value': buffered.item,
        'context': dagContext,
        'dags': this.#adapter.dags,
        'accessor': this.#adapter.accessor,
        ...(this.#bodyCandidateIris === null ? {} : { 'candidateIris': this.#bodyCandidateIris }),
      });

      if (selectedDagIri === null) {
        const clone = this.#adapter.stateMapper.cloneChild(state, inputMapping);
        clone.deleteMetadata(SCATTER_PROGRESS_KEY);
        clone.deleteMetadata(WORKSET_PROGRESS_KEY);
        clone.setMetadata(itemKey, buffered.item);
        clone.setMetadata('itemIndex', buffered.index);
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        results.push({
          'index': buffered.index,
          'item': buffered.item,
          'output': 'error',
          'terminalOutcome': 'failed',
          'cloneState': clone,
          'selectedDagIri': null,
        });
        continue;
      }

      this.#bindItemSelectedDag(buffered.index, selectedDagIri);

      const factory = this.#adapter.stateFactories.get(selectedDagIri) ?? ChildStateFactory.cloneParent;
      const clone = this.#adapter.stateMapper.spawnChild(state, inputMapping, factory);
      clone.deleteMetadata(SCATTER_PROGRESS_KEY);
      clone.deleteMetadata(WORKSET_PROGRESS_KEY);
      clone.setMetadata(itemKey, buffered.item);
      clone.setMetadata('itemIndex', buffered.index);

      let partition = partitions.get(selectedDagIri);
      if (partition === undefined) {
        partition = { 'items': [], 'clones': [], 'batchItems': [] };
        partitions.set(selectedDagIri, partition);
      }
      partition.items.push(buffered);
      partition.clones.push(clone);
      partition.batchItems.push({ 'id': String(buffered.index), 'state': clone });
    }

    for (const [selectedDagIri, partition] of partitions) {
      const batch = Batch.from(partition.batchItems);

      if (container === null) {
        // ── Branch B: DAG body, in-process (batch-native) ─────────────────────
        const childOptions: ExecuteOptionsType = { 'signal': signal };
        const terminalByItemId = new Map<string, 'completed' | 'failed'>();
        const repClone = state.clone();
        const iter = this.#adapter.runNodes(selectedDagIri, repClone, null, childOptions, { 'embedded': true }, innerPath, { 'inputBatch': batch, terminalByItemId });

        let step = await iter.next();
        while (!step.done) {
          step = await iter.next();
        }

        for (let i = 0; i < partition.items.length; i++) {
          const buffered = partition.items[i];
          if (buffered === undefined) throw new DAGError(`ScatterDispatch: invariant — partition.items[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
          const clone = partition.clones[i];
          if (clone === undefined) throw new DAGError(`ScatterDispatch: invariant — partition.clones[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
          const terminalOutcome = terminalByItemId.get(String(buffered.index)) ?? null;
          const hasUnrecoverable = clone.errors.some((e) => e.recoverable === false);
          const output = PlacementRouter.route(terminalOutcome, hasUnrecoverable);
          for (const err of clone.errors) state.collectError(err);
          for (const warn of clone.warnings) state.collectWarning(warn);
          results.push({
            'index': buffered.index,
            'item': buffered.item,
            output,
            terminalOutcome,
            'cloneState': clone,
            selectedDagIri,
          });
        }
        continue;
      }

      // ── Branch C: DAG body with container ───────────────────────────────────
      const correlationId = this.#adapter.nextCorrelationId(selectedDagIri);
      const context = this.#adapter.context(selectedDagIri, scatter.name, signal);
      const scatterRelay = this.#adapter.relayFor(state);
      let outcomes: BatchRunResultType[];

      if (container instanceof DagContainerBase) {
        const repCloneForTask: NodeStateInterface = partition.clones[0] ?? state;
        const task = new DagTask(
          selectedDagIri,
          innerPath,
          correlationId,
          Timeout.none(),
          repCloneForTask,
          context,
        );
        outcomes = await container.runDagBatch(task, batch, { 'relay': scatterRelay });
      } else {
        outcomes = [];
        for (let i = 0; i < partition.items.length; i++) {
          const clone: NodeStateInterface = partition.clones[i] ?? state;
          const buffered = partition.items[i];
          if (buffered === undefined) throw new DAGError(`ScatterDispatch: invariant — partition.items[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
          const itemCorrelationId = this.#adapter.nextCorrelationId(selectedDagIri);
          const itemContext = this.#adapter.context(selectedDagIri, scatter.name, signal);
          const task = new DagTask(
            selectedDagIri,
            innerPath,
            itemCorrelationId,
            Timeout.none(),
            clone,
            itemContext,
          );
          const outcome = await container.runDag(task, { 'relay': scatterRelay });
          outcomes.push({ 'id': String(buffered.index), ...outcome });
        }
      }

      for (const outcome of outcomes) {
        if (outcome.errors.some((e) => TransportErrorCode.isInfrastructureFailure(e.code))) {
          const infra = outcome.errors.find((e) => TransportErrorCode.isInfrastructureFailure(e.code));
          this.persistCheckpoint();
          throw new DAGError(
            `ScatterNode '${scatter.name}': container infrastructure failure — ${infra?.message ?? 'transport lost'}`,
            { 'code': 'EXECUTION_ERROR' },
          );
        }
      }

      for (let i = 0; i < partition.items.length; i++) {
        const buffered = partition.items[i];
        if (buffered === undefined) throw new DAGError(`ScatterDispatch: invariant — partition.items[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
        const clone = partition.clones[i];
        if (clone === undefined) throw new DAGError(`ScatterDispatch: invariant — partition.clones[${i}] is undefined`, { 'code': 'EXECUTION_ERROR' });
        const outcome = outcomes.find((candidate) => candidate.id === String(buffered.index));

        if (outcome === undefined) {
          for (const err of clone.errors) state.collectError(err);
          for (const warn of clone.warnings) state.collectWarning(warn);
          results.push({
            'index': buffered.index,
            'item': buffered.item,
            'output': 'error',
            'terminalOutcome': 'failed',
            'cloneState': clone,
            selectedDagIri,
          });
          continue;
        }

        if (outcome.stateSnapshot !== null) {
          clone.applySnapshot(outcome.stateSnapshot);
        }
        for (const err of outcome.errors) clone.collectError(err);

        const terminalOutcome: 'completed' | 'failed' = outcome.terminalOutput === 'failed' ? 'failed' : 'completed';
        const hasUnrecoverable = clone.errors.some((e) => e.recoverable === false);
        const output = PlacementRouter.route(terminalOutcome, hasUnrecoverable);

        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);

        results.push({
          'index': buffered.index,
          'item': buffered.item,
          output,
          terminalOutcome,
          'cloneState': clone,
          selectedDagIri,
        });
      }
    }

    results.sort((left, right) => left.index - right.index);
    return { results };
  }

  /**
   * Acknowledge a batch of items: remove all from inbox, append exported
   * gather records, advance scatter progress, and write the checkpoint once.
   */
  async ackBatch(batchResult: ScatterItemBatchResultType): Promise<void> {
    const { scatter, state, inbox, allFreshRecords, watermarkRef, aheadAcked, outcomeTally, gatherRecordSink } = this.#ctx;

    // Collect all item indexes to remove up-front so the inbox scan is O(inbox)
    // total rather than O(inbox × batch) from per-item findIndex+splice.
    const toRemove = new Set<number>(batchResult.results.map((r) => r.index));

    for (const res of batchResult.results) {
      const { 'index': itemIndex, 'output': output } = res;

      const freshRecord = this.#freshRecord(res);
      if (gatherRecordSink === null) {
        allFreshRecords.push(freshRecord);
      } else {
        await gatherRecordSink(freshRecord);
      }
      ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
    }

    // Bulk-remove all batch items from inbox in a single O(inbox) pass.
    // Per-item findIndex+splice would be O(inbox × batch); this is O(inbox) total.
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < inbox.length; readIdx++) {
      const entry = inbox[readIdx];
      if (entry === undefined) throw new DAGError(`ScatterDispatch: invariant — inbox[${readIdx}] is undefined`, { 'code': 'EXECUTION_ERROR' });
      if (!toRemove.has(entry.index)) {
        inbox[writeIdx++] = entry;
      }
    }
    inbox.length = writeIdx;

    // Single checkpoint write for the entire batch.
    ScatterCheckpoint.writeBounded(
      state, scatter['@id'], [...inbox], watermarkRef.value,
      [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
      Object.fromEntries(outcomeTally),
    );
  }
}

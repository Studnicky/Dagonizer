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
import type { GatherStrategy } from '../core/GatherStrategies.js';
import { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import { SCATTER_PROGRESS_KEY, WORKSET_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { ScatterNodeDefaults } from '../entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { ScatterAckedResultType, ScatterInboxItemType } from '../entities/scatter/ScatterProgress.js';
import { Timeout } from '../entities/Timeout.js';
import { DAGError, ExecutionError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { ChildStateFactory } from '../runtime/ChildStateFactory.js';

import type { BodyExecutor } from './BodyExecutor.js';
import { OutputContractApplier } from './OutputContractApplier.js';
import { PlacementRouter } from './PlacementRouter.js';

/** Engine-private result envelope returned by every node executor method. */
export type RunNodeResultType = {
  'nextStage': null | string;
  'result': NodeResultType<NodeStateInterface>;
};

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
export interface ScatterDispatchAdapterInterface<TServices> {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string, TServices>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  context(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices>;
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
export interface ScatterDispatchSourceInterface<TServices> {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string, TServices>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  bodyContext(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices>;
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
export class ScatterDispatchAdapter<TServices>
  implements ScatterDispatchAdapterInterface<TServices>
{
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
  };
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string, TServices>>;
  readonly dags: ReadonlyMap<string, DAGType>;
  readonly accessor: StateAccessorInterface;
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;
  readonly #source: ScatterDispatchSourceInterface<TServices>;

  constructor(source: ScatterDispatchSourceInterface<TServices>) {
    this.stateMapper = source.stateMapper;
    this.nodes = source.nodes;
    this.dags = source.dags;
    this.accessor = source.accessor;
    this.stateFactories = source.stateFactories;
    this.outputSchemaValidator = source.outputSchemaValidator;
    this.#source = source;
  }

  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string, TServices>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    return this.#source.withNodeTimeout(node, signal, fn);
  }

  context(dagName: string, nodeName: string, signal: AbortSignal | null): NodeContextType<TServices> {
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
  readonly signal: AbortSignal | null;
  readonly placementPath: readonly string[];
  readonly itemKey: string;
  readonly inbox: ScatterInboxItemType[];
  readonly ackedResults: ScatterAckedResultType[];
  readonly ackedByIndex: Map<number, ScatterAckedResultType>;
  readonly itemOutputs: Map<number, string>;
  readonly allFreshRecords: GatherRecordType[];
  readonly intermediateResults: Array<NodeResultType<NodeStateInterface>>;
  readonly gatherStrategy: GatherStrategy | null;
  readonly compactable: boolean;
  readonly watermarkRef: { value: number };
  readonly aheadAcked: Map<number, string>;
  readonly outcomeTally: Map<string, number>;
}

/**
 * Engine-private driver: bridges `ScatterWorkerPool` to `Dagonizer` internals.
 *
 * Constructed once per `executeScatter` call with a stable adapter + context.
 * Implements `ScatterPoolDriverInterface` without accessing private
 * members on `Dagonizer` directly.
 */
export class ScatterPoolDriver<TServices>
  implements ScatterPoolDriverInterface, ReservoirDriverInterface
{
  readonly #adapter: ScatterDispatchAdapterInterface<TServices>;
  readonly #ctx: ScatterRunContextType;
  readonly #bodyExecutor: BodyExecutor<TServices>;

  constructor(
    adapter: ScatterDispatchAdapterInterface<TServices>,
    ctx: ScatterRunContextType,
    bodyExecutor: BodyExecutor<TServices>,
  ) {
    this.#adapter = adapter;
    this.#ctx = ctx;
    this.#bodyExecutor = bodyExecutor;
  }

  /**
   * VALIDATE stage. The scatter analogue of the scheduler's output-contract
   * stage: applied to each body firing's routed output before the item is
   * routed and emitted into the gather. Zero overhead when `validateOutputs` is
   * off (`outputSchemaValidator` is null). On a violation, the item is re-routed
   * to `'error'` with a collected `outputContractViolation` NodeError.
   */
  #validateOutputContract(
    dagNode: NodeInterface<NodeStateInterface, string, TServices>,
    routed: RoutedBatchType<string, NodeStateInterface>,
  ): RoutedBatchType<string, NodeStateInterface> {
    return OutputContractApplier.applyToRouted(
      dagNode.name,
      dagNode.outputSchema,
      routed,
      this.#adapter.outputSchemaValidator,
    );
  }

  async executeItem(itemIndex: number, item: unknown): Promise<ScatterItemResultType> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;

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
      const dagNode = this.#adapter.nodes.get(scatter.body.node);
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
      return { 'index': itemIndex, item, output, 'terminalOutcome': null, 'cloneState': cloneState };
    } else {
      // DAG body (`dag` literal or `dagFrom` runtime path) — resolve the dag
      // name first, then look up its factory, then build the child clone.
      // An unresolvable `dagFrom` or an unregistered resolved name routes the
      // item to `error` (same as an infrastructure failure that routes to error
      // — no throw, so the item is acked, not re-queued).
      let bodyDagName: string;
      if ('dagFrom' in scatter.body) {
        // Resolve the body dag name from the ITEM: each scatter item names its
        // own body dag (e.g. a tool call carrying `dagName: 'tool:<name>'`). The
        // item is available before any clone, so resolution precedes the
        // isolation-factory child build. An unresolvable or unregistered name
        // routes the item to `error` (no throw; the item is acked, not re-queued).
        const resolved = (typeof item === 'object' && item !== null)
          ? this.#adapter.accessor.get(item, scatter.body.dagFrom)
          : null;
        if (typeof resolved !== 'string' || resolved.length === 0 || !this.#adapter.dags.has(resolved)) {
          const errorClone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
          errorClone.deleteMetadata(SCATTER_PROGRESS_KEY);
          errorClone.deleteMetadata(WORKSET_PROGRESS_KEY);
          errorClone.setMetadata(itemKey, item);
          errorClone.setMetadata('itemIndex', itemIndex);
          return { 'index': itemIndex, item, 'output': 'error', 'terminalOutcome': 'failed', 'cloneState': errorClone };
        }
        bodyDagName = resolved;
      } else {
        bodyDagName = scatter.body.dag;
      }

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
        throw new ExecutionError(
          `ScatterNode '${scatter.name}': container infrastructure failure — ${body.infrastructureError.message ?? 'transport lost'}`,
        );
      }

      const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
      const output = PlacementRouter.route(body.terminalOutcome, hasUnrecoverable);

      for (const err of cloneState.errors) state.collectError(err);
      for (const warn of cloneState.warnings) state.collectWarning(warn);

      return { 'index': itemIndex, item, output, 'terminalOutcome': body.terminalOutcome, 'cloneState': cloneState };
    }
  }

  async ackItem(res: ScatterItemResultType): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;
    const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

    // Remove from inbox.
    const inboxIdx = inbox.findIndex((e) => e.index === itemIndex);
    if (inboxIdx !== -1) inbox.splice(inboxIdx, 1);

    const freshRecord: GatherRecordType = {
      'index': itemIndex,
      item,
      output,
      terminalOutcome,
      cloneState,
    };

    // Fold this record into state via reduce (exactly-once per item).
    if (scatter.gather !== undefined && gatherStrategy !== null) {
      const batchItems = [{ 'id': String(itemIndex), 'state': freshRecord }];
      await gatherStrategy.reduce(scatter.gather, Batch.from(batchItems), state, this.#adapter.accessor);
    }

    // Accumulate for the finalize pass and outcome-reducer.
    // Compactable gathers fold all state into parent via reduce; finalize builds
    // derived state from its own private accumulators and does not read records.
    // Skip the push in compactable mode so each cloneState is GC-eligible
    // immediately after reduce returns — preserving the bounded-memory guarantee.
    if (!compactable) allFreshRecords.push(freshRecord);

    if (compactable) {
      // Bounded mode: advance watermark bookkeeping; skip full ackedResult storage.
      // shape changed for compactable gathers; result assertion unchanged.
      ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      ScatterCheckpoint.writeBounded(
        state, scatter.name, [...inbox], watermarkRef.value,
        [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
        Object.fromEntries(outcomeTally),
      );
    } else {
      // Retained mode: persist full acked result for reconstruct on resume.
      const ackedResult: ScatterAckedResultType = (() => {
        if (scatter.gather?.strategy === 'map' && scatter.gather.mapping !== undefined) {
          const snapshot: Record<string, unknown> = {};
          for (const clonePath of Object.keys(scatter.gather.mapping)) {
            snapshot[clonePath] = this.#adapter.accessor.get(cloneState, clonePath);
          }
          return { 'variant': 'map' as const, 'index': itemIndex, 'item': item, output, 'mappingValues': snapshot };
        }
        if (
          (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
          scatter.gather.field !== undefined
        ) {
          return { 'variant': 'field' as const, 'index': itemIndex, 'item': item, output, 'fieldValue': this.#adapter.accessor.get(cloneState, scatter.gather.field) };
        }
        return { 'variant': 'plain' as const, 'index': itemIndex, 'item': item, output };
      })();
      ackedResults.push(ackedResult);
      ackedByIndex.set(itemIndex, ackedResult);
      itemOutputs.set(itemIndex, output);
      ScatterCheckpoint.writeRetained(state, scatter.name, [...inbox], [...ackedResults]);
    }
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
   *   for all items); falls back to per-item `container.runDag` for plain
   *   `DagContainerInterface` implementations.
   *
   * Errors and warnings from each clone are collected into the parent state.
   */
  async executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResultType> {
    const { scatter, state, dagName, signal, placementPath, itemKey } = this.#ctx;

    if ('node' in scatter.body) {
      // ── Branch A: node body ─────────────────────────────────────────────────
      const dagNode = this.#adapter.nodes.get(scatter.body.node);
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
        if (buffered === undefined) throw new ExecutionError(`ScatterDispatch: invariant — items[${i}] is undefined`);
        const clone = clones[i];
        if (clone === undefined) throw new ExecutionError(`ScatterDispatch: invariant — clones[${i}] is undefined`);
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        results.push({
          'index': buffered.index,
          'item': buffered.item,
          'output': outputById.get(String(buffered.index)) ?? 'error',
          'terminalOutcome': null,
          'cloneState': clone,
        });
      }

      return { results };
    }

    // ── Branch B / C: DAG body ────────────────────────────────────────────────
    // Resolve dag name: `dag` literal or `dagFrom` runtime path. For `dagFrom`,
    // each ITEM names its own body dag — but at batch-execution time all items in
    // a released batch share the same body dag (reservoir batches group by key,
    // not by dag), so resolve against the first item as the representative.
    // An unresolvable or unregistered name routes every item in the batch to `error`.
    let batchBodyDagName: string;
    if ('dagFrom' in scatter.body) {
      const firstItem = items[0]?.item;
      const resolved = (typeof firstItem === 'object' && firstItem !== null)
        ? this.#adapter.accessor.get(firstItem, scatter.body.dagFrom)
        : null;
      if (typeof resolved !== 'string' || resolved.length === 0 || !this.#adapter.dags.has(resolved)) {
        // Route all items to error without running any body (clone-parent for error path).
        const errorResults: ScatterItemResultType[] = items.map((buffered) => {
          const clone = this.#adapter.stateMapper.cloneChild(state, ScatterNodeDefaults.inputMapping(scatter));
          clone.deleteMetadata(SCATTER_PROGRESS_KEY);
          clone.deleteMetadata(WORKSET_PROGRESS_KEY);
          clone.setMetadata(itemKey, buffered.item);
          clone.setMetadata('itemIndex', buffered.index);
          for (const err of clone.errors) state.collectError(err);
          for (const warn of clone.warnings) state.collectWarning(warn);
          return {
            'index': buffered.index,
            'item': buffered.item,
            'output': 'error',
            'terminalOutcome': 'failed' as const,
            'cloneState': clone,
          };
        });
        return { 'results': errorResults };
      }
      batchBodyDagName = resolved;
    } else {
      batchBodyDagName = scatter.body.dag;
    }

    const innerPath: readonly string[] = [...placementPath, scatter.name];
    const container = this.#adapter.resolveContainer(scatter.container);

    // Build N child clones using the body dag's registered factory (spawnChild
    // returns NodeStateInterface; isolation factories may produce a different class).
    const batchFactory = this.#adapter.stateFactories.get(batchBodyDagName) ?? ChildStateFactory.cloneParent;
    const clones: NodeStateInterface[] = [];
    const batchItems: { id: string; state: NodeStateInterface }[] = [];
    for (const buffered of items) {
      const clone = this.#adapter.stateMapper.spawnChild(state, ScatterNodeDefaults.inputMapping(scatter), batchFactory);
      // Strip engine-internal metadata keys — the child body must not inherit
      // the parent scatter/workset progress (O(N) payload, see executeItem).
      clone.deleteMetadata(SCATTER_PROGRESS_KEY);
      clone.deleteMetadata(WORKSET_PROGRESS_KEY);
      clone.setMetadata(itemKey, buffered.item);
      clone.setMetadata('itemIndex', buffered.index);
      clones.push(clone);
      batchItems.push({ 'id': String(buffered.index), 'state': clone });
    }
    // Batch<NodeStateInterface> for the batch-native embedded path (Branch B) and
    // the container path (Branch C). RunNodesBatchType.inputBatch is widened to
    // Batch<NodeStateInterface>; the WorkSet seam in NodeScheduler holds the single
    // narrowing cast at pending.add().
    const batch = Batch.from(batchItems);

    if (container === null) {
      // ── Branch B: DAG body, in-process (batch-native) ───────────────────────
      // Run the child DAG once over all N items as a single batch via the wave-1
      // seam (inputBatch + terminalByItemId), mirroring the batch-native embedded
      // -DAG firing in runNodes. The per-item items live in `batch`; `repClone`
      // is a standalone clone supplied only to satisfy the `state` argument.
      const childOptions: ExecuteOptionsType = { ...(signal !== null && { 'signal': signal }) };
      const terminalByItemId = new Map<string, 'completed' | 'failed'>();
      const repClone = state.clone();
      const iter = this.#adapter.runNodes(batchBodyDagName, repClone, null, childOptions, { 'embedded': true }, innerPath, { 'inputBatch': batch, terminalByItemId });

      // Drain the generator fully; per-item terminal outcomes land in the map.
      let step = await iter.next();
      while (!step.done) {
        step = await iter.next();
      }

      // Paired iteration over items+clones (same length: both built from `items`).
      const results: ScatterItemResultType[] = [];
      for (let i = 0; i < items.length; i++) {
        const buffered = items[i];
        if (buffered === undefined) throw new ExecutionError(`ScatterDispatch: invariant — items[${i}] is undefined`);
        const clone = clones[i];
        if (clone === undefined) throw new ExecutionError(`ScatterDispatch: invariant — clones[${i}] is undefined`);
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
        });
      }

      return { results };
    }

    // ── Branch C: DAG body with container ─────────────────────────────────────
    const correlationId = this.#adapter.nextCorrelationId(batchBodyDagName);
    const context = this.#adapter.context(batchBodyDagName, scatter.name, signal);
    const scatterRelay = this.#adapter.relayFor(state);

    let outcomes: BatchRunResultType[];

    if (container instanceof DagContainerBase) {
      // runDagBatch: one transport round-trip for all items.
      // DagContainerBase.runDagBatch accepts DagTaskInterface<unknown>
      // and Batch<NodeStateInterface>; no cast needed.
      const repCloneForTask: NodeStateInterface = clones[0] ?? state;
      const task = new DagTask<TServices>(
        batchBodyDagName,
        innerPath,
        correlationId,
        Timeout.none(),
        repCloneForTask,
        context,
      );
      outcomes = await container.runDagBatch(task, batch, { 'relay': scatterRelay });
    } else {
      // Fallback: per-item sequential runDag for custom DagContainerInterface implementations.
      // DagContainerInterface.runDag accepts DagTaskInterface<unknown>; no cast needed.
      outcomes = [];
      for (let i = 0; i < items.length; i++) {
        const clone: NodeStateInterface = clones[i] ?? state;
        const buffered = items[i];
        if (buffered === undefined) throw new ExecutionError(`ScatterDispatch: invariant — items[${i}] is undefined`);
        const itemCorrelationId = this.#adapter.nextCorrelationId(batchBodyDagName);
        const itemContext = this.#adapter.context(batchBodyDagName, scatter.name, signal);
        const task = new DagTask<TServices>(
          batchBodyDagName,
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

    // Infrastructure failure check: any item with an infrastructure error → throw (at-least-once).
    for (const outcome of outcomes) {
      if (outcome.errors.some((e) => TransportErrorCode.isInfrastructureFailure(e.code))) {
        const infra = outcome.errors.find((e) => TransportErrorCode.isInfrastructureFailure(e.code));
        throw new ExecutionError(
          `ScatterNode '${scatter.name}': container infrastructure failure — ${infra?.message ?? 'transport lost'}`,
        );
      }
    }

    // Build results from outcomes. Paired iteration over items+clones (same length).
    const results: ScatterItemResultType[] = [];
    for (let i = 0; i < items.length; i++) {
      const buffered = items[i];
      if (buffered === undefined) throw new ExecutionError(`ScatterDispatch: invariant — items[${i}] is undefined`);
      const clone = clones[i];
      if (clone === undefined) throw new ExecutionError(`ScatterDispatch: invariant — clones[${i}] is undefined`);
      const outcome = outcomes.find((o) => o.id === String(buffered.index));

      if (outcome === undefined) {
        // No outcome for this item — treat as infrastructure failure path (should not happen).
        for (const err of clone.errors) state.collectError(err);
        for (const warn of clone.warnings) state.collectWarning(warn);
        results.push({
          'index': buffered.index,
          'item': buffered.item,
          'output': 'error',
          'terminalOutcome': 'failed' as const,
          'cloneState': clone,
        });
        continue;
      }

      // Apply terminal state snapshot back to clone for domain state.
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
      });
    }

    return { results };
  }

  /**
   * Acknowledge a batch of items: remove all from inbox, build acked results,
   * fold them into parent state via a SINGLE `gatherStrategy.reduce` call, and
   * write the checkpoint ONCE for the entire batch.
   */
  async ackBatch(batchResult: ScatterItemBatchResultType): Promise<void> {
    const { scatter, state, inbox, ackedResults, ackedByIndex, itemOutputs, allFreshRecords, gatherStrategy, compactable, watermarkRef, aheadAcked, outcomeTally } = this.#ctx;

    const freshRecordsForBatch: GatherRecordType[] = [];

    // Collect all item indexes to remove up-front so the inbox scan is O(inbox)
    // total rather than O(inbox × batch) from per-item findIndex+splice.
    const toRemove = new Set<number>(batchResult.results.map((r) => r.index));

    for (const res of batchResult.results) {
      const { 'index': itemIndex, 'item': item, 'output': output, 'terminalOutcome': terminalOutcome, 'cloneState': cloneState } = res;

      const freshRecord: GatherRecordType = { 'index': itemIndex, item, output, terminalOutcome, cloneState };
      freshRecordsForBatch.push(freshRecord);
      // Compactable mode: skip accumulation so each cloneState is GC-eligible
      // after the batch reduce below — same bounded-memory invariant as ackItem.
      if (!compactable) allFreshRecords.push(freshRecord);

      if (compactable) {
        // Bounded mode: advance watermark per item.
        ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, itemIndex, output);
      } else {
        // Retained mode: build full acked result.
        const ackedResult: ScatterAckedResultType = (() => {
          if (scatter.gather?.strategy === 'map' && scatter.gather.mapping !== undefined) {
            const snapshot: Record<string, unknown> = {};
            for (const clonePath of Object.keys(scatter.gather.mapping)) {
              snapshot[clonePath] = this.#adapter.accessor.get(cloneState, clonePath);
            }
            return { 'variant': 'map' as const, 'index': itemIndex, 'item': item, output, 'mappingValues': snapshot };
          }
          if (
            (scatter.gather?.strategy === 'append' || scatter.gather?.strategy === 'partition') &&
            scatter.gather.field !== undefined
          ) {
            return { 'variant': 'field' as const, 'index': itemIndex, 'item': item, output, 'fieldValue': this.#adapter.accessor.get(cloneState, scatter.gather.field) };
          }
          return { 'variant': 'plain' as const, 'index': itemIndex, 'item': item, output };
        })();
        ackedResults.push(ackedResult);
        ackedByIndex.set(itemIndex, ackedResult);
        itemOutputs.set(itemIndex, output);
      }
    }

    // Bulk-remove all batch items from inbox in a single O(inbox) pass.
    // Per-item findIndex+splice would be O(inbox × batch); this is O(inbox) total.
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < inbox.length; readIdx++) {
      const entry = inbox[readIdx];
      if (entry === undefined) throw new ExecutionError(`ScatterDispatch: invariant — inbox[${readIdx}] is undefined`);
      if (!toRemove.has(entry.index)) {
        inbox[writeIdx++] = entry;
      }
    }
    inbox.length = writeIdx;

    // Single reduce call for the whole batch.
    if (scatter.gather !== undefined && gatherStrategy !== null) {
      const batchItems = freshRecordsForBatch.map((r) => ({ 'id': String(r.index), 'state': r }));
      await gatherStrategy.reduce(scatter.gather, Batch.from(batchItems), state, this.#adapter.accessor);
    }

    // Single checkpoint write for the entire batch.
    if (compactable) {
      // shape changed for compactable gathers; result assertion unchanged.
      ScatterCheckpoint.writeBounded(
        state, scatter.name, [...inbox], watermarkRef.value,
        [...aheadAcked.entries()].map(([i, o]) => ({ 'index': i, 'output': o })),
        Object.fromEntries(outcomeTally),
      );
    } else {
      ScatterCheckpoint.writeRetained(state, scatter.name, [...inbox], [...ackedResults]);
    }
  }
}

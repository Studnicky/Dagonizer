import { WorkSetCheckpoint } from '../checkpoint/WorkSetCheckpoint.js';
import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { HandoffChannelInterface } from '../contracts/HandoffChannelInterface.js';
import type { NodeInterface, OutputSchemaValidatorInterface } from '../contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import { PlacementRank } from '../core/PlacementRank.js';
import { WorkSet } from '../core/WorkSet.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { ExecutionResultType, InterruptionInfoType } from '../entities/execution/ExecutionResult.js';
import type { ParkedType } from '../entities/execution/Parked.js';
import type { DAGHandoffType } from '../entities/handoff/DAGHandoff.js';
import { JsonObject } from '../entities/json.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { WorkSetProgressType } from '../entities/workset/WorkSetProgress.js';
import { DAGError, ExecutionError, NodeTimeoutError } from '../errors/index.js';
import { DAGLifecycleMachine } from '../lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { SignalComposer } from '../runtime/SignalComposer.js';
import type { StateMapper } from '../runtime/StateMapper.js';

import { OutputContractApplier } from './OutputContractApplier.js';
import type { RunNodeResultType, RunNodesBatchType, RunOptionsType } from './ScatterDispatch.js';

/**
 * Narrow host surface the `NodeScheduler` drives. `Dagonizer` provides a thin
 * source object backed by its public seams (registries, observer relay,
 * placement dispatch, state mapper, container resolution, timeout wrapper,
 * correlation minting, and node-context building) so the scheduler depends only
 * on these ports — never on the whole dispatcher.
 *
 * The scheduler is the application's node-graph traversal layer; `Dagonizer`
 * stays the orchestration layer that wires this source and owns the protected
 * observability hooks the relay forwarders fan into.
 */
export interface NodeSchedulerSourceInterface {
  /** Registered DAGs keyed by name. */
  readonly dags: ReadonlyMap<string, DAGType>;
  /** Registered nodes keyed by name. Typed at the base so heterogeneous child-node states store without casts. */
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  /** Placement index keyed by `${dagName}:${placementName}`. */
  readonly nodeIndex: ReadonlyMap<string, DAGNodeType>;
  /** Child-state cloning + output mapping for the in-process embedded-DAG path. */
  readonly stateMapper: StateMapper;
  /** Per-DAG child-state factories keyed by DAG name. Used to spawn isolated child state. */
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  /** Egress channels keyed by terminal placement name. */
  readonly channels: Readonly<Record<string, HandoffChannelInterface>>;
  /** Registry version stamped into every `DAGHandoff` envelope. */
  readonly registryVersion: string;
  /** State path accessor — used to resolve `dagFrom` paths on `EmbeddedDAGNode` at execution time. */
  readonly accessor: StateAccessorInterface;
  /** Output-schema validator injected when validateOutputs is true; null otherwise. */
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;

  /** Relay a flow-start event into the dispatcher's `onFlowStart` hook. */
  relayFlowStart(dagName: string, state: NodeStateInterface): void;
  /** Relay a flow-end event into the dispatcher's `onFlowEnd` hook. */
  relayFlowEnd(dagName: string, state: NodeStateInterface, result: ExecutionResultType<NodeStateInterface>): void;
  /** Relay a node-start event into the dispatcher's `onNodeStart` hook. */
  relayNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[]): void;
  /** Relay a node-end event into the dispatcher's `onNodeEnd` hook. */
  relayNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[]): void;
  /** Relay an error event into the dispatcher's `onError` hook. */
  relayError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[]): void;
  /** Relay a phase-enter event into the dispatcher's `onPhaseEnter` hook. */
  relayPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void;
  /** Relay a phase-exit event into the dispatcher's `onPhaseExit` hook. */
  relayPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void;

  /** Dispatch a composite (`ScatterNode` / `EmbeddedDAGNode`) placement for one item. */
  executeDAGNode(
    entry: DAGNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType>;
  /** Resolve a bound container by role, or `null` to run the body in-process. */
  resolveContainer(role: string | undefined): DagContainerInterface | null;
  /** Wrap a node execute call with its per-node timeout budget. */
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal | null,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  /** Mint a monotonic correlation id for a hand-off envelope. */
  nextCorrelationId(dagName: string): string;
  /** Build a node context for a placement execution. */
  nodeContext(dagName: string, placementName: string, signal: AbortSignal | null): NodeContextType;
}

/**
 * Work-set node-graph scheduler.
 *
 * Drives the streaming DAG traversal: seeds a `WorkSet` from the entry
 * placement (or a rehydrated checkpoint blob), pulls the next ready placement
 * by rank + declaration order, fires it (`TerminalNode`, `SingleNode`,
 * in-process `EmbeddedDAGNode`, or composite `ScatterNode` / contained
 * embedded), yields each `NodeResultType`, and returns the final
 * `ExecutionResultType` with `cursor` set. Never throws.
 *
 * Extracts the scheduler cluster from `Dagonizer` into a single-responsibility
 * module. It depends only on the narrow `NodeSchedulerSourceInterface`; the
 * embedded re-entry recurses into `this.run` so the same generator drives every
 * nesting level.
 */
export class NodeScheduler {
  readonly #source: NodeSchedulerSourceInterface;

  constructor(source: NodeSchedulerSourceInterface) {
    this.#source = source;
  }

  /**
   * Canonical generator. Yields each node result (including the intermediate
   * yields from parallel / scatter nodes) and returns the final
   * `ExecutionResultType` with `cursor` set. Never throws.
   *
   * `runOptions.embedded` is a private implementation detail for recursive
   * embedded-DAG re-entry. When `true`, lifecycle transitions (`markRunning`,
   * `markCompleted`) and flow hooks (`onFlowStart`, `onFlowEnd`) are suppressed
   * (those are top-level concerns owned by the consumer's `execute()` /
   * `resume()` call). Node hooks (`onNodeStart`, `onNodeEnd`, `onError`) still
   * fire for every child node.
   */
  async *run<TReturn extends NodeStateInterface = NodeStateInterface>(
    dagName: string,
    state: TReturn,
    fromStage: string | null,
    options: ExecuteOptionsType,
    runOptions: RunOptionsType = { 'embedded': false },
    placementPath: readonly string[] = [],
    batch: RunNodesBatchType = {},
  ): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TReturn>, void> {
    const { inputBatch, terminalByItemId } = batch;
    // Expand the bare dagName to its IRI key for all registry map lookups.
    // The original dagName string is retained for human-readable error messages,
    // lifecycle hooks, and hand-off envelopes.
    const dagIri = ContextResolver.expand(dagName, {});
    const dag = this.#source.dags.get(dagIri);

    if (!dag) {
      // Unknown DAG: synthesize an error result without starting the
      // lifecycle. `state` may not have been touched yet, so don't mark
      // running. The cursor is null because there is no DAG to resume.
      const error = new DAGError(`Unknown DAG: ${dagName}`);
      this.#source.relayError('<unknown>', error, state, placementPath);
      if (!runOptions.embedded) {
        try { state.markFailed(error); } catch { /* state may already be terminal */ }
      }
      const result: ExecutionResultType<TReturn> = {
        'cursor': null, 'executedNodes': [], 'skippedNodes': [], state, 'terminalOutcome': null,
        'interruptedAt': null, 'parked': null,
      };
      if (!runOptions.embedded) {
        this.#source.relayFlowEnd(dagName, state, result);
      }
      return result;
    }

    // Extract the DAG's @context prefix map for node-name IRI expansion during execution.
    const dagContext: Record<string, unknown> = ContextResolver.contextOf(dag['@context']);

    const signal = SignalComposer.compose(options);

    if (!runOptions.embedded) {
      // When resuming after a crash (fromStage !== null), the prior run may
      // have left the lifecycle in a terminal state (failed/cancelled/timed_out)
      // or in the awaiting-input (parked) state for HITL flows. Reset to `pending`
      // so `markRunning()` can re-enter the running state.
      // Lifecycle is not captured in snapshots; this reset is safe — the
      // checkpoint data (SCATTER_PROGRESS_KEY, etc.) is in metadata and survives.
      if (fromStage !== null && (DAGLifecycleMachine.isTerminal(state.lifecycle) || DAGLifecycleMachine.isParked(state.lifecycle))) {
        state.resetLifecycle();
      }
      state.markRunning();
      this.#source.relayFlowStart(dagName, state);
    }

    const executedNodes: string[] = [];
    const skippedNodes: string[] = [];
    let terminalNodeName: string | null = null;

    // --- Pre-phase placements --------------------------------------------------
    // Run before the entrypoint, in DAG declaration order. Suppressed when this
    // is a embedded-DAG re-entry; pre/post phases are top-level concerns owned by
    // the consumer's `execute()` / `resume()` call.
    if (!runOptions.embedded) {
      const prePhases = dag.nodes.filter(
        (n): n is PhaseNodeType =>
          n['@type'] === 'PhaseNode' && n.phase === 'pre',
      );
      for (const phase of prePhases) {
        this.#source.relayPhaseEnter(dagName, 'pre', phase.name, state, placementPath);
        try {
          await this.#executePhasePlacement(phase, state, dagName, signal, dagContext);
          executedNodes.push(phase.name);
        } catch (err) {
          const error = err instanceof Error ? err : new ExecutionError(String(err));
          this.#source.relayError(phase.name, error, state, placementPath);
          try { state.markFailed(error); } catch { /* already terminal */ }
          this.#source.relayPhaseExit(dagName, 'pre', phase.name, state, placementPath);
          const result = this.#composeResult(null, executedNodes, skippedNodes, null, null, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }
        this.#source.relayPhaseExit(dagName, 'pre', phase.name, state, placementPath);
      }
    }

    let cursor: null | string = fromStage ?? dag.entrypoint;
    let terminalOutcome: 'completed' | 'failed' | null = null;

    // Skip phase placements in the main loop; they are out-of-band and
    // never the entrypoint. If the consumer's fromStage / entrypoint happens
    // to name a phase placement, treat it as if the main loop is empty.
    if (cursor !== null && this.#isPhaseEntry(dagName, cursor)) {
      cursor = null;
    }

    // ── Work-set scheduler ──────────────────────────────────────────────────
    // Initialize the work set with the input state at the entry placement.
    // When cursor is null (phase-entry guard tripped), skip the main loop.
    if (cursor !== null) {
      // Build rank and declaration-index maps once per walk.
      const rankMap = PlacementRank.compute(dag);
      const declIndex = new Map<string, number>();
      for (let i = 0; i < dag.nodes.length; i++) {
        const placement = dag.nodes[i];
        if (placement === undefined) continue;
        declIndex.set(placement.name, i);
      }

      const rankOf = (name: string): number => rankMap.get(name) ?? Number.MAX_SAFE_INTEGER;
      const declIndexOf = (name: string): number => declIndex.get(name) ?? Number.MAX_SAFE_INTEGER;

      const pending = new WorkSet<NodeStateInterface>();

      // Resume: when fromStage is provided and this is a top-level run, check
      // for a persisted work-set blob. If present, rebuild `pending` from it so
      // every in-flight item's state is restored exactly. If absent, fall through
      // to the size-1 seed below (the cursor model — byte-identical to before).
      if (fromStage !== null && !runOptions.embedded) {
        const workSetBlob = WorkSetCheckpoint.read(state);
        if (workSetBlob !== undefined) {
          // Rebuild pending from the blob: for each placement, reconstruct each
          // item's state via clone + applySnapshot, then accumulate into the
          // work set in declaration order.
          //
          // `state.clone()` copies the current metadata (including the blob),
          // but `applySnapshot` resets metadata and repopulates from the item
          // snapshot, so reconstructed item states do not carry the parent blob.
          for (const entry of workSetBlob.entries) {
            const items: Array<{ 'id': string; 'state': NodeStateInterface }> = [];
            for (const workItem of entry.items) {
              const itemState = state.clone();
              // workItem.snapshot is typed as `{}` by json-schema-to-ts for
              // `{ type: 'object' }`; `JsonObject.is` narrows it to JsonObjectType
              // (cast-free) at the snapshot ingest boundary.
              itemState.applySnapshot(JsonObject.is(workItem.snapshot) ? workItem.snapshot : {});
              items.push({ 'id': workItem.id, 'state': itemState });
            }
            pending.add(entry.placement, Batch.from(items));
          }
          // Clear the blob from all reconstructed item states (applySnapshot
          // already reset each clone's metadata from its item snapshot, so the
          // blob is absent there). Clear from the top-level state too so a
          // re-interrupted run captures a fresh blob rather than the old one.
          WorkSetCheckpoint.clear(state);
        } else {
          // Size-1 canonical resume: no blob → seed with the top-level state at
          // the cursor. Byte-identical to the existing checkpoint test path.
          pending.add(cursor, Batch.of(state));
        }
      } else {
        // Fresh execute (fromStage === null) or embedded: seed with the
        // provided inputBatch when supplied (batch-native embedded path),
        // otherwise seed with the single top-level state.
        pending.add(cursor, inputBatch ?? Batch.of(state));
      }

      // Terminal accumulator: collects batches per terminal name so all items
      // reaching terminal nodes are processed before outcome is determined.
      // For size-1 batches this is a map with exactly one entry of size 1,
      // and the behaviour is byte-identical to the prior break-on-first path.
      const terminalAccumulator = new Map<string, { 'outcome': 'completed' | 'failed'; 'batch': Batch<NodeStateInterface> }>();

      // Work-set scheduling loop.
      // For size-1 input: exactly one placement holds exactly one item at all
      // times; nextReady returns that placement, SingleNode fires over the
      // size-1 batch returning one route with one item, and the item advances
      // to the next placement.
      scheduleLoop: while (true) {
        const currentPlacementName = pending.nextReady(rankOf, declIndexOf);
        if (currentPlacementName === null) break scheduleLoop;

        // Advance cursor to the placement about to fire, immediately after
        // picking, so the abort-check result correctly identifies the placement
        // that would have fired.
        cursor = currentPlacementName;

        // Abort check: fires before each placement.
        if (signal?.aborted) {
          const abortInfo = this.#handleAbort(state, signal);
          this.#source.relayError(currentPlacementName, abortInfo.error, state, placementPath);
          const interruptedAt: InterruptionInfoType = {
            'nodeName': currentPlacementName,
            'reason':   abortInfo.reason,
          };

          // Work-set serialization for top-level runs: persist the in-flight
          // work set so a subsequent resume can rebuild `pending` with the
          // correct item states for every placement.
          //
          // Size-1 canonical detection: exactly one item total across the whole
          // work set AND that item's state is reference-equal to the top-level
          // state. When this holds, the cursor model already captures everything
          // (cursor = placement name, state = top-level state) and no blob is
          // needed — byte-identical to existing behaviour. When it does NOT hold
          // (multi-item or a cloned item state), write the blob.
          if (!runOptions.embedded) {
            let totalItems = 0;
            let canonicalState: NodeStateInterface | undefined;
            for (const [, batch] of pending.entries()) {
              for (const item of batch) {
                totalItems++;
                canonicalState = item.state;
              }
            }
            const isSize1Canonical = totalItems === 1 && canonicalState === state;

            if (!isSize1Canonical) {
              // Build the WorkSetProgress blob from the current `pending` map.
              // Each entry serialises one placement's batch (in item order).
              const entries: WorkSetProgressType['entries'] = [];
              for (const [placement, batch] of pending.entries()) {
                const items: WorkSetProgressType['entries'][number]['items'] = [];
                for (const item of batch) {
                  items.push({ 'id': item.id, 'snapshot': item.state.snapshot() });
                }
                entries.push({ placement, items });
              }
              WorkSetCheckpoint.write(state, { entries });
            }
          }

          const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }

        // Take the batch pending at this placement. nextReady returned this
        // name from the live #entries map, so takeExpected() is safe here.
        const batch = pending.takeExpected(currentPlacementName);

        const node = this.#source.nodeIndex.get(`${dagIri}:${currentPlacementName}`);

        if (!node) {
          const error = new DAGError(`Unknown node: ${currentPlacementName} in DAG ${dagName}`);
          this.#source.relayError(currentPlacementName, error, state, placementPath);
          if (!runOptions.embedded) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
          const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, null, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
          return result;
        }

        // Representative state: first item in the batch. For size-1 batches
        // this is identical to the single cursor state — byte-identical to today.
        const repState = batch.row(0).state;

        this.#source.relayNodeStart(node.name, repState, placementPath);

        // TerminalNode: no-op execution — capture outcome, synthesize result,
        // fire onNodeEnd, and continue the work-set loop so remaining items
        // can reach their own terminals (which may differ in multi-item batches).
        if (Placement.isTerminal(node)) {
          const terminal = node;
          // Accumulate this terminal's batch. Multiple items may arrive at the
          // same terminal (coalesced by the work-set) or at different terminals.
          const existing = terminalAccumulator.get(terminal.name);
          if (existing === undefined) {
            terminalAccumulator.set(terminal.name, { 'outcome': terminal.outcome, 'batch': batch });
          } else {
            // Same terminal reached by items in separate work-set turns; merge.
            const merged: Array<{ 'id': string; 'state': NodeStateInterface }> = [];
            for (const item of existing.batch) merged.push({ 'id': item.id, 'state': item.state });
            for (const item of batch) merged.push({ 'id': item.id, 'state': item.state });
            terminalAccumulator.set(terminal.name, { 'outcome': terminal.outcome, 'batch': Batch.from(merged) });
          }
          // Populate per-item terminal map when the caller requested it (batch-native
          // embedded path needs to know which items ended at which terminal variant).
          if (terminalByItemId !== undefined) {
            for (const item of batch) {
              terminalByItemId.set(item.id, terminal.outcome);
            }
          }
          executedNodes.push(terminal.name);
          const terminalResult: NodeResultType<NodeStateInterface> = {
            'output': terminal.outcome,
            'skipped': false,
            'nodeName': terminal.name,
            'state': repState,
            'intermediateResults': [],
          };
          this.#source.relayNodeEnd(terminal.name, terminal.outcome, repState, placementPath);
          yield terminalResult;
          continue scheduleLoop;
        }

        // SingleNode: batch-native path. Three named lifecycle stages run in
        // strict order — fire (execute the node) → validate (apply the
        // output-schema contract) → route (push each port's sub-batch into
        // pending). Validation is a dedicated stage between fire and route, never
        // folded into execute; it is a no-op when the toggle is off.
        //
        // Special case: when the node routes to the reserved `'parked'` output,
        // execution suspends for HITL (human-in-the-loop). The engine reads the
        // correlationKey from state metadata, transitions the lifecycle to
        // `awaiting-input`, sets cursor to the parked placement, and returns
        // early with a populated `parked` entity on the result.
        if (Placement.isSingle(node)) {
          let nodeResult: NodeResultType<NodeStateInterface>;
          try {
            const fired = await this.#fireSinglePlacement(node, batch, dagName, signal, dagContext);

            // Park detection: if any item in the routed map is on the 'parked'
            // output, treat the entire firing as a park. For size-1 batches
            // (the canonical case) this is a single item on a single port.
            if (fired.routed.has('parked')) {
              executedNodes.push(currentPlacementName);
              // Read the correlationKey the node placed in state metadata.
              const rawKey = repState.getMetadata('correlationKey');
              const correlationKey = typeof rawKey === 'string' ? rawKey : currentPlacementName;
              // Transition the top-level state lifecycle to awaiting-input.
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle) && !DAGLifecycleMachine.isParked(state.lifecycle)) {
                try { state.park(correlationKey); } catch { /* lifecycle guard */ }
              }
              const parkedEntity: ParkedType = {
                'correlationKey': correlationKey,
                'cursor': currentPlacementName,
                'dagName': dagName,
              };
              this.#source.relayNodeEnd(node.name, 'parked', repState, placementPath);
              const parkResult = this.#composeResult(currentPlacementName, executedNodes, skippedNodes, null, null, state, parkedEntity);
              await this.#runPostPhasesAndFinalize(dag, dagName, state, parkResult, runOptions, terminalNodeName, placementPath);
              return parkResult;
            }

            const validated = this.#validateOutputContract(fired.dagNode, fired.routed);
            nodeResult = this.#routeToPending(node, fired.dagNode, validated, batch, pending);
          } catch (caughtError) {
            const error = caughtError instanceof Error ? caughtError : new ExecutionError(String(caughtError));
            this.#source.relayError(currentPlacementName, error, repState, placementPath);
            let interruptedAt: InterruptionInfoType | null = null;
            if (signal?.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.#handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof NodeTimeoutError) {
              interruptedAt = { 'nodeName': currentPlacementName, 'reason': 'timeout' };
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
                try { state.markFailed(error); } catch { /* already terminal */ }
              }
            } else if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
              try { state.markFailed(error); } catch { /* already terminal */ }
            }
            const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
            await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
            return result;
          }

          executedNodes.push(nodeResult.nodeName);
          this.#source.relayNodeEnd(node.name, nodeResult.output, repState, placementPath);
          yield nodeResult;
          continue scheduleLoop;
        }

        // EmbeddedDAGNode batch-native path (in-process only): run the child DAG
        // once over all N items as a single batch rather than N separate calls.
        // This avoids N redundant DAG setups and preserves batch semantics in
        // the child flow. Only applies when the container resolves to null (in-
        // process); the contained path uses per-item executeDAGNode below.
        if (Placement.isEmbeddedDAG(node) && this.#source.resolveContainer(node.container) === null) {
          const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(node);
          const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(node);
          const innerPath: readonly string[] = [...placementPath, node.name];

          const parentItems = [...batch];

          // Resolve the child dag name. `dag` is a build-time literal; `dagFrom`
          // is resolved from the representative state at execution time. A null
          // result means the path did not resolve to a string; an unregistered
          // name means dagFrom resolved to a string not in the registry.
          // Both cases route all items to their error outputs without executing.
          const resolvedChildDagName = EmbeddedDAGNodeDefaults.resolveDagName(node, repState, this.#source.accessor);
          const childDagIri = resolvedChildDagName !== null ? ContextResolver.expand(resolvedChildDagName, {}) : null;
          if (resolvedChildDagName === null || childDagIri === null || !this.#source.dags.has(childDagIri)) {
            for (const item of parentItems) {
              const routeOutput = 'error';
              const nextPlacement = node.outputs[routeOutput] ?? null;
              if (nextPlacement !== null) {
                pending.add(nextPlacement, Batch.of(item.state, item.id));
              }
            }
            continue scheduleLoop;
          }
          // resolvedChildDagName is a non-null string beyond this point.
          const childDagName: string = resolvedChildDagName;

          // Build child batch: one clone per parent item, seeded via inputMapping.
          // Use the registered isolation factory for this DAG when one is present
          // (spawnChild returns NodeStateInterface; isolation factory may produce a
          // different class). cloneChild also returns NodeStateInterface.
          // stateFactories is bare-name keyed; childDagName is the bare/short name.
          const childFactory = this.#source.stateFactories.get(childDagName);
          const childItems: Array<{ 'id': string; 'state': NodeStateInterface }> = [];
          for (const item of parentItems) {
            const childClone: NodeStateInterface = childFactory !== undefined
              ? this.#source.stateMapper.spawnChild(item.state, inputMapping, childFactory)
              : this.#source.stateMapper.cloneChild(item.state, inputMapping);
            childItems.push({ 'id': item.id, 'state': childClone });
          }
          const childBatch = Batch.from(childItems);

          // Per-item terminal outcome map: populated by the child runNodes when
          // each item reaches a TerminalNode. Maps item.id → terminal outcome.
          const childTerminalByItemId = new Map<string, 'completed' | 'failed'>();

          // Run the child DAG once over all N items (batch-native embedded).
          // `childRepState` is a standalone clone used as the `state` argument
          // required by the run signature; the actual items are in childBatch.
          const childRepState = repState.clone();
          const childOptions: ExecuteOptionsType = { ...(signal !== null && { 'signal': signal }) };
          const intermediateResults: Array<NodeResultType<NodeStateInterface>> = [];

          const iter = this.run(childDagName, childRepState, null, childOptions, { 'embedded': true }, innerPath, { 'inputBatch': childBatch, 'terminalByItemId': childTerminalByItemId });

          // Collect inner intermediates when streaming (top-level only); at nested
          // or composite scale, drain without buffering to avoid O(N*M*L) heap.
          if (!runOptions.embedded) {
            let step = await iter.next();
            while (!step.done) {
              const nr = step.value;
              intermediateResults.push({
                'output': nr.output,
                'skipped': nr.skipped,
                'nodeName': `${node.name}.${nr.nodeName}`,
                'state': repState,
                'intermediateResults': [],
              });
              step = await iter.next();
            }
          } else {
            while (true) {
              const step = await iter.next();
              if (step.done) break;
            }
          }

          // Route each parent item by its child clone's terminal outcome + errors.
          const routeOutputByItemId = new Map<string, string>();
          for (let i = 0; i < parentItems.length; i++) {
            // parentItems and childItems are parallel arrays built above, so both
            // index i are always within bounds inside this loop; the guard narrows
            // the `noUncheckedIndexedAccess` `| undefined` without a cast.
            const parentItem = parentItems[i];
            const childItem = childItems[i];
            if (parentItem === undefined || childItem === undefined) continue;
            const childClone = childItem.state;

            // Propagate errors and warnings from child clone to parent.
            for (const err of childClone.errors) parentItem.state.collectError(err);
            for (const warn of childClone.warnings) parentItem.state.collectWarning(warn);

            // Apply output state mapping: child → parent.
            this.#source.stateMapper.mapOutput(childClone, parentItem.state, outputMapping);

            // Determine route from per-item terminal outcome + unrecoverable errors.
            // childTerminalByItemId is populated by run when each item hits a
            // TerminalNode, giving accurate per-item failed/completed status.
            const childTerminalOutcome = childTerminalByItemId.get(parentItem.id) ?? 'completed';
            const hasUnrecoverable = childClone.errors.some((e) => e.recoverable === false);
            const routeOutput = (childTerminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
            routeOutputByItemId.set(parentItem.id, routeOutput);
            const nextPlacement = node.outputs[routeOutput] ?? null;

            if (nextPlacement !== null) {
              pending.add(nextPlacement, Batch.of(parentItem.state, parentItem.id));
            }
          }

          // Representative observability output for the batch firing.
          // Unanimous when all items routed to the same port, else null.
          let repOutput: string | null = null;
          let allSameOutput = true;
          for (const [, output] of routeOutputByItemId) {
            if (repOutput === null) {
              repOutput = output;
            } else if (output !== repOutput) {
              allSameOutput = false;
              break;
            }
          }
          if (!allSameOutput) repOutput = null;

          // Stream intermediates before this node's own result.
          for (const intermediate of intermediateResults) {
            yield intermediate;
          }

          executedNodes.push(node.name);
          this.#source.relayNodeEnd(node.name, repOutput, repState, placementPath);
          yield {
            'output': repOutput,
            'skipped': false,
            'nodeName': node.name,
            'state': repState,
            'intermediateResults': [],
          };
          continue scheduleLoop;
        }

        // ScatterNode / EmbeddedDAGNode fire batch-native by running the
        // existing per-item composite logic (executeDAGNode) for each item in
        // the batch, then partitioning the items across output ports by the
        // route each one selected (RFC 0003 §6 — single-item = internal
        // iteration; the sub-walk / scatter machinery is reused unchanged). For
        // a size-1 batch this is byte-identical to the prior single dispatch:
        // one item, one executeDAGNode call, one route.
        const composite: Array<{ 'state': NodeStateInterface; 'nextStage': string | null; 'result': NodeResultType<NodeStateInterface> }> = [];
        for (const item of batch) {
          try {
            // bufferIntermediates: only accumulate inner-node results when
            // running at the top level (not embedded). Inside a scatter body
            // or nested embedded DAG, intermediates are discarded by the caller
            // anyway, and buffering at N×M×L scale causes unbounded heap growth.
            const outcome = await this.#source.executeDAGNode(node, item.state, dagName, signal, placementPath, !runOptions.embedded);
            composite.push({ 'state': item.state, 'nextStage': outcome.nextStage, 'result': outcome.result });
          } catch (caughtError) {
            // A thrown firing fails the whole fired batch (RFC 0003 §10.2). Same
            // classification + lifecycle handling as the single-item path; the
            // representative state for telemetry is the batch's first item.
            const error = caughtError instanceof Error ? caughtError : new ExecutionError(String(caughtError));
            this.#source.relayError(currentPlacementName, error, repState, placementPath);
            let interruptedAt: InterruptionInfoType | null = null;
            if (signal?.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.#handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementName, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof NodeTimeoutError) {
              interruptedAt = { 'nodeName': currentPlacementName, 'reason': 'timeout' };
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
                try { state.markFailed(error); } catch { /* already terminal */ }
              }
            } else if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
              try { state.markFailed(error); } catch { /* already terminal */ }
            }
            const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
            await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
            return result;
          }
        }

        // Stream every item's composite intermediates, in item order, before
        // the firing's own result. The dispatch chain (executeDAGNode → the
        // NodeStateInterface-typed executors) returns NodeResultType<NodeStateInterface>;
        // entry.state is NodeStateInterface, so we use it as the state for each
        // intermediate — the parent state that flowed into executeDAGNode.
        for (const entry of composite) {
          for (const intermediate of entry.result.intermediateResults) {
            yield {
              'output': intermediate.output,
              'skipped': intermediate.skipped,
              'nodeName': intermediate.nodeName,
              'state': entry.state,
              'intermediateResults': [],
            };
          }
        }

        // Observability: one onNodeEnd + one yielded result per firing. For a
        // size-1 batch this is the single item's result, byte-identical to the
        // prior single dispatch. For a multi-item batch the representative
        // output is the one distinct output port when every item agrees, else
        // null (the items split across ports).
        const soleResult = composite.length === 1 ? composite[0]?.result : undefined;
        if (soleResult !== undefined) {
          if (soleResult.skipped) {
            skippedNodes.push(soleResult.nodeName);
          } else {
            executedNodes.push(soleResult.nodeName);
          }
          this.#source.relayNodeEnd(node.name, soleResult.output, repState, placementPath);
          yield {
            'output': soleResult.output,
            'skipped': soleResult.skipped,
            'nodeName': soleResult.nodeName,
            'state': repState,
            'intermediateResults': [],
          };
        } else {
          executedNodes.push(node.name);
          let repOutput: string | null = composite[0]?.result.output ?? null;
          for (const entry of composite) {
            if (entry.result.output !== repOutput) { repOutput = null; break; }
          }
          this.#source.relayNodeEnd(node.name, repOutput, repState, placementPath);
          yield {
            'output': repOutput,
            'skipped': false,
            'nodeName': node.name,
            'state': repState,
            'intermediateResults': [],
          };
        }

        // Route each item to the next placement its outcome selected.
        for (const entry of composite) {
          if (entry.nextStage !== null) {
            pending.add(entry.nextStage, Batch.of(entry.state));
          }
        }
      }

      // Resolve terminalOutcome and terminalNodeName from the accumulator after
      // the work-set loop drains. For size-1 batches with a single terminal this
      // is identical to the prior break-on-first behaviour. For multi-item batches
      // with multiple terminals: any 'failed' terminal makes the overall outcome
      // 'failed'; terminalNodeName is set only when all items converged on a single
      // terminal (otherwise left null for the lifecycle code below to handle).
      if (terminalAccumulator.size > 0) {
        const allSameTerminal = terminalAccumulator.size === 1;
        let overallFailed = false;
        for (const [tName, { outcome }] of terminalAccumulator) {
          if (outcome === 'failed') overallFailed = true;
          terminalNodeName = tName;
        }
        terminalOutcome = overallFailed ? 'failed' : 'completed';
        if (!allSameTerminal) {
          // Multiple terminal nodes reached — no single representative terminal.
          terminalNodeName = null;
        }
      }
    }

    if (!runOptions.embedded) {
      if (terminalOutcome === 'failed') {
        try {
          state.markFailed(new DAGError(`Flow terminated at '${executedNodes[executedNodes.length - 1] ?? '<unknown>'}' with outcome=failed`));
        } catch { /* state may already be terminal */ }
      } else {
        // terminalOutcome === 'completed'; flows always end at a TerminalNode.
        try { state.markCompleted(); } catch { /* state may already be terminal */ }
      }
      // Clear any stale work-set blob so a completed run carries no lingering
      // progress metadata. This is a no-op for size-1 runs (no blob was written)
      // and ensures a second execution of the same state instance starts clean.
      WorkSetCheckpoint.clear(state);
    }
    const result = this.#composeResult(null, executedNodes, skippedNodes, terminalOutcome, null, state);
    await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, placementPath);
    return result;
  }

  /**
   * Shared result-object constructor. Centralises the
   * `ExecutionResultType<NodeStateInterface>` shape so every exit branch in `run` returns an
   * identically-shaped object (same key order, same field set), keeping V8
   * hidden classes stable across success and error paths.
   */
  #composeResult<TReturn extends NodeStateInterface>(
    cursor: string | null,
    executedNodes: string[],
    skippedNodes: string[],
    terminalOutcome: 'completed' | 'failed' | null,
    interruptedAt: InterruptionInfoType | null,
    state: TReturn,
    parked: ParkedType | null = null,
  ): ExecutionResultType<TReturn> {
    return {
      cursor,
      executedNodes,
      skippedNodes,
      state,
      terminalOutcome,
      interruptedAt,
      parked,
    };
  }

  /**
   * Run every `phase: 'post'` placement in DAG declaration order, then fire
   * `onFlowEnd`. Suppressed when `runOptions.embedded` is true; phase placements
   * are top-level concerns owned by the consumer's `execute()` / `resume()` call.
   *
   * Errors thrown by a post-phase placement are collected as warnings on
   * `state` (code `POST_PHASE_FAILED`) and do NOT change the already-set
   * lifecycle. Each post-phase that completes successfully is appended to
   * `result.executedNodes` (the array reference shared with the result).
   */
  async #runPostPhasesAndFinalize(
    dag: DAGType,
    dagName: string,
    state: NodeStateInterface,
    result: ExecutionResultType<NodeStateInterface>,
    runOptions: RunOptionsType,
    terminalNodeName: string | null,
    placementPath: readonly string[] = [],
  ): Promise<void> {
    if (runOptions.embedded) {
      return;
    }

    const postDagContext: Record<string, unknown> = ContextResolver.contextOf(dag['@context']);

    const postPhases = dag.nodes.filter(
      (n): n is PhaseNodeType =>
        n['@type'] === 'PhaseNode' && n.phase === 'post',
    );
    for (const phase of postPhases) {
      this.#source.relayPhaseEnter(dagName, 'post', phase.name, state, placementPath);
      try {
        await this.#executePhasePlacement(phase, state, dagName, null, postDagContext);
        result.executedNodes.push(phase.name);
      } catch (err) {
        const error = err instanceof Error ? err : new ExecutionError(String(err));
        // Post-phase intentionally runs without the parent abort signal (null)
        // so lifecycle has already been set; collect as warning, not re-throw.
        this.#source.relayError(phase.name, error, state, placementPath);
        state.collectWarning({
          'code':      'POST_PHASE_FAILED',
          'message':   `post-phase '${phase.name}' threw: ${error.message}`,
          'operation': phase.name,
          'timestamp': new Date().toISOString(),
        });
      }
      this.#source.relayPhaseExit(dagName, 'post', phase.name, state, placementPath);
    }
    this.#source.relayFlowEnd(dagName, state, result);

    // Hand-off channel publish: only for non-embedded top-level runs that
    // completed at a bound terminal. The in-process (no-channels) path is
    // byte-identical: when channels is empty this block is skipped entirely.
    if (terminalNodeName !== null) {
      const channel = this.#source.channels[terminalNodeName];
      if (channel !== undefined) {
        const stateSnapshot = state.snapshot();
        const handoff: DAGHandoffType = {
          'dagName': dagName,
          'terminalName': terminalNodeName,
          'terminalOutput': result.terminalOutcome ?? 'completed',
          'registryVersion': this.#source.registryVersion,
          'correlationId': this.#source.nextCorrelationId(dagName),
          'placementPath': [...placementPath],
          'stateSnapshot': stateSnapshot,
        };
        try {
          await channel.publish(handoff);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          state.collectError({
            'code': 'HANDOFF_PUBLISH_FAILED',
            'context': {},
            'message': `Channel publish failed for terminal '${terminalNodeName}': ${error.message}`,
            'operation': terminalNodeName,
            'recoverable': false,
            'timestamp': new Date().toISOString(),
          });
          this.#source.relayError(terminalNodeName, error, state, placementPath);
        }
      }
    }
  }

  /**
   * Execute a single PhaseNode placement. Looks up the registered node by
   * `phase.node`, builds a node context, and invokes `node.execute(state, ctx)`
   * through `withNodeTimeout` so per-node timeouts apply uniformly. Errors
   * collected by the node are forwarded to `state` via `state.collectError`.
   * Throws when the registered node is not found or when the node throws /
   * times out.
   */
  async #executePhasePlacement(
    phase: PhaseNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal | null,
    dagContext: Record<string, unknown>,
  ): Promise<void> {
    const nodeIri = ContextResolver.expand(phase.node, dagContext);
    const node = this.#source.nodes.get(nodeIri);
    if (node === undefined) {
      throw new DAGError(
        `PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`,
      );
    }
    await this.#source.withNodeTimeout(node, signal, (nodeSignal) => {
      const context = this.#source.nodeContext(dagName, phase.name, nodeSignal);
      return this.#runNodeOnState(node, state, context);
    });
  }

  /**
   * Invokes a node on a single state as a size-1 batch.
   *
   * Wraps `state` in `Batch.of(state)`, calls `node.execute(batch, context)`,
   * asserts the size-1 invariant (exactly one route with exactly one item), and
   * returns the single output port key.
   *
   * The node owns error-forwarding: `ScalarNode.execute` forwards per-item
   * errors to `item.state.collectError` during `execute`. Since `Batch.of`
   * wraps the same state reference, mutations are visible after this call.
   *
   * Throws `DAGError` if the returned `RoutedBatchType` does not contain exactly
   * one route with exactly one item (invariant violation for size-1 dispatch).
   */
  async #runNodeOnState(
    node: NodeInterface<NodeStateInterface, string>,
    state: NodeStateInterface,
    context: NodeContextType,
  ): Promise<string> {
    const batch = Batch.of(state);
    const routed = await node.execute(batch, context);
    if (routed.size !== 1) {
      throw new DAGError(
        `Node '${node.name}' returned ${routed.size} routes for a size-1 batch (expected exactly 1).`,
      );
    }
    const entry = routed.entries().next().value;
    if (entry === undefined) {
      throw new DAGError(`Node '${node.name}' returned an empty RoutedBatchType for a size-1 batch.`);
    }
    const [output, resultBatch] = entry;
    if (resultBatch.size !== 1) {
      throw new DAGError(
        `Node '${node.name}' route '${output}' contains ${resultBatch.size} items for a size-1 batch (expected exactly 1).`,
      );
    }
    return output;
  }

  /**
   * Fire a SingleNode placement over a batch in the work-set scheduler.
   *
   * Stage 1 — FIRE. Calls `node.execute(batch, context)` via `withNodeTimeout`
   * and returns the firing node together with its raw `RoutedBatchType`. No
   * validation and no routing happen here; those are the two stages that follow.
   *
   * Throws `DAGError` when the placement names an unregistered node.
   */
  async #fireSinglePlacement(
    nodeConfig: SingleNodePlacementType,
    batch: Batch<NodeStateInterface>,
    dagName: string,
    signal: AbortSignal | null,
    dagContext: Record<string, unknown>,
  ): Promise<{ 'dagNode': NodeInterface<NodeStateInterface, string>; 'routed': RoutedBatchType<string, NodeStateInterface> }> {
    const nodeIri = ContextResolver.expand(nodeConfig.node, dagContext);
    const dagNode = this.#source.nodes.get(nodeIri);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const routed = await this.#source.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.#source.nodeContext(dagName, nodeConfig.name, nodeSignal);
      return dagNode.execute(batch, context);
    });

    return { 'dagNode': dagNode, 'routed': routed };
  }

  /**
   * Stage 2 — VALIDATE. Applies the node's output-schema contract to the routed
   * output via `OutputContractApplier`. Covers BOTH ScalarNode and MonadicNode
   * subclasses uniformly. Zero overhead when `validateOutputs` is off
   * (`outputSchemaValidator` is null) — returns the routed map unchanged. On a
   * violation, the offending item is re-routed to `'error'` with a collected
   * `outputContractViolation` NodeError.
   */
  #validateOutputContract(
    dagNode: NodeInterface<NodeStateInterface, string>,
    routed: RoutedBatchType<string, NodeStateInterface>,
  ): RoutedBatchType<string, NodeStateInterface> {
    return OutputContractApplier.applyToRouted(
      dagNode.name,
      dagNode.outputSchema,
      routed,
      this.#source.outputSchemaValidator,
    );
  }

  /**
   * Stage 3 — ROUTE. Pushes each output port's sub-batch into the downstream
   * node's pending work and returns a representative `NodeResultType` for the
   * firing.
   *
   * For a size-1 batch: exactly one route is produced with exactly one item, so
   * `output` equals the single port key and `state` equals the single item.
   *
   * For a multi-item batch: items may split across multiple output ports.
   * `output` is `null` (no single representative output) and `state` is the
   * representative state (`batch.row(0).state`).
   *
   * Throws `DAGError` when the placement routing map has no entry for a returned
   * output port.
   */
  #routeToPending(
    nodeConfig: SingleNodePlacementType,
    dagNode: NodeInterface<NodeStateInterface, string>,
    routed: RoutedBatchType<string, NodeStateInterface>,
    batch: Batch<NodeStateInterface>,
    pending: WorkSet<NodeStateInterface>,
  ): NodeResultType<NodeStateInterface> {
    // Add each output port's sub-batch to the downstream node's pending work.
    for (const [outputPort, subBatch] of routed.entries()) {
      const nextPlacement = nodeConfig.outputs[outputPort];
      if (nextPlacement === undefined) {
        throw new DAGError(
          `Node ${dagNode.name} returned output '${outputPort}' but node ${nodeConfig.name} has no routing for it. `
          + `Available outputs: ${Object.keys(nodeConfig.outputs).join(', ')}`,
        );
      }
      pending.add(nextPlacement, subBatch);
    }

    // For size-1 batches: exactly one route, one item → single representative output.
    // For multi-item batches: items may split → null representative output.
    const repState = batch.row(0).state;
    const output = routed.size === 1 ? (routed.keys().next().value ?? null) : null;

    return {
      output,
      'skipped': false,
      'nodeName': nodeConfig.name,
      'state': repState,
      'intermediateResults': [],
    };
  }

  /**
   * Returns true when the named placement in the given DAG is a `PhaseNode`.
   * Phase placements are out-of-band lifecycle hooks; they are never valid
   * entrypoints or resume targets for the main loop.
   */
  #isPhaseEntry(dagName: string, name: string): boolean {
    const expandedDagIri = ContextResolver.expand(dagName, {});
    const entry = this.#source.nodeIndex.get(`${expandedDagIri}:${name}`);
    return entry?.['@type'] === 'PhaseNode';
  }

  /**
   * Inspect a triggered abort and mark the lifecycle terminal accordingly.
   * Returns the error to surface on the dispatcher boundary and the
   * `InterruptionInfo.reason` discriminant ('abort' vs 'timeout') so the caller
   * can populate `ExecutionResultType.interruptedAt`.
   */
  #handleAbort(state: NodeStateInterface, signal: AbortSignal): { 'error': Error; 'reason': 'abort' | 'timeout' } {
    const reason = signal.reason;
    const isTimeout = reason instanceof Error && reason.name === 'TimeoutError';
    if (isTimeout) {
      try { state.markTimedOut(); } catch { /* lifecycle already terminal */ }
      return { 'error': reason, 'reason': 'timeout' };
    }
    const message = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : 'aborted');
    try { state.markCancelled(message); } catch { /* lifecycle already terminal */ }
    return {
      'error':  reason instanceof Error ? reason : new ExecutionError(message),
      'reason': 'abort',
    };
  }

}

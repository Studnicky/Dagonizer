import { Signal } from '@studnicky/signal';

import { GatherCheckpoint } from '../checkpoint/GatherCheckpoint.js';
import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import { WorkSetCheckpoint } from '../checkpoint/WorkSetCheckpoint.js';
import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DagContainerInterface } from '../contracts/DagContainerInterface.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { HandoffChannelInterface } from '../contracts/HandoffChannelInterface.js';
import type { NodeInterface, OutputSchemaValidatorInterface } from '../contracts/NodeInterface.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { TripleStoreInterface } from '../contracts/TripleStoreInterface.js';
import { PlacementRank } from '../core/PlacementRank.js';
import { WorkSet } from '../core/WorkSet.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import { DAGEntrypoints } from '../entities/dag/DAG.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { NO_RETRY } from '../entities/dag/SingleNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import type { ExecutionResultType, InterruptionInfoType } from '../entities/execution/ExecutionResult.js';
import type { ParkedType } from '../entities/execution/Parked.js';
import type { DAGHandoffType } from '../entities/handoff/DAGHandoff.js';
import { JsonObject } from '../entities/json.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { WorkSetProgressType } from '../entities/workset/WorkSetProgress.js';
import { DAGError } from '../errors/index.js';
import { DAGLifecycleMachine } from '../lifecycle/DAGLifecycleMachine.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { DagExecutionContext } from '../runtime/DagExecutionContext.js';
import { RetryPolicy } from '../runtime/RetryPolicy.js';
import type { StateMapper } from '../runtime/StateMapper.js';

import { DagReferenceResolver } from './DagReferenceResolver.js';
import type { Gather, GatherRouteRecordType } from './Gather.js';
import { GatherBuffers } from './GatherBuffers.js';
import { GatherRecordProjector } from './GatherRecordProjector.js';
import { OutputContractApplier } from './OutputContractApplier.js';
import { PlacementRouter } from './PlacementRouter.js';
import type { GatherRecordSinkType, RunNodeResultType, RunNodesBatchType, RunOptionsType } from './ScatterDispatch.js';

type StreamedGatherBindingType = {
  readonly target: GatherNodeType;
  readonly key: string;
  readonly routeRecords: GatherRouteRecordType[];
  readonly retainedRecords: GatherRecordType[];
  readonly sink: GatherRecordSinkType;
  initialized: boolean;
};

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
  /** Registered DAGs keyed by expanded IRI. */
  readonly dags: ReadonlyMap<string, DAGType>;
  /** Registered nodes keyed by expanded IRI. Typed at the base so heterogeneous child-node states store without casts. */
  readonly nodes: ReadonlyMap<string, NodeInterface<NodeStateInterface, string>>;
  /** Placement index keyed by canonical placement `@id`. */
  readonly nodeIndex: ReadonlyMap<string, DAGNodeType>;
  /** Child-state cloning + output mapping for the in-process embedded-DAG path. */
  readonly stateMapper: StateMapper;
  /** Per-DAG child-state factories keyed by expanded DAG IRI. Used to spawn isolated child state. */
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
  /** Egress channels keyed by terminal placement name. */
  readonly channels: Readonly<Record<string, HandoffChannelInterface>>;
  /** Registry version stamped into every `DAGHandoff` envelope. */
  readonly registryVersion: string;
  /** State path accessor — used to resolve dynamic `DagReference` paths at execution time. */
  readonly accessor: StateAccessorInterface;
  /** Runtime topology graph sink for selected embedded-DAG bindings. */
  readonly executionTopologyStore: TripleStoreInterface;
  /** Output-schema validator injected when validateOutputs is true; null otherwise. */
  readonly outputSchemaValidator: OutputSchemaValidatorInterface | null;

  /** Relay a flow-start event into the dispatcher's `onFlowStart` hook. */
  relayFlowStart(dagName: string, state: NodeStateInterface, signal: AbortSignal): void;
  /** Relay a flow-end event into the dispatcher's `onFlowEnd` hook. */
  relayFlowEnd(dagName: string, state: NodeStateInterface, result: ExecutionResultType<NodeStateInterface>, signal: AbortSignal): void;
  /** Relay a node-start event into the dispatcher's `onNodeStart` hook. */
  relayNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void;
  /** Relay a node-end event into the dispatcher's `onNodeEnd` hook. */
  relayNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void;
  /** Relay an error event into the dispatcher's `onError` hook. */
  relayError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void;
  /** Relay a phase-enter event into the dispatcher's `onPhaseEnter` hook. */
  relayPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void;
  /** Relay a phase-exit event into the dispatcher's `onPhaseExit` hook. */
  relayPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[], signal: AbortSignal): void;

  /** Dispatch a composite (`ScatterNode` / `EmbeddedDAGNode`) placement for one item. */
  executeDAGNode(
    entry: DAGNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
    gatherRecordSink?: GatherRecordSinkType | null,
  ): Promise<RunNodeResultType>;
  /** Resolve a bound container by role, or `null` to run the body in-process. */
  resolveContainer(role: string | undefined): DagContainerInterface | null;
  /** Wrap a node execute call with its per-node timeout budget. */
  withNodeTimeout<TResult>(
    node: NodeInterface<NodeStateInterface, string>,
    signal: AbortSignal,
    fn: (sig: AbortSignal) => Promise<TResult>,
  ): Promise<TResult>;
  /** Mint a monotonic correlation id for a hand-off envelope. */
  nextCorrelationId(dagName: string): string;
  /** Build a node context for a placement execution. */
  nodeContext(dagName: string, placementName: string, signal: AbortSignal): NodeContextType;
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
  readonly #gather: Gather;

  constructor(source: NodeSchedulerSourceInterface, gather: Gather) {
    this.#source = source;
    this.#gather = gather;
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
    // Composed once, up front: every relay call in this method (including the
    // unknown-DAG/unknown-node error paths below, before `dag` even resolves)
    // fires with this same signal, so `DagExecutionContext.tryGet(signal, ...)`
    // resolves from any of them. When `options.signal` is already the run's
    // fully-composed root signal (the caller stripped `deadlineMs` — see
    // `Dagonizer.execute()`), `Signal.compose` short-circuits to that identical
    // object rather than re-wrapping it, so identity survives recursive
    // (embedded/scatter) re-entry into this method.
    const signal = Signal.compose(options);
    // Runtime DAG identity is the exact registered IRI supplied by the caller.
    const dag = this.#source.dags.get(dagName);

    if (!dag) {
      // Unknown DAG: synthesize an error result without starting the
      // lifecycle. `state` may not have been touched yet, so don't mark
      // running. The cursor is null because there is no DAG to resume.
      const error = new DAGError(`Unknown DAG: ${dagName}`);
      this.#source.relayError('<unknown>', error, state, placementPath, signal);
      if (!runOptions.embedded) {
        try { state.markFailed(error); } catch { /* state may already be terminal */ }
      }
      const result: ExecutionResultType<TReturn> = {
        'cursor': null, 'executedNodes': [], 'skippedNodes': [], state, 'terminalOutcome': null,
        'interruptedAt': null, 'parked': null,
      };
      if (!runOptions.embedded) {
        this.#source.relayFlowEnd(dagName, state, result, signal);
      }
      return result;
    }

    const dagIri = dag['@id'];

    // Extract the DAG's @context prefix map for registered-node IRI expansion during execution.
    const dagContext: Record<string, unknown> = ContextResolver.contextOf(dag['@context']);

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
      this.#source.relayFlowStart(dagName, state, signal);
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
        this.#source.relayPhaseEnter(dagName, 'pre', phase.name, state, placementPath, signal);
        try {
          await this.#executePhasePlacement(phase, state, dagName, signal, dagContext);
          executedNodes.push(phase.name);
        } catch (err) {
          const error = err instanceof Error ? err : new DAGError(String(err), { 'code': 'EXECUTION_ERROR' });
          this.#source.relayError(phase.name, error, state, placementPath, signal);
          try { state.markFailed(error); } catch { /* already terminal */ }
          this.#source.relayPhaseExit(dagName, 'pre', phase.name, state, placementPath, signal);
          const result = this.#composeResult(null, executedNodes, skippedNodes, null, null, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
          return result;
        }
        this.#source.relayPhaseExit(dagName, 'pre', phase.name, state, placementPath, signal);
      }
    }

    let cursor: null | string = fromStage ?? DAGEntrypoints.primary(dag);
    let terminalOutcome: 'completed' | 'failed' | null = null;

    // Skip phase placements in the main loop; they are out-of-band and
    // never the entrypoint. If the consumer's fromStage / entrypoint happens
    // to name a phase placement, treat it as if the main loop is empty.
    if (cursor !== null && this.#isPhaseEntry(cursor)) {
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
        declIndex.set(placement['@id'], i);
      }

      const rankOf = (placementIri: string): number => rankMap.get(placementIri) ?? Number.MAX_SAFE_INTEGER;
      const declIndexOf = (placementIri: string): number => declIndex.get(placementIri) ?? Number.MAX_SAFE_INTEGER;

      const pending = new WorkSet<NodeStateInterface>();
      const gatherBuffers = new GatherBuffers();
      const scheduledGatherKeys = new Set<string>();
      const entrypointSourceByState = new WeakMap<NodeStateInterface, string>();
      const entrypointRootByState = new WeakMap<NodeStateInterface, NodeStateInterface>();
      const entrypointSourcesByPlacement = new Map<string, string[]>();
      for (const [label, placementIri] of Object.entries(dag.entrypoints)) {
        const sources = entrypointSourcesByPlacement.get(placementIri);
        const sourceIri = this.#entrypointIri(dagIri, label);
        if (sources === undefined) {
          entrypointSourcesByPlacement.set(placementIri, [sourceIri]);
        } else {
          sources.push(sourceIri);
        }
      }

      // Resume: when fromStage is provided and this is a top-level run, check
      // for a persisted work-set blob. If present, rebuild `pending` from it so
      // every in-flight item's state is restored exactly. If absent, fall through
      // to the size-1 seed below (the cursor model — byte-identical to before).
      if (fromStage !== null && !runOptions.embedded) {
        const gatherBlob = GatherCheckpoint.read(state);
        if (gatherBlob !== undefined) {
          gatherBuffers.restore(gatherBlob, state);
          GatherCheckpoint.clear(state);
        }

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
              entrypointSourceByState.set(itemState, workItem.source ?? this.#entrypointIri(dagIri, 'main'));
              entrypointRootByState.set(itemState, state);
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
          entrypointSourceByState.set(state, this.#entrypointIri(dagIri, 'main'));
          entrypointRootByState.set(state, state);
          pending.add(cursor, Batch.of(state));
        }
      } else {
        // Fresh execute (fromStage === null) or embedded: seed with the
        // provided inputBatch when supplied (batch-native embedded path),
        // otherwise seed with the single top-level state.
        if (fromStage === null && !runOptions.embedded && inputBatch === undefined) {
          const entrypointEntries = Object.entries(dag.entrypoints);
          const seededGather = this.#seedOpenIntakeGather(
            dagIri,
            entrypointEntries,
            state,
            pending,
            gatherBuffers,
            entrypointSourceByState,
            entrypointRootByState,
          );
          if (!seededGather) {
            for (const [source, placementIri] of entrypointEntries) {
              const entryState = source === 'main' ? state : state.clone();
              entrypointSourceByState.set(entryState, this.#entrypointIri(dagIri, source));
              entrypointRootByState.set(entryState, state);
              pending.add(placementIri, Batch.of(entryState, '0'));
            }
          }
        } else {
          const seedBatch = inputBatch ?? Batch.of(state);
          for (const item of seedBatch) {
            entrypointSourceByState.set(item.state, this.#entrypointIri(dagIri, 'main'));
            entrypointRootByState.set(item.state, item.state);
          }
          pending.add(cursor, seedBatch);
        }
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
        const currentPlacementIri = pending.nextReady(rankOf, declIndexOf);
        if (currentPlacementIri === null) break scheduleLoop;

        // Advance cursor to the placement about to fire, immediately after
        // picking, so the abort-check result correctly identifies the placement
        // that would have fired.
        cursor = currentPlacementIri;

        // Abort check: fires before each placement.
        if (signal.aborted) {
          const abortInfo = this.#handleAbort(state, signal);
          this.#source.relayError(currentPlacementIri, abortInfo.error, state, placementPath, signal);
          const interruptedAt: InterruptionInfoType = {
            'nodeName': currentPlacementIri,
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
                  const source = entrypointSourceByState.get(item.state);
                  items.push(source === undefined
                    ? { 'id': item.id, 'snapshot': item.state.snapshot() }
                    : { 'id': item.id, source, 'snapshot': item.state.snapshot() });
                }
                entries.push({ placement, items });
              }
              WorkSetCheckpoint.write(state, { entries });
            }
            if (gatherBuffers.isEmpty()) {
              GatherCheckpoint.clear(state);
            } else {
              GatherCheckpoint.write(state, gatherBuffers.toProgress((gatherKey) => this.#gatherTargetForBufferKey(gatherKey)?.gather));
            }
          }

          const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
          return result;
        }

        // Take the batch pending at this placement. nextReady returned this
        // name from the live #entries map, so takeExpected() is safe here.
        const batch = pending.takeExpected(currentPlacementIri);

        const node = this.#source.nodeIndex.get(currentPlacementIri);

        if (!node) {
          const error = new DAGError(`Unknown placement IRI: ${currentPlacementIri} in DAG ${dagName}`);
          this.#source.relayError(currentPlacementIri, error, state, placementPath, signal);
          if (!runOptions.embedded) {
            try { state.markFailed(error); } catch { /* already terminal */ }
          }
          const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, null, state);
          await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
          return result;
        }

        // Representative state: first item in the batch. For size-1 batches
        // this is identical to the single cursor state — byte-identical to today.
        const repState = batch.row(0).state;

        this.#source.relayNodeStart(node.name, repState, placementPath, signal);

        if (Placement.isGather(node)) {
          for (const item of batch) {
            const gatherKey = this.#gatherBufferKey(node, item.id);
            scheduledGatherKeys.delete(gatherKey);
            const ready = gatherBuffers.takeReady(node, gatherKey);
            const gatherRun = await this.#gather.runGather(node, ready.records, item.state, dagName, signal, {
              'preReduced': ready.preReduced,
              'routeRecords': ready.routeRecords,
            });
            const nextStage = node.outputs[gatherRun.output];
            if (nextStage === undefined) {
              throw new DAGError(
                `GatherNode ${node.name} produced output '${gatherRun.output}' but has no routing for it. `
                + `Available outputs: ${Object.keys(node.outputs).join(', ')}`,
              );
            }
            pending.add(nextStage, Batch.of(item.state, item.id));
            executedNodes.push(node.name);
            this.#source.relayNodeEnd(node.name, gatherRun.output, item.state, placementPath, signal);
            yield {
              'output': gatherRun.output,
              'skipped': false,
              'nodeName': node.name,
              'state': item.state,
              'intermediateResults': [],
            };
          }
          continue scheduleLoop;
        }

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
          this.#source.relayNodeEnd(terminal.name, terminal.outcome, repState, placementPath, signal);
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
              executedNodes.push(currentPlacementIri);
              // Read the correlationKey the node placed in state metadata.
              const rawKey = repState.getMetadata('correlationKey');
              const correlationKey = typeof rawKey === 'string' ? rawKey : currentPlacementIri;
              // Transition the top-level state lifecycle to awaiting-input.
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle) && !DAGLifecycleMachine.isParked(state.lifecycle)) {
                try { state.park(correlationKey); } catch { /* lifecycle guard */ }
              }
              const parkedEntity: ParkedType = {
                'correlationKey': correlationKey,
                'cursor': currentPlacementIri,
                'dagName': dagName,
              };
              this.#source.relayNodeEnd(node.name, 'parked', repState, placementPath, signal);
              const parkResult = this.#composeResult(currentPlacementIri, executedNodes, skippedNodes, null, null, state, parkedEntity);
              await this.#runPostPhasesAndFinalize(dag, dagName, state, parkResult, runOptions, terminalNodeName, signal, placementPath);
              return parkResult;
            }

            const validated = this.#validateOutputContract(fired.dagNode, fired.routed);
            nodeResult = this.#routeToPending(
              node,
              fired.dagNode,
              validated,
              batch,
              pending,
              gatherBuffers,
              entrypointSourceByState,
              entrypointRootByState,
              entrypointSourcesByPlacement,
              scheduledGatherKeys,
            );
          } catch (caughtError) {
            const error = this.#enrichError(caughtError, dagName, placementPath, signal);
            this.#source.relayError(currentPlacementIri, error, repState, placementPath, signal);
            let interruptedAt: InterruptionInfoType | null = null;
            if (signal.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.#handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementIri, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementIri, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof DAGError && error.code === 'NODE_TIMEOUT') {
              interruptedAt = { 'nodeName': currentPlacementIri, 'reason': 'timeout' };
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
                try { state.markFailed(error); } catch { /* already terminal */ }
              }
            } else if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
              try { state.markFailed(error); } catch { /* already terminal */ }
            }
            const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
            await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
            return result;
          }

          executedNodes.push(nodeResult.nodeName);
          this.#source.relayNodeEnd(node.name, nodeResult.output, repState, placementPath, signal);
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

          const intermediateResults: Array<NodeResultType<NodeStateInterface>> = [];
          const routeOutputByItemId = new Map<string, string>();
          let invalidSelectionCount = 0;

          const partitionByDag = new Map<string, Array<{
            readonly parentItem: { readonly id: string; readonly state: NodeStateInterface };
            readonly childItem: { readonly id: string; readonly state: NodeStateInterface };
          }>>();

          for (const item of parentItems) {
            const childDagIri = node.dag !== undefined
              ? DagReferenceResolver.resolve({
                'reference': node.dag,
                'source': 'state',
                'value': item.state,
                'context': dagContext,
                'dags': this.#source.dags,
                'accessor': this.#source.accessor,
              })
              : null;
            if (childDagIri === null) {
              invalidSelectionCount += 1;
              const routeOutput = 'error';
              routeOutputByItemId.set(item.id, routeOutput);
              const nextPlacement = node.outputs[routeOutput] ?? null;
              if (nextPlacement !== null) {
                const gatherTarget = this.#gatherTarget(nextPlacement);
                if (gatherTarget !== undefined) {
                  const source = this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, item.state, node['@id'], gatherTarget);
                  const gatherKey = this.#gatherBufferKey(gatherTarget, item.id);
                  gatherBuffers.add(gatherKey, {
                    source,
                    'index': null,
                    'item': undefined,
                    'output': routeOutput,
                    'terminalOutcome': null,
                    'result': this.#projectGatherResult(gatherTarget, source, item.state),
                    'cloneState': item.state,
                  });
                  this.#scheduleGatherIfReady(gatherBuffers, gatherTarget, gatherKey, pending, this.#gatherStateFor(item.state, entrypointRootByState), item.id, scheduledGatherKeys);
                } else {
                  pending.add(nextPlacement, Batch.of(item.state, item.id));
                }
              }
              continue;
            }

            const childFactory = this.#source.stateFactories.get(childDagIri);
            const childClone: NodeStateInterface = childFactory !== undefined
              ? this.#source.stateMapper.spawnChild(item.state, inputMapping, childFactory)
              : this.#source.stateMapper.cloneChild(item.state, inputMapping);
            const entries = partitionByDag.get(childDagIri);
            const partitionEntry = {
              'parentItem': item,
              'childItem':  { 'id': item.id, 'state': childClone },
            };
            if (entries !== undefined) {
              entries.push(partitionEntry);
            } else {
              partitionByDag.set(childDagIri, [partitionEntry]);
            }
          }

          const ownerPlacementIri = node['@id'];
          const itemScopedSelectedDag = invalidSelectionCount > 0 || partitionByDag.size > 1;
          for (const [childDagIri, partition] of partitionByDag) {
            if (itemScopedSelectedDag) {
              for (const entry of partition) {
                DagReferenceResolver.bindSelectedDag({
                  'store': this.#source.executionTopologyStore,
                  'ownerPlacementIri': `${ownerPlacementIri}/item/${encodeURIComponent(entry.parentItem.id)}`,
                  'selectedDagIri': childDagIri,
                });
              }
            } else {
              DagReferenceResolver.bindSelectedDag({
                'store': this.#source.executionTopologyStore,
                'ownerPlacementIri': ownerPlacementIri,
                'selectedDagIri': childDagIri,
              });
            }

            const childItems = partition.map((entry) => entry.childItem);
            const childBatch = Batch.from(childItems);

            // Per-item terminal outcome map: populated by the child runNodes when
            // each item reaches a TerminalNode. Maps item.id → terminal outcome.
            const childTerminalByItemId = new Map<string, 'completed' | 'failed'>();

            // Run each selected child DAG once for its partition. This preserves
            // batch efficiency without collapsing heterogeneous dynamic choices.
            const childRepState = partition[0]?.parentItem.state.clone() ?? repState.clone();
            const childOptions: ExecuteOptionsType = { 'signal': signal };
            const iter = this.run(childDagIri, childRepState, null, childOptions, { 'embedded': true }, innerPath, { 'inputBatch': childBatch, 'terminalByItemId': childTerminalByItemId });

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
            for (const entry of partition) {
              const { parentItem, childItem } = entry;
              const childClone = childItem.state;

              // Propagate errors and warnings from child clone to parent.
              for (const err of childClone.errors) parentItem.state.collectError(err);
              for (const warn of childClone.warnings) parentItem.state.collectWarning(warn);

              // Apply output state mapping: child → parent.
              this.#source.stateMapper.mapOutput(childClone, parentItem.state, outputMapping);

              // Determine route from per-item terminal outcome + unrecoverable errors,
              // through the single shared route policy: an explicit `completed`
              // terminal is authoritative and is never flipped to `error` by an
              // error the inner flow already tolerated (a scatter clone absorbed by
              // an `any-success` reducer). childTerminalByItemId is populated by run
              // when each item hits a TerminalNode, giving accurate per-item
              // failed/completed status.
              const childTerminalOutcome = childTerminalByItemId.get(parentItem.id) ?? 'completed';
              const hasUnrecoverable = childClone.errors.some((e) => e.recoverable === false);
              const routeOutput = PlacementRouter.route(childTerminalOutcome, hasUnrecoverable);
              routeOutputByItemId.set(parentItem.id, routeOutput);
              const nextPlacement = node.outputs[routeOutput] ?? null;

              if (nextPlacement !== null) {
                const gatherTarget = this.#gatherTarget(nextPlacement);
                if (gatherTarget !== undefined) {
                  const source = this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, parentItem.state, node['@id'], gatherTarget);
                  const resultField = this.#gatherResultField(gatherTarget, source);
                  const gatherKey = this.#gatherBufferKey(gatherTarget, parentItem.id);
                  gatherBuffers.add(gatherKey, GatherRecordProjector.project({
                    source,
                    'output': routeOutput,
                    'terminalOutcome': childTerminalOutcome,
                    'state': childClone,
                    'accessor': this.#source.accessor,
                    ...(resultField !== undefined
                      ? { resultField }
                      : {}),
                  }));
                  this.#scheduleGatherIfReady(gatherBuffers, gatherTarget, gatherKey, pending, this.#gatherStateFor(parentItem.state, entrypointRootByState), parentItem.id, scheduledGatherKeys);
                } else {
                  pending.add(nextPlacement, Batch.of(parentItem.state, parentItem.id));
                }
              }
            }
          }

          // Representative observability output for the batch firing.
          // Unanimous when all items routed to the same port, else null.
          let repOutput: string | null = null;
          let allSameOutput = true;
          for (const item of parentItems) {
            const output = routeOutputByItemId.get(item.id) ?? null;
            if (output === null) continue;
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
          this.#source.relayNodeEnd(node.name, repOutput, repState, placementPath, signal);
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
        const composite: Array<{
          readonly itemId: string;
          readonly state: NodeStateInterface;
          readonly nextStage: string | null;
          readonly result: NodeResultType<NodeStateInterface>;
          readonly gatherRecords?: readonly GatherRecordType[];
          readonly streamedGather?: StreamedGatherBindingType;
        }> = [];
        for (const item of batch) {
          try {
            // bufferIntermediates: only accumulate inner-node results when
            // running at the top level (not embedded). Inside a scatter body
            // or nested embedded DAG, intermediates are discarded by the caller
            // anyway, and buffering at N×M×L scale causes unbounded heap growth.
            const streamedGather = Placement.isScatter(node)
              ? this.#scatterGatherBinding(node, item.id, item.state, this.#gatherStateFor(item.state, entrypointRootByState), entrypointSourceByState, entrypointSourcesByPlacement)
              : null;
            const gatherRecordSink = streamedGather?.sink ?? null;
            const outcome = await this.#source.executeDAGNode(node, item.state, dagName, signal, placementPath, !runOptions.embedded, gatherRecordSink);
            const entry = {
              'itemId': item.id,
              'state': item.state,
              'nextStage': outcome.nextStage,
              'result': outcome.result,
              ...(outcome.gatherRecords === undefined ? {} : { 'gatherRecords': outcome.gatherRecords }),
              ...(streamedGather === null ? {} : { streamedGather }),
            };
            composite.push(entry);
          } catch (caughtError) {
            // A thrown firing fails the whole fired batch (RFC 0003 §10.2). Same
            // classification + lifecycle handling as the single-item path; the
            // representative state for telemetry is the batch's first item.
            const error = this.#enrichError(caughtError, dagName, placementPath, signal);
            this.#source.relayError(currentPlacementIri, error, repState, placementPath, signal);
            let interruptedAt: InterruptionInfoType | null = null;
            if (signal.aborted) {
              if (!runOptions.embedded) {
                const abortInfo = this.#handleAbort(state, signal);
                interruptedAt = { 'nodeName': currentPlacementIri, 'reason': abortInfo.reason };
              } else {
                const isTimeout = signal.reason instanceof Error && signal.reason.name === 'TimeoutError';
                interruptedAt = { 'nodeName': currentPlacementIri, 'reason': isTimeout ? 'timeout' : 'abort' };
              }
            } else if (error instanceof DAGError && error.code === 'NODE_TIMEOUT') {
              interruptedAt = { 'nodeName': currentPlacementIri, 'reason': 'timeout' };
              if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
                try { state.markFailed(error); } catch { /* already terminal */ }
              }
            } else if (!runOptions.embedded && !DAGLifecycleMachine.isTerminal(state.lifecycle)) {
              try { state.markFailed(error); } catch { /* already terminal */ }
            }
            const result = this.#composeResult(cursor, executedNodes, skippedNodes, terminalOutcome, interruptedAt, state);
            await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
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
          this.#source.relayNodeEnd(node.name, soleResult.output, repState, placementPath, signal);
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
          this.#source.relayNodeEnd(node.name, repOutput, repState, placementPath, signal);
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
            const gatherTarget = this.#gatherTarget(entry.nextStage);
            if (gatherTarget !== undefined) {
              if (entry.streamedGather !== undefined && entry.streamedGather.target['@id'] === gatherTarget['@id']) {
                const gatherRun = entry.streamedGather.initialized
                  ? await this.#gather.runGather(gatherTarget, entry.streamedGather.retainedRecords, entry.state, dagName, signal, {
                    'preReduced': true,
                    'routeRecords': entry.streamedGather.routeRecords,
                  })
                  : await this.#gather.runGather(gatherTarget, [], entry.state, dagName, signal);
                const nextStage = gatherTarget.outputs[gatherRun.output];
                if (nextStage === undefined) {
                  throw new DAGError(
                    `GatherNode ${gatherTarget.name} produced output '${gatherRun.output}' but has no routing for it. `
                    + `Available outputs: ${Object.keys(gatherTarget.outputs).join(', ')}`,
                  );
                }
                pending.add(nextStage, Batch.of(entry.state, entry.itemId));
                executedNodes.push(gatherTarget.name);
                this.#source.relayNodeEnd(gatherTarget.name, gatherRun.output, entry.state, placementPath, signal);
                yield {
                  'output': gatherRun.output,
                  'skipped': false,
                  'nodeName': gatherTarget.name,
                  'state': entry.state,
                  'intermediateResults': [],
                };
                continue;
              }
              const records = entry.gatherRecords !== undefined
                ? entry.gatherRecords.map((gatherRecord) => {
                  const source = this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, entry.state, node['@id'], gatherTarget);
                  return {
                    ...gatherRecord,
                    source,
                    'result': this.#projectGatherResult(gatherTarget, source, gatherRecord.cloneState),
                  };
                })
                : [
                  this.#recordFromComposite(
                    this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, entry.state, node['@id'], gatherTarget),
                    gatherTarget,
                    entry,
                  ),
                ];
              const gatherKey = this.#gatherBufferKey(gatherTarget, entry.itemId);
              for (const record of records) gatherBuffers.add(gatherKey, record);
              this.#scheduleGatherIfReady(gatherBuffers, gatherTarget, gatherKey, pending, this.#gatherStateFor(entry.state, entrypointRootByState), entry.itemId, scheduledGatherKeys);
            } else {
              pending.add(entry.nextStage, Batch.of(entry.state, entry.itemId));
            }
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
      GatherCheckpoint.clear(state);
    }
    const result = this.#composeResult(null, executedNodes, skippedNodes, terminalOutcome, null, state);
    await this.#runPostPhasesAndFinalize(dag, dagName, state, result, runOptions, terminalNodeName, signal, placementPath);
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
    signal: AbortSignal,
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
      this.#source.relayPhaseEnter(dagName, 'post', phase.name, state, placementPath, signal);
      try {
        await this.#executePhasePlacement(phase, state, dagName, Signal.never(), postDagContext);
        result.executedNodes.push(phase.name);
      } catch (err) {
        const error = err instanceof Error ? err : new DAGError(String(err), { 'code': 'EXECUTION_ERROR' });
        // Post-phase intentionally runs without the parent abort signal —
        // `Signal.never()` models "deliberately unguarded" here, since
        // lifecycle has already been set; collect as warning, not re-throw.
        this.#source.relayError(phase.name, error, state, placementPath, signal);
        state.collectWarning({
          'code':      'POST_PHASE_FAILED',
          'message':   `post-phase '${phase.name}' threw: ${error.message}`,
          'operation': phase.name,
          'timestamp': new Date().toISOString(),
        });
      }
      this.#source.relayPhaseExit(dagName, 'post', phase.name, state, placementPath, signal);
    }
    this.#source.relayFlowEnd(dagName, state, result, signal);

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
          this.#source.relayError(terminalNodeName, error, state, placementPath, signal);
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
    signal: AbortSignal,
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
   * The node owns error-forwarding during `execute`. Since `Batch.of` wraps
   * the same state reference, mutations are visible after this call.
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
   * Throws `DAGError` when the placement references an unregistered node IRI.
   */
  async #fireSinglePlacement(
    nodeConfig: SingleNodePlacementType,
    batch: Batch<NodeStateInterface>,
    dagName: string,
    signal: AbortSignal,
    dagContext: Record<string, unknown>,
  ): Promise<{ 'dagNode': NodeInterface<NodeStateInterface, string>; 'routed': RoutedBatchType<string, NodeStateInterface> }> {
    const nodeIri = ContextResolver.expand(nodeConfig.node, dagContext);
    const dagNode = this.#source.nodes.get(nodeIri);

    if (!dagNode) {
      throw new DAGError(`Unknown node: ${nodeConfig.node}`);
    }

    const routed = await this.#source.withNodeTimeout(dagNode, signal, (nodeSignal) => {
      const context = this.#source.nodeContext(dagName, nodeConfig.name, nodeSignal);
      return RetryPolicy.from(nodeConfig.retry ?? NO_RETRY).run(
        () => dagNode.execute(batch, context),
        { 'signal': nodeSignal },
      );
    });

    return { 'dagNode': dagNode, 'routed': routed };
  }

  /**
   * Stage 2 — VALIDATE. Applies the node's output-schema contract to the routed
   * output via `OutputContractApplier`. Covers all `MonadicNode` subclasses
   * uniformly. Zero overhead when `validateOutputs` is off
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
    gatherBuffers: GatherBuffers,
    entrypointSourceByState: WeakMap<NodeStateInterface, string>,
    entrypointRootByState: WeakMap<NodeStateInterface, NodeStateInterface>,
    entrypointSourcesByPlacement: ReadonlyMap<string, readonly string[]>,
    scheduledGatherKeys: Set<string>,
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
      const gatherTarget = this.#gatherTarget(nextPlacement);
      if (gatherTarget !== undefined) {
        for (const item of subBatch) {
          const source = this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, item.state, nodeConfig['@id'], gatherTarget);
          const resultField = this.#gatherResultField(gatherTarget, source);
          const gatherKey = this.#gatherBufferKey(gatherTarget, item.id);
          gatherBuffers.add(gatherKey, GatherRecordProjector.project({
            source,
            'output': outputPort,
            'terminalOutcome': null,
            'state': item.state,
            'accessor': this.#source.accessor,
            ...(resultField !== undefined
              ? { resultField }
              : {}),
          }));
        }
        for (const item of subBatch) {
          const gatherKey = this.#gatherBufferKey(gatherTarget, item.id);
          this.#scheduleGatherIfReady(gatherBuffers, gatherTarget, gatherKey, pending, this.#gatherStateFor(item.state, entrypointRootByState), item.id, scheduledGatherKeys);
        }
      } else {
        pending.add(nextPlacement, subBatch);
      }
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

  #seedOpenIntakeGather(
    dagIri: string,
    entrypoints: readonly (readonly [string, string])[],
    state: NodeStateInterface,
    pending: WorkSet<NodeStateInterface>,
    gatherBuffers: GatherBuffers,
    entrypointSourceByState: WeakMap<NodeStateInterface, string>,
    entrypointRootByState: WeakMap<NodeStateInterface, NodeStateInterface>,
  ): boolean {
    const firstEntrypoint = entrypoints[0];
    if (firstEntrypoint === undefined) return false;

    const gatherTarget = this.#gatherTarget(firstEntrypoint[1]);
    if (gatherTarget === undefined) return false;
    if (!entrypoints.every((entrypoint) => entrypoint[1] === gatherTarget['@id'])) return false;

    for (const [source] of entrypoints) {
      const entryState = source === 'main' ? state : state.clone();
      entrypointSourceByState.set(entryState, this.#entrypointIri(dagIri, source));
      entrypointRootByState.set(entryState, state);
      const gatherKey = this.#gatherBufferKey(gatherTarget, '0');
      const sourceIri = this.#entrypointIri(dagIri, source);
      gatherBuffers.add(gatherKey, {
        'source': sourceIri,
        'index': null,
        'item': undefined,
        'output': 'success',
        'terminalOutcome': null,
        'result': this.#projectGatherResult(gatherTarget, sourceIri, entryState),
        'cloneState': entryState,
      });
    }

    const gatherKey = this.#gatherBufferKey(gatherTarget, '0');
    if (gatherBuffers.ready(gatherTarget, gatherKey)) {
      pending.add(gatherTarget['@id'], Batch.of(state));
    }
    return true;
  }

  #gatherStateFor(
    state: NodeStateInterface,
    entrypointRootByState: WeakMap<NodeStateInterface, NodeStateInterface>,
  ): NodeStateInterface {
    return entrypointRootByState.get(state) ?? state;
  }

  #scheduleGatherIfReady(
    gatherBuffers: GatherBuffers,
    gatherTarget: GatherNodeType,
    gatherKey: string,
    pending: WorkSet<NodeStateInterface>,
    state: NodeStateInterface,
    itemId: string,
    scheduledGatherKeys: Set<string>,
  ): void {
    if (scheduledGatherKeys.has(gatherKey)) return;
    if (!gatherBuffers.ready(gatherTarget, gatherKey)) return;
    scheduledGatherKeys.add(gatherKey);
    pending.add(gatherTarget['@id'], Batch.of(state, itemId));
  }

  #gatherTarget(placementIri: string): GatherNodeType | undefined {
    const target = this.#source.nodeIndex.get(placementIri);
    return target !== undefined && Placement.isGather(target) ? target : undefined;
  }

  #gatherTargetForBufferKey(gatherKey: string): GatherNodeType | undefined {
    for (const node of this.#source.nodeIndex.values()) {
      if (!Placement.isGather(node)) continue;
      if (gatherKey.startsWith(`${node['@id']}/execution/`)) {
        return node;
      }
    }
    return undefined;
  }

  #gatherBufferKey(gatherTarget: GatherNodeType, scope: string): string {
    return `${gatherTarget['@id']}/execution/${encodeURIComponent(scope)}`;
  }

  #scatterGatherBinding(
    scatter: Extract<DAGNodeType, { '@type': 'ScatterNode' }>,
    itemId: string,
    parentState: NodeStateInterface,
    gatherState: NodeStateInterface,
    entrypointSourceByState: WeakMap<NodeStateInterface, string>,
    entrypointSourcesByPlacement: ReadonlyMap<string, readonly string[]>,
  ): StreamedGatherBindingType | null {
    const gatherTargets = new Map<string, GatherNodeType>();
    for (const [output, targetIri] of Object.entries(scatter.outputs)) {
      if (targetIri === null) continue;
      const gatherTarget = this.#gatherTarget(targetIri);
      if (gatherTarget !== undefined) {
        gatherTargets.set(gatherTarget['@id'], gatherTarget);
        continue;
      }
      if (output !== 'empty') return null;
    }
    if (gatherTargets.size !== 1) return null;

    const target = gatherTargets.values().next().value;
    if (target === undefined) return null;

    const source = this.#branchProducerSource(entrypointSourceByState, entrypointSourcesByPlacement, parentState, scatter['@id'], target);
    if (Object.keys(target.sources).length !== 1) return null;
    const key = this.#gatherBufferKey(target, itemId);
    const routeRecords: GatherRouteRecordType[] = [];
    const retainedRecords: GatherRecordType[] = [];
    const retainRecord = this.#gather.retainsRecordsForFinalize(target);

    const storedProgress = ScatterCheckpoint.read(parentState, scatter['@id']);
    const initialized = storedProgress?.mode === 'bounded'
      ? storedProgress.watermark + storedProgress.aheadAcked.length > 0
      : (storedProgress?.ackedResults.length ?? 0) > 0;

    let binding: StreamedGatherBindingType;
    const sink: GatherRecordSinkType = async (record) => {
      const projected: GatherRecordType = {
        ...record,
        source,
        'result': this.#projectGatherResult(target, source, record.cloneState),
      };
      if (!binding.initialized) {
        this.#gather.initialGather(target, gatherState);
        binding.initialized = true;
      }
      await this.#gather.reduceGather(target, [projected], gatherState);
      routeRecords.push(projected);
      if (retainRecord) {
        retainedRecords.push(projected);
      }
    };

    binding = {
      target,
      key,
      routeRecords,
      retainedRecords,
      sink,
      initialized,
    };
    return binding;
  }

  #recordFromComposite(
    source: string,
    gatherTarget: GatherNodeType,
    entry: { readonly state: NodeStateInterface; readonly result: NodeResultType<NodeStateInterface> },
  ): GatherRecordType {
    return {
      source,
      'index': null,
      'item': undefined,
      'output': entry.result.output ?? 'error',
      'terminalOutcome': null,
      'result': this.#projectGatherResult(gatherTarget, source, entry.state),
      'cloneState': entry.state,
    };
  }

  #branchProducerSource(
    entrypointSourceByState: WeakMap<NodeStateInterface, string>,
    entrypointSourcesByPlacement: ReadonlyMap<string, readonly string[]>,
    state: NodeStateInterface,
    producerIri: string,
    gatherTarget: GatherNodeType,
  ): string {
    const source = entrypointSourceByState.get(state);
    if (source !== undefined && source in gatherTarget.sources) return source;
    const declaredEntrypointSources = (entrypointSourcesByPlacement.get(producerIri) ?? [])
      .filter((entrypointSource) => entrypointSource in gatherTarget.sources);
    if (declaredEntrypointSources.length === 1) {
      const declared = declaredEntrypointSources[0];
      if (declared !== undefined) return declared;
    }
    if (declaredEntrypointSources.length > 1) {
      throw new DAGError(
        `GatherNode '${gatherTarget.name}' declares multiple entrypoint sources for producer '${producerIri}'.`,
      );
    }
    if (producerIri in gatherTarget.sources) return producerIri;
    throw new DAGError(
      `GatherNode '${gatherTarget.name}' does not declare routed source '${producerIri}'.`,
    );
  }

  #gatherResultField(gatherTarget: GatherNodeType, source: string): string | undefined {
    return gatherTarget.sources[source]?.resultField;
  }

  #projectGatherResult(
    gatherTarget: GatherNodeType,
    source: string,
    state: NodeStateInterface,
  ): unknown {
    const resultField = this.#gatherResultField(gatherTarget, source);
    return resultField === undefined ? undefined : this.#source.accessor.get(state, resultField);
  }

  /**
   * Returns true when the placement IRI points at a `PhaseNode`.
   * Phase placements are out-of-band lifecycle hooks; they are never valid
   * entrypoints or resume targets for the main loop.
   */
  #isPhaseEntry(placementIri: string): boolean {
    const entry = this.#source.nodeIndex.get(placementIri);
    return entry?.['@type'] === 'PhaseNode';
  }

  #entrypointIri(dagIri: string, label: string): string {
    return `${dagIri}/entrypoint/${encodeURIComponent(label)}`;
  }

  /**
   * Normalise a caught node-firing error into a `DAGError` whose `context`
   * carries `dagName`, `placementPath`, and (when available) the run's
   * correlation id — read via `DagExecutionContext.correlationIdOf(signal)`.
   *
   * `DAGError.context` is set once at construction and is not writable after
   * (`readonly context`), so enrichment always constructs a NEW `DAGError`
   * rather than mutating the coerced error's own context in place. The
   * coerced error is attached as `cause`, preserving the original stack and
   * message via the cause chain; `code`/`retryable` are carried forward from
   * the coerced error when it is already a `DAGError` (e.g. `NODE_TIMEOUT`),
   * and any context it already carried is merged underneath the enrichment.
   */
  #enrichError(caughtError: unknown, dagName: string, placementPath: readonly string[], signal: AbortSignal): DAGError {
    const coerced = DAGError.coerce(caughtError);
    const baseContext = coerced instanceof DAGError ? coerced.context : {};
    const correlationId = DagExecutionContext.correlationIdOf(signal);
    const context: Record<string, unknown> = {
      ...baseContext,
      dagName,
      'placementPath': [...placementPath],
    };
    if (correlationId !== undefined) context['correlationId'] = correlationId;
    return new DAGError(coerced.message, {
      'code':      coerced instanceof DAGError ? coerced.code : 'EXECUTION_ERROR',
      context,
      'cause':     coerced,
      'retryable': coerced instanceof DAGError ? coerced.retryable : false,
    });
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
      'error':  reason instanceof Error ? reason : new DAGError(message, { 'code': 'EXECUTION_ERROR' }),
      'reason': 'abort',
    };
  }

}

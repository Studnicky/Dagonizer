import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { GatherRecordType } from '../contracts/GatherExecution.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { BodyExecutor } from './BodyExecutor.js';
import { DagReferenceResolver } from './DagReferenceResolver.js';
import { PlacementRouter } from './PlacementRouter.js';
import type { RunNodeResultType } from './ScatterDispatch.js';

/**
 * Dispatcher surface `EmbeddedDagExecutor` needs to execute an
 * `EmbeddedDAGNode` placement. `Dagonizer` satisfies this type so
 * `EmbeddedDagExecutor` depends only on a narrow port. Declared as a `type`
 * (not `interface`): the port exposes a single readonly collaborator field and
 * no methods, which the `noocodec/interface-must-be-contract` rule requires be
 * a `type` rather than an `interface`.
 */
export type EmbeddedDagExecutorSourceType = {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
    mapOutput(childState: NodeStateInterface, parentState: NodeStateInterface, output: Record<string, string>): void;
  };
  /** State path accessor — used to resolve dynamic `DagReference` paths at execution time. */
  readonly accessor: StateAccessorInterface;
  /** Registered DAGs — used to validate that a resolved DAG reference is registered. */
  readonly dags: ReadonlyMap<string, DAGType>;
  /** Per-DAG child-state factories — used to spawn isolated child state when registered. */
  readonly stateFactories: ReadonlyMap<string, ChildStateFactoryType>;
};

/**
 * `EmbeddedDAGNode` placement executor.
 *
 * Extracts `executeEmbeddedDAG` from `Dagonizer` into a focused domain module.
 * Depends on `EmbeddedDagExecutorSourceType` (state mapper) and the shared
 * `BodyExecutor` primitive (in-process vs. container branch, error collection,
 * intermediate buffering).
 *
 * Embedded DAG is cardinality-1 (not inbox-backed), so an infrastructure
 * failure does NOT throw — the body executor collects the transport error into
 * the clone; `PlacementRouter.assemble` routes the collected unrecoverable
 * error to the placement's `'error'` output. `body.infrastructureError` is
 * intentionally ignored here (no re-queue).
 */
export class EmbeddedDagExecutor {
  readonly #source: EmbeddedDagExecutorSourceType;
  readonly #bodyExecutor: BodyExecutor;

  constructor(
    source: EmbeddedDagExecutorSourceType,
    bodyExecutor: BodyExecutor,
  ) {
    this.#source = source;
    this.#bodyExecutor = bodyExecutor;
  }

  #withGatherRecord(
    placement: EmbeddedDAGNodeType,
    run: RunNodeResultType,
    cloneState: NodeStateInterface,
    terminalOutcome: 'completed' | 'failed' | null,
  ): RunNodeResultType {
    if (placement.gatherResult === undefined) return run;
    const output = run.result.output ?? 'error';
    const gatherRecord: GatherRecordType = {
      'source': placement.name,
      'index': null,
      'item': undefined,
      output,
      terminalOutcome,
      'result': this.#source.accessor.get(cloneState, placement.gatherResult.resultField),
      cloneState,
    };
    return { ...run, gatherRecord };
  }

  async executeEmbeddedDAG(
    placement: EmbeddedDAGNodeType,
    state: NodeStateInterface,
    parentDagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
    bufferIntermediates: boolean = true,
  ): Promise<RunNodeResultType> {
    const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(placement);
    const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(placement);

    const parentDag = this.#source.dags.get(ContextResolver.expand(parentDagName, {}));
    const parentContext = parentDag !== undefined ? ContextResolver.contextOf(parentDag['@context']) : {};
    const dagIri = placement.dag !== undefined
      ? DagReferenceResolver.resolve({
        'reference': placement.dag,
        'source': 'state',
        'value': state,
        'context': parentContext,
        'dags': this.#source.dags,
        'accessor': this.#source.accessor,
      })
      : null;

    // Produce the child state. Use the DAG's isolation factory when the
    // resolver returns a registered DAG IRI; invalid selections route to error
    // without touching the child state meaningfully.
    const factory = dagIri !== null ? this.#source.stateFactories.get(dagIri) : undefined;
    const cloneState = factory !== undefined
      ? this.#source.stateMapper.spawnChild(state, inputMapping, factory)
      : this.#source.stateMapper.cloneChild(state, inputMapping);

    if (dagIri === null) {
      return this.#withGatherRecord(placement, PlacementRouter.assemble(
        placement.name,
        placement.outputs,
        null,
        cloneState,
        state,
        outputMapping,
        [],
        this.#source.stateMapper,
      ), cloneState, null);
    }

    // Run the sub-DAG body in-process or through a bound container. The
    // in-process-vs-container branch, the bufferIntermediates O(N*M*L) guard,
    // and the container error/snapshot collection all live in BodyExecutor.
    const body = await this.#bodyExecutor.run(
      dagIri,
      placement.name,
      cloneState,
      state,
      placement.container,
      signal,
      placementPath,
      bufferIntermediates,
    );

    // Propagate child→parent errors/warnings, apply output-state mapping, derive
    // the route token, resolve the next stage, and assemble the envelope.
    return this.#withGatherRecord(placement, PlacementRouter.assemble(
      placement.name,
      placement.outputs,
      body.terminalOutcome,
      cloneState,
      state,
      outputMapping,
      body.intermediates,
      this.#source.stateMapper,
    ), cloneState, body.terminalOutcome);
  }
}

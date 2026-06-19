import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { StateMapper } from '../runtime/StateMapper.js';

import type { BodyExecutor } from './BodyExecutor.js';
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
export type EmbeddedDagExecutorSourceType<TState extends NodeStateInterface> = {
  readonly stateMapper: StateMapper<TState>;
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
export class EmbeddedDagExecutor<TState extends NodeStateInterface, TServices> {
  readonly #source: EmbeddedDagExecutorSourceType<TState>;
  readonly #bodyExecutor: BodyExecutor<TState, TServices>;

  constructor(
    source: EmbeddedDagExecutorSourceType<TState>,
    bodyExecutor: BodyExecutor<TState, TServices>,
  ) {
    this.#source = source;
    this.#bodyExecutor = bodyExecutor;
  }

  async executeEmbeddedDAG(
    placement: EmbeddedDAGNodeType,
    state: TState,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean = true,
  ): Promise<RunNodeResultType<TState>> {
    const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(placement);
    const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(placement);
    const cloneState = this.#source.stateMapper.cloneChild(state, inputMapping);

    // Run the sub-DAG body in-process or through a bound container. The
    // in-process-vs-container branch, the bufferIntermediates O(N*M*L) guard,
    // and the container error/snapshot collection all live in BodyExecutor.
    const body = await this.#bodyExecutor.run(
      placement.dag,
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
    return PlacementRouter.assemble(
      placement.name,
      placement.outputs,
      body.terminalOutcome,
      cloneState,
      state,
      outputMapping,
      body.intermediates,
      this.#source.stateMapper,
    );
  }
}

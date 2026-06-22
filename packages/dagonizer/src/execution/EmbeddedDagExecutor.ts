import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

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
export type EmbeddedDagExecutorSourceType = {
  readonly stateMapper: {
    cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface;
    spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface;
    mapOutput(childState: NodeStateInterface, parentState: NodeStateInterface, output: Record<string, string>): void;
  };
  /** State path accessor — used to resolve `dagFrom` paths at execution time. */
  readonly accessor: StateAccessorInterface;
  /** Registered DAGs — used to validate that a `dagFrom`-resolved name is registered. */
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

  async executeEmbeddedDAG(
    placement: EmbeddedDAGNodeType,
    state: NodeStateInterface,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean = true,
  ): Promise<RunNodeResultType> {
    const inputMapping = EmbeddedDAGNodeDefaults.inputMapping(placement);
    const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(placement);

    // Resolve the sub-DAG name: `dag` is a build-time literal; `dagFrom` is
    // resolved from state at execution time. A null result means the path did
    // not resolve to a string — route to the error output via a null body run.
    const dagName = EmbeddedDAGNodeDefaults.resolveDagName(placement, state, this.#source.accessor);

    // Produce the child state. Use the DAG's isolation factory when registered,
    // otherwise fall back to cloneChild (clone-parent semantics). The factory
    // lookup uses the resolved dagName; if dagName is null the assembly below
    // routes to error without touching the child state meaningfully.
    const factory = dagName !== null ? this.#source.stateFactories.get(dagName) : undefined;
    const cloneState = factory !== undefined
      ? this.#source.stateMapper.spawnChild(state, inputMapping, factory)
      : this.#source.stateMapper.cloneChild(state, inputMapping);

    if (dagName === null) {
      return PlacementRouter.assemble(
        placement.name,
        placement.outputs,
        null,
        cloneState,
        state,
        outputMapping,
        [],
        this.#source.stateMapper,
      );
    }

    // Validate that the resolved dag name is registered. An unregistered name
    // means the runtime path resolved to a string that does not correspond to
    // any known DAG — route to error without throwing.
    // dags is IRI-keyed: expand the bare/short dagName to its registry key.
    const dagIri = ContextResolver.expand(dagName, {});
    if (!this.#source.dags.has(dagIri)) {
      return PlacementRouter.assemble(
        placement.name,
        placement.outputs,
        null,
        cloneState,
        state,
        outputMapping,
        [],
        this.#source.stateMapper,
      );
    }

    // Run the sub-DAG body in-process or through a bound container. The
    // in-process-vs-container branch, the bufferIntermediates O(N*M*L) guard,
    // and the container error/snapshot collection all live in BodyExecutor.
    const body = await this.#bodyExecutor.run(
      dagName,
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

import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { Placement } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { RunNodeResultType } from './ScatterDispatch.js';

/**
 * Leaf (`SingleNode`) placement executor surface. `LeafExecutor` implements
 * this interface; `PlacementDispatch` holds a reference via the field `#leaf`.
 */
export interface LeafPlacementExecutorInterface {
  executeSingleNode(
    placement: SingleNodePlacementType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
  ): Promise<RunNodeResultType>;
}

/**
 * Embedded-DAG placement executor surface. `EmbeddedDagExecutor` implements
 * this interface; `PlacementDispatch` holds a reference via the field `#embedded`.
 */
export interface EmbeddedPlacementExecutorInterface {
  executeEmbeddedDAG(
    placement: EmbeddedDAGNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType>;
}

/**
 * Scatter placement executor surface. `ScatterExecutor` implements this
 * interface; `PlacementDispatch` holds a reference via the field `#scatter`.
 */
export interface ScatterPlacementExecutorInterface {
  executeScatter(
    placement: ScatterNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
  ): Promise<RunNodeResultType>;
}

/**
 * Per-`@type` execution dispatch for composite placements.
 *
 * Built once per dispatcher instance (not per node call) so node execution is a
 * single keyed branch with no per-call closure/object allocation in the hot
 * loop. Three focused executor fields (`#leaf`, `#embedded`, `#scatter`)
 * replace the prior single `#executor` reference; `dispatch` routes on the
 * placement's `@type` discriminant.
 *
 * `SingleNode` is handled structurally by the work-set scheduler (via
 * `#fireSinglePlacement`) before `executeDAGNode` is called; its branch keeps
 * the routing exhaustive over the `DAGNodeType['@type']` union. `TerminalNode`
 * and `PhaseNode` are likewise handled before `executeDAGNode` in `runNodes`;
 * their branches synthesise the no-op result the union requires.
 */
export class PlacementDispatch {
  readonly #leaf: LeafPlacementExecutorInterface;
  readonly #embedded: EmbeddedPlacementExecutorInterface;
  readonly #scatter: ScatterPlacementExecutorInterface;

  constructor(
    leaf: LeafPlacementExecutorInterface,
    embedded: EmbeddedPlacementExecutorInterface,
    scatter: ScatterPlacementExecutorInterface,
  ) {
    this.#leaf = leaf;
    this.#embedded = embedded;
    this.#scatter = scatter;
  }

  dispatch(
    entry: DAGNodeType,
    state: NodeStateInterface,
    dagName: string,
    signal: AbortSignal,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType> {
    // Dispatch map over @type: each handler is keyed by the placement discriminant.
    // SingleNode is handled structurally by the work-set scheduler (via
    // #fireSinglePlacement) before executeDAGNode is called; its entry keeps the
    // routing exhaustive over the DAGNodeType['@type'] union. TerminalNode /
    // PhaseNode are handled before executeDAGNode in runNodes; their entries
    // synthesise the no-op result the union requires.
    const typeDispatch: Record<DAGNodeType['@type'], (e: DAGNodeType) => Promise<RunNodeResultType>> = {
      'EmbeddedDAGNode': (e) => {
        // Placement.isEmbeddedDAG guard: @type === 'EmbeddedDAGNode' confirmed by
        // the dispatch key; guard makes the narrowing explicit.
        if (!Placement.isEmbeddedDAG(e)) throw new DAGError(`Dispatch type mismatch: expected EmbeddedDAGNode`);
        return this.#embedded.executeEmbeddedDAG(e, state, dagName, signal, placementPath, bufferIntermediates);
      },
      'ScatterNode': (e) => {
        if (!Placement.isScatter(e)) throw new DAGError(`Dispatch type mismatch: expected ScatterNode`);
        return this.#scatter.executeScatter(e, state, dagName, signal, placementPath);
      },
      'SingleNode': (e) => {
        if (!Placement.isSingle(e)) throw new DAGError(`Dispatch type mismatch: expected SingleNode`);
        return this.#leaf.executeSingleNode(e, state, dagName, signal);
      },
      'GatherNode': (e) => {
        if (!Placement.isGather(e)) throw new DAGError(`Dispatch type mismatch: expected GatherNode`);
        return Promise.reject(new DAGError(`GatherNode '${e.name}' is scheduler-managed and cannot be dispatched directly`));
      },
      'TerminalNode': (e) => {
        if (!Placement.isTerminal(e)) throw new DAGError(`Dispatch type mismatch: expected TerminalNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': e.outcome, 'skipped': false, 'nodeName': e.name, state, 'intermediateResults': [],
        } });
      },
      'PhaseNode': (e) => {
        if (!Placement.isPhase(e)) throw new DAGError(`Dispatch type mismatch: expected PhaseNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': e.phase, 'skipped': true, 'nodeName': e.name, state, 'intermediateResults': [],
        } });
      },
    };

    const handler = typeDispatch[entry['@type']];
    if (handler === undefined) {
      // Exhaustive over DAGNodeType['@type']; an unknown type is a contract violation.
      throw new DAGError(`Unknown node type: ${String(entry['@type'])}`);
    }
    return handler(entry);
  }
}

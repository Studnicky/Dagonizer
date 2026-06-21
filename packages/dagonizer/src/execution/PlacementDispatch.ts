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
    signal: AbortSignal | null,
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
    signal: AbortSignal | null,
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
    signal: AbortSignal | null,
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
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType> {
    switch (entry['@type']) {
      case 'EmbeddedDAGNode': {
        // Placement.isEmbeddedDAG guard: @type === 'EmbeddedDAGNode' confirmed by
        // the dispatch branch; guard makes the narrowing explicit.
        if (!Placement.isEmbeddedDAG(entry)) throw new DAGError(`Dispatch type mismatch: expected EmbeddedDAGNode`);
        return this.#embedded.executeEmbeddedDAG(entry, state, signal, placementPath, bufferIntermediates);
      }
      case 'ScatterNode': {
        if (!Placement.isScatter(entry)) throw new DAGError(`Dispatch type mismatch: expected ScatterNode`);
        return this.#scatter.executeScatter(entry, state, dagName, signal, placementPath);
      }
      // SingleNode is handled structurally by the work-set scheduler (via
      // #fireSinglePlacement) before executeDAGNode is called; this branch is
      // unreachable in normal operation but keeps the dispatch exhaustive over
      // the DAGNodeType['@type'] union. executeSingleNode is preserved here so
      // the method is not flagged as unused by static analysis.
      case 'SingleNode': {
        if (!Placement.isSingle(entry)) throw new DAGError(`Dispatch type mismatch: expected SingleNode`);
        return this.#leaf.executeSingleNode(entry, state, dagName, signal);
      }
      // TerminalNode / PhaseNode are handled before executeDAGNode in runNodes;
      // these branches are unreachable in normal operation but keep the dispatch
      // exhaustive over the node `@type` union.
      case 'TerminalNode': {
        if (!Placement.isTerminal(entry)) throw new DAGError(`Dispatch type mismatch: expected TerminalNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': entry.outcome, 'skipped': false, 'nodeName': entry.name, state, 'intermediateResults': [],
        } });
      }
      case 'PhaseNode': {
        if (!Placement.isPhase(entry)) throw new DAGError(`Dispatch type mismatch: expected PhaseNode`);
        return Promise.resolve({ 'nextStage': null, 'result': {
          'output': entry.phase, 'skipped': true, 'nodeName': entry.name, state, 'intermediateResults': [],
        } });
      }
      default: {
        // Exhaustive over DAGNodeType['@type']; an unknown type is a contract
        // violation, mirroring the prior dispatch-map `undefined` handler.
        throw new DAGError(`Unknown node type: ${String(entry['@type'])}`);
      }
    }
  }
}

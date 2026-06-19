import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { Placement } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { RunNodeResultType } from './ScatterDispatch.js';

/**
 * Per-`@type` placement executor surface the `Dagonizer` exposes to
 * `PlacementDispatch`. Each method runs one node-`@type`'s execution path over
 * its narrowed placement type; `PlacementDispatch.dispatch` narrows the
 * placement from its `@type` discriminant before selecting the matching method.
 *
 * `Dagonizer` implements this interface so the dispatch routing lives in a
 * dedicated class with a stable shape, rather than an object-literal of arrow
 * closures rebuilt per construction.
 */
export interface PlacementExecutorInterface<TState extends NodeStateInterface> {
  executeEmbeddedDAG(
    placement: EmbeddedDAGNodeType,
    state: TState,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType<TState>>;
  executeScatter(
    placement: ScatterNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
  ): Promise<RunNodeResultType<TState>>;
  executeSingleNode(
    placement: SingleNodePlacementType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
  ): Promise<RunNodeResultType<TState>>;
}

/**
 * Per-`@type` execution dispatch for composite placements.
 *
 * Built once per dispatcher instance (not per node call) so node execution is a
 * single keyed branch with no per-call closure/object allocation in the hot
 * loop. The single `#executor` field holds the dispatcher; `dispatch` routes on
 * the placement's `@type` discriminant.
 *
 * `SingleNode` is handled structurally by the work-set scheduler (via
 * `#fireSinglePlacement`) before `executeDAGNode` is called; its branch keeps
 * the routing exhaustive over the `DAGNodeType['@type']` union. `TerminalNode`
 * and `PhaseNode` are likewise handled before `executeDAGNode` in `runNodes`;
 * their branches synthesise the no-op result the union requires.
 */
export class PlacementDispatch<TState extends NodeStateInterface> {
  readonly #executor: PlacementExecutorInterface<TState>;

  constructor(executor: PlacementExecutorInterface<TState>) {
    this.#executor = executor;
  }

  dispatch(
    entry: DAGNodeType,
    state: TState,
    dagName: string,
    signal: AbortSignal | null,
    placementPath: readonly string[],
    bufferIntermediates: boolean,
  ): Promise<RunNodeResultType<TState>> {
    switch (entry['@type']) {
      case 'EmbeddedDAGNode': {
        // Placement.isEmbeddedDAG guard: @type === 'EmbeddedDAGNode' confirmed by
        // the dispatch branch; guard makes the narrowing explicit.
        if (!Placement.isEmbeddedDAG(entry)) throw new DAGError(`Dispatch type mismatch: expected EmbeddedDAGNode`);
        return this.#executor.executeEmbeddedDAG(entry, state, signal, placementPath, bufferIntermediates);
      }
      case 'ScatterNode': {
        if (!Placement.isScatter(entry)) throw new DAGError(`Dispatch type mismatch: expected ScatterNode`);
        return this.#executor.executeScatter(entry, state, dagName, signal, placementPath);
      }
      // SingleNode is handled structurally by the work-set scheduler (via
      // #fireSinglePlacement) before executeDAGNode is called; this branch is
      // unreachable in normal operation but keeps the dispatch exhaustive over
      // the DAGNodeType['@type'] union. executeSingleNode is preserved here so
      // the method is not flagged as unused by static analysis.
      case 'SingleNode': {
        if (!Placement.isSingle(entry)) throw new DAGError(`Dispatch type mismatch: expected SingleNode`);
        return this.#executor.executeSingleNode(entry, state, dagName, signal);
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

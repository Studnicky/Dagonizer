import type { NodeResultType } from '../entities/node/NodeResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { RunNodeResultType } from './ScatterDispatch.js';

/**
 * Narrow state-mapping seam `PlacementRouter` drives to merge a completed
 * child/clone state back into its parent. `StateMapper` satisfies it directly;
 * the router depends only on the single `mapOutput` method, never on the whole
 * mapper or the dispatcher.
 */
export interface StateMergePortInterface<TState extends NodeStateInterface> {
  /**
   * Copy fields from `childState` back to `parentState` per the `output`
   * mapping (`{ parentPath: childKey }`). A no-op for an empty mapping.
   */
  mapOutput(childState: TState, parentState: TState, output: Record<string, string>): void;
}

/**
 * Outputs map shared by every composite placement: a route token (`'success'`
 * or `'error'`) keys the next stage to schedule, or `undefined` when the route
 * is terminal. Embedded-DAG, single-node, and scatter placements all carry this
 * shape under their `outputs` field.
 */
export type PlacementOutputsType = Readonly<Record<string, string | undefined>>;

/**
 * Shared result-assembly tail for composite placements.
 *
 * `executeEmbeddedDAG`, `executeSingleNode`, and the scatter per-item routing
 * all hand-rolled the same three concerns: decide the route token from the
 * child's terminal outcome plus any unrecoverable error, resolve the next stage
 * from the placement's `outputs`, and (for the envelope path) propagate
 * child→parent errors/warnings, apply output-state mapping, and assemble the
 * `{ nextStage, result }` envelope. `PlacementRouter` is those concerns in one
 * place.
 *
 * Two entry points so each caller takes exactly what it needs:
 * - `route` — the route-token decision alone (scatter per-item needs only this;
 *   gather handles its own state folding, so no merge/envelope step applies).
 * - `assemble` — the full propagate + merge + envelope tail (embedded-DAG and
 *   single-node return the envelope directly).
 *
 * All methods are static: the router holds no state, only the shared policy.
 */
export class PlacementRouter {
  /**
   * Decide the route token for a completed child body. Routes `'error'` when the
   * child run failed terminally OR any unrecoverable error was collected;
   * `'success'` otherwise. This is the single definition of the route policy the
   * embedded-DAG envelope, the single-node envelope, and the scatter per-item
   * acknowledgment all share.
   */
  static route(
    terminalOutcome: 'completed' | 'failed' | null,
    hasUnrecoverable: boolean,
  ): 'success' | 'error' {
    return (terminalOutcome === 'failed' || hasUnrecoverable) ? 'error' : 'success';
  }

  /**
   * Assemble the full `{ nextStage, result }` envelope for a composite
   * placement whose child body has finished.
   *
   * Propagates the child clone's collected errors and warnings into the parent,
   * applies the output-state mapping (child→parent) through the `merge` port,
   * derives the route token via {@link route}, resolves `nextStage` from the
   * placement's `outputs`, and builds the `NodeResultType` carrying the parent
   * state and the buffered intermediates.
   */
  static assemble<TState extends NodeStateInterface>(
    placementName: string,
    outputs: PlacementOutputsType,
    terminalOutcome: 'completed' | 'failed' | null,
    cloneState: TState,
    parentState: TState,
    outputMapping: Record<string, string>,
    intermediates: ReadonlyArray<NodeResultType<TState>>,
    merge: StateMergePortInterface<TState>,
  ): RunNodeResultType<TState> {
    // Propagate errors and warnings from child to parent.
    for (const err of cloneState.errors) parentState.collectError(err);
    for (const warn of cloneState.warnings) parentState.collectWarning(warn);

    // Apply output state mapping: child → parent.
    merge.mapOutput(cloneState, parentState, outputMapping);

    const hasUnrecoverable = cloneState.errors.some((e) => e.recoverable === false);
    const routeOutput = PlacementRouter.route(terminalOutcome, hasUnrecoverable);
    const nextStage = outputs[routeOutput] ?? null;

    return PlacementRouter.envelope(placementName, routeOutput, nextStage, parentState, intermediates);
  }

  /**
   * Assemble the `{ nextStage, result }` envelope from an already-decided route
   * token and next stage. The shared terminal-shape construction used by every
   * composite placement: the `NodeResultType` carries the route token, the
   * parent state, and any buffered intermediates.
   *
   * `executeSingleNode` calls this with the node's own returned output token
   * (resolved and validated against its `outputs` map by the caller, which
   * throws on an unrouted token before reaching here); the envelope path uses it
   * with the `'success'`/`'error'` route decision.
   */
  static envelope<TState extends NodeStateInterface>(
    placementName: string,
    output: string,
    nextStage: string | null,
    parentState: TState,
    intermediates: ReadonlyArray<NodeResultType<TState>>,
  ): RunNodeResultType<TState> {
    const result: NodeResultType<TState> = {
      'output': output,
      'skipped': false,
      'nodeName': placementName,
      'state': parentState,
      'intermediateResults': [...intermediates],
    };

    return { nextStage, result };
  }
}

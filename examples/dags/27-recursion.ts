/**
 * 27-recursion/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/27-recursion.ts (the executable entry point).
 *
 * Pattern: a countdown DAG embeds ITSELF via `dagFrom` runtime resolution.
 * Each invocation adds `remaining` to `total`, then either:
 *   - routes to `recurse` (EmbeddedDAGNode that re-runs the same DAG) when
 *     remaining > 0, OR
 *   - routes to `base` (TerminalNode) when remaining === 0.
 *
 * The engine reads the DAG name from `state.dagName` at execution time
 * (`dagFrom: 'dagName'`), spawns a FRESH isolated child state for each
 * recursive invocation, and copies fields across the boundary via
 * `stateMapping.input` / `stateMapping.output` — so each frame is safe and
 * independent of its parent's internal shape.
 *
 * Asserted result: countdown(5) → total = 5+4+3+2+1+0 = 15.
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class CountdownState extends NodeStateBase {
  /** The registered name of this DAG — read by the engine for `dagFrom` lookup. */
  dagName     = 'countdown';
  /** How many steps remain before the base case. */
  remaining   = 0;
  /** Accumulated sum across all recursive frames. */
  total       = 0;
  /** Scratch field: remaining - 1, written before the recursive embed. */
  nextRemaining = 0;
}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// #region node
/**
 * Accumulate node: adds `remaining` to `total`, then computes
 * `nextRemaining = remaining - 1`.
 *
 * Routes:
 *   'recurse' — remaining > 0 (more frames to run)
 *   'base'    — remaining === 0 (nothing left; terminate)
 */
export class AccumulateNode extends ScalarNode<CountdownState, 'recurse' | 'base'> {
  readonly name = 'accumulate';
  readonly outputs = ['recurse', 'base'] as const;

  override get outputSchema(): Record<'recurse' | 'base', SchemaObjectType> {
    return {
      recurse: { type: 'object' },
      base:    { type: 'object' },
    };
  }

  protected override async executeOne(state: CountdownState) {
    state.total         = state.total + state.remaining;
    state.nextRemaining = state.remaining - 1;
    return NodeOutputBuilder.of(state.remaining > 0 ? 'recurse' : 'base');
  }
}
// #endregion node

// ---------------------------------------------------------------------------
// Recursive countdown DAG
// ---------------------------------------------------------------------------

// #region dag
/**
 * The countdown DAG — registers itself under the name `'countdown'`.
 *
 * Placement topology:
 *
 *   accumulate  ─── base ──► base-end  (TerminalNode, completed)
 *               └── recurse ──► embed  (EmbeddedDAGNode)
 *                                └── success ──► end  (TerminalNode, completed)
 *                                └── error   ──► end-error  (TerminalNode, failed)
 *
 * The `embed` placement uses `dagFrom: 'dagName'` so the engine resolves which
 * DAG to run from `state.dagName` at runtime.  Seeding the child with
 * `remaining ← nextRemaining` and `total ← total`, then writing `total` back
 * after the child finishes, threads the accumulator through each frame.
 */
export const countdownDAG: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:countdown',
  '@type':     'DAG',
  "name":        'countdown',
  "version":     '1',
  "entrypoint":  'accumulate',
  "nodes": [
    // #region accumulate-placement
    {
      '@id':   'urn:noocodex:dag:countdown/node/accumulate',
      '@type': 'SingleNode',
      "name":    'accumulate',
      "node":    'accumulate',           // registered AccumulateNode
      "outputs": {
        "base":    'base-end',           // remaining === 0 → terminal
        "recurse": 'embed',              // remaining > 0  → recursive embed
      },
    },
    // #endregion accumulate-placement

    // #region base-terminal
    {
      '@id':     'urn:noocodex:dag:countdown/node/base-end',
      '@type':   'TerminalNode',
      "name":    'base-end',
      "outcome": 'completed',
    },
    // #endregion base-terminal

    // #region embed-placement
    {
      '@id':   'urn:noocodex:dag:countdown/node/embed',
      '@type': 'EmbeddedDAGNode',
      "name":    'embed',
      // dagFrom: the engine reads state.dagName at runtime to resolve which DAG
      // to run.  Because state.dagName === 'countdown', this DAG embeds ITSELF.
      "dagFrom":  'dagName',
      "stateMapping": {
        // inputs: seed the child frame's fields from the current (parent) frame
        // { childKey: parentPath }
        "input": {
          "dagName":   'dagName',         // propagate the DAG name down the call stack
          "remaining": 'nextRemaining',   // child.remaining ← parent.nextRemaining
          "total":     'total',           // child.total     ← parent.total (carry accumulator)
        },
        // outputs: write the child frame's result back into the parent frame
        // { parentPath: childKey }
        "output": {
          "total": 'total',               // parent.total ← child.total (accumulate upward)
        },
      },
      "outputs": {
        "success": 'end',
        "error":   'end-error',
      },
    },
    // #endregion embed-placement

    {
      '@id':     'urn:noocodex:dag:countdown/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id':     'urn:noocodex:dag:countdown/node/end-error',
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};
// #endregion dag

/**
 * 27-recursion/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/27-recursion.ts (the executable entry point).
 *
 * Pattern: a countdown DAG embeds ITSELF via a dynamic `DagReference`.
 * Each invocation adds `remaining` to `total`, then either:
 *   - routes to `recurse` (EmbeddedDAGNode that re-runs the same DAG) when
 *     remaining > 0, OR
 *   - routes to `base` (TerminalNode) when remaining === 0.
 *
 * The engine reads the DAG IRI from `state.dagIri` at execution time,
 * constrains it to the declared countdown candidate, spawns a FRESH isolated child state for each
 * recursive invocation, and copies fields across the boundary via
 * `stateMapping.input` / `stateMapping.output` — so each frame is safe and
 * independent of its parent's internal shape.
 *
 * Asserted result: countdown(5) → total = 5+4+3+2+1+0 = 15.
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
export class CountdownState extends NodeStateBase {
  /** The registered IRI of this DAG, read by the dynamic DagReference. */
  dagIri      = 'urn:noocodec:dag:countdown';
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
export class AccumulateNode extends MonadicNode<CountdownState, 'recurse' | 'base'> {
  readonly name = 'accumulate';
  readonly '@id' = 'urn:noocodec:node:accumulate';
  readonly outputs = ['recurse', 'base'] as const;

  override get outputSchema(): Record<'recurse' | 'base', SchemaObjectType> {
    return {
      recurse: { type: 'object' },
      base:    { type: 'object' },
    };
  }

  override async execute(batch: Batch<CountdownState>) {
    const entries: Array<readonly ['recurse' | 'base', Batch<CountdownState>]> = [];
    for (const item of batch) {
      const state = item.state;
      state.total         = state.total + state.remaining;
      state.nextRemaining = state.remaining - 1;
      const output = NodeOutput.create(state.remaining > 0 ? 'recurse' : 'base');
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}
// #endregion node

// ---------------------------------------------------------------------------
// Recursive countdown DAG
// ---------------------------------------------------------------------------

// #region dag
/**
 * The countdown DAG registers itself under its canonical DAG IRI.
 *
 * Placement topology:
 *
 *   accumulate  ─── base ──► base-end  (TerminalNode, completed)
 *               └── recurse ──► embed  (EmbeddedDAGNode)
 *                                └── success ──► end  (TerminalNode, completed)
 *                                └── error   ──► end-error  (TerminalNode, failed)
 *
 * The `embed` placement uses a dynamic DagReference so the engine resolves
 * which DAG to run from `state.dagIri` at runtime. Seeding the child with
 * `remaining ← nextRemaining` and `total ← total`, then writing `total` back
 * after the child finishes, threads the accumulator through each frame.
 */
export const countdownDAG: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:countdown',
  '@type':     'DAG',
  "name":        'countdown',
  "version":     '1',
  "entrypoints": { "main": 'urn:noocodec:dag:countdown/node/accumulate' },
  "nodes": [
    // #region accumulate-placement
    {
      '@id': 'urn:noocodec:dag:countdown/node/accumulate',
      '@type': 'SingleNode',
      "name":    'accumulate',
      "node":    'urn:noocodec:node:accumulate', // registered AccumulateNode IRI
      "outputs": {
        "base":    'urn:noocodec:dag:countdown/node/base-end',
        "recurse": 'urn:noocodec:dag:countdown/node/embed',
      },
    },
    // #endregion accumulate-placement

    // #region base-terminal
    {
      '@id': 'urn:noocodec:dag:countdown/node/base-end',
      '@type':   'TerminalNode',
      "name":    'base-end',
      "outcome": 'completed',
    },
    // #endregion base-terminal

    // #region embed-placement
    {
      '@id': 'urn:noocodec:dag:countdown/node/embed',
      '@type': 'EmbeddedDAGNode',
      "name":    'embed',
      // The engine reads state.dagIri at runtime. The value is the canonical
      // DAG IRI, so this DAG embeds itself without name lookup.
      "dag": {
        '@type': 'DagReference',
        "from": 'state',
        "path": 'dagIri',
        "candidates": ['urn:noocodec:dag:countdown'],
      },
      "stateMapping": {
        // inputs: seed the child frame's fields from the current (parent) frame
        // { childKey: parentPath }
        "input": {
          "dagIri":    'dagIri',          // propagate the DAG IRI down the call stack
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
        "success": 'urn:noocodec:dag:countdown/node/end',
        "error":   'urn:noocodec:dag:countdown/node/end-error',
      },
    },
    // #endregion embed-placement

    {
      '@id': 'urn:noocodec:dag:countdown/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id': 'urn:noocodec:dag:countdown/node/end-error',
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};
// #endregion dag

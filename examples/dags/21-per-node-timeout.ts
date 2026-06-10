/**
 * 21-per-node-timeout/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/21-per-node-timeout.ts (the executable entry point).
 *
 * Demonstrates per-node timeoutMs: set directly on the NodeInterface object.
 * The engine reads `node.timeoutMs` and derives a child AbortController. When
 * the budget expires, the engine throws NodeTimeoutError, fires onError, and
 * marks the run failed (interruptedAt.reason === 'timeout').
 *
 * The parent run-level signal is NOT aborted; per-node timeout is scoped to
 * that one node's execute() call only. Other nodes in the same run are
 * unaffected.
 */

import {
  DAGBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class TaskState extends NodeStateBase {
  output = '';
}

// ---------------------------------------------------------------------------
// Fast node: completes well within its 200 ms budget
// ---------------------------------------------------------------------------

// #region fast-node
export const fastNode: NodeInterface<TaskState, 'done'> = {
  "name":      'fast-task',
  "outputs":   ['done'],
  // Per-node timeout budget: 200 ms. This node resolves in ~0 ms → no timeout.
  "timeoutMs": 200,
  async execute(state) {
    state.output = 'fast-done';
    return { "output": 'done' };
  },
};
// #endregion fast-node

// ---------------------------------------------------------------------------
// Slow node: intentionally exceeds its 50 ms budget.
// The engine aborts the child signal after 50 ms; the node must observe
// context.signal to detect the abort. If the node ignores the signal the
// engine hard-stops it via Promise.race.
// ---------------------------------------------------------------------------

// #region slow-node
export const slowNode: NodeInterface<TaskState, 'done'> = {
  "name":      'slow-task',
  "outputs":   ['done'],
  // Per-node timeout budget: 50 ms. The node tries to wait 5 s → NodeTimeoutError.
  "timeoutMs": 50,
  async execute(_state, context) {
    // Await a 5-second delay, but honour context.signal so the engine's
    // per-node abort terminates the wait promptly at the 50 ms boundary.
    await new Promise<void>((_resolve, reject) => {
      const t = setTimeout(_resolve, 5_000);
      context.signal.addEventListener(
        'abort',
        () => { clearTimeout(t); reject(context.signal.reason); },
        { "once": true },
      );
    });
    return { "output": 'done' };
  },
};
// #endregion slow-node

// ---------------------------------------------------------------------------
// DAGs: one for each node
// ---------------------------------------------------------------------------

export const fastDag = new DAGBuilder('fast-dag', '1')
  .node('fast-task', fastNode, { 'done': 'end' })
  .terminal('end')
  .build();

export const slowDag = new DAGBuilder('slow-dag', '1')
  .node('slow-task', slowNode, { 'done': 'end' })
  .terminal('end')
  .build();

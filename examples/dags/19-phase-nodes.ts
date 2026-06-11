/**
 * 19-phase-nodes/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/19-phase-nodes.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// State: tracks execution order so the example proves ordering guarantees
// ---------------------------------------------------------------------------

export class PhaseState extends NodeStateBase {
  /** Names appended in execution order. */
  executionLog: string[] = [];
  /** Data seeded by the pre-phase and read by the main node. */
  seedValue = 0;
  /** Result written by the main node and inspected by the post-phase. */
  result = '';
}

// ---------------------------------------------------------------------------
// Pre-phase node: runs BEFORE the entrypoint.
// A thrown error here aborts the run; the main loop never executes.
// ---------------------------------------------------------------------------

// #region pre-phase-node
export const preSetup: NodeInterface<PhaseState, 'ready'> = {
  "name":    'pre-setup',
  "outputs": ['ready'],
  async execute(state) {
    state.executionLog.push('pre-setup');
    state.seedValue = 42;
    return NodeOutputBuilder.of('ready');
  },
};
// #endregion pre-phase-node

// ---------------------------------------------------------------------------
// Main node: the flow entrypoint. Reads seedValue left by the pre-phase.
// ---------------------------------------------------------------------------

export const compute: NodeInterface<PhaseState, 'done'> = {
  "name":    'compute',
  "outputs": ['done'],
  async execute(state) {
    state.executionLog.push('compute');
    state.result = `computed:${String(state.seedValue * 2)}`;
    return NodeOutputBuilder.of('done');
  },
};

// ---------------------------------------------------------------------------
// Post-phase node: runs AFTER the main loop on every exit path (completion,
// abort, timeout, terminal-failed, node throw). Errors are collected as
// warnings; they do NOT change the already-set lifecycle.
// ---------------------------------------------------------------------------

// #region post-phase-node
export const postAudit: NodeInterface<PhaseState, 'audited'> = {
  "name":    'post-audit',
  "outputs": ['audited'],
  async execute(state) {
    state.executionLog.push('post-audit');
    // State is already finalized; this is the last observer.
    state.executionLog.push(`final-result:${state.result}`);
    return NodeOutputBuilder.of('audited');
  },
};
// #endregion post-phase-node

// ---------------------------------------------------------------------------
// DAG: pre → compute → post
// ---------------------------------------------------------------------------

// #region phase-dag
export const dag = new DAGBuilder('phase-demo', '1')
  // 'pre' phase: runs before the entrypoint in declaration order.
  .phase('setup', 'pre', preSetup)
  // Main loop: compute is the entrypoint (first .node() call).
  .node('compute', compute, { 'done': 'end' })
  .terminal('end')
  // 'post' phase: runs after the main loop drains on every exit path.
  .phase('audit', 'post', postAudit)
  .build();
// #endregion phase-dag

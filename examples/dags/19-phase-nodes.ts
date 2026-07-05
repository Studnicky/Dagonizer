/**
 * 19-phase-nodes/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/19-phase-nodes.ts (the executable entry point).
 */

import {
  Batch,
  DAGBuilder,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

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
export class PreSetupNode extends MonadicNode<PhaseState, 'ready'> {
  readonly name = 'pre-setup';
  readonly outputs = ['ready'] as const;
  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PhaseState>) {
    for (const item of batch) {
      item.state.executionLog.push('pre-setup');
      item.state.seedValue = 42;
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('ready').output, batch);
  }
}
// #endregion pre-phase-node

// ---------------------------------------------------------------------------
// Main node: the flow entrypoint. Reads seedValue left by the pre-phase.
// ---------------------------------------------------------------------------

export class ComputeNode extends MonadicNode<PhaseState, 'done'> {
  readonly name = 'compute';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PhaseState>) {
    for (const item of batch) {
      item.state.executionLog.push('compute');
      item.state.result = `computed:${String(item.state.seedValue * 2)}`;
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Post-phase node: runs AFTER the main loop on every exit path (completion,
// abort, timeout, terminal-failed, node throw). Errors are collected as
// warnings; they do NOT change the already-set lifecycle.
// ---------------------------------------------------------------------------

// #region post-phase-node
export class PostAuditNode extends MonadicNode<PhaseState, 'audited'> {
  readonly name = 'post-audit';
  readonly outputs = ['audited'] as const;
  override get outputSchema(): Record<'audited', SchemaObjectType> {
    return { 'audited': { 'type': 'object' } };
  }

  override async execute(batch: Batch<PhaseState>) {
    for (const item of batch) {
      item.state.executionLog.push('post-audit');
      // State is already finalized; this is the last observer.
      item.state.executionLog.push(`final-result:${item.state.result}`);
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('audited').output, batch);
  }
}
// #endregion post-phase-node

// ---------------------------------------------------------------------------
// DAG: pre → compute → post
// ---------------------------------------------------------------------------

// #region phase-dag
const preSetupNode = new PreSetupNode();
const computeNode = new ComputeNode();
const postAuditNode = new PostAuditNode();

export const dag = new DAGBuilder('phase-demo', '1')
  // 'pre' phase: runs before the entrypoint in declaration order.
  .phase('setup', 'pre', preSetupNode)
  // Main loop: compute is the entrypoint (first .node() call).
  .node('compute', computeNode, { 'done': 'end' })
  .terminal('end')
  // 'post' phase: runs after the main loop drains on every exit path.
  .phase('audit', 'post', postAuditNode)
  .build();
// #endregion phase-dag

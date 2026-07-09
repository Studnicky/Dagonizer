/**
 * 21-per-node-timeout/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/21-per-node-timeout.ts (the executable entry point).
 *
 * Demonstrates per-node timeout: set `timeout: Timeout.ofMs(n)` directly on
 * the NodeInterface object. The engine reads `node.timeout` and derives a
 * child AbortController. When the budget expires, the engine throws a
 * DAGError (code NODE_TIMEOUT), fires onError, and marks the run failed
 * (interruptedAt.reason === 'timeout').
 *
 * The parent run-level signal is NOT aborted; per-node timeout is scoped to
 * that one node's execute() call only. Other nodes in the same run are
 * unaffected.
 */

import {
  Batch,
  DAGBuilder,
  DAGIdentity,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import { Timeout } from '@studnicky/dagonizer/runtime';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

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
export class FastTaskNode extends MonadicNode<TaskState, 'done'> {
  readonly name = 'fast-task';
  readonly '@id' = 'urn:noocodec:node:fast-task';
  readonly outputs = ['done'] as const;
  // Per-node timeout budget: 200 ms. This node resolves in ~0 ms → no timeout.
  override readonly timeout = Timeout.ofMs(200);
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<TaskState>) {
    for (const item of batch) item.state.output = 'fast-done';
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion fast-node

// ---------------------------------------------------------------------------
// Slow node: intentionally exceeds its 50 ms budget.
// The engine aborts the child signal after 50 ms; the node must observe
// context.signal to detect the abort. If the node ignores the signal the
// engine hard-stops it via Promise.race.
// ---------------------------------------------------------------------------

// #region slow-node
export class SlowTaskNode extends MonadicNode<TaskState, 'done'> {
  readonly name = 'slow-task';
  readonly '@id' = 'urn:noocodec:node:slow-task';
  readonly outputs = ['done'] as const;
  // Per-node timeout budget: 50 ms. The node tries to wait 5 s → DAGError (code NODE_TIMEOUT).
  override readonly timeout = Timeout.ofMs(50);
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }
  override async execute(batch: Batch<TaskState>, context: NodeContextType) {
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
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion slow-node

// ---------------------------------------------------------------------------
// DAGs: one for each node
// ---------------------------------------------------------------------------

export const fastDagIri = 'urn:noocodec:dag:fast-dag' as const;
export const slowDagIri = 'urn:noocodec:dag:slow-dag' as const;
const fastPlacement = (placementIdentifier: string): string => DAGIdentity.placementId(fastDagIri, placementIdentifier);
const slowPlacement = (placementIdentifier: string): string => DAGIdentity.placementId(slowDagIri, placementIdentifier);

export const fastDag = new DAGBuilder(fastDagIri, '1')
  .node(fastPlacement('fast-task'), new FastTaskNode(), { 'done': fastPlacement('end') })
  .terminal(fastPlacement('end'))
  .build();

export const slowDag = new DAGBuilder(slowDagIri, '1')
  .node(slowPlacement('slow-task'), new SlowTaskNode(), { 'done': slowPlacement('end') })
  .terminal(slowPlacement('end'))
  .build();

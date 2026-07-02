/**
 * virtual-clock/dags: pure module — a per-node-timeout DAG (state, slow
 * node, DAG const), plus re-exports of the virtual time providers.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/virtual-clock.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeStateBase,
  ScalarNode,
  Timeout,
} from '@studnicky/dagonizer';
import type { DAGType, NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

export { Scheduler } from '@studnicky/dagonizer/runtime';
export { VirtualScheduler } from '@studnicky/dagonizer/testing';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class SlowState extends NodeStateBase {}

// ---------------------------------------------------------------------------
// Node: a per-node `timeout` budget. The engine arms the deadline via
// `Scheduler.current().after(ms, ...)` (src/Dagonizer.ts `withNodeTimeout`),
// so a VirtualScheduler installed before `dispatcher.execute()` drives the
// deadline deterministically via `advance()` — no real wait required.
// ---------------------------------------------------------------------------

// #region slow-node
export class SlowNode extends ScalarNode<SlowState, 'success'> {
  readonly name = 'slow';
  readonly outputs = ['success'] as const;
  override readonly timeout = Timeout.ofMs(200);
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  protected override async executeOne(_state: SlowState, context: NodeContextType): Promise<NodeOutputType<'success'>> {
    // Suspends until the per-node deadline aborts context.signal.
    await new Promise<never>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => { reject(context.signal.reason); }, { 'once': true });
    });
    return { 'errors': [], 'output': 'success' };
  }
}
// #endregion slow-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:virtual-clock-dag',
  '@type':      'DAG',
  'name':       'virtual-clock-dag',
  'version':    '1',
  'entrypoint': 'slow',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:virtual-clock-dag/node/slow',
      '@type':   'SingleNode',
      'name':    'slow',
      'node':    'slow',
      'outputs': { 'success': 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:virtual-clock-dag/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};

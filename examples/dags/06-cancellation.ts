/**
 * 06-cancellation/dags: pure module — node and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/06-cancellation.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// Node: iterates a list while checking context.signal.aborted between items
// ---------------------------------------------------------------------------

// #region signal-iteration
export class BatchProcessNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'batch-process';
  readonly outputs = ['success'] as const;

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType) {
    const items = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    for (const item of items) {
      if (context.signal.aborted) break;        // check between iterations
      await this.processItem(item, context.signal); // propagate to every IO call
    }
    return NodeOutputBuilder.of('success');
  }

  /** Simulate per-item IO; propagates the signal so the item-level wait aborts. */
  private async processItem(item: string, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 200);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
    void item; // consume for side-effect
  }
}
// #endregion signal-iteration

// ---------------------------------------------------------------------------
// Node: simulates a slow downstream; must honour context.signal to cancel
// ---------------------------------------------------------------------------

// #region node-cancellation-aware
export class SlowNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'slow';
  readonly outputs = ['success'] as const;

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType) {
    // Wrap the delay in a manual Promise that listens for abort. If the node
    // ignores context.signal, cancellation would not take effect until the
    // current node finishes, even if the signal fires.
    //
    // When composing multiple signals (e.g. a per-operation timeout plus the
    // dispatcher's signal), prefer `AbortSignal.any([sigA, sigB])` — it fires
    // as soon as the first of the two aborts. Do not manually chain listeners.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      context.signal.addEventListener(
        'abort',
        () => { clearTimeout(t); reject(context.signal.reason); },
        { "once": true },
      );
    });
    return NodeOutputBuilder.of('success');
  }
}
// #endregion node-cancellation-aware

// ---------------------------------------------------------------------------
// DAGs
// ---------------------------------------------------------------------------

export const batchDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:batch-dag',
  '@type':     'DAG',
  name:        'batch-dag',
  version:     '1',
  entrypoint:  'batch-process',
  nodes: [
    {
      '@id':   'urn:noocodex:dag:batch-dag/node/batch-process',
      '@type': 'SingleNode',
      name:    'batch-process',
      node:    'batch-process',
      outputs: { success: 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:batch-dag/node/end',
      '@type':   'TerminalNode',
      name:      'end',
      outcome:   'completed',
    },
  ],
};

export const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:slow-dag',
  '@type':     'DAG',
  "name":        'slow-dag',
  "version":     '1',
  "entrypoint":  'slow',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:slow-dag/node/slow',
      '@type': 'SingleNode',
      "name":    'slow',
      "node":    'slow',
      "outputs": { "success": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:slow-dag/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};

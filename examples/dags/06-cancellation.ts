/**
 * 06-cancellation/dags: pure module — node and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/06-cancellation.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface} from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Node: simulates a slow downstream; must honour context.signal to cancel
// ---------------------------------------------------------------------------

// #region node-cancellation-aware
export class SlowNode implements NodeInterface<NodeStateBase, 'success'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'slow';
  readonly outputs = ['success'] as const;

  async execute(_state: NodeStateBase, context: NodeContextInterface) {
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
// DAG
// ---------------------------------------------------------------------------

export const dag: DAG = {
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

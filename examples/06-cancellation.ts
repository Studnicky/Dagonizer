/**
 * 06-cancellation — AbortSignal + deadlineMs.
 *
 * Demonstrates two independent cancellation shapes:
 *   (a) caller-controlled abort: the caller holds an AbortController and
 *       fires it when the user cancels. The node must observe context.signal.
 *   (b) deadline timeout: pass deadlineMs to execute(); the dispatcher
 *       synthesizes an AbortSignal that fires after the deadline.
 *
 * Watch: lifecycle.kind records the terminal reason — 'cancelled' for an
 * explicit abort, 'timed_out' for a deadline. The cursor is the next node
 * that would have run (useful for resume).
 *
 * Run: npx tsx examples/06-cancellation.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Node — simulates a slow downstream; must honour context.signal to cancel
// ---------------------------------------------------------------------------

const slow: NodeInterface<NodeStateBase, 'success'> = {
  "name": 'slow',
  "outputs": ['success'],
  async execute(_state, context) {
    // Wrap the delay in a manual Promise that listens for abort. If the node
    // ignores context.signal, cancellation would not take effect until the
    // current node finishes, even if the signal fires.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      context.signal.addEventListener(
        'abort',
        () => { clearTimeout(t); reject(context.signal.reason); },
        { "once": true },
      );
    });
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

const dag: DAG = {
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
      "outputs": { "success": null },
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(slow);
dispatcher.registerDAG(dag);

// (a) Caller-controlled abort — fires after 25 ms
const ctl    = new AbortController();
const aState = new NodeStateBase();
setTimeout(() => ctl.abort(new Error('user pressed cancel')), 25);
const aResult = await dispatcher.execute('slow-dag', aState, { "signal": ctl.signal });

// (b) Dispatcher deadline — fires after 25 ms automatically
const bState  = new NodeStateBase();
const bResult = await dispatcher.execute('slow-dag', bState, { "deadlineMs": 25 });

process.stdout.write('\nCancellation shapes — AbortSignal vs deadlineMs\n');
process.stdout.write(`  (a) AbortController: lifecycle=${aState.lifecycle.kind} cursor="${aResult.cursor}"\n`);
process.stdout.write(`  (b) deadlineMs:      lifecycle=${bState.lifecycle.kind} cursor="${bResult.cursor}"\n`);
process.stdout.write('\nLesson: observe context.signal in every long-running operation.\n');
process.stdout.write('        lifecycle.kind records the terminal reason;\n');
process.stdout.write('        cursor records where resumption would begin.\n');

/**
 * 04-cancellation — AbortSignal + deadlineMs.
 *
 * Demonstrates both shapes of cancellation:
 *   (a) caller-controlled abort via AbortController.signal
 *   (b) dispatcher deadline via deadlineMs
 *
 * Inspect `state.lifecycle.kind` after each run — 'cancelled' vs 'timed_out'.
 *
 * Run: npx tsx examples/04-cancellation.ts
 */

import {
  NodeStateBase,
  Dagonizer,
} from '../src/index.js';
import type { DAG, NodeInterface } from '../src/index.js';

const slow: NodeInterface<NodeStateBase, 'success'> = {
  "name": 'slow',
  "outputs": ['success'],
  async execute(_state, context) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { "once": true });
    });
    return { "output": 'success' };
  },
};

const dag: DAG = {
  "name": 'slow-dag',
  "version": '1',
  "entrypoint": 'slow',
  "nodes": [{ "type": 'single', "name": 'slow', "node": 'slow', "outputs": { "success": null } }],
};

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(slow);
dispatcher.registerDAG(dag);

// (a) User cancellation
const ctl = new AbortController();
setTimeout(() => ctl.abort(new Error('user pressed cancel')), 25);
const aState = new NodeStateBase();
const aResult = await dispatcher.execute('slow-dag', aState, { "signal": ctl.signal });
process.stdout.write(`cancelled → ${aState.lifecycle.kind}, cursor=${aResult.cursor}\n`);

// (b) Deadline timeout
const bState = new NodeStateBase();
const bResult = await dispatcher.execute('slow-dag', bState, { "deadlineMs": 25 });
process.stdout.write(`deadline → ${bState.lifecycle.kind}, cursor=${bResult.cursor}\n`);

/**
 * 05-retry — `RetryPolicy` inside a node.
 *
 * A flaky downstream fails twice then succeeds. The node wraps the call
 * in `RetryPolicy.run()` which cooperates with the dispatcher's abort signal.
 *
 * Run: npx tsx examples/05-retry.ts
 */

import {
  BackoffStrategy,
  NodeStateBase,
  Dagonizer,
  RetryPolicy,
} from '../src/index.js';
import type { DAG, NodeInterface } from '../src/index.js';

class TransientError extends Error { constructor() { super('transient'); } }

let flakyAttempts = 0;
const flakyDownstream = async (): Promise<string> => {
  flakyAttempts++;
  if (flakyAttempts < 3) throw new TransientError();
  return 'OK';
};

class S extends NodeStateBase {
  result = '';
}

const fetchNode: NodeInterface<S, 'success' | 'error'> = {
  "name": 'fetch',
  "outputs": ['success', 'error'],
  async execute(state, context) {
    const policy = new RetryPolicy({
      "maxAttempts": 5,
      "strategy": BackoffStrategy.EXPONENTIAL,
      "baseDelay": 50,
      "jitterFactor": 0,
      "retryOn": [TransientError],
    });
    try {
      state.result = await policy.run(flakyDownstream, context.signal);
      return { "output": 'success' };
    } catch {
      return { "output": 'error' };
    }
  },
};

const dag: DAG = {
  "name": 'retry-dag',
  "version": '1',
  "entrypoint": 'fetch',
  "nodes": [
    { "type": 'single', "name": 'fetch', "node": 'fetch',
      "outputs": { "success": null, "error": null } },
  ],
};

const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(fetchNode);
dispatcher.registerDAG(dag);

const state = new S();
await dispatcher.execute('retry-dag', state);
process.stdout.write(`attempts=${flakyAttempts} result=${state.result}\n`);

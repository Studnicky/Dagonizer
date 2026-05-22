/**
 * 07-retry — RetryPolicy inside a node's execute().
 *
 * Demonstrates using RetryPolicy.run() to handle transient downstream
 * failures. The policy is constructed inside the node and cooperates
 * with the dispatcher's AbortSignal — if the DAG is cancelled mid-retry,
 * the policy propagates the abort rather than retrying again.
 *
 * Watch: the flaky downstream throws twice, then succeeds on attempt 3.
 * RetryPolicy with EXPONENTIAL backoff spaces out the retries; jitterFactor=0
 * makes the timing deterministic for the example output.
 *
 * Run: npx tsx examples/07-retry.ts
 */

import {
  BackoffStrategy,
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
  RetryPolicy,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Simulated flaky downstream — throws twice, succeeds on third attempt
// ---------------------------------------------------------------------------

class TransientError extends Error { constructor() { super('transient'); } }

let flakyAttempts = 0;
const flakyDownstream = async (): Promise<string> => {
  flakyAttempts++;
  if (flakyAttempts < 3) throw new TransientError();
  return 'OK';
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  result = '';
}

// ---------------------------------------------------------------------------
// Node — constructs RetryPolicy and passes context.signal through
// ---------------------------------------------------------------------------

const fetchNode: NodeInterface<S, 'success' | 'error'> = {
  'name': 'fetch',
  'outputs': ['success', 'error'],
  async execute(state, context) {
    const policy = new RetryPolicy({
      'maxAttempts':  5,
      'strategy':     BackoffStrategy.EXPONENTIAL,  // 50ms → 100ms → 200ms → …
      'baseDelay':    50,
      'jitterFactor': 0,                            // deterministic delays for testing
      'retryOn':      [TransientError],             // only retry on this error class
    });
    try {
      // policy.run() re-invokes flakyDownstream until it succeeds or
      // maxAttempts is reached. It passes context.signal so an abort
      // cancels the wait between retries immediately.
      state.result = await policy.run(flakyDownstream, context.signal);
      return { 'output': 'success' };
    } catch {
      return { 'output': 'error' };
    }
  },
};

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

const dag: DAG = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:retry-dag',
  '@type':      'DAG',
  "name":       'retry-dag',
  "version":    '1',
  "entrypoint": 'fetch',
  "nodes": [
    {
      '@id':     'urn:noocodex:dag:retry-dag/node/fetch',
      '@type':   'SingleNode',
      "name":    'fetch',
      "node":    'fetch',
      "outputs": { "success": null, "error": null },
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(fetchNode);
dispatcher.registerDAG(dag);

const state = new S();
await dispatcher.execute('retry-dag', state);

process.stdout.write('\nRetry DAG — fetch with EXPONENTIAL backoff\n');
process.stdout.write(`  attempts=${flakyAttempts}  result="${state.result}"\n`);
process.stdout.write(`  (threw ${flakyAttempts - 1} time(s) before succeeding)\n`);
process.stdout.write('\nLesson: RetryPolicy.run(fn, signal) retries on declared error classes;\n');
process.stdout.write('        passing context.signal ensures abort short-circuits the delay.\n');

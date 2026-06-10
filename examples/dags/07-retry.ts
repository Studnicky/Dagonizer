/**
 * 07-retry/dags: pure module — state, flaky downstream, node, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/07-retry.ts (the executable entry point).
 */

import {
  BackoffStrategy,
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  RetryPolicy,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Simulated flaky downstream: class encapsulates mutable attempt counter
// so it can be reset between test runs without mutable module-level state.
// ---------------------------------------------------------------------------

export class TransientError extends Error { constructor() { super('transient'); } }

/** Stub downstream that throws twice then succeeds; counter is per-instance. */
export class FlakyDownstream {
  #attempts = 0;

  get attempts(): number { return this.#attempts; }

  async call(): Promise<string> {
    this.#attempts++;
    if (this.#attempts < 3) throw new TransientError();
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class FetchState extends NodeStateBase {
  result = '';
}

// ---------------------------------------------------------------------------
// Node: constructs RetryPolicy and passes context.signal through
// ---------------------------------------------------------------------------

// #region retry-node
export const fetchNode: NodeInterface<FetchState, 'success' | 'error'> = {
  'name': 'fetch',
  'outputs': ['success', 'error'],
  async execute(state, context) {
    // #region policy-config
    const policy = RetryPolicy.from({
      'maxAttempts':  5,
      'strategy':     BackoffStrategy.EXPONENTIAL,  // 50ms → 100ms → 200ms → …
      'baseDelay':    50,
      'jitterFactor': 0,                            // deterministic delays for testing
      'retryOn':      [TransientError],             // only retry on this error class
    });
    // #endregion policy-config
    const downstream = new FlakyDownstream();
    try {
      // policy.run() re-invokes downstream.call() until it succeeds or
      // maxAttempts is reached. The options bag passes context.signal so
      // an abort cancels the wait between retries immediately.
      state.result = await policy.run(() => downstream.call(), { signal: context.signal });
      return NodeOutputBuilder.of('success');
    } catch {
      return NodeOutputBuilder.of('error');
    }
  },
};
// #endregion retry-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAG = {
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
      "outputs": { "success": 'end', "error": 'end-error' },
    },
    {
      '@id':     'urn:noocodex:dag:retry-dag/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id':     'urn:noocodex:dag:retry-dag/node/end-error',
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};

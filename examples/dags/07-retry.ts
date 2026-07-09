/**
 * 07-retry/dags: pure module — state, flaky downstream, node, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/07-retry.ts (the executable entry point).
 */

import {
  BackoffStrategyNames,
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RetryPolicy,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, NodeContextType, RetryPolicyOptionsType, SchemaObjectType } from '@studnicky/dagonizer';

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
export class FetchNode extends MonadicNode<FetchState, 'success' | 'error'> {
  readonly name = 'fetch';
  readonly '@id' = 'urn:noocodec:node:fetch';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  override async execute(batch: Batch<FetchState>, context: NodeContextType) {
    // #region policy-config
    const policy = RetryPolicy.from({
      'maxAttempts':  5,
      'strategy':     BackoffStrategyNames.EXPONENTIAL,  // 50ms → 100ms → 200ms → …
      'baseDelay':    50,
      'jitterFactor': 0,                            // deterministic delays for testing
      'retryOn':      [TransientError],             // only retry on this error class
    });
    // #endregion policy-config
    const entries: Array<readonly ['success' | 'error', Batch<FetchState>]> = [];
    for (const item of batch) {
      const state = item.state;
      const downstream = new FlakyDownstream();
      try {
        // policy.run() re-invokes downstream.call() until it succeeds or
        // maxAttempts is reached. The options object passes context.signal so
        // an abort cancels the wait between retries immediately.
        state.result = await policy.run(() => downstream.call(), { signal: context.signal });
        const output = NodeOutput.create('success');
        entries.push([output.output, Batch.from([item])]);
      } catch {
        const output = NodeOutput.create('error');
        entries.push([output.output, Batch.from([item])]);
      }
    }
    return RoutedBatch.create(entries);
  }
}
// #endregion retry-node

// ---------------------------------------------------------------------------
// Error filtering: retryOn / abortOn precedence demonstration
// ---------------------------------------------------------------------------

// #region error-filtering
export class NetworkError extends Error { constructor() { super('network'); } }
export class AuthError    extends Error { constructor() { super('auth');    } }

/** Policy that only retries NetworkError and never retries AuthError. */
export const filteredPolicy = RetryPolicy.from({
  maxAttempts: 5,
  strategy:    BackoffStrategyNames.EXPONENTIAL,
  retryOn:     [NetworkError],  // only retry these
  abortOn:     [AuthError],     // never retry these, even if listed in retryOn
});
// Precedence: abortOn wins over retryOn. If the error matches abortOn, no retry.
// #endregion error-filtering

// ---------------------------------------------------------------------------
// Abort cooperation: policy.run() propagates the abort signal mid-backoff
// ---------------------------------------------------------------------------

// #region abort-cooperation
/** Drives a task under a RetryPolicy and propagates an AbortSignal.
 *  If the signal fires during a backoff wait, run() throws immediately
 *  rather than waiting for the next attempt window to expire.
 */
export class AbortRunner {
  static async run(task: () => Promise<string>, signal: AbortSignal): Promise<string> {
    const policy = RetryPolicy.from({ maxAttempts: 10, baseDelay: 1000 });
    // If signal aborts during a 1 s sleep, run() throws immediately.
    return policy.run(task, { signal });
  }
}
// #endregion abort-cooperation

// ---------------------------------------------------------------------------
// Custom backoff: FibonacciRetry subclass
// ---------------------------------------------------------------------------

// #region custom-backoff
/** RetryPolicy subclass that spaces retries on the Fibonacci sequence (× 100 ms). */
export class FibonacciRetry extends RetryPolicy {
  constructor(options: RetryPolicyOptionsType = {}) {
    super(options);
  }

  override getDelay(attempt: number, _options: { readonly error?: Error | null } = {}): number {
    const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
    return Math.min(fib(attempt) * 100, this.maxDelay);
  }
}
// #endregion custom-backoff

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:retry-dag',
  '@type':      'DAG',
  "name":       'retry-dag',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:retry-dag/node/fetch' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:retry-dag/node/fetch',
      '@type':   'SingleNode',
      "name":    'fetch',
      "node":    'urn:noocodec:node:fetch',
      "outputs": {
        "success": 'urn:noocodec:dag:retry-dag/node/end',
        "error": 'urn:noocodec:dag:retry-dag/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:retry-dag/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id': 'urn:noocodec:dag:retry-dag/node/end-error',
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};

/**
 * 07-retry: RetryPolicy inside a node's execute().
 *
 * Demonstrates using RetryPolicy.run() to handle transient downstream
 * failures. The policy is constructed inside the node and cooperates
 * with the dispatcher's AbortSignal; if the DAG is cancelled mid-retry,
 * the policy propagates the abort rather than retrying again.
 *
 * Watch: the flaky downstream throws twice, then succeeds on attempt 3.
 * RetryPolicy with EXPONENTIAL backoff spaces out the retries; jitterFactor=0
 * makes the timing deterministic for the example output.
 *
 * DAG definition (state, flaky downstream, fetch node, dag): examples/dags/07-retry.ts
 *
 * Run: npx tsx examples/07-retry.ts
 */

import { BackoffStrategyNames, Dagonizer, RetryPolicy } from '@studnicky/dagonizer';
import { FetchState, FetchNode, FlakyDownstream, TransientError, dag } from './dags/07-retry.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region runtime
const dispatcher = new Dagonizer<FetchState>();
dispatcher.registerNode(new FetchNode());
dispatcher.registerDAG(dag);

const state = new FetchState();
await dispatcher.execute('urn:noocodec:dag:retry-dag', state);

// FlakyDownstream (inside FetchNode.execute) throws twice before succeeding.
// The stub is per-execution so attempts are scoped to the node invocation.
process.stdout.write('\nRetry DAG: fetch with EXPONENTIAL backoff\n');
process.stdout.write(`  result="${state.result}"\n`);
process.stdout.write('\nLesson: RetryPolicy.run(fn, { signal }) retries on declared error classes;\n');
process.stdout.write('        passing context.signal ensures abort short-circuits the delay.\n');
// #endregion runtime

// ---------------------------------------------------------------------------
// Elapsed-time verification: retry backoff runs on a real timer
// ---------------------------------------------------------------------------

// #region elapsed-time-verification
// `RetryPolicy` schedules its backoff delays through `@studnicky/retry`'s
// `Retry`, which sleeps on its own internal timer rather than the injected
// `Scheduler` — `VirtualScheduler.advance()` has no effect on retry timing.
// This run verifies the EXPONENTIAL backoff actually elapses real wall-clock
// time: baseDelay=50ms → waits of 50ms then 100ms (150ms total) before the
// third attempt succeeds.
const testPolicy = RetryPolicy.from({
  maxAttempts:  3,
  strategy:     BackoffStrategyNames.EXPONENTIAL,
  baseDelay:    50,
  jitterFactor: 0,
  retryOn:      [TransientError],
});
const testDownstream = new FlakyDownstream(); // throws twice, succeeds on third
const startedAt = Date.now();
const testResult = await testPolicy.run(() => testDownstream.call());
const elapsedMs = Date.now() - startedAt;
// #endregion elapsed-time-verification

process.stdout.write(`\nElapsed-time test: result="${testResult}" after ${String(testDownstream.attempts)} attempts, ${String(elapsedMs)}ms elapsed\n`);
process.stdout.write('Lesson: RetryPolicy backoff runs on a real timer owned by substrate\'s Retry;\n');
process.stdout.write('        VirtualScheduler.advance() no longer drives retry delays.\n');

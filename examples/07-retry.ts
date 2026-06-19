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

import { BackoffStrategyNames, RetryPolicy, Scheduler } from '@studnicky/dagonizer';
import { Clock, Dagonizer } from '@studnicky/dagonizer';
import { VirtualClockProvider, VirtualScheduler } from '@studnicky/dagonizer/testing';
import { FetchState, FetchNode, FlakyDownstream, TransientError, dag } from './dags/07-retry.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region runtime
const dispatcher = new Dagonizer<FetchState>();
dispatcher.registerNode(new FetchNode());
dispatcher.registerDAG(dag);

const state = new FetchState();
await dispatcher.execute('retry-dag', state);

// FlakyDownstream (inside FetchNode.execute) throws twice before succeeding.
// The stub is per-execution so attempts are scoped to the node invocation.
process.stdout.write('\nRetry DAG: fetch with EXPONENTIAL backoff\n');
process.stdout.write(`  result="${state.result}"\n`);
process.stdout.write('\nLesson: RetryPolicy.run(fn, { signal }) retries on declared error classes;\n');
process.stdout.write('        passing context.signal ensures abort short-circuits the delay.\n');
// #endregion runtime

// ---------------------------------------------------------------------------
// Deterministic testing: VirtualScheduler makes retry sleeps instant
// ---------------------------------------------------------------------------

// #region deterministic-testing
// Install VirtualScheduler and VirtualClockProvider before the policy run so
// retry sleeps do not block real wall time. Drive each backoff window with
// scheduler.advance(ms); call Clock.reset() + Scheduler.reset() when done.
const clock     = new VirtualClockProvider(0n);
const scheduler = new VirtualScheduler(0);
Clock.configure(clock);
Scheduler.configure(scheduler);

const testPolicy = RetryPolicy.from({
  maxAttempts:  3,
  strategy:     BackoffStrategyNames.EXPONENTIAL,
  baseDelay:    1_000,   // 1 s → 2 s; instant under VirtualScheduler
  jitterFactor: 0,
  retryOn:      [TransientError],
});
const testDownstream = new FlakyDownstream(); // throws twice, succeeds on third
const testRun = testPolicy.run(() => testDownstream.call());

// Step through each backoff window without real wall-clock delay.
await new Promise<void>((r) => setImmediate(r)); // let first backoff register
scheduler.advance(1_000);                         // drain the 1 s backoff

await new Promise<void>((r) => setImmediate(r)); // let second backoff register
scheduler.advance(2_000);                         // drain the 2 s backoff

const testResult = await testRun;                 // attempt 3 succeeds
Clock.reset();
Scheduler.reset();
// #endregion deterministic-testing

process.stdout.write(`\nDeterministic test: result="${testResult}" after ${String(testDownstream.attempts)} attempts\n`);
process.stdout.write('VirtualScheduler: retry sleeps are instant; drive with advance(ms).\n');

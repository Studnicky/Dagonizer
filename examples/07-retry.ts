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

import { Dagonizer } from '@noocodex/dagonizer';
import { FetchState, fetchNode, dag } from './dags/07-retry.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region runtime
const dispatcher = new Dagonizer<FetchState>();
dispatcher.registerNode(fetchNode);
dispatcher.registerDAG(dag);

const state = new FetchState();
await dispatcher.execute('retry-dag', state);

// FlakyDownstream (inside fetchNode.execute) throws twice before succeeding.
// The stub is per-execution so attempts are scoped to the node invocation.
process.stdout.write('\nRetry DAG: fetch with EXPONENTIAL backoff\n');
process.stdout.write(`  result="${state.result}"\n`);
process.stdout.write('\nLesson: RetryPolicy.run(fn, { signal }) retries on declared error classes;\n');
process.stdout.write('        passing context.signal ensures abort short-circuits the delay.\n');
// #endregion runtime

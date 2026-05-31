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
import { S, fetchNode, dag, flakyAttempts } from './dags/07-retry.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region runtime
const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(fetchNode);
dispatcher.registerDAG(dag);

const state = new S();
await dispatcher.execute('retry-dag', state);

// flakyAttempts is a live binding from the dag module; it reflects the count
// accumulated during execution.
process.stdout.write('\nRetry DAG: fetch with EXPONENTIAL backoff\n');
process.stdout.write(`  attempts=${flakyAttempts}  result="${state.result}"\n`);
process.stdout.write(`  (threw ${flakyAttempts - 1} time(s) before succeeding)\n`);
process.stdout.write('\nLesson: RetryPolicy.run(fn, signal) retries on declared error classes;\n');
process.stdout.write('        passing context.signal ensures abort short-circuits the delay.\n');
// #endregion runtime

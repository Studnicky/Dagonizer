/**
 * 22-backoff-strategies: RetryPolicy with each BackoffStrategy, driven by
 * VirtualScheduler for deterministic instant execution.
 *
 * Demonstrates all four backoff strategies available in `BackoffStrategy`:
 *   CONSTANT         — fixed delay between every retry
 *   LINEAR           — delay grows linearly with attempt number
 *   EXPONENTIAL      — delay grows by multiplier^(attempt-1) (default strategy)
 *   DECORRELATED_JITTER — random delay in [baseDelay, baseDelay × 3]
 *
 * Each strategy run uses:
 *   - `RetryPolicy.from(...)` with `jitterFactor: 0` (except jitter) so the
 *     delay sequence is exact and predictable.
 *   - `VirtualScheduler` (from `@noocodex/dagonizer/testing`) so retries
 *     complete in zero real time — virtual time is advanced programmatically.
 *   - `RecordingPolicy` (a RetryPolicy subclass) that intercepts `getDelay()`
 *     to capture the computed delay before forwarding to the scheduler.
 *
 * Watch: the delay column in the printed table shows the sequence each
 * strategy produces. Real retries (production) would sleep these durations;
 * the virtual scheduler drains them instantly.
 *
 * DAG helper module (FlakyStub): examples/dags/22-backoff-strategies.ts
 *
 * Run: npx tsx examples/22-backoff-strategies.ts
 */

import {
  BackoffStrategy,
  RetryPolicy,
  Scheduler,
} from '@noocodex/dagonizer';
import type { BackoffStrategyValue } from '@noocodex/dagonizer';
import { VirtualScheduler } from '@noocodex/dagonizer/testing';

import { FlakyStub } from './dags/22-backoff-strategies.js';

// ---------------------------------------------------------------------------
// RecordingPolicy: subclass that intercepts getDelay() to capture the delay
// sequence without altering the retry logic in any other way.
// ---------------------------------------------------------------------------

// #region recording-policy
class RecordingPolicy extends RetryPolicy {
  readonly #delays: number[] = [];

  get delays(): readonly number[] { return this.#delays; }

  override getDelay(attempt: number, options?: { error: Error | null }): number {
    const delay = super.getDelay(attempt, options);
    this.#delays.push(delay);
    return delay;
  }
}
// #endregion recording-policy

// ---------------------------------------------------------------------------
// runStrategy: drive a single strategy through N retries under VirtualScheduler
// ---------------------------------------------------------------------------

// #region run-strategy
async function runStrategy(
  strategyName: string,
  strategy: BackoffStrategyValue,
  baseDelay: number,
  maxAttempts: number,
  jitterFactor: number,
): Promise<{ delays: readonly number[]; attempts: number }> {
  const scheduler = new VirtualScheduler(0);
  Scheduler.configure(scheduler);

  const policy = new RecordingPolicy({
    strategy,
    baseDelay,
    maxAttempts,
    jitterFactor,
    maxDelay: 100_000, // high cap so we see the raw strategy values
  });

  // Stub that fails (maxAttempts - 1) times then succeeds.
  const stub = new FlakyStub(maxAttempts - 1);
  const runPromise = policy.run(() => stub.call());

  // Drive each retry by advancing virtual time past the scheduled delay.
  // Each cycle: yield to let the pending `after()` register in the scheduler,
  // then capture how far ahead we need to advance to drain it.
  for (let i = 0; i < maxAttempts - 1; i++) {
    // Let the retry's `after(delay)` call register in the VirtualScheduler.
    await new Promise<void>((r) => setImmediate(r));
    // Peek at the next pending entry's target time, then advance to it.
    // scheduler.virtualNow is at the previous advance point; the next pending
    // entry sits at virtualNow + delay.
    const nextAt = scheduler.virtualNow;
    scheduler.runAll(); // drain all due entries up to the end of the pending queue
    void nextAt;        // used implicitly via runAll
  }

  await runPromise;
  Scheduler.reset();

  process.stdout.write(`\n  ${strategyName}:\n`);
  for (let i = 0; i < policy.delays.length; i++) {
    process.stdout.write(`    attempt ${String(i + 1)} failed → wait ${String(Math.round(policy.delays[i] ?? 0))} ms\n`);
  }
  process.stdout.write(`    attempt ${String(maxAttempts)} succeeded\n`);

  return { delays: policy.delays, attempts: stub.attempts };
}
// #endregion run-strategy

// ---------------------------------------------------------------------------
// Run all four strategies
// ---------------------------------------------------------------------------

process.stdout.write('\n22-backoff-strategies: RetryPolicy delay sequences per strategy\n');
process.stdout.write('(maxAttempts=4, baseDelay=100 ms, VirtualScheduler = instant)\n');

const MAX_ATTEMPTS = 4;
const BASE_DELAY   = 100;

// #region strategies
// CONSTANT: every wait is exactly baseDelay.
await runStrategy('CONSTANT', BackoffStrategy.CONSTANT, BASE_DELAY, MAX_ATTEMPTS, 0);

// LINEAR: wait grows as baseDelay × attempt (100, 200, 300 ms …).
await runStrategy('LINEAR', BackoffStrategy.LINEAR, BASE_DELAY, MAX_ATTEMPTS, 0);

// EXPONENTIAL: wait grows as baseDelay × 2^(attempt-1) (100, 200, 400 ms …).
await runStrategy('EXPONENTIAL', BackoffStrategy.EXPONENTIAL, BASE_DELAY, MAX_ATTEMPTS, 0);

// DECORRELATED_JITTER: wait is random in [baseDelay, baseDelay × 3].
// jitterFactor is ignored for this strategy; the output varies each run.
await runStrategy('DECORRELATED_JITTER', BackoffStrategy.DECORRELATED_JITTER, BASE_DELAY, MAX_ATTEMPTS, 0.1);
// #endregion strategies

process.stdout.write('\nLesson: choose a strategy to match your retry workload:\n');
process.stdout.write('  CONSTANT          — simple fixed cooldown\n');
process.stdout.write('  LINEAR            — graduated cooldown for overloaded upstreams\n');
process.stdout.write('  EXPONENTIAL       — default; aggressive back-off for persistent errors\n');
process.stdout.write('  DECORRELATED_JITTER — spread retry storms across many callers\n');
process.stdout.write('\n  VirtualScheduler makes retry tests instant; install before the run,\n');
process.stdout.write('  drive with scheduler.runAll() / advance(), restore with Scheduler.reset().\n');

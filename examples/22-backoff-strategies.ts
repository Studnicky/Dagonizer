/**
 * 22-backoff-strategies: RetryPolicy with each BackoffStrategy, run in real
 * time with small delays and elapsed-time verification.
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
 *   - `RecordingPolicy` (a RetryPolicy subclass) that intercepts `getDelay()`
 *     to capture the computed delay before the wait happens.
 *
 * `RetryPolicy`'s backoff delays run on `@studnicky/retry`'s own internal
 * timer (not the injected `Scheduler`), so a `VirtualScheduler` cannot drain
 * them — the run genuinely sleeps `baseDelay`-scaled milliseconds between
 * attempts. This example uses a small `baseDelay` (20ms) to keep the total
 * real time short, and asserts the run's elapsed time is at least the sum
 * of the recorded delays.
 *
 * Watch: the delay column in the printed table shows the sequence each
 * strategy produces, and the elapsed real time confirms the run actually
 * waited that long.
 *
 * DAG helper module (FlakyStub): examples/dags/22-backoff-strategies.ts
 *
 * Run: npx tsx examples/22-backoff-strategies.ts
 */

import {
  BackoffStrategyNames,
  RetryPolicy,
} from '@studnicky/dagonizer';
import type { BackoffStrategyType, RetryPolicyOptionsType } from '@studnicky/dagonizer';

import { FlakyStub } from './dags/22-backoff-strategies.js';

// ---------------------------------------------------------------------------
// RecordingPolicy: subclass that intercepts getDelay() to capture the delay
// sequence without altering the retry logic in any other way.
// ---------------------------------------------------------------------------

// #region recording-policy
class RecordingPolicy extends RetryPolicy {
  readonly #delays: number[] = [];

  constructor(options?: RetryPolicyOptionsType) {
    super(options);
  }

  get delays(): readonly number[] { return this.#delays; }

  override getDelay(attempt: number, options: { readonly error: Error | null } = { 'error': null }): number {
    const delay = super.getDelay(attempt, options);
    this.#delays.push(delay);
    return delay;
  }
}
// #endregion recording-policy

// ---------------------------------------------------------------------------
// StrategyRunner: drives a single strategy through N retries in real time
// and verifies the run's elapsed time against the recorded delay sequence.
// ---------------------------------------------------------------------------

// #region run-strategy
class StrategyRunner {
  static async run(
    strategyName: string,
    strategy: BackoffStrategyType,
    baseDelay: number,
    maxAttempts: number,
    jitterFactor: number,
  ): Promise<{ delays: readonly number[]; attempts: number }> {
    const policy = new RecordingPolicy({
      strategy,
      baseDelay,
      maxAttempts,
      jitterFactor,
      maxDelay: 100_000, // high cap so we see the raw strategy values
    });

    // Stub that fails (maxAttempts - 1) times then succeeds.
    const stub = new FlakyStub(maxAttempts - 1);
    const startedAt = Date.now();
    await policy.run(() => stub.call());
    const elapsedMs = Date.now() - startedAt;

    const totalDelayMs = policy.delays.reduce((sum, delay) => sum + delay, 0);
    if (elapsedMs < totalDelayMs) {
      throw new Error(`${strategyName}: expected at least ${String(totalDelayMs)}ms elapsed, got ${String(elapsedMs)}ms`);
    }

    process.stdout.write(`\n  ${strategyName}:\n`);
    for (let i = 0; i < policy.delays.length; i++) {
      process.stdout.write(`    attempt ${String(i + 1)} failed → wait ${String(Math.round(policy.delays[i] ?? 0))} ms\n`);
    }
    process.stdout.write(`    attempt ${String(maxAttempts)} succeeded (${String(elapsedMs)}ms elapsed)\n`);

    return { delays: policy.delays, attempts: stub.attempts };
  }
}
// #endregion run-strategy

// ---------------------------------------------------------------------------
// Run all four strategies
// ---------------------------------------------------------------------------

process.stdout.write('\n22-backoff-strategies: RetryPolicy delay sequences per strategy\n');
process.stdout.write('(maxAttempts=4, baseDelay=20 ms, real-time waits)\n');

const MAX_ATTEMPTS = 4;
const BASE_DELAY   = 20;

// #region strategies
// CONSTANT: every wait is exactly baseDelay.
await StrategyRunner.run('CONSTANT', BackoffStrategyNames.CONSTANT, BASE_DELAY, MAX_ATTEMPTS, 0);

// LINEAR: wait grows as baseDelay × attempt (20, 40, 60 ms …).
await StrategyRunner.run('LINEAR', BackoffStrategyNames.LINEAR, BASE_DELAY, MAX_ATTEMPTS, 0);

// EXPONENTIAL: wait grows as baseDelay × 2^(attempt-1) (20, 40, 80 ms …).
await StrategyRunner.run('EXPONENTIAL', BackoffStrategyNames.EXPONENTIAL, BASE_DELAY, MAX_ATTEMPTS, 0);

// DECORRELATED_JITTER: wait is random in [baseDelay, baseDelay × 3].
// jitterFactor is ignored for this strategy; the output varies each run.
await StrategyRunner.run('DECORRELATED_JITTER', BackoffStrategyNames.DECORRELATED_JITTER, BASE_DELAY, MAX_ATTEMPTS, 0.1);
// #endregion strategies

process.stdout.write('\nLesson: choose a strategy to match your retry workload:\n');
process.stdout.write('  CONSTANT          — simple fixed cooldown\n');
process.stdout.write('  LINEAR            — graduated cooldown for overloaded upstreams\n');
process.stdout.write('  EXPONENTIAL       — default; aggressive back-off for persistent errors\n');
process.stdout.write('  DECORRELATED_JITTER — spread retry storms across many callers\n');
process.stdout.write('\n  RetryPolicy backoff sleeps on a real timer (substrate\'s Retry), not the\n');
process.stdout.write('  injected Scheduler, so VirtualScheduler cannot drain these waits.\n');

/**
 * virtual-clock/dags: deterministic retry demo using VirtualClockProvider +
 * VirtualScheduler from @noocodex/dagonizer/testing and RetryPolicy from
 * @noocodex/dagonizer/runtime.
 *
 * Virtual time is advanced programmatically so retries run without real waits.
 * Call `demonstrateVirtualClock()` to run the example; importing this module
 * alone has no side effects.
 */

import { BackoffStrategy, Clock, RetryPolicy, Scheduler } from '@noocodex/dagonizer/runtime';
import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing';

// #region virtual-time
/**
 * Installs virtual time providers, drives a flaky retry through exponential
 * backoff by advancing the virtual clock, then restores real-time providers.
 * Wrapping side-effectful setup in a function keeps module import clean.
 */
export async function demonstrateVirtualClock(): Promise<void> {
  // ── Install virtual time ────────────────────────────────────────────────────

  const clock     = new VirtualClockProvider(0n);   // starts at t=0 ns
  const scheduler = new VirtualScheduler(0);         // starts at t=0 ms

  // VirtualClock drives Clock.monotonicMs(); VirtualScheduler drives Scheduler.
  // Both must be installed before the RetryPolicy runs.
  Clock.configure(clock);
  Scheduler.configure(scheduler);

  // ── Flaky operation: succeeds on the third attempt ─────────────────────────

  let attempts = 0;

  async function fetchCatalogueEntry(): Promise<string> {
    attempts++;
    if (attempts < 3) throw new Error('transient catalogue timeout');
    return 'The Archivist Compendium, Vol. 1';
  }

  // ── RetryPolicy with exponential backoff, zero jitter for determinism ───────

  const policy = RetryPolicy.from({
    maxAttempts:  5,
    strategy:     BackoffStrategy.EXPONENTIAL,
    baseDelay:    100,    // 100ms → 200ms → 400ms …
    jitterFactor: 0,      // no jitter: delays are exact, enabling deterministic advance
  });

  // ── Drive retries by advancing virtual time ─────────────────────────────────

  // Run the policy; each retry will park waiting in the VirtualScheduler.
  const runPromise = policy.run(() => fetchCatalogueEntry());

  // Drive retries: yield control so each retry's `after()` promise registers in
  // the VirtualScheduler, then advance past that backoff window.  Without the
  // setImmediate yield the advance() call runs before the pending entry exists.

  // Attempt 1 fails; policy schedules a 100ms wait.
  await new Promise<void>((r) => setImmediate(r));   // let microtasks settle
  scheduler.advance(100);                             // drain the 100ms backoff

  // Attempt 2 fails; policy schedules a 200ms wait.
  await new Promise<void>((r) => setImmediate(r));   // let microtasks settle
  scheduler.advance(200);                             // drain the 200ms backoff

  // Attempt 3 succeeds; the promise resolves without further advancement.
  const title = await runPromise;
  // title === 'The Archivist Compendium, Vol. 1'
  // attempts === 3
  // scheduler.virtualNow === 300 (100 + 200 ms of virtual time elapsed)

  // ── Restore real-time providers so subsequent tests are unaffected ──────────
  Scheduler.reset();
  Clock.reset();

  if (title !== 'The Archivist Compendium, Vol. 1') throw new Error(`unexpected title: ${title}`);
}
// #endregion virtual-time

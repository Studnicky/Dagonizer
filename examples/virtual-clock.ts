/**
 * virtual-clock: deterministic retry timing under VirtualClockProvider +
 * VirtualScheduler from @studnicky/dagonizer/testing.
 *
 * Virtual time providers replace the real wall-clock so retry backoff intervals
 * are driven by programmatic calls to scheduler.advance(ms) rather than actual
 * waits. This makes retry behaviour testable in zero elapsed wall-clock time.
 *
 * The example uses a flaky operation that fails on the first two attempts and
 * succeeds on the third. Exponential backoff delays are 100ms → 200ms (300ms
 * total virtual time). Both ClockProvider and Scheduler are restored to real
 * time after the demonstration.
 *
 * DAG definition (re-exported providers): examples/dags/virtual-clock.ts
 *
 * Run: npx tsx examples/virtual-clock.ts
 */

import { BackoffStrategy, Clock, RetryPolicy, Scheduler } from '@studnicky/dagonizer/runtime';
import { VirtualClockProvider, VirtualScheduler } from '@studnicky/dagonizer/testing';

process.stdout.write('\n=== VirtualClock: deterministic retry under programmatic time ===\n\n');

// ── Install virtual time ────────────────────────────────────────────────────

const clock     = new VirtualClockProvider(0n);   // starts at t=0 ns
const scheduler = new VirtualScheduler(0);         // starts at t=0 ms

// VirtualClock drives Clock.monotonicMs(); VirtualScheduler drives Scheduler.
// Both must be installed before the RetryPolicy runs.
Clock.configure(clock);
Scheduler.configure(scheduler);

// ── Flaky operation: succeeds on the third attempt ─────────────────────────

let attempts = 0;

// ── RetryPolicy with exponential backoff, zero jitter for determinism ───────

const policy = RetryPolicy.from({
  maxAttempts:  5,
  strategy:     BackoffStrategy.EXPONENTIAL,
  baseDelay:    100,    // 100ms → 200ms → 400ms …
  jitterFactor: 0,      // no jitter: delays are exact, enabling deterministic advance
});

// ── Drive retries by advancing virtual time ─────────────────────────────────

// Run the policy; each retry will park waiting in the VirtualScheduler.
// The operation fails on attempts 1 and 2, succeeds on attempt 3.
const runPromise = policy.run(async () => {
  attempts++;
  if (attempts < 3) throw new Error('transient catalogue timeout');
  return 'The Archivist Compendium, Vol. 1';
});

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

process.stdout.write('demonstrateVirtualClock completed: 3 attempts, 300ms virtual time elapsed\n');
process.stdout.write('\nLesson: VirtualClockProvider + VirtualScheduler replace global time;\n');
process.stdout.write('        advance() drains pending timers without real waits.\n');

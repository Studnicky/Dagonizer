/**
 * virtual-scheduler-clock.test.ts
 *
 * Coverage for testing-infrastructure primitives:
 *
 * S1 — VirtualScheduler.every() abort:
 *   When the signal is aborted, the every() iterator returns without yielding
 *   further values. The in-flight after() is rejected and the async generator
 *   catches it and stops.
 *
 * S2 — VirtualClockProvider setNs / tickNs:
 *   setNs sets virtual hrtime to an absolute nanosecond value;
 *   tickNs advances by a delta; tickMs converts milliseconds.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

// ---------------------------------------------------------------------------
// S1 — VirtualScheduler.every() abort
// ---------------------------------------------------------------------------

void describe('VirtualScheduler.every() — abort (S1)', () => {
  void it('stops yielding when signal is aborted before any advance', async () => {
    const sched = new VirtualScheduler(0);
    const controller = new AbortController();

    // Abort immediately — no advance.
    controller.abort();

    const yields: number[] = [];
    for await (const _ of sched.every(100, { 'signal': controller.signal })) {
      yields.push(1);
    }

    // With the signal already aborted, the loop must terminate without yielding.
    assert.strictEqual(yields.length, 0, 'no values should be yielded when signal is pre-aborted');
  });

  void it('stops after one yield when signal aborts before the second interval', async () => {
    const sched = new VirtualScheduler(0);
    const controller = new AbortController();

    const yields: number[] = [];
    const iterating = (async () => {
      for await (const _ of sched.every(100, { 'signal': controller.signal })) {
        yields.push(1);
        if (yields.length === 1) {
          // Abort after collecting the first yield.
          controller.abort();
        }
      }
    })();

    // Advance past the first interval → yield 1.
    sched.advance(100);
    // Attempt a second advance — the loop should have exited already.
    sched.advance(100);

    await iterating;

    assert.strictEqual(yields.length, 1, 'exactly one yield before abort');
  });

  void it('yields multiple values before abort and stops cleanly', async () => {
    const sched = new VirtualScheduler(0);
    const controller = new AbortController();
    const INTERVAL = 50;
    const TARGET = 3;

    const yields: number[] = [];
    const iterating = (async () => {
      for await (const _ of sched.every(INTERVAL, { 'signal': controller.signal })) {
        yields.push(yields.length);
        if (yields.length === TARGET) controller.abort();
      }
    })();

    // Advance one interval at a time, yielding between advances so the
    // async generator can process each yield before we advance again.
    for (let i = 0; i < TARGET + 1; i++) {
      sched.advance(INTERVAL);
      // Yield microtask queue so the for-await body runs before next advance.
      await new Promise<void>((r) => setImmediate(r));
      if (controller.signal.aborted) break;
    }

    await iterating;
    assert.strictEqual(yields.length, TARGET, `expected exactly ${TARGET} yields`);
  });
});

// ---------------------------------------------------------------------------
// S2 — VirtualClockProvider setNs / tickNs
// ---------------------------------------------------------------------------

void describe('VirtualClockProvider setNs / tickNs / tickMs (S2)', () => {
  void it('initial hrtime is 0 by default', () => {
    const clock = new VirtualClockProvider();
    assert.strictEqual(clock.hrtime(), 0n);
  });

  void it('setNs sets hrtime to an absolute nanosecond value', () => {
    const clock = new VirtualClockProvider(0n);
    clock.setNs(500_000_000n);
    assert.strictEqual(clock.hrtime(), 500_000_000n);
  });

  void it('setNs overwrites the previous value', () => {
    const clock = new VirtualClockProvider(1_000n);
    clock.setNs(50n);
    assert.strictEqual(clock.hrtime(), 50n, 'setNs must overwrite, not add');
  });

  void it('tickNs advances hrtime by the given delta', () => {
    const clock = new VirtualClockProvider(0n);
    clock.tickNs(1_000_000n);
    assert.strictEqual(clock.hrtime(), 1_000_000n);
    clock.tickNs(500n);
    assert.strictEqual(clock.hrtime(), 1_000_500n);
  });

  void it('tickMs converts ms to ns and advances hrtime', () => {
    const clock = new VirtualClockProvider(0n);
    clock.tickMs(1);   // 1ms = 1_000_000ns
    assert.strictEqual(clock.hrtime(), 1_000_000n);
    clock.tickMs(10);  // +10ms
    assert.strictEqual(clock.hrtime(), 11_000_000n);
  });

  void it('constructor accepts a custom initial nanosecond value', () => {
    const clock = new VirtualClockProvider(999_999n);
    assert.strictEqual(clock.hrtime(), 999_999n);
  });
});

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Clock } from '../../src/runtime/Clock.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualClockProvider } from '../../testing/VirtualClock.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

const NS_PER_MS = 1_000_000n;

void describe('Clock + VirtualClockProvider', () => {
  afterEach(() => { Clock.reset(); });

  void it('default Clock.hrtime() returns monotonic-increasing nanoseconds', () => {
    const a = Clock.hrtime();
    const b = Clock.hrtime();
    assert.ok(b >= a);
    assert.ok(typeof a === 'bigint');
  });

  void it('configure installs a virtual provider', () => {
    const v = new VirtualClockProvider(1000n * NS_PER_MS);
    Clock.configure(v);
    assert.equal(Clock.monotonicMs(), 1000);
    v.tickMs(500);
    assert.equal(Clock.monotonicMs(), 1500);
  });

  void it('Clock.hrtime() advances with virtual ticks', () => {
    const v = new VirtualClockProvider(0n);
    Clock.configure(v);
    const before = Clock.hrtime();
    v.tickMs(1);
    const after = Clock.hrtime();
    assert.equal(after - before, NS_PER_MS);
  });
});

void describe('Scheduler + VirtualScheduler', () => {
  afterEach(() => { Scheduler.reset(); Clock.reset(); });

  void it('fires tasks in order via runUntil', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);
    const fired: string[] = [];

    void Scheduler.current().at(100).then(() => { fired.push('first'); });
    void Scheduler.current().at(50).then(() => { fired.push('zero'); });
    void Scheduler.current().at(200).then(() => { fired.push('last'); });

    sched.runUntil(100);
    await new Promise<void>((r) => setImmediate(r));
    assert.deepEqual(fired, ['zero', 'first']);

    sched.runUntil(300);
    await new Promise<void>((r) => setImmediate(r));
    assert.deepEqual(fired, ['zero', 'first', 'last']);
  });

  void it('advance moves time forward and fires due tasks', async () => {
    const sched = new VirtualScheduler(0);
    Scheduler.configure(sched);
    let fired = false;
    void Scheduler.current().at(500).then(() => { fired = true; });

    sched.advance(499);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(fired, false);
    sched.advance(1);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(fired, true);
  });

  void it('after uses delayMs relative to virtualNow', async () => {
    const sched = new VirtualScheduler(2_000);
    Scheduler.configure(sched);
    let fired = false;
    void Scheduler.current().after(100).then(() => { fired = true; });
    sched.advance(99);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(fired, false);
    sched.advance(1);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(fired, true);
  });

  void it('signal abort rejects the pending promise', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);
    const controller = new AbortController();
    const promise = Scheduler.current().at(100, controller.signal);
    controller.abort(new Error('aborted by test'));
    await assert.rejects(promise, /aborted by test/);
  });

  void it('cancelAll rejects all pending promises', async () => {
    const sched = new VirtualScheduler();
    Scheduler.configure(sched);
    const p1 = Scheduler.current().at(10).catch(() => 'rejected');
    const p2 = Scheduler.current().at(20).catch(() => 'rejected');
    sched.cancelAll();
    assert.deepEqual(await Promise.all([p1, p2]), ['rejected', 'rejected']);
  });
});

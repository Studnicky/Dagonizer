/**
 * virtual-clock: deterministic per-node-timeout testing under
 * VirtualScheduler from @studnicky/dagonizer/testing.
 *
 * `RetryPolicy`'s backoff delays run on `@studnicky/retry`'s own internal
 * timer (not the injected `Scheduler`), so `VirtualScheduler.advance()` no
 * longer drives retry timing — that seam is gone. Per-node `timeout`
 * budgets are unaffected: `Dagonizer.withNodeTimeout` arms its deadline via
 * `Scheduler.current().after(ms, ...)` (src/Dagonizer.ts), so installing a
 * `VirtualScheduler` before `dispatcher.execute()` still lets the deadline
 * be driven deterministically with `scheduler.advance(ms)`, in zero real
 * wall-clock time.
 *
 * The example runs a single-node DAG whose node has a 200ms `timeout` and
 * never resolves on its own; advancing the VirtualScheduler past the budget
 * fires the timeout deterministically.
 *
 * DAG definition (state, slow node, DAG): examples/dags/virtual-clock.ts
 *
 * Run: npx tsx examples/virtual-clock.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { Scheduler, SlowNode, SlowState, VirtualScheduler, dag } from './dags/virtual-clock.js';

process.stdout.write('\n=== VirtualClock: deterministic per-node timeout under programmatic time ===\n\n');

// ── Install a virtual scheduler ─────────────────────────────────────────────

const scheduler = new VirtualScheduler(0); // starts at t=0 ms
Scheduler.configure(scheduler);

// ── Run the DAG: the node never resolves on its own; the 200ms timeout ─────
// ── budget on SlowNode must fire to complete the run.                   ────

const dispatcher = new Dagonizer<SlowState>();
dispatcher.registerNode(new SlowNode());
dispatcher.registerDAG(dag);

const state = new SlowState();
const startedAt = Date.now();
const runPromise = dispatcher.execute('virtual-clock-dag', state);

// Drive the timeout concurrently while the run awaits: yield so the node's
// `.after(200)` registers in the VirtualScheduler, advance past the budget,
// then yield again so the deadline rejection and abort propagation settle.
const advancer = (async (): Promise<void> => {
  await new Promise<void>((r) => setImmediate(r)); // let the node start and register .after(200)
  scheduler.advance(201);                          // trigger the timeout
  await new Promise<void>((r) => setImmediate(r)); // flush .then() → deadlineReject + childCtrl.abort
  scheduler.runAll();                              // drain any remaining entries
  await new Promise<void>((r) => setImmediate(r)); // flush abort propagation to the node signal
})();

const result = await runPromise;
await advancer;
const elapsedMs = Date.now() - startedAt;

// ── Restore the real scheduler so subsequent code is unaffected ────────────
Scheduler.reset();

if (result.state.lifecycle.variant !== 'failed') {
  throw new Error(`expected the node timeout to fail the run, got ${result.state.lifecycle.variant}`);
}

process.stdout.write(`demonstrateVirtualClock completed: node timeout fired at 200ms virtual time, ${String(elapsedMs)}ms real time elapsed\n`);
process.stdout.write('\nLesson: VirtualScheduler still drives per-node `timeout` deadlines\n');
process.stdout.write('        (Scheduler.current().after()); it no longer drives RetryPolicy\n');
process.stdout.write('        backoff, which sleeps on substrate\'s own internal timer.\n');

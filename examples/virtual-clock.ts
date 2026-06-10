/**
 * virtual-clock: deterministic retry timing under VirtualClockProvider +
 * VirtualScheduler from @noocodex/dagonizer/testing.
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
 * DAG definition (demonstrateVirtualClock export): examples/dags/virtual-clock.ts
 *
 * Run: npx tsx examples/virtual-clock.ts
 */

import { demonstrateVirtualClock } from './dags/virtual-clock.js';

process.stdout.write('\n=== VirtualClock: deterministic retry under programmatic time ===\n\n');

// demonstrateVirtualClock() is fully self-contained:
//   1. Installs VirtualClockProvider + VirtualScheduler.
//   2. Runs a flaky fetch (fails on attempts 1 and 2, succeeds on 3).
//   3. Advances the scheduler 100ms + 200ms to drain each backoff wait.
//   4. Verifies the expected title was returned.
//   5. Restores real-time providers.
//
// No real wall-clock time elapses; the retries run synchronously from the
// event-loop's perspective by resolving the scheduler's pending timers.

await demonstrateVirtualClock();

process.stdout.write('demonstrateVirtualClock() completed: 3 attempts, 300ms virtual time elapsed\n');
process.stdout.write('\nLesson: VirtualClockProvider + VirtualScheduler replace global time;\n');
process.stdout.write('        advance() drains pending timers without real waits.\n');

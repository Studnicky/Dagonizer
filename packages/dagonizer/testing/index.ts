/**
 * Test utilities. Not part of the runtime; install in tests/replay only.
 *
 *   import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing';
 *   Clock.configure(new VirtualClockProvider());
 *   Scheduler.configure(new VirtualScheduler());
 */

export { VirtualClockProvider } from './VirtualClock.js';
export { VirtualScheduler } from './VirtualScheduler.js';

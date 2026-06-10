import type { SchedulerProvider } from './SchedulerProvider.js';

/**
 * Public scheduling surface returned by `Scheduler.current()`.
 *
 * Derived from `SchedulerProvider` — the shapes are structurally identical so
 * a single definition owns the method list. `SchedulerHandle` is the consumer
 * surface (what engine code receives from `Scheduler.current()`);
 * `SchedulerProvider` is the backend surface (what implementors satisfy, e.g.
 * `RealTimeScheduler`, `VirtualScheduler`). Both names remain exported so
 * consumers that annotate call sites with `SchedulerHandle` and implementors
 * that annotate classes with `SchedulerProvider` each use the correct name.
 */
export type SchedulerHandle = SchedulerProvider;

export { Clock } from './Clock.js';
export { DottedPathAccessor } from './DottedPathAccessor.js';
export { RealTimeScheduler } from './RealTimeScheduler.js';
export { Scheduler } from './Scheduler.js';
export { SignalComposer } from './SignalComposer.js';
export { RetryPolicy } from './RetryPolicy.js';

// `Timeout` is an entity (dependency-free reified time budget). It lives at
// `entities/Timeout.ts` so `contracts/` can type-import it inward without a
// cycle; re-exported here to preserve the `./runtime` public subpath.
export { Timeout } from '../entities/Timeout.js';

// Adapter contracts live in `contracts/` (single source of truth).
// They are re-exported through this barrel for ergonomic `runtime/` imports
// when consumers want both the engine class and its contract together.
export type { ClockProvider } from '../contracts/ClockProvider.js';
export type { SchedulerProvider } from '../contracts/SchedulerProvider.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
export type { StateAccessor } from '../contracts/StateAccessor.js';

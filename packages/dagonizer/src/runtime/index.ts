export { Clock } from './Clock.js';
export { DottedPathAccessor } from './DottedPathAccessor.js';
export { NoopWarningEmitter } from './NoopWarningEmitter.js';
export { RealTimeScheduler } from './RealTimeScheduler.js';
export { Scheduler } from './Scheduler.js';
export { SignalComposer } from './SignalComposer.js';
export { BackoffStrategy, RetryPolicy } from './RetryPolicy.js';
export type { BackoffStrategyValue } from './RetryPolicy.js';

// Adapter contracts live in `contracts/` (single source of truth).
// They are re-exported through this barrel for ergonomic `runtime/` imports
// when consumers want both the engine class and its contract together.
export type { ClockProvider } from '../contracts/ClockProvider.js';
export type { SchedulerHandle } from '../contracts/SchedulerHandle.js';
export type { SchedulerProvider } from '../contracts/SchedulerProvider.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { RetryPolicyOptionsInterface } from '../contracts/RetryPolicyOptionsInterface.js';
export type { StateAccessor } from '../contracts/StateAccessor.js';

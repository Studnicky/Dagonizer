export { Clock } from './Clock.js';
export { DagExecutionContext, DagExecutionContextKeys, DagExecutionScope } from './DagExecutionContext.js';
export { DottedPathAccessor } from './DottedPathAccessor.js';
export { RealTimeScheduler } from './RealTimeScheduler.js';
export { Scheduler } from './Scheduler.js';
export { RetryPolicy } from './RetryPolicy.js';

// `Timeout` is an entity (dependency-free reified time budget). It lives at
// `entities/Timeout.ts` so `contracts/` can type-import it inward without a
// cycle; re-exported here to preserve the `./runtime` public subpath.
export { Timeout } from '../entities/Timeout.js';

// Adapter contracts live in `contracts/` (single source of truth).
// They are re-exported through this barrel for ergonomic `runtime/` imports
// when consumers want both the engine class and its contract together.
export type { ClockProviderInterface } from '../contracts/ClockProviderInterface.js';
export type { SchedulerProviderInterface } from '../contracts/SchedulerProviderInterface.js';
export type { ErrorConstructorType } from '../contracts/ErrorConstructorType.js';
export type { ErrorMatcherType } from '../contracts/ErrorMatcherType.js';
export type { RetryPolicyOptionsType } from '../contracts/RetryPolicyOptionsType.js';
export type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';

// Child-state factory: class with default clone-parent factory constant.
export { ChildStateFactory } from './ChildStateFactory.js';
// ChildStateFactoryType lives in contracts/ (single source of truth).
export type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';

/**
 * DAGLifecycleMachine: pure reducer + initial-state factory + terminal
 * predicate for the lifecycle defined in `DAGLifecycleStateType.ts`.
 *
 * Side-effect-free: no IO, no logging. The `at` field on each event carries
 * the monotonic clock value; callers supply it explicitly (production callers
 * use `clock.monotonicMs()`; tests supply a pinned value for determinism).
 *
 * Transitions:
 *
 *   pending  + start         → running   (startedAt)
 *   running  + succeed       → completed (finishedAt)
 *   running  + fail(error)   → failed    (finishedAt, error carried)
 *   running  + cancel(reason)→ cancelled (finishedAt, reason carried)
 *   running  + timeout       → timed_out (finishedAt)
 *
 * Terminal stickiness: every variant in {completed, failed, cancelled, timed_out}
 * ignores all events and returns itself unchanged (by reference).
 *
 * Illegal transitions return the input state by reference. `NodeStateBase`
 * detects `next === current` after dispatch and throws a `DAGError`.
 */

import type {
  DAGLifecycleEventType,
  DAGLifecycleStateType,
} from './DAGLifecycleState.js';

type StateVariant = DAGLifecycleStateType['variant'];
type EventType = DAGLifecycleEventType['type'];
type Handler<K extends StateVariant, T extends EventType> = (
  state: Extract<DAGLifecycleStateType, { variant: K }>,
  event: Extract<DAGLifecycleEventType, { type: T }>,
) => DAGLifecycleStateType;

/**
 * Pure reducer for `DAGLifecycleStateType`. Static class; never
 * instantiated. Use `initial()` to seed a new state and `transition()` to
 * advance it. Illegal transitions return the input state unchanged;
 * `NodeStateBase.dispatch` detects the identity return and throws.
 */
export class DAGLifecycleMachine {
  private constructor() {
    /* utility class; never instantiated */
  }

  static initial(): DAGLifecycleStateType {
    return { 'variant': 'pending', 'startedAt': null, 'finishedAt': null, 'error': null, 'reason': null };
  }

  static transition(
    state: DAGLifecycleStateType,
    event: DAGLifecycleEventType,
  ): DAGLifecycleStateType {
    // Terminal stickiness: delegate to `isTerminal` — the single source of
    // truth for which variants are terminal so the two sites never diverge.
    if (DAGLifecycleMachine.isTerminal(state)) {
      return state;
    }

    // `isTerminal` is a type-predicate, so the early return above narrows
    // `state` to the active (pending | running) variants — no cast.
    type ActiveState = Extract<DAGLifecycleStateType, { variant: 'pending' | 'running' }>;
    const activeState: ActiveState = state;
    // The TRANSITION_TABLE is keyed on `ActiveState['variant']` × `EventType`,
    // but the index signature returns `Handler<K,T> | undefined`. The wider
    // cast to a plain `(state, event) => DAGLifecycleStateType` is necessary
    // because the generic K/T are not propagatable through a dynamic index
    // lookup; the shape is structurally identical at runtime.
    const transition = DAGLifecycleMachine.TRANSITION_TABLE[activeState.variant][event.type] as
      | ((state: ActiveState, event: DAGLifecycleEventType) => DAGLifecycleStateType)
      | undefined;
    return transition ? transition(activeState, event) : state;
  }

  /** True iff `state` has reached one of the four terminal variants. */
  static isTerminal(
    state: DAGLifecycleStateType,
  ): state is Extract<DAGLifecycleStateType, { variant: 'completed' | 'failed' | 'cancelled' | 'timed_out' }> {
    return (
      state.variant === 'completed'
      || state.variant === 'failed'
      || state.variant === 'cancelled'
      || state.variant === 'timed_out'
    );
  }

  private static handlePendingStart(
    _state: Extract<DAGLifecycleStateType, { variant: 'pending' }>,
    event: Extract<DAGLifecycleEventType, { type: 'start' }>,
  ): DAGLifecycleStateType {
    return { 'variant': 'running', 'startedAt': event.at, 'finishedAt': null, 'error': null, 'reason': null };
  }

  private static handleRunningSucceed(
    state: Extract<DAGLifecycleStateType, { variant: 'running' }>,
    event: Extract<DAGLifecycleEventType, { type: 'succeed' }>,
  ): DAGLifecycleStateType {
    return {
      'variant': 'completed',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': null,
    };
  }

  private static handleRunningFail(
    state: Extract<DAGLifecycleStateType, { variant: 'running' }>,
    event: Extract<DAGLifecycleEventType, { type: 'fail' }>,
  ): DAGLifecycleStateType {
    return {
      'variant': 'failed',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': event.error,
      'reason': null,
    };
  }

  private static handleRunningCancel(
    state: Extract<DAGLifecycleStateType, { variant: 'running' }>,
    event: Extract<DAGLifecycleEventType, { type: 'cancel' }>,
  ): DAGLifecycleStateType {
    return {
      'variant': 'cancelled',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': event.reason,
    };
  }

  private static handleRunningTimeout(
    state: Extract<DAGLifecycleStateType, { variant: 'running' }>,
    event: Extract<DAGLifecycleEventType, { type: 'timeout' }>,
  ): DAGLifecycleStateType {
    return {
      'variant': 'timed_out',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': null,
    };
  }

  private static readonly TRANSITION_TABLE: { [K in 'pending' | 'running']: { [T in EventType]?: Handler<K, T> } } = {
    'pending': {
      'start': DAGLifecycleMachine.handlePendingStart,
    },
    'running': {
      'succeed': DAGLifecycleMachine.handleRunningSucceed,
      'fail': DAGLifecycleMachine.handleRunningFail,
      'cancel': DAGLifecycleMachine.handleRunningCancel,
      'timeout': DAGLifecycleMachine.handleRunningTimeout,
    },
  };
}

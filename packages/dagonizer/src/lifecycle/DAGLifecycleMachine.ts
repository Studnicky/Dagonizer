/**
 * DAGLifecycleMachine: `@studnicky/fsm` `StateMachine` subclass + static
 * facade for the lifecycle defined in `DAGLifecycleState.ts`.
 *
 * Side-effect-free: no IO, no logging. The `at` field on each event carries
 * the monotonic clock value; callers supply it explicitly (production callers
 * use `clock.monotonicMs()`; tests supply a pinned value for determinism).
 *
 * Transitions:
 *
 *   pending        + start              → running        (startedAt)
 *   running        + succeed            → completed      (finishedAt)
 *   running        + fail(error)        → failed         (finishedAt, error carried)
 *   running        + cancel(reason)     → cancelled      (finishedAt, reason carried)
 *   running        + timeout            → timed_out      (finishedAt)
 *   running        + park(correlationKey) → awaiting-input (finishedAt: null, correlationKey stored)
 *   awaiting-input + start              → running        (restarts execution)
 *
 * Terminal stickiness: every variant in {completed, failed, cancelled, timed_out}
 * rejects all events. The `awaiting-input` variant is NOT terminal — execution
 * can resume. `isTerminal()` excludes it; `isParked()` detects it.
 *
 * `DAGLifecycleMachineReducer.reduce()` throws for both terminal stickiness
 * and illegal transitions from an active state; `StateMachine.transition()`
 * (the `@studnicky/fsm` base class) wraps that throw in a `ReducerThrewError`.
 * `NodeStateBase.#dispatch` catches it and re-throws as a `DAGError`.
 *
 * `DAGLifecycleMachine` is a thin static facade over one module-level
 * `DAGLifecycleMachineReducer` singleton — the established pattern in this
 * codebase for exposing a stateless-FSM-logic instance through static call
 * sites (mirrors `Clock`/`Scheduler`). The reducer logic itself lives on the
 * real `StateMachine` subclass, not reimplemented in the facade.
 */

import type { FsmStepType } from '@studnicky/fsm';
import { StateMachine } from '@studnicky/fsm';

import type {
  DAGLifecycleEventType,
  DAGLifecycleStateType,
} from './DAGLifecycleState.js';

type ActiveVariant = 'pending' | 'running' | 'awaiting-input';
type TerminalVariant = 'completed' | 'failed' | 'cancelled' | 'timed_out';
type ActiveState = Extract<DAGLifecycleStateType, { variant: ActiveVariant }>;
type EventType = DAGLifecycleEventType['type'];
type Handler = (state: ActiveState, event: DAGLifecycleEventType) => DAGLifecycleStateType;

/**
 * Real `@studnicky/fsm` `StateMachine` subclass carrying the lifecycle
 * reducer logic. Never instantiated directly by consumers; `DAGLifecycleMachine`
 * (the static facade below) holds the one module-level singleton.
 */
class DAGLifecycleMachineReducer extends StateMachine<DAGLifecycleStateType, DAGLifecycleEventType, never> {
  constructor() {
    super();
  }

  getInitialState(): DAGLifecycleStateType {
    return { 'variant': 'pending', 'startedAt': null, 'finishedAt': null, 'error': null, 'reason': null, 'correlationKey': null };
  }

  reduce(state: DAGLifecycleStateType, event: DAGLifecycleEventType): FsmStepType<DAGLifecycleStateType, never> {
    if (DAGLifecycleMachineReducer.isTerminalState(state)) {
      throw new Error(`Illegal transition: '${event.type}' on terminal lifecycle state '${state.variant}'`);
    }

    // `isTerminalState` is a type-predicate; the guard above narrows `state`
    // to the active (pending | running | awaiting-input) variants — no cast.
    const activeState: ActiveState = state;
    const handler = DAGLifecycleMachineReducer.TRANSITION_TABLE[activeState.variant][event.type];
    if (handler === undefined) {
      throw new Error(`Illegal transition: '${event.type}' from lifecycle state '${activeState.variant}'`);
    }

    return { 'state': handler(activeState, event), 'effects': [] };
  }

  /** True iff `state` has reached one of the four terminal variants. `awaiting-input` is NOT terminal. */
  static isTerminalState(state: DAGLifecycleStateType): state is Extract<DAGLifecycleStateType, { variant: TerminalVariant }> {
    return (
      state.variant === 'completed'
      || state.variant === 'failed'
      || state.variant === 'cancelled'
      || state.variant === 'timed_out'
    );
  }

  /** True iff `state` is parked (`awaiting-input`). The run can resume via `dispatcher.resume()`. */
  static isParkedState(state: DAGLifecycleStateType): state is Extract<DAGLifecycleStateType, { variant: 'awaiting-input' }> {
    return state.variant === 'awaiting-input';
  }

  private static handlePendingStart(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'pending' || event.type !== 'start') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected pending state and start event');
    }
    return { 'variant': 'running', 'startedAt': event.at, 'finishedAt': null, 'error': null, 'reason': null, 'correlationKey': null };
  }

  private static handleRunningSucceed(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'running' || event.type !== 'succeed') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected running state and succeed event');
    }
    return {
      'variant': 'completed',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': null,
      'correlationKey': null,
    };
  }

  private static handleRunningFail(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'running' || event.type !== 'fail') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected running state and fail event');
    }
    return {
      'variant': 'failed',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': event.error,
      'reason': null,
      'correlationKey': null,
    };
  }

  private static handleRunningCancel(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'running' || event.type !== 'cancel') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected running state and cancel event');
    }
    return {
      'variant': 'cancelled',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': event.reason,
      'correlationKey': null,
    };
  }

  private static handleRunningTimeout(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'running' || event.type !== 'timeout') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected running state and timeout event');
    }
    return {
      'variant': 'timed_out',
      'startedAt': state.startedAt,
      'finishedAt': event.at,
      'error': null,
      'reason': null,
      'correlationKey': null,
    };
  }

  private static handleRunningPark(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'running' || event.type !== 'park') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected running state and park event');
    }
    return {
      'variant': 'awaiting-input',
      'startedAt': state.startedAt,
      'finishedAt': null,
      'error': null,
      'reason': null,
      'correlationKey': event.correlationKey,
    };
  }

  private static handleAwaitingInputStart(state: ActiveState, event: DAGLifecycleEventType): DAGLifecycleStateType {
    if (state.variant !== 'awaiting-input' || event.type !== 'start') {
      throw new Error('DAGLifecycleMachine dispatch invariant violated: expected awaiting-input state and start event');
    }
    return { 'variant': 'running', 'startedAt': event.at, 'finishedAt': null, 'error': null, 'reason': null, 'correlationKey': null };
  }

  private static readonly TRANSITION_TABLE: { [K in ActiveVariant]: { [T in EventType]?: Handler } } = {
    'pending': {
      'start': DAGLifecycleMachineReducer.handlePendingStart,
    },
    'running': {
      'succeed': DAGLifecycleMachineReducer.handleRunningSucceed,
      'fail': DAGLifecycleMachineReducer.handleRunningFail,
      'cancel': DAGLifecycleMachineReducer.handleRunningCancel,
      'timeout': DAGLifecycleMachineReducer.handleRunningTimeout,
      'park': DAGLifecycleMachineReducer.handleRunningPark,
    },
    'awaiting-input': {
      'start': DAGLifecycleMachineReducer.handleAwaitingInputStart,
    },
  };
}

const reducer: DAGLifecycleMachineReducer = new DAGLifecycleMachineReducer();

/**
 * Static facade over the `DAGLifecycleMachineReducer` singleton. Use
 * `initial()` to seed a new state and `transition()` to advance it. Illegal
 * transitions throw (via `StateMachine.transition()`'s `ReducerThrewError`
 * wrapping); `NodeStateBase.#dispatch` catches and re-throws as a `DAGError`.
 */
export class DAGLifecycleMachine {
  private constructor() {
    /* utility class; never instantiated */
  }

  static initial(): DAGLifecycleStateType {
    return reducer.getInitialState();
  }

  static transition(
    state: DAGLifecycleStateType,
    event: DAGLifecycleEventType,
  ): DAGLifecycleStateType {
    return reducer.transition(state, event).state;
  }

  /** True iff `state` has reached one of the four terminal variants. `awaiting-input` is NOT terminal. */
  static isTerminal(
    state: DAGLifecycleStateType,
  ): state is Extract<DAGLifecycleStateType, { variant: TerminalVariant }> {
    return DAGLifecycleMachineReducer.isTerminalState(state);
  }

  /** True iff `state` is parked (`awaiting-input`). The run can resume via `dispatcher.resume()`. */
  static isParked(
    state: DAGLifecycleStateType,
  ): state is Extract<DAGLifecycleStateType, { variant: 'awaiting-input' }> {
    return DAGLifecycleMachineReducer.isParkedState(state);
  }
}

/**
 * DAGLifecycleMachine — pure reducer + initial-state factory + terminal
 * predicate for the lifecycle defined in `DAGLifecycleState.ts`.
 *
 * Side-effect-free: no IO, no logging. The reducer reads the optional `at`
 * field on each event and otherwise calls `Clock.monotonicMs()` to stamp transitions.
 * Pin the clock with `at` for deterministic tests.
 *
 * Transitions:
 *
 *   pending  + start         → running   (startedAt)
 *   running  + succeed       → completed (finishedAt)
 *   running  + fail(error)   → failed    (finishedAt, error carried)
 *   running  + cancel(reason)→ cancelled (finishedAt, reason carried)
 *   running  + timeout       → timed_out (finishedAt)
 *
 * Terminal stickiness: every kind in {completed, failed, cancelled, timed_out}
 * ignores all events and returns itself unchanged (by reference).
 *
 * Illegal transitions return the input state by reference. `NodeStateBase`
 * detects `next === current` after dispatch and throws a `DAGError`.
 */

import { Clock } from '../runtime/Clock.js';

import type {
  DAGLifecycleEvent,
  DAGLifecycleState,
} from './DAGLifecycleState.js';

type StateKind = DAGLifecycleState['kind'];
type EventType = DAGLifecycleEvent['type'];
type Handler<K extends StateKind, T extends EventType> = (
  state: Extract<DAGLifecycleState, { kind: K }>,
  event: Extract<DAGLifecycleEvent, { type: T }>,
) => DAGLifecycleState;

/**
 * Pure reducer for `DAGLifecycleState`. Static class — never
 * instantiated. Use `initial()` to seed a new state and `transition()` to
 * advance it. Illegal transitions return the input state unchanged;
 * `NodeStateBase.dispatch` detects the identity return and throws.
 */
export class DAGLifecycleMachine {
  private constructor() {
    /* utility class — never instantiated */
  }

  static initial(): DAGLifecycleState {
    return { 'kind': 'pending', 'startedAt': null, 'finishedAt': null, 'error': null, 'reason': null };
  }

  static transition(
    state: DAGLifecycleState,
    event: DAGLifecycleEvent,
  ): DAGLifecycleState {
    if (
      state.kind === 'completed'
      || state.kind === 'failed'
      || state.kind === 'cancelled'
      || state.kind === 'timed_out'
    ) {
      return state;
    }

    const handler = DAGLifecycleMachine.TRANSITION_TABLE[state.kind as 'pending' | 'running'][event.type] as Handler<typeof state.kind & ('pending' | 'running'), EventType> | undefined;
    return handler ? handler(state as never, event as never) : state;
  }

  /** True iff `state` has reached one of the four terminal kinds. */
  static isTerminal(state: DAGLifecycleState): boolean {
    return (
      state.kind === 'completed'
      || state.kind === 'failed'
      || state.kind === 'cancelled'
      || state.kind === 'timed_out'
    );
  }

  private static handlePendingStart(
    _state: Extract<DAGLifecycleState, { kind: 'pending' }>,
    event: Extract<DAGLifecycleEvent, { type: 'start' }>,
  ): DAGLifecycleState {
    return { 'kind': 'running', 'startedAt': event.at ?? Clock.monotonicMs(), 'finishedAt': null, 'error': null, 'reason': null };
  }

  private static handleRunningSucceed(
    state: Extract<DAGLifecycleState, { kind: 'running' }>,
    event: Extract<DAGLifecycleEvent, { type: 'succeed' }>,
  ): DAGLifecycleState {
    return {
      'kind': 'completed',
      'startedAt': state.startedAt,
      'finishedAt': event.at ?? Clock.monotonicMs(),
      'error': null,
      'reason': null,
    };
  }

  private static handleRunningFail(
    state: Extract<DAGLifecycleState, { kind: 'running' }>,
    event: Extract<DAGLifecycleEvent, { type: 'fail' }>,
  ): DAGLifecycleState {
    return {
      'kind': 'failed',
      'startedAt': state.startedAt,
      'finishedAt': event.at ?? Clock.monotonicMs(),
      'error': event.error,
      'reason': null,
    };
  }

  private static handleRunningCancel(
    state: Extract<DAGLifecycleState, { kind: 'running' }>,
    event: Extract<DAGLifecycleEvent, { type: 'cancel' }>,
  ): DAGLifecycleState {
    return {
      'kind': 'cancelled',
      'startedAt': state.startedAt,
      'finishedAt': event.at ?? Clock.monotonicMs(),
      'error': null,
      'reason': event.reason ?? 'cancelled',
    };
  }

  private static handleRunningTimeout(
    state: Extract<DAGLifecycleState, { kind: 'running' }>,
    event: Extract<DAGLifecycleEvent, { type: 'timeout' }>,
  ): DAGLifecycleState {
    return {
      'kind': 'timed_out',
      'startedAt': state.startedAt,
      'finishedAt': event.at ?? Clock.monotonicMs(),
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

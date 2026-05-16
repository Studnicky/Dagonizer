/**
 * DAGLifecycleState — discriminated union of the six kinds a DAG lifecycle
 * machine can occupy.
 *
 * All six variants share an identical 5-field shape so V8 sees a single
 * hidden class regardless of which kind is live. Fields absent in a given
 * state carry `null` — never `undefined` or omitted.
 *
 * Field order (canonical — must be preserved in every object literal):
 *   kind · startedAt · finishedAt · error · reason
 *
 * The reducer in `DAGLifecycleMachine.ts` is the source of truth on
 * legal transitions. The `error` payload on the `failed` branch carries the
 * original Error instance for in-memory use.
 */

/**
 * Uniform 5-field discriminated union of the six DAG lifecycle states.
 * Timestamps are monotonic milliseconds from `Clock.monotonicMs()`.
 * Fields that are not meaningful for a given `kind` are `null`.
 */
export type DAGLifecycleState =
  | { kind: 'pending';   startedAt: null;   finishedAt: null;   error: null;  reason: null }
  | { kind: 'running';   startedAt: number; finishedAt: null;   error: null;  reason: null }
  | { kind: 'completed'; startedAt: number; finishedAt: number; error: null;  reason: null }
  | { kind: 'failed';    startedAt: number; finishedAt: number; error: Error; reason: null }
  | { kind: 'cancelled'; startedAt: number; finishedAt: number; error: null;  reason: string }
  | { kind: 'timed_out'; startedAt: number; finishedAt: number; error: null;  reason: null };

/**
 * Events consumed by `DAGLifecycleMachine.transition()`. The optional
 * `at` field overrides `Clock.monotonicMs()` for deterministic tests.
 */
export type DAGLifecycleEvent =
  | { type: 'start'; at?: number }
  | { type: 'succeed'; at?: number }
  | { type: 'fail'; error: Error; at?: number }
  | { type: 'cancel'; reason?: string; at?: number }
  | { type: 'timeout'; at?: number };

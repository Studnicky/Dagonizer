/**
 * DAGLifecycleStateType: discriminated union of the six variants a DAG lifecycle
 * machine can occupy.
 *
 * All six variants share an identical 5-field shape so V8 sees a single
 * hidden class regardless of which variant is live. Fields absent in a given
 * state carry `null`; never `undefined` or omitted.
 *
 * Field order (canonical; must be preserved in every object literal):
 *   variant · startedAt · finishedAt · error · reason
 *
 * The reducer in `DAGLifecycleMachine.ts` is the source of truth on
 * legal transitions. The `error` payload on the `failed` branch carries the
 * original Error instance for in-memory use.
 */

/**
 * Uniform 5-field discriminated union of the seven DAG lifecycle states.
 * Timestamps are monotonic milliseconds from `Clock.monotonicMs()`.
 * Fields that are not meaningful for a given `variant` are `null`.
 *
 * The `awaiting-input` variant is the HITL park state: execution is
 * suspended pending an external signal. It is NOT terminal — the run can
 * resume via `dispatcher.resume()`. The `correlationKey` field is an opaque
 * caller-supplied key used to correlate the resume with the parked run.
 */
export type DAGLifecycleStateType =
  | { variant: 'pending';        startedAt: null;   finishedAt: null;   error: null;  reason: null; correlationKey: null }
  | { variant: 'running';        startedAt: number; finishedAt: null;   error: null;  reason: null; correlationKey: null }
  | { variant: 'awaiting-input'; startedAt: number; finishedAt: null;   error: null;  reason: null; correlationKey: string }
  | { variant: 'completed';      startedAt: number; finishedAt: number; error: null;  reason: null; correlationKey: null }
  | { variant: 'failed';         startedAt: number; finishedAt: number; error: Error; reason: null; correlationKey: null }
  | { variant: 'cancelled';      startedAt: number; finishedAt: number; error: null;  reason: string; correlationKey: null }
  | { variant: 'timed_out';      startedAt: number; finishedAt: number; error: null;  reason: null; correlationKey: null };

/**
 * Events consumed by `DAGLifecycleMachine.transition()`. The `at` field
 * carries the monotonic clock value for the transition; production callers
 * supply `clock.monotonicMs()` explicitly. Tests supply a pinned value for
 * determinism.
 */
export type DAGLifecycleEventType =
  | { type: 'start'; at: number }
  | { type: 'succeed'; at: number }
  | { type: 'fail'; error: Error; at: number }
  | { type: 'cancel'; reason: string; at: number }
  | { type: 'timeout'; at: number }
  | { type: 'park'; correlationKey: string; at: number };

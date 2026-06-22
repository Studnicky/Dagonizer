/**
 * TriggerInterface: adapter contract for `DagRunner` triggers.
 *
 * A trigger decides WHEN the runner fires. The four observed variants in the
 * research study cover every consumer harness shape:
 *   - `OnceTrigger`    — fire once on a single explicit call
 *   - `CliTrigger`     — fire from a parsed command line
 *   - `EventTrigger`   — fire per message off a subscription
 *   - `RequestTrigger` — fire per HTTP turn
 *
 * Consumers implement this interface to wire the timing signal into the
 * canonical runner loop. `trigger.attach(runner)` returns a promise that
 * resolves when the trigger lifecycle is complete. `trigger.detach()` tears
 * down any pending subscriptions and is safe to call before `attach` resolves.
 *
 * TInput   — trigger-specific input type passed to `runner.run(input)`.
 * TState   — the domain state flowing through the DAG.
 * TOutput  — the projected output from `runner.run(input)`.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';
import type { DagRunnerInterface } from '../runner/DagRunner.js';

export interface TriggerInterface<
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> {
  /**
   * Attach this trigger to a runner. The trigger calls `runner.run(input)`
   * at the appropriate moments (once, per-event, per-request, etc.).
   * Returns a promise that resolves when the trigger has completed its
   * lifecycle (all planned invocations are done, or `detach` was called).
   */
  attach(runner: DagRunnerInterface<TInput, TState, TOutput>): Promise<void>;

  /**
   * Detach the trigger. Any pending subscriptions are torn down; no further
   * `runner.run` calls will be made after this resolves. Idempotent.
   */
  detach(): Promise<void>;
}

/**
 * GatherExecution / GatherRecord: adapter contracts between the dispatcher
 * and GatherStrategy implementations.
 *
 * `GatherRecord<TState>` carries per-clone results from the scatter loop.
 * `GatherExecution<TState>` is the invocation context handed to
 * `GatherStrategy.apply`; it gives strategies read access to per-clone
 * records, the live parent state, and the `invoker` seam.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { NodeInvoker } from './NodeInvoker.js';
import type { StateAccessor } from './StateAccessor.js';

/**
 * Per-clone record produced by the scatter loop. Carries the source item
 * (or `undefined` for a singleton scatter), the routing output, the
 * terminal outcome of a DAG body (or `null` for a node body), and the
 * live clone state after the body ran.
 */
export interface GatherRecord<TState extends NodeStateInterface> {
  index: number;
  item: unknown;
  output: string;
  terminalOutcome: 'completed' | 'failed' | null;
  cloneState: TState;
}

/**
 * Per-invocation context handed to `GatherStrategy.apply`. Carries:
 *
 *   - the live parent state object (mutated in place by the strategy)
 *   - the per-clone records produced by every scatter clone
 *   - the current dag/signal for any nested node invocation
 *   - the `StateAccessor` the dispatcher is configured with
 *   - `invoker`, the only way for `custom` strategies to dispatch
 *     a registered node back through the engine
 */
export interface GatherExecution<TState extends NodeStateInterface> {
  state: TState;
  /**
   * Per-clone records. INVARIANT: ordered by source index (`record.index`
   * ascending). The dispatcher's scatter loop builds them index-ordered across
   * batches (`Promise.all` preserves per-batch order; restored items flow
   * through the same index-ordered batch loop on resume). Strategies rely on
   * this and must not re-sort.
   */
  records: GatherRecord<TState>[];
  dagName: string;
  /**
   * The active abort signal for the scatter body, or `null` when the run
   * has no cancellation signal. `null` is a deliberate sentinel meaning
   * "no signal present" — distinct from the optional `signal?` pattern
   * used elsewhere in the engine, where the field may simply be absent.
   * Strategies and invokers check `signal !== null` before forwarding.
   */
  signal: AbortSignal | null;
  accessor: StateAccessor;
  invoker: NodeInvoker;
}

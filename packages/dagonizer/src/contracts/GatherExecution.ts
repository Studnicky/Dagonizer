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
  /** 0-based position of this item in the scatter source array. */
  index: number;
  /** The source item that was scattered over (the element from the source array). */
  item: unknown;
  /** Routing output the scatter body emitted for this clone. */
  output: string;
  /**
   * Terminal outcome of the DAG body for this clone (`'completed'` or `'failed'`),
   * or `null` when the body was a node body (not a DAG).
   */
  terminalOutcome: 'completed' | 'failed' | null;
  /** Live clone state after the scatter body ran. Strategies fold this into the parent. */
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
  /** Live parent state object. Strategies mutate it in place. */
  state: TState;
  /**
   * Per-clone records. INVARIANT: ordered by source index (`record.index`
   * ascending). The dispatcher's scatter loop builds them index-ordered across
   * batches (`Promise.all` preserves per-batch order; restored items flow
   * through the same index-ordered batch loop on resume). Strategies rely on
   * this and must not re-sort.
   */
  records: GatherRecord<TState>[];
  /** Name of the DAG being executed. Used by `invoker.invokeNode` to dispatch gather nodes. */
  dagName: string;
  /**
   * The active abort signal for the scatter body, or `null` when the run
   * has no cancellation signal. `null` is a deliberate sentinel meaning
   * "no signal present" — distinct from the optional `signal?` pattern
   * used elsewhere in the engine, where the field may simply be absent.
   * Strategies and invokers check `signal !== null` before forwarding.
   */
  signal: AbortSignal | null;
  /** State path accessor the dispatcher is configured with; used by built-in strategies to read and write state paths. */
  accessor: StateAccessor;
  /** The only dispatch seam for `custom` gather strategies to invoke a registered node through the engine. */
  invoker: NodeInvoker;
}

/**
 * GatherExecutionType / GatherRecordType: adapter contracts between the dispatcher
 * and GatherStrategy implementations.
 *
 * `GatherRecordType<TItem, TResult>` carries producer records from scatter,
 * embedded DAG, and DAG-entry branches. `GatherExecutionType<TItem, TResult>`
 * is the invocation context handed to `GatherStrategy.apply`; it gives
 * strategies read access to producer records, the live parent state, and the
 * `invoker` seam.
 *
 * `TItem` and `TResult` default to `unknown`, bounding producer payloads to a
 * generic default. A strategy that knows its source element or projected result
 * type narrows `record.item` or `record.result` without a cast.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { NodeInvokerInterface } from './NodeInvokerInterface.js';
import type { StateAccessorInterface } from './StateAccessorInterface.js';

/**
 * Producer record consumed by gather strategies. Scatter records carry an item
 * index and source item; scalar producers use `index: null` and
 * `item: undefined`.
 */
export type GatherRecordType<TItem = unknown, TResult = unknown> = {
  /** Producer label: entrypoint key, scatter placement name, or explicit source. */
  source: string;
  /** 0-based position for scatter records; null for scalar producers. */
  index: number | null;
  /** Source item for scatter records; undefined for scalar producers. */
  item: TItem | undefined;
  /** Routing output the scatter body emitted for this clone. */
  output: string;
  /**
   * Terminal outcome of the DAG body for this clone (`'completed'` or `'failed'`),
   * or `null` when the body was a node body (not a DAG).
   */
  terminalOutcome: 'completed' | 'failed' | null;
  /** First-class projected value consumed by gather strategies. */
  result: TResult | undefined;
  /**
   * Live producer state after the body ran. Strategies fold this into the parent.
   *
   * Typed as `NodeStateInterface` because isolation factories may produce a child class
   * unrelated to the parent type — the engine only guarantees the base interface here.
   */
  cloneState: NodeStateInterface;
}

/**
 * Per-invocation context handed to `GatherStrategy.apply`. Carries:
 *
 *   - the live parent state object (mutated in place by the strategy)
 *   - the per-clone records produced by every scatter clone
 *   - the current dag/signal for any nested node invocation
 *   - the `StateAccessorInterface` the dispatcher is configured with
 *   - `invoker`, the only way for `custom` strategies to dispatch
 *     a registered node back through the engine
 */
export type GatherExecutionType<TItem = unknown, TResult = unknown> = {
  /**
   * Live parent state object. Strategies mutate it in place.
   *
   * Typed as `NodeStateInterface` — the engine operates on the base interface
   * at the gather boundary; consumers that need the concrete subtype access it
   * through the dispatcher's own typed surface.
   */
  state: NodeStateInterface;
  /**
   * Per-clone records. INVARIANT: ordered by source index (`record.index`
   * ascending). The dispatcher's scatter loop builds them index-ordered across
   * batches (`Promise.all` preserves per-batch order; restored items flow
   * through the same index-ordered batch loop on resume). Strategies rely on
   * this and must not re-sort.
   */
  records: GatherRecordType<TItem, TResult>[];
  /** Name of the DAG being executed. Used by `invoker.invokeNode` to dispatch gather nodes. */
  dagName: string;
  /**
   * The active abort signal for the scatter body. Always a valid
   * `AbortSignal` — a run with no caller-supplied cancellation surface
   * carries `Signal.never()`, so strategies and invokers can forward it
   * unconditionally with no null-check.
   */
  signal: AbortSignal;
  /** State path accessor the dispatcher is configured with; used by built-in strategies to read and write state paths. */
  accessor: StateAccessorInterface;
  /** The only dispatch seam for `custom` gather strategies to invoke a registered node through the engine. */
  invoker: NodeInvokerInterface;
}

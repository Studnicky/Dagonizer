/**
 * ScatterPoolDriver: adapter contract for scatter item body execution and
 * acknowledgment.
 *
 * `ScatterWorkerPool` owns concurrency (slot semaphore, active-worker counter,
 * error accumulation) and delegates the actual item body execution and ack to a
 * `ScatterPoolDriverInterface` implementation. The pool has no knowledge of DAG
 * internals; all DAG/state mutation logic lives in the implementor.
 *
 * The companion `ScatterItemResultType` envelope is the driver's return shape. It is
 * part of the contract surface: every `executeItem` result and every `ackItem`
 * argument is a `ScatterItemResultType`, so it lives here beside the contract.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * The result envelope that `ScatterPoolDriverInterface.executeItem` returns.
 *
 * Shape is stable (all fields initialised, required): V8 sees one hidden class
 * across all item executions.
 */
export type ScatterItemResultType<TState extends NodeStateInterface> = {
  index: number;
  item: unknown;
  output: string;
  terminalOutcome: 'completed' | 'failed' | null;
  cloneState: TState;
};

/**
 * Adapter contract for scatter item body execution and acknowledgment.
 *
 * Implementors are instantiated inside `Dagonizer.executeScatter` and injected
 * into `ScatterWorkerPool`. The pool calls these two methods for every item;
 * all DAG/state mutation logic lives in the implementor, not the pool.
 */
export interface ScatterPoolDriverInterface<TState extends NodeStateInterface> {
  /**
   * Execute one scatter item body and return its result.
   *
   * Must not mutate shared state — callers handle ack and gather after this
   * resolves. Must throw on infrastructure failure (container crash, transport
   * loss) so the pool correctly routes it to `poolErrors` rather than acking.
   */
  executeItem(index: number, item: unknown): Promise<ScatterItemResultType<TState>>;

  /**
   * Acknowledge a completed item: remove it from the inbox, record the acked
   * result, apply incremental gather to fold into parent state, and persist
   * the checkpoint.
   */
  ackItem(result: ScatterItemResultType<TState>): Promise<void>;
}

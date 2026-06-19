/**
 * ReservoirDriver: adapter contract for buffered (reservoir) scatter execution.
 *
 * `ReservoirBuffer` owns the buffer-then-release loop (key buffering, capacity
 * release, idle release, complete-flush) and delegates batch body execution and
 * ack to a `ReservoirDriverInterface` implementation. Each released batch of N
 * items is dispatched as one `executeBatch` call, then acked as one `ackBatch`
 * call.
 *
 * The companion `ScatterItemBatchResultType` envelope is the driver's batch return
 * shape (one `ScatterItemResultType` per item in the batch). It is part of the
 * contract surface, so it lives here beside the contract.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { ScatterItemResultType } from './ScatterPoolDriver.js';

/**
 * Result envelope for a batch execution. One result per item in the batch.
 */
export type ScatterItemBatchResultType<TState extends NodeStateInterface> = {
  results: ScatterItemResultType<TState>[];
};

/**
 * Adapter contract that `ReservoirBuffer` calls for batch execution and ack.
 *
 * Implementors are instantiated inside `Dagonizer.executeScatter` and injected
 * into `ReservoirBuffer`. The buffer calls these two methods for every released
 * batch; all DAG/state mutation logic lives in the implementor, not the buffer.
 */
export interface ReservoirDriverInterface<TState extends NodeStateInterface> {
  executeBatch(items: { index: number; item: unknown; bufferKey: string }[]): Promise<ScatterItemBatchResultType<TState>>;
  ackBatch(batchResult: ScatterItemBatchResultType<TState>): Promise<void>;
}

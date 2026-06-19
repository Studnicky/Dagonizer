/**
 * CheckpointRestoreAdapterInterface: typed contract for restoring domain state
 * from a JSON snapshot.
 *
 * Consumers implement this interface (typically as a static class) to
 * rehydrate a `TState` instance from a `JsonObjectType` snapshot produced by
 * `NodeStateBase.snapshot()`. Use `CheckpointRestoreAdapter.wrap` from
 * `checkpoint/Checkpoint.ts` to wrap a plain function in this contract.
 */

import type { JsonObjectType } from '../entities/json.js';

export interface CheckpointRestoreAdapterInterface<TState> {
  /** Rehydrate a `TState` instance from a JSON snapshot produced by `NodeStateBase.snapshot()`. */
  restore(snapshot: JsonObjectType): TState;
}

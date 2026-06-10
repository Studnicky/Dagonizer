/**
 * CheckpointRestoreAdapter: typed contract for restoring domain state
 * from a JSON snapshot.
 *
 * Consumers implement this interface (typically as a static class) to
 * rehydrate a `TState` instance from a `JsonObject` snapshot produced by
 * `NodeStateBase.snapshot()`. Use `CheckpointRestoreAdapterFn.fromFn` from
 * `checkpoint/Checkpoint.ts` to wrap a plain function in this contract.
 */

import type { JsonObject } from '../entities/json.js';

export interface CheckpointRestoreAdapter<TState> {
  restore(snapshot: JsonObject): TState;
}

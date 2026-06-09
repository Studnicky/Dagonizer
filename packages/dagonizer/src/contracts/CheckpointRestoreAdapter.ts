/**
 * CheckpointRestoreAdapter: typed contract for restoring domain state
 * from a JSON snapshot.
 *
 * Wave 4 will replace `StateRestoreFnType` (`(snapshot: JsonObject) => TState`)
 * with this contract, converting the bare function type to an injectable
 * adapter that consumers implement as a class.
 */

import type { JsonObject } from '../entities/json.js';

export interface CheckpointRestoreAdapter<TState> {
  restore(snapshot: JsonObject): TState;
}

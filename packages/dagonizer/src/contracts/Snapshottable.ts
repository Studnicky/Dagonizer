/**
 * Snapshottable: the capability `Checkpoint` depends on: a named state
 * container that can serialize itself to a `StoreSnapshot` and rehydrate from
 * one.
 *
 * Deliberately decoupled from the key-value `Store` surface. Checkpoint /
 * resume needs ONLY `snapshot()` + `restore()`, so a non-KV backing (an RDF
 * triple store, a vector index, an append-only log projection) can participate
 * in checkpointing WITHOUT implementing `get`/`set`/`has`/`delete`/`update`.
 * `Store extends Snapshottable`, so every `Store` is also `Snapshottable`.
 */

import type { JsonValue } from '../entities/json.js';

/** Entry in a serialized snapshot envelope. */
export interface StoreSnapshotEntry {
  readonly key:   string;
  readonly value: JsonValue;
}

/**
 * Versioned snapshot envelope. Authors set `type` to a stable identifier
 * (e.g. `'memory-store-v1'`) so resume code can refuse incompatible snapshots.
 */
export interface StoreSnapshot {
  readonly version: number;
  readonly type:    string;
  readonly entries: readonly StoreSnapshotEntry[];
}

/** A state container that can be captured into, and restored from, a `StoreSnapshot`. */
export interface Snapshottable {
  /** Capture the entire state as a typed envelope. */
  snapshot(): Promise<StoreSnapshot>;

  /**
   * Repopulate from a snapshot. Implementations validate `snapshot.type` and
   * `snapshot.version` before applying entries.
   */
  restore(snapshot: StoreSnapshot): Promise<void>;
}

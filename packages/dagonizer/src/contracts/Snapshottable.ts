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

import type { AbortableOptionsInterface } from './AbortableOptionsInterface.js';


/** Entry in a serialized snapshot envelope. */
export interface StoreSnapshotEntry {
  key:   string;
  value: JsonValue;
}

/**
 * Versioned snapshot envelope. Authors set `type` to a stable identifier
 * (e.g. `'memory-store-v1'`) so resume code can refuse incompatible snapshots.
 */
export interface StoreSnapshot {
  version: number;
  type:    string;
  entries: StoreSnapshotEntry[];
}

/** A state container that can be captured into, and restored from, a `StoreSnapshot`. */
export interface Snapshottable {
  /**
   * Capture the entire state as a typed envelope. `options.signal` is
   * available for implementations backed by remote or async stores that
   * support cancellation; in-process implementations may ignore it.
   */
  snapshot(options?: AbortableOptionsInterface): Promise<StoreSnapshot>;

  /**
   * Repopulate from a snapshot. Implementations validate `snapshot.type` and
   * `snapshot.version` before applying entries. `options.signal` is available
   * for implementations backed by remote or async stores; in-process
   * implementations may ignore it.
   */
  restore(snapshot: StoreSnapshot, options?: AbortableOptionsInterface): Promise<void>;
}

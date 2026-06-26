/**
 * SnapshottableInterface: the capability `Checkpoint` depends on: a named state
 * container that can serialize itself to a `StoreSnapshotType` and rehydrate from
 * one.
 *
 * Deliberately decoupled from the key-value `StoreInterface` surface. Checkpoint /
 * resume needs ONLY `snapshot()` + `restore()`, so a non-KV backing (an RDF
 * triple store, a vector index, an append-only log projection) can participate
 * in checkpointing WITHOUT implementing `get`/`set`/`has`/`delete`/`update`.
 * `StoreInterface extends SnapshottableInterface`, so every `StoreInterface` is also `SnapshottableInterface`.
 *
 * `StoreSnapshotEntryType` and `StoreSnapshotType` are defined here as the runtime
 * contract surface (with `value: JsonValueType` for type-safe store access).
 * The wire-validation schemas live at `entities/checkpoint/StoreSnapshotType.ts`
 * and mirror the same shape; the schemas validate inbound JSON, these
 * interfaces type in-process store operations.
 */

import type { JsonValueType } from '../entities/json.js';

import type { AbortableOptionsType } from './AbortableOptionsType.js';


/** Entry in a serialized snapshot envelope. */
export type StoreSnapshotEntryType = {
  key:   string;
  value: JsonValueType;
}

/**
 * Versioned snapshot envelope. Authors set `type` to a stable identifier
 * (e.g. `'memory-store-v1'`) so resume code can refuse incompatible snapshots.
 */
export type StoreSnapshotType = {
  version: number;
  type:    string;
  entries: StoreSnapshotEntryType[];
}

/** A state container that can be captured into, and restored from, a `StoreSnapshotType`. */
export interface SnapshottableInterface {
  /**
   * Capture the entire state as a typed envelope. `options.signal` is
   * available for implementations backed by remote or async stores that
   * support cancellation; in-process implementations may ignore it.
   */
  snapshot(options?: AbortableOptionsType): Promise<StoreSnapshotType>;

  /**
   * Repopulate from a snapshot. Implementations validate `snapshot.type` and
   * `snapshot.version` before applying entries. `options.signal` is available
   * for implementations backed by remote or async stores; in-process
   * implementations may ignore it.
   */
  restore(snapshot: StoreSnapshotType, options?: AbortableOptionsType): Promise<void>;

  /**
   * Stream the entire state as a sequence of `StoreSnapshotEntryType` values.
   * This is the streaming counterpart to `snapshot()`: entries are yielded
   * lazily without loading the full keyspace into memory first.
   *
   * Implementations that support cancellation should check
   * `options.signal?.throwIfAborted()` between entries. In-process
   * implementations may ignore `options`.
   *
   * The stream is additive/upsert — it does NOT clear the target before
   * writing. To achieve replacement semantics, use the array-form `restore()`
   * which clears first, or pair this with an explicit clear.
   */
  snapshotStream(options?: AbortableOptionsType): AsyncIterable<StoreSnapshotEntryType>;

  /**
   * Restore state from a stream of `StoreSnapshotEntryType` values. Each
   * entry is applied as an upsert; keys absent from the stream are left
   * untouched. To achieve full replacement semantics use the array-form
   * `restore()`, which clears the keyspace before applying entries.
   *
   * `options.signal` is available for cancellation-aware implementations;
   * in-process implementations may ignore it.
   */
  restoreStream(entries: AsyncIterable<StoreSnapshotEntryType>, options?: AbortableOptionsType): Promise<void>;
}

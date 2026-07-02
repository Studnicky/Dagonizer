/**
 * Checkpoint: build, parse, persist, and restore DAG execution snapshots.
 *
 * Obtain instances via `Checkpoint.capture()` (when saving) or
 * `Checkpoint.load()` (when recalling a persisted record). Both paths return
 * the same `Checkpoint` instance shape regardless of whether named stores are
 * involved.
 *
 * @example
 * ```ts
 * // Save a checkpoint after early termination.
 * const result = await dispatcher.execute('my-dag', state, { signal });
 * if (result.cursor !== null) {
 *   const ckpt = await Checkpoint.capture('my-dag', result);
 *   await storage.set('ckpt', ckpt.toJson());
 * }
 *
 * // Resume later.
 * const raw: unknown = JSON.parse(await storage.get('ckpt'));
 * const ckpt = Checkpoint.load(raw);
 * const { dagName, state: restoredState, cursor } = ckpt.restoreState(
 *   CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap)),
 * );
 * const finalResult = await dispatcher.resume(dagName, restoredState, cursor);
 * ```
 *
 * @example Named-store checkpoint
 * ```ts
 * const ckpt = await Checkpoint.capture('my-dag', result, { stores: { memory } });
 * await checkpointStore.save(runId, ckpt.toJson());
 *
 * // Resume:
 * const ckpt2 = await Checkpoint.recall(checkpointStore, runId);
 * if (ckpt2 !== null) {
 *   const freshMemory = new MemoryStore();
 *   await ckpt2.restoreStores({ memory: freshMemory });
 *   const { dagName, state, cursor } = ckpt2.restoreState(
 *     CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap)),
 *   );
 *   await dispatcher.resume(dagName, state, cursor);
 * }
 * ```
 */

import type { CheckpointRestoreAdapterInterface } from '../contracts/CheckpointRestoreAdapterInterface.js';
import type { CheckpointStoreInterface } from '../contracts/CheckpointStoreInterface.js';
import type { SnapshottableInterface, StoreSnapshotType } from '../contracts/SnapshottableInterface.js';
import type { CheckpointDataType } from '../entities/checkpoint/CheckpointData.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { JsonObjectType } from '../entities/json.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateBase, NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

/**
 * Bare function signature for restoring state from a JSON snapshot.
 * Used internally by `CheckpointRestoreAdapter`. Pass a function of this
 * shape to `CheckpointRestoreAdapter.wrap(fn)` to obtain an adapter
 * that satisfies `CheckpointRestoreAdapterInterface`.
 */
type StateRestoreType<TState extends NodeStateInterface>
  = (snapshot: JsonObjectType) => TState;

/**
 * Concrete `CheckpointRestoreAdapterInterface` backed by a plain function.
 *
 * Use `CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap))` to
 * wrap an inline lambda for `Checkpoint.restoreState()` without giving up the
 * ergonomics of arrow-function syntax.
 *
 * @example
 * ```ts
 * const { state, dagName, cursor } = ckpt.restoreState(
 *   CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap)),
 * );
 * ```
 */
export class CheckpointRestoreAdapter<TState extends NodeStateInterface>
  implements CheckpointRestoreAdapterInterface<TState> {
  readonly #fn: StateRestoreType<TState>;

  private constructor(fn: StateRestoreType<TState>) {
    this.#fn = fn;
  }

  restore(snapshot: JsonObjectType): TState {
    return this.#fn(snapshot);
  }

  /**
   * Wrap a plain restore function in a `CheckpointRestoreAdapterInterface`.
   * The function receives a `JsonObjectType` snapshot and must return a `TState`
   * instance; the typical pattern is `(snap) => MyState.restore(snap)`.
   */
  static wrap<TState extends NodeStateInterface>(
    fn: StateRestoreType<TState>,
  ): CheckpointRestoreAdapter<TState> {
    return new CheckpointRestoreAdapter(fn);
  }
}

/** Result of a successful `restoreState` call. */
export type RecalledCheckpointType<TState extends NodeStateInterface> = {
  state: TState;
  dagName: string;
  cursor: string;
  executedNodes: string[];
  skippedNodes: string[];
}

/** Options for `Checkpoint.capture`. */
export type CaptureOptionsType = {
  /**
   * Named stores to snapshot alongside the state. Keys become the
   * names in `CheckpointData.stores`; the same names must be passed to
   * `restoreStores()` on resume. Omit or leave empty to capture state
   * only.
   */
  stores?: Record<string, SnapshottableInterface>;
}

/**
 * `Checkpoint`: a parsed and validated checkpoint record.
 *
 * Obtain instances via `Checkpoint.capture()` (when saving) or
 * `Checkpoint.load()` / `Checkpoint.recall()` (when recalling). Instance
 * methods `toJson`, `persist`, `restoreState`, and `restoreStores` cover the
 * full lifecycle.
 */
export class Checkpoint {
  /** Parsed + validated checkpoint payload. Serializable. */
  readonly data: CheckpointDataType;

  private constructor(data: CheckpointDataType) {
    this.data = data;
  }

  // ── Static factory methods ────────────────────────────────────────────────

  /**
   * Build a `Checkpoint` instance from a flow name, execution result, and
   * optional named stores. Snapshots all stores in parallel.
   *
   * Throws `DAGError` when `result.cursor === null` (the flow completed;
   * nothing to resume).
   */
  static async capture<TState extends NodeStateInterface & NodeStateBase>(
    dagName: string,
    result: ExecutionResultType<TState>,
    options: CaptureOptionsType = {},
  ): Promise<Checkpoint> {
    if (result.cursor === null) {
      throw new DAGError(`Cannot checkpoint a completed DAG '${dagName}': no cursor to resume from`);
    }

    const base: CheckpointDataType = {
      'dagName': dagName,
      'cursor': result.cursor,
      'state': result.state.snapshot(),
      'executedNodes': [...result.executedNodes],
      'skippedNodes': [...result.skippedNodes],
      'stores': {},
    };

    const storeMap = options.stores ?? {};
    const entries = Object.entries(storeMap);

    if (entries.length === 0) {
      return new Checkpoint(base);
    }

    const snapshots: [string, StoreSnapshotType][] = await Promise.all(
      entries.map(async ([name, store]): Promise<[string, StoreSnapshotType]> => {
        const snap = await store.snapshot();
        return [name, snap];
      }),
    );

    const stores: Record<string, StoreSnapshotType> = {};
    for (const [name, snap] of snapshots) {
      stores[name] = snap;
    }

    const data: CheckpointDataType = { ...base, stores };
    return new Checkpoint(data);
  }

  /**
   * Parse a raw value (typically from `JSON.parse`) into a `Checkpoint`
   * instance. Validates against `CheckpointDataSchema`. Throws `DAGError`
   * (code `VALIDATION_ERROR`) on schema failure.
   */
  static load(raw: unknown): Checkpoint {
    const valid = Validator.checkpoint.validate(raw);
    return new Checkpoint(valid);
  }

  /**
   * Load a checkpoint from a `CheckpointStoreInterface` by key. Returns `null` when
   * the store has no entry for the key. Composes `store.load` + `JSON.parse`
   * + `Checkpoint.load`. Throws `DAGError` (code `VALIDATION_ERROR`) when
   * the stored JSON fails schema validation.
   */
  static async recall(store: CheckpointStoreInterface, key: string): Promise<Checkpoint | null> {
    const json = await store.load(key);
    if (json === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DAGError(`Checkpoint '${key}' contains invalid JSON: ${message}`, { 'code': 'VALIDATION_ERROR' });
    }
    return Checkpoint.load(parsed);
  }

  // ── Instance methods ─────────────────────────────────────────────────────

  /**
   * Serialize this checkpoint's data to a JSON string.
   */
  toJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Persist this checkpoint to a `CheckpointStoreInterface` under `key`. Composes
   * `toJson` + `store.save`. Throws when the underlying store throws.
   */
  async persist(store: CheckpointStoreInterface, key: string): Promise<void> {
    await store.save(key, this.toJson());
  }

  /**
   * Rehydrate the state from this checkpoint via the supplied adapter.
   * Returns the rehydrated state, dag name, cursor, and execution history.
   *
   * Pass a `CheckpointRestoreAdapter.wrap((snap) => MyState.restore(snap))`
   * to wrap an inline lambda in the adapter contract.
   *
   * Throws `DAGError` (code `VALIDATION_ERROR`) when `this.data.cursor === null`.
   */
  restoreState<TState extends NodeStateInterface>(
    adapter: CheckpointRestoreAdapterInterface<TState>,
  ): RecalledCheckpointType<TState> {
    if (this.data.cursor === null) {
      throw new DAGError(`Cannot restore from a CheckpointData with null cursor: the DAG had no resumable position`, { 'code': 'VALIDATION_ERROR' });
    }
    return {
      'state': adapter.restore(this.data.state),
      'dagName': this.data.dagName,
      'cursor': this.data.cursor,
      'executedNodes': [...this.data.executedNodes],
      'skippedNodes': [...this.data.skippedNodes],
    };
  }

  /**
   * Populate the named stores from this checkpoint's store snapshots.
   *
   * Rules:
   * - Name in checkpoint but **absent** from the map → throws `DAGError`
   *   (loud failure beats silent desync).
   * - Name in the map but **absent** from the checkpoint → no-op
   *   (the consumer added a store that was not tracked; acceptable).
   * - Matched pairs → `store.restore(snapshot)` in parallel.
   *   `BaseStore.restore` throws `StoreError(INCOMPATIBLE_SNAPSHOT)` on
   *   type/version mismatch; this method propagates that unchanged.
   */
  async restoreStores(stores: Readonly<Record<string, SnapshottableInterface>>): Promise<void> {
    const checkpointStores = this.data.stores;
    if (Object.keys(checkpointStores).length === 0) {
      return;
    }

    const missingNames: string[] = [];
    for (const name of Object.keys(checkpointStores)) {
      if (!(name in stores)) {
        missingNames.push(name);
      }
    }
    if (missingNames.length > 0) {
      throw new DAGError(
        `Cannot restore stores: checkpoint contains store(s) [${missingNames.join(', ')}] that are absent from the restore map. ` +
        `Pass matching store instances keyed by the same names used in Checkpoint.capture().`,
      );
    }

    await Promise.all(
      Object.entries(checkpointStores).map(async ([name, snapshot]) => {
        // `store` is guaranteed present: the `missingNames` check above throws
        // for any checkpoint key absent from the `stores` map. The explicit
        // undefined guard narrows the index access without a cast.
        const store = stores[name];
        if (store === undefined) return;
        await store.restore(snapshot);
      }),
    );
  }
}

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
 * const raw = JSON.parse(await storage.get('ckpt')) as unknown;
 * const ckpt = Checkpoint.load(raw);
 * const { dagName, state: restoredState, cursor } = ckpt.restoreState(
 *   CheckpointRestoreAdapterFn.wrap((snap) => MyState.restore(snap)),
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
 *     CheckpointRestoreAdapterFn.wrap((snap) => MyState.restore(snap)),
 *   );
 *   await dispatcher.resume(dagName, state, cursor);
 * }
 * ```
 */

import type { CheckpointRestoreAdapter } from '../contracts/CheckpointRestoreAdapter.js';
import type { CheckpointStore } from '../contracts/CheckpointStore.js';
import type { Snapshottable, StoreSnapshot } from '../contracts/Snapshottable.js';
import { CHECKPOINT_DATA_VERSION } from '../entities/checkpoint/CheckpointData.js';
import type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
import type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
import type { JsonObject } from '../entities/json.js';
import { DAGError, ValidationError } from '../errors/DAGError.js';
import type { NodeStateBase, NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

/**
 * Bare function signature for restoring state from a JSON snapshot.
 * Used internally by `CheckpointRestoreAdapterFn`. Pass a function of this
 * shape to `CheckpointRestoreAdapterFn.wrap(fn)` to obtain an adapter
 * that satisfies `CheckpointRestoreAdapter`.
 */
type StateRestoreFn<TState extends NodeStateInterface>
  = (snapshot: JsonObject) => TState;

/**
 * Concrete `CheckpointRestoreAdapter` backed by a plain function.
 *
 * Use `CheckpointRestoreAdapterFn.wrap((snap) => MyState.restore(snap))` to
 * wrap an inline lambda for `Checkpoint.restoreState()` without giving up the
 * ergonomics of arrow-function syntax.
 *
 * @example
 * ```ts
 * const { state, dagName, cursor } = ckpt.restoreState(
 *   CheckpointRestoreAdapterFn.wrap((snap) => MyState.restore(snap)),
 * );
 * ```
 */
export class CheckpointRestoreAdapterFn<TState extends NodeStateInterface>
  implements CheckpointRestoreAdapter<TState> {
  readonly #fn: StateRestoreFn<TState>;

  private constructor(fn: StateRestoreFn<TState>) {
    this.#fn = fn;
  }

  restore(snapshot: JsonObject): TState {
    return this.#fn(snapshot);
  }

  /**
   * Wrap a plain restore function in a `CheckpointRestoreAdapter`.
   * The function receives a `JsonObject` snapshot and must return a `TState`
   * instance; the typical pattern is `(snap) => MyState.restore(snap)`.
   */
  static wrap<TState extends NodeStateInterface>(
    fn: StateRestoreFn<TState>,
  ): CheckpointRestoreAdapterFn<TState> {
    return new CheckpointRestoreAdapterFn(fn);
  }
}

/** Result of a successful `restoreState` call. */
export interface RecalledCheckpoint<TState extends NodeStateInterface> {
  state: TState;
  dagName: string;
  cursor: string;
  executedNodes: string[];
  skippedNodes: string[];
}

/** Options for `Checkpoint.capture`. */
export interface CaptureOptionsInterface {
  /**
   * Named stores to snapshot alongside the state. Keys become the
   * names in `CheckpointData.stores`; the same names must be passed to
   * `restoreStores()` on resume. Omit or leave empty to capture state
   * only.
   */
  stores?: Record<string, Snapshottable>;
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
  readonly data: CheckpointData;

  private constructor(data: CheckpointData) {
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
    result: ExecutionResultInterface<TState>,
    options: CaptureOptionsInterface = {},
  ): Promise<Checkpoint> {
    if (result.cursor === null) {
      throw new DAGError(`Cannot checkpoint a completed DAG '${dagName}': no cursor to resume from`);
    }

    const base: CheckpointData = {
      'version': CHECKPOINT_DATA_VERSION,
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

    const snapshots = await Promise.all(
      entries.map(async ([name, store]) => {
        const snap = await store.snapshot();
        // Post-validation boundary: `store.snapshot()` returns `StoreSnapshot`
        // (the contract return type). The tuple cast preserves the pair for
        // later insertion into `StoreRecord` without losing the key.
        return [name, snap] as [string, StoreSnapshot];
      }),
    );

    // Build the stores record in the schema-derived shape.
    // `StoreSnapshot` is the contract type; `CheckpointData['stores'][string]`
    // is the schema-derived type. Both have readonly fields; the cast bridges
    // the nominal type gap between the json-schema-to-ts derivation and the
    // hand-written contract without a structural difference at runtime.
    type StoreRecord = NonNullable<CheckpointData['stores']>;
    type StoreEntry  = StoreRecord[string];
    const stores: StoreRecord = {};
    for (const [name, snap] of snapshots) {
      stores[name] = snap as StoreEntry;
    }

    const data: CheckpointData = { ...base, stores };
    return new Checkpoint(data);
  }

  /**
   * Parse a raw value (typically from `JSON.parse`) into a `Checkpoint`
   * instance. Validates against `CheckpointDataSchema`. Throws
   * `ValidationError` on schema failure.
   */
  static load(raw: unknown): Checkpoint {
    const valid = Validator.checkpoint.validate(raw);
    return new Checkpoint(valid);
  }

  /**
   * Load a checkpoint from a `CheckpointStore` by key. Returns `null` when
   * the store has no entry for the key. Composes `store.load` + `JSON.parse`
   * + `Checkpoint.load`. Throws `ValidationError` when the stored JSON fails
   * schema validation.
   */
  static async recall(store: CheckpointStore, key: string): Promise<Checkpoint | null> {
    const json = await store.load(key);
    if (json === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Checkpoint '${key}' contains invalid JSON: ${message}`);
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
   * Persist this checkpoint to a `CheckpointStore` under `key`. Composes
   * `toJson` + `store.save`. Throws when the underlying store throws.
   */
  async persist(store: CheckpointStore, key: string): Promise<void> {
    await store.save(key, this.toJson());
  }

  /**
   * Rehydrate the state from this checkpoint via the supplied adapter.
   * Returns the rehydrated state, dag name, cursor, and execution history.
   *
   * Pass a `CheckpointRestoreAdapterFn.wrap((snap) => MyState.restore(snap))`
   * to wrap an inline lambda in the adapter contract.
   *
   * Throws `ValidationError` when `this.data.cursor === null`.
   */
  restoreState<TState extends NodeStateInterface>(
    adapter: CheckpointRestoreAdapter<TState>,
  ): RecalledCheckpoint<TState> {
    if (this.data.cursor === null) {
      throw new ValidationError(`Cannot restore from a CheckpointData with null cursor: the DAG had no resumable position`);
    }
    return {
      // Post-validation boundary: `this.data` passed `Validator.checkpoint`
      // at construction time, so `data.state` satisfies `JsonObject`. The
      // schema-derived type carries `JsonObject` but TypeScript infers
      // `CheckpointData['state']` as `Record<string, unknown>`; the cast is a
      // safe narrowing to the structurally identical `JsonObject` alias.
      'state': adapter.restore(this.data.state as JsonObject),
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
  async restoreStores(stores: Readonly<Record<string, Snapshottable>>): Promise<void> {
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
        // for any checkpoint key absent from the `stores` map, so every key
        // that reaches here has a matching entry.
        const store = stores[name] as Snapshottable;
        // Post-validation boundary: `snapshot` comes from `CheckpointData.stores`
        // which is validated by `Validator.checkpoint` at load time. The
        // schema-derived type is structurally identical to `StoreSnapshot`; the
        // cast bridges the readonly/mutable gap in the generated types.
        await store.restore(snapshot as StoreSnapshot);
      }),
    );
  }
}

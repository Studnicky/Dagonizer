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
 * const dagIri = 'urn:noocodec:dag:my-dag';
 * const result = await dispatcher.execute(dagIri, state, { signal });
 * if (result.cursor !== null) {
 *   const ckpt = await Checkpoint.capture(dagIri, result);
 *   await storage.set('ckpt', ckpt.toJson());
 * }
 *
 * // Resume later.
 * const raw: unknown = JSON.parse(await storage.get('ckpt'));
 * const ckpt = Checkpoint.load(raw);
 * const { dagName, state: restoredState, cursor } = await ckpt.restoreState(
 *   CheckpointRestoreAdapter.wrap(() => new MyState()),
 * );
 * const finalResult = await dispatcher.resume(dagName, restoredState, cursor);
 * ```
 *
 * @example Named-store checkpoint
 * ```ts
 * const ckpt = await Checkpoint.capture('urn:noocodec:dag:my-dag', result, { stores: { memory } });
 * await checkpointStore.save(runId, ckpt.toJson());
 *
 * // Resume:
 * const ckpt2 = await Checkpoint.recall(checkpointStore, runId);
 * if (ckpt2 !== null) {
 *   const freshMemory = new MemoryStore();
 *   await ckpt2.restoreStores({ memory: freshMemory });
 *   const { dagName, state, cursor } = await ckpt2.restoreState(
 *     CheckpointRestoreAdapter.wrap(() => new MyState()),
 *   );
 *   await dispatcher.resume(dagName, state, cursor);
 * }
 * ```
 */

import type { CheckpointRestoreAdapterInterface } from '../contracts/CheckpointRestoreAdapterInterface.js';
import type { CheckpointStoreInterface } from '../contracts/CheckpointStoreInterface.js';
import type { SnapshottableInterface, StoreSnapshotType } from '../contracts/SnapshottableInterface.js';
import type { CheckpointDataType } from '../entities/checkpoint/CheckpointData.js';
import { DAGIdentity } from '../entities/dag/DAG.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import { DAGError } from '../errors/DAGError.js';
import { BatchItemExecutor } from '../execution/BatchItemExecutor.js';
import { GraphStateTerms } from '../graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../graph/GraphStateTransferCodec.js';
import { NodeStateBase, type NodeStateInterface } from '../NodeStateBase.js';
import type { BatchExecutionOptionsType } from '../types/BatchExecutionOptions.js';
import { Validator } from '../validation/Validator.js';

/**
 * Plain function signature for restoring state from a JSON snapshot.
 * Used internally by `CheckpointRestoreAdapter`. Pass a function of this
 * shape to `CheckpointRestoreAdapter.wrap(fn)` to obtain an adapter
 * that satisfies `CheckpointRestoreAdapterInterface`.
 */
type StateRestoreType<TState extends NodeStateInterface>
  = () => TState;

/**
 * Concrete `CheckpointRestoreAdapterInterface` backed by a plain function.
 *
 * Use `CheckpointRestoreAdapter.wrap(() => new MyState())` to
 * wrap an inline lambda for `Checkpoint.restoreState()` without giving up the
 * ergonomics of arrow-function syntax.
 *
 * @example
 * ```ts
 * const { state, dagName, cursor } = await ckpt.restoreState(
 *   CheckpointRestoreAdapter.wrap(() => new MyState()),
 * );
 * ```
 */
export class CheckpointRestoreAdapter<TState extends NodeStateInterface>
  implements CheckpointRestoreAdapterInterface<TState> {
  readonly #fn: StateRestoreType<TState>;

  private constructor(fn: StateRestoreType<TState>) {
    this.#fn = fn;
  }

  restore(): TState {
    return this.#fn();
  }

  /**
   * Wrap a plain restore function in a `CheckpointRestoreAdapterInterface`.
   * The function constructs a fresh `TState` instance. The checkpoint graph is
   * restored by `Checkpoint` through the graph-state port after construction.
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
  /**
   * Execution policy for named store snapshots. Controls concurrency, throttle,
   * and timing for `store.snapshot()` calls.
   */
  execution?: BatchExecutionOptionsType;
}

/** Options for `Checkpoint.restoreStores`. */
export type RestoreStoresOptionsType = {
  /**
   * Execution policy for named store restores. Controls concurrency, throttle,
   * and timing for `store.restore(snapshot)` calls.
   */
  execution?: BatchExecutionOptionsType;
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
   * Build a `Checkpoint` instance from a DAG IRI, execution result, and
   * optional named stores. Store snapshots run through the shared batch
   * executor, so consumers can tune concurrency, throttle, and timing.
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

    const dagIri = DAGIdentity.id(dagName);
    const graphJsonLd = await result.state.snapshotJsonLd(result.state.runIri);
    const graphTransfer = await GraphStateTransferCodec.inlineStream(
      result.state.runIri,
      [GraphStateTerms.runGraphIri(result.state.runIri)],
      result.state.snapshotGraph(),
      { 'dagIri': dagIri, 'placementPath': [result.cursor], 'placementIri': result.cursor, "jsonLd": graphJsonLd },
    );
    const graphNquads = graphTransfer.nquads;
    const graphHash = graphTransfer.mode === 'inline-nquads' ? graphTransfer.hash : '';
    const base: CheckpointDataType = {
      'dagName': dagIri,
      'cursor': result.cursor,
      'executedNodes': [...result.executedNodes],
      'skippedNodes': [...result.skippedNodes],
      'stores': {},
      'graph': {
        'runIri': result.state.runIri,
        'graphIri': GraphStateTerms.runGraphIri(result.state.runIri),
        'nquads': graphNquads,
        'hash': graphHash,
        'jsonLd': graphJsonLd,
      },
    };

    const storeMap = options.stores ?? {};
    const entries = Object.entries(storeMap);

    if (entries.length === 0) {
      return new Checkpoint(base);
    }

    const snapshots = await BatchItemExecutor.map(
      entries,
      async ([name, store]): Promise<[string, StoreSnapshotType]> => {
        const snap = await store.snapshot();
        return [name, snap];
      },
      options.execution,
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
      const message = DAGError.messageOf(error);
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
   * Returns the rehydrated state, DAG IRI, cursor, and execution history.
   *
   * Pass a `CheckpointRestoreAdapter.wrap(() => new MyState())`
   * to wrap an inline lambda in the adapter contract.
   *
   * Throws `DAGError` (code `VALIDATION_ERROR`) when `this.data.cursor === null`.
   */
  async restoreState<TState extends NodeStateInterface>(
    adapter: CheckpointRestoreAdapterInterface<TState>,
  ): Promise<RecalledCheckpointType<TState>> {
    if (this.data.cursor === null) {
      throw new DAGError(`Cannot restore from a CheckpointData with null cursor: the DAG had no resumable position`, { 'code': 'VALIDATION_ERROR' });
    }
    const state = adapter.restore();
    if (!(state instanceof NodeStateBase)) {
      throw new DAGError('Checkpoint restore adapters must construct a NodeStateBase instance', { 'code': 'VALIDATION_ERROR' });
    }
    await state.restoreJsonLd(this.data.graph.runIri, this.data.graph.jsonLd);
    return {
      'state': state,
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
  async restoreStores(
    stores: Readonly<Record<string, SnapshottableInterface>>,
    options: RestoreStoresOptionsType = {},
  ): Promise<void> {
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

    await BatchItemExecutor.map(
      Object.entries(checkpointStores),
      async ([name, snapshot]) => {
        // `store` is guaranteed present: the `missingNames` check above throws
        // for any checkpoint key absent from the `stores` map. The explicit
        // undefined guard narrows the index access without a cast.
        const store = stores[name];
        if (store === undefined) return;
        await store.restore(snapshot);
      },
      options.execution,
    );
  }
}

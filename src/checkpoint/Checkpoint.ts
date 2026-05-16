/**
 * Checkpoint — assemble and parse `CheckpointData` records.
 *
 * The package does not ship a persistence backend. Callers serialize the
 * `CheckpointData` returned by `from()` however they want (file, kv,
 * postgres, etc.) and feed it back through `restore()` when ready to
 * resume.
 *
 * `restore()` takes a state-factory function so callers can rehydrate
 * subclassed `NodeStateBase` derivatives. Any function that maps a
 * snapshot `JsonObject` to `TState` satisfies the constraint.
 *
 * @example
 * ```ts
 * // Save a checkpoint after early termination.
 * const result = await dispatcher.execute('my-dag', state, { signal });
 * if (result.cursor !== null) {
 *   const data = Checkpoint.from('my-dag', result);
 *   await storage.set('ckpt', Checkpoint.toJson(data));
 * }
 *
 * // Resume later.
 * const raw = JSON.parse(await storage.get('ckpt'));
 * const { dagName, state: restoredState, cursor } = Checkpoint.restore(
 *   raw,
 *   (snap) => MyState.restore(snap),
 * );
 * const finalResult = await dispatcher.resume(dagName, restoredState, cursor);
 * ```
 */

import type { CheckpointStore } from '../contracts/CheckpointStore.js';
import { CHECKPOINT_DATA_VERSION } from '../entities/checkpoint/CheckpointData.js';
import type { CheckpointData } from '../entities/checkpoint/CheckpointData.js';
import type { ExecutionResultInterface } from '../entities/execution/ExecutionResult.js';
import type { JsonObject } from '../entities/json.js';
import { DAGError, ValidationError } from '../errors/DAGError.js';
import type { NodeStateBase, NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

/**
 * Restore-factory shape passed to `Checkpoint.restore`. Any function that
 * maps a snapshot to a state instance satisfies it:
 *
 *   Checkpoint.restore(data, (snap) => MyState.restore(snap))
 *
 * The factory form is what carries the concrete type through generic
 * inference — `static restore` with `this`-typing loses the type when
 * passed as a class reference.
 */
export type StateRestoreFnType<TState extends NodeStateInterface>
  = (snapshot: JsonObject) => TState;

/** Result of a successful `Checkpoint.recall`. */
export interface RecalledCheckpoint<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly dagName: string;
  readonly cursor: string;
  readonly executedNodes: readonly string[];
  readonly skippedNodes: readonly string[];
}

export class Checkpoint {
  private constructor() { /* static class */ }

  /**
   * Build a `CheckpointData` record from a flow name and an execution
   * result. Throws when the result has no cursor (the flow completed —
   * nothing to resume).
   */
  static from<TState extends NodeStateInterface & NodeStateBase>(
    dagName: string,
    result: ExecutionResultInterface<TState>,
  ): CheckpointData {
    if (result.cursor === null) {
      throw new DAGError(`Cannot checkpoint a completed DAG '${dagName}' — no cursor to resume from`);
    }
    return {
      'version': CHECKPOINT_DATA_VERSION,
      'dagName': dagName,
      'cursor': result.cursor,
      'state': result.state.snapshot(),
      'executedNodes': [...result.executedNodes],
      'skippedNodes': [...result.skippedNodes],
    };
  }

  /**
   * Parse and validate a `CheckpointData` record, then rehydrate a state
   * instance via the supplied factory. Returns the rehydrated state, the
   * flow name, and the cursor (next node to run).
   *
   * Pass to `dispatcher.resume(dagName, state, cursor)` to continue
   * execution.
   */
  static restore<TState extends NodeStateInterface>(
    data: unknown,
    restoreState: StateRestoreFnType<TState>,
  ): { 'state': TState; 'dagName': string; 'cursor': string; 'executedNodes': string[]; 'skippedNodes': string[]; } {
    const valid: CheckpointData = Validator.checkpoint.validate(data);
    if (valid.cursor === null) {
      throw new ValidationError(`Cannot restore from a CheckpointData with null cursor — the DAG had no resumable position`);
    }
    return {
      'state': restoreState(valid.state as JsonObject),
      'dagName': valid.dagName,
      'cursor': valid.cursor,
      'executedNodes': [...valid.executedNodes],
      'skippedNodes': [...valid.skippedNodes],
    };
  }

  /**
   * Serialize a CheckpointData to a JSON string. Symmetric counterpart
   * to `JSON.parse` + `Checkpoint.restore`.
   */
  static toJson(checkpoint: CheckpointData): string {
    return JSON.stringify(checkpoint, null, 2);
  }

  /**
   * Persist a `CheckpointData` to a `CheckpointStore`. Composes
   * `Checkpoint.toJson` with the store's `save`. Throws when the
   * underlying store throws.
   */
  static async persist(store: CheckpointStore, key: string, data: CheckpointData): Promise<void> {
    await store.save(key, Checkpoint.toJson(data));
  }

  /**
   * Recall a checkpoint from a `CheckpointStore`. Returns `null` when
   * no entry exists under `key`; throws `ValidationError` when the
   * stored JSON fails schema validation.
   *
   * Composes the store's `load` with `JSON.parse` and `Checkpoint.restore`.
   */
  static async recall<TState extends NodeStateInterface>(
    store: CheckpointStore,
    key: string,
    restoreState: StateRestoreFnType<TState>,
  ): Promise<RecalledCheckpoint<TState> | null> {
    const json = await store.load(key);
    if (json === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Checkpoint '${key}' contains invalid JSON: ${message}`);
    }
    return Checkpoint.restore<TState>(parsed, restoreState);
  }
}

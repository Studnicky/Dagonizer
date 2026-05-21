import type { JsonObject, JsonValue } from './entities/json.js';
import type { NodeErrorInterface } from './entities/node/NodeError.js';
import type { NodeWarning } from './entities/node/NodeWarning.js';
import { DAGError } from './errors/DAGError.js';
import { DAGLifecycleMachine } from './lifecycle/DAGLifecycleMachine.js';
import type { DAGLifecycleState } from './lifecycle/DAGLifecycleState.js';

/**
 * Shared state flowing through all nodes in a flow.
 * Concrete implementations extend this for domain-specific state.
 *
 * State is the "clipboard" that all nodes read from and write to.
 * Errors are collected in state — they don't stop execution.
 *
 * The data fields (errors, warnings, metadata) mirror `NodeStateData`
 * — the persistence shape returned by `NodeStateBase.snapshot()`.
 * The `lifecycle` field here carries an in-memory `Error` on the `failed`
 * branch, which is not JSON-expressible; `NodeStateData` holds the opaque
 * wire form. See `entities/node/NodeStateData.ts` for the persistence shape.
 */
export interface NodeStateInterface {
  /**
   * Clone state for isolated execution (sub-flows and fan-out).
   */
  clone(): NodeStateInterface;

  /**
   * Collect an error in state.
   */
  collectError(error: NodeErrorInterface): void;

  /**
   * Collect a warning in state.
   */
  collectWarning(warning: NodeWarning): void;

  /**
   * Collected errors from all nodes.
   * Errors accumulate — they don't stop the flow.
   * At completion, caller decides what to do with them.
   */
  readonly 'errors': readonly NodeErrorInterface[];

  /**
   * Get a metadata value with type casting.
   */
  getMetadata<T>(key: string): T | undefined;

  /**
   * Current DAG lifecycle state (full discriminated union).
   */
  readonly 'lifecycle': DAGLifecycleState;

  /**
   * Mark state as cancelled (terminal). Dispatched by the dispatcher (or a
   * cancellation supervisor) when an in-flight flow is aborted.
   */
  markCancelled(reason: string): void;

  /**
   * Mark state as completed (called by dispatcher at flow end).
   */
  markCompleted(): void;

  /**
   * Mark state as failed (terminal). Dispatched by the dispatcher when a
   * node throws; the original error is carried into the lifecycle.
   */
  markFailed(error: Error): void;

  /**
   * Mark state as running (called by dispatcher at flow start).
   */
  markRunning(): void;

  /**
   * Mark state as timed-out (terminal). Reserved for deadline enforcement
   * at the dispatcher tier.
   */
  markTimedOut(): void;

  /**
   * Generic metadata for routing decisions and node communication.
   */
  readonly 'metadata': Readonly<Record<string, unknown>>;

  /**
   * Set a metadata value.
   */
  setMetadata(key: string, value: unknown): void;

  /**
   * Collected warnings from all nodes.
   */
  readonly 'warnings': readonly NodeWarning[];
}

/**
 * Base implementation of node state. Lifecycle is the canonical
 * `DAGLifecycleState` discriminated union exposed via the `lifecycle`
 * getter.
 *
 * Each `mark*` dispatches the corresponding lifecycle event through the
 * pure reducer. Illegal transitions throw `DAGError`.
 *
 * Extend this class for domain-specific state.
 *
 * @example
 * ```ts
 * class PipelineState extends NodeStateBase {
 *   items: string[] = [];
 *
 *   protected override snapshotData() {
 *     return { items: [...this.items] };
 *   }
 *
 *   protected override restoreData(snap: JsonObject) {
 *     const raw = snap['items'];
 *     if (Array.isArray(raw)) this.items = raw as string[];
 *   }
 * }
 *
 * const state = new PipelineState();
 * // After execution:
 * const snap = state.snapshot();
 * const restored = PipelineState.restore(snap);
 * ```
 */
export class NodeStateBase implements NodeStateInterface {
  private readonly _errors: NodeErrorInterface[] = [];
  private _lifecycle: DAGLifecycleState = DAGLifecycleMachine.initial();
  private _metadata: Record<string, unknown> = {};
  private readonly _warnings: NodeWarning[] = [];

  constructor() {
    // Canonical instantiation. Subclass to add domain-specific state.
  }

  clone(): NodeStateBase {
    const cloned = new NodeStateBase();

    // Lifecycle resets to `pending`, errors/warnings empty for fresh
    // sub-execution. Only metadata is preserved for data passing between
    // parent and child.
    cloned._metadata = structuredClone(this._metadata);

    return cloned;
  }

  collectError(error: NodeErrorInterface): void {
    this._errors.push(error);
  }

  collectWarning(warning: NodeWarning): void {
    this._warnings.push(warning);
  }

  get errors(): readonly NodeErrorInterface[] {
    return this._errors;
  }

  getMetadata<T>(key: string): T | undefined {
    return this._metadata[key] as T | undefined;
  }

  /**
   * Current DAG lifecycle state (full discriminated union).
   */
  get lifecycle(): DAGLifecycleState {
    return this._lifecycle;
  }

  markCancelled(reason: string): void {
    this.dispatch({ "type": 'cancel', reason }, 'cancelled');
  }

  markCompleted(): void {
    this.dispatch({ "type": 'succeed' }, 'completed');
  }

  markFailed(error: Error): void {
    this.dispatch({ "type": 'fail', error }, 'failed');
  }

  markRunning(): void {
    this.dispatch({ "type": 'start' }, 'running');
  }

  markTimedOut(): void {
    this.dispatch({ "type": 'timeout' }, 'timed_out');
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }

  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
  }

  get warnings(): readonly NodeWarning[] {
    return this._warnings;
  }

  private dispatch(
    event: Parameters<typeof DAGLifecycleMachine.transition>[1],
    targetKind: DAGLifecycleState['kind'],
  ): void {
    const next = DAGLifecycleMachine.transition(this._lifecycle, event);

    if (next === this._lifecycle) {
      throw new DAGError(
        `Cannot mark ${targetKind}: lifecycle is ${this._lifecycle.kind}`,
      );
    }
    this._lifecycle = next;
  }

  /**
   * Serialize state to a JSON-safe snapshot for checkpointing.
   *
   * Subclasses with extra fields override `snapshotData()` to add them;
   * the base implementation captures metadata, errors, and warnings.
   * Lifecycle is intentionally NOT captured — resume starts a fresh
   * execution from `pending`.
   */
  snapshot(): JsonObject {
    return {
      'metadata': structuredClone(this._metadata) as JsonValue,
      'errors': this._errors.map((e) => ({ ...e })) as unknown as JsonValue,
      'warnings': this._warnings.map((w) => ({ ...w })) as unknown as JsonValue,
      ...this.snapshotData(),
    };
  }

  /**
   * Subclass hook for snapshotting additional fields. Default returns an
   * empty object. Override to include domain-specific state.
   */
  protected snapshotData(): JsonObject {
    return {};
  }

  /**
   * Rehydrate state from a snapshot. Lifecycle resets to `pending` — the
   * resumed execution is a new run on the DAG lifecycle FSM.
   *
   * Subclasses with extra fields override `restoreData()` to read them
   * off the snapshot before the constructor returns.
   */
  static restore<T extends NodeStateBase>(this: new () => T, snapshot: JsonObject): T {
    const instance = new this();
    instance.applySnapshot(snapshot);
    return instance;
  }

  /**
   * Apply a snapshot to this instance. Called by `restore()`. Subclasses
   * override to read domain-specific fields, calling `super.applySnapshot`
   * to inherit the base behavior.
   */
  protected applySnapshot(snapshot: JsonObject): void {
    const metadata = snapshot['metadata'];
    if (metadata !== undefined && typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
      this._metadata = structuredClone(metadata) as Record<string, unknown>;
    }
    const errors = snapshot['errors'];
    if (Array.isArray(errors)) {
      for (const e of errors) {
        if (typeof e === 'object' && e !== null && !Array.isArray(e)) {
          this._errors.push(e as unknown as NodeErrorInterface);
        }
      }
    }
    const warnings = snapshot['warnings'];
    if (Array.isArray(warnings)) {
      for (const w of warnings) {
        if (typeof w === 'object' && w !== null && !Array.isArray(w)) {
          this._warnings.push(w as unknown as NodeWarning);
        }
      }
    }
    this.restoreData(snapshot);
  }

  /**
   * Subclass hook for restoring additional fields. Default is a no-op.
   */
  protected restoreData(_snapshot: JsonObject): void { /* override */ }
}

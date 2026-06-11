/**
 * GatherStrategies: pluggable strategy registry that decides how the
 * dispatcher merges scatter clone results back into the parent state.
 *
 * A `GatherStrategy` is a class with a `name` and an `apply` method (batch
 * gather — called after all clones complete). Strategies that extend
 * `IncrementalGatherStrategy` also implement `applyIncremental` to fold each
 * completed record into parent state as it arrives, producing results
 * progressively. Batch-only strategies accumulate records and call `apply`
 * at the end.
 *
 * Four defaults register at module load: `map`, `append`, `partition`,
 * `custom`. Consumers extend `GatherStrategy` and call
 * `GatherStrategies.register(new MyGather())` to add their own.
 *
 * @example
 * ```ts
 * class TopNGather extends GatherStrategy {
 *   readonly name = 'top-n';
 *   async apply<TState extends NodeStateInterface>(
 *     config: GatherConfig,
 *     execution: GatherExecution<TState>,
 *   ): Promise<void> {
 *     const target = config.target ?? 'topResults';
 *     const all = execution.records.map((r) => r.item);
 *     execution.accessor.set(execution.state, target, all.slice(0, 10));
 *   }
 * }
 *
 * GatherStrategies.register(new TopNGather());
 * ```
 */

import type { GatherExecution, GatherRecord } from '../contracts/GatherExecution.js';
import type { StateAccessor } from '../contracts/StateAccessor.js';
import type { GatherConfig } from '../entities/dag/GatherConfig.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export type { GatherExecution, GatherRecord };

/**
 * Extension point for gather strategies.
 *
 * Subclass and override `apply` for batch gather — called after all scatter
 * clones complete. For incremental (per-clone) folding, extend
 * `IncrementalGatherStrategy` instead and override `applyIncremental`.
 *
 * The class registers in `GatherStrategies` under its `name`; the dispatcher
 * resolves it via `GatherStrategies.resolve(name)` when all scatter clones
 * have reported.
 */
export abstract class GatherStrategy {
  /** Wire-shape identifier; matches `GatherConfig.strategy`. */
  abstract readonly name: string;

  /**
   * Declares whether this strategy supports incremental folding.
   * Batch-only strategies (the default) set this to `false`; incremental
   * strategies extend `IncrementalGatherStrategy` which overrides this to `true`.
   * The dispatcher checks `instanceof IncrementalGatherStrategy` — this field
   * is informational and may be used by consumers for documentation/introspection.
   */
  readonly supportsIncremental: boolean = false;

  /**
   * Apply the strategy in batch mode. Called once after all scatter clones
   * complete (or, for strategies that do not support `applyIncremental`, after
   * every clone regardless). Mutates `execution.state` in place; may invoke
   * a registered node via `execution.invokeNode(name)`.
   */
  abstract apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void>;

}

/**
 * Base class for gather strategies that support incremental folding.
 *
 * Extend this class (instead of `GatherStrategy` directly) to enable
 * per-clone incremental folding: the dispatcher narrows to this type
 * and calls `applyIncremental` after each clone completes, without needing
 * an optional-method presence check.
 *
 * `supportsIncremental` is permanently `true` here; subclasses MUST NOT
 * override it back to `false`. The batch `apply` method MUST still be
 * implemented for compatibility with dispatchers that use the batch path.
 *
 * @example
 * ```ts
 * class TopNGather extends IncrementalGatherStrategy {
 *   readonly name = 'top-n';
 *   applyIncremental(config, record, state, accessor) {
 *     // fold one record into state
 *   }
 *   async apply(config, execution) {
 *     // batch fallback: call applyIncremental for each record
 *     for (const record of execution.records) {
 *       this.applyIncremental(config, record, execution.state, execution.accessor);
 *     }
 *   }
 * }
 * GatherStrategies.register(new TopNGather());
 * ```
 */
export abstract class IncrementalGatherStrategy extends GatherStrategy {
  /** Always `true`; incremental strategies declare this at the class level. */
  override readonly supportsIncremental = true;

  /**
   * Apply the strategy incrementally for a single record as it arrives.
   * Called after each clone body completes successfully, before the next clone
   * starts. Implementations mutate `state` in place.
   *
   * Every `IncrementalGatherStrategy` subclass must implement this method.
   * The dispatcher narrows to `IncrementalGatherStrategy` via `instanceof`
   * and calls this method directly — no optional-method presence check needed.
   *
   * The `accessor` and `state` parameters mirror those in `GatherExecution`
   * and are provided directly to avoid constructing a full execution context
   * for every incremental fold.
   */
  abstract applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void;
}

class MapGatherStrategy extends IncrementalGatherStrategy {
  readonly name = 'map';

  applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const mapping = config.mapping ?? {};
    for (const [clonePath, parentPath] of Object.entries(mapping)) {
      const value = accessor.get(record.cloneState, clonePath);
      const existing = accessor.get<readonly unknown[]>(state, parentPath) ?? [];
      accessor.set(state, parentPath, [...existing, value]);
    }
  }

  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    const mapping = config.mapping ?? {};
    for (const [clonePath, parentPath] of Object.entries(mapping)) {
      if (execution.records.length === 1 && execution.records[0] !== undefined) {
        // Singleton: write scalar to parent path.
        const value = execution.accessor.get(execution.records[0].cloneState, clonePath);
        execution.accessor.set(execution.state, parentPath, value);
      } else {
        // Multi-clone: `execution.records` is already in source-index order
        // (the scatter loop builds them index-ordered across batches — see
        // GatherExecution.records), so map directly without a re-sort.
        const values = execution.records
          .map((r) => execution.accessor.get(r.cloneState, clonePath));
        const existing = execution.accessor.get<readonly unknown[]>(execution.state, parentPath) ?? [];
        execution.accessor.set(execution.state, parentPath, [...existing, ...values]);
      }
    }
  }
}

class AppendGatherStrategy extends IncrementalGatherStrategy {
  readonly name = 'append';

  applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) {
      throw new DAGError('Gather append strategy requires target path');
    }
    const value = config.field !== undefined
      ? accessor.get(record.cloneState, config.field)
      : record.item;
    const existing = accessor.get<readonly unknown[]>(state, config.target) ?? [];
    accessor.set(state, config.target, [...existing, value]);
  }

  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) {
      throw new DAGError('Gather append strategy requires target path');
    }
    const target = config.target;
    // records are already source-index ordered (see GatherExecution.records).
    const values = execution.records.map((r) =>
      config.field !== undefined
        ? execution.accessor.get(r.cloneState, config.field)
        : r.item,
    );
    const existing = execution.accessor.get<readonly unknown[]>(execution.state, target) ?? [];
    execution.accessor.set(execution.state, target, [...existing, ...values]);
  }
}

class PartitionGatherStrategy extends IncrementalGatherStrategy {
  readonly name = 'partition';

  applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const partitions = config.partitions ?? {};
    const targetPath = partitions[record.output];
    if (targetPath === undefined) return;
    const value = config.field !== undefined
      ? accessor.get(record.cloneState, config.field)
      : record.item;
    const existing = accessor.get<readonly unknown[]>(state, targetPath) ?? [];
    accessor.set(state, targetPath, [...existing, value]);
  }

  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    const partitions = config.partitions ?? {};
    for (const [outputToken, targetPath] of Object.entries(partitions)) {
      // records are already source-index ordered (see GatherExecution.records),
      // so filtering preserves index order without a re-sort.
      const matching = execution.records
        .filter((r) => r.output === outputToken);
      const values = matching.map((r) =>
        config.field !== undefined
          ? execution.accessor.get(r.cloneState, config.field)
          : r.item,
      );
      if (values.length > 0) {
        const existing = execution.accessor.get<readonly unknown[]>(execution.state, targetPath) ?? [];
        execution.accessor.set(execution.state, targetPath, [...existing, ...values]);
      }
    }
  }
}

class CustomGatherStrategy extends GatherStrategy {
  readonly name = 'custom';
  // No applyIncremental: custom strategies run as a batch node invocation.
  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.customNode === undefined) return;
    // Expose a plain projection of records for the custom gather node to read.
    // Items must be JSON-serialisable (scatter sources are checkpointed);
    // the engine contract requires callers to provide JSON-safe scatter sources.
    execution.state.setMetadata(
      'gatherResults',
      execution.records.map((r) => ({
        'index':  r.index,
        'item':   r.item,
        'output': r.output,
      })),
    );
    await execution.invoker.invokeNode(config.customNode);
  }
}

/**
 * `discard`: no-op merge. Clones run for side-effects; nothing is folded
 * back into the parent state. Use this when a scatter body is purely
 * effectful and no clone state should flow to the parent.
 *
 * `gather` is required on every `ScatterNode`. Declare `{ strategy: 'discard' }`
 * to make the no-merge intent explicit.
 */
class DiscardGatherStrategy extends IncrementalGatherStrategy {
  readonly name = 'discard';

  // applyIncremental is a no-op: never accumulates any state.
  applyIncremental(): void {
    // Intentional no-op: discard strategy folds nothing.
  }

  async apply(): Promise<void> {
    // Intentional no-op: discard strategy folds nothing.
  }
}

/**
 * `collect`: collect each clone's output token (and/or its `field` value)
 * into a target collection on the parent in source-index order. Mirrors the
 * `CollectCombiner` intent for scatter: produces a per-clone result array
 * keyed by source index.
 *
 * Config fields:
 *   `target` (required): parent state path to write the collected array.
 *   `field`  (optional): clone state path to read the per-clone value. When
 *            absent the clone's output token is collected instead.
 *
 * The collected array is appended to the existing value at `target`
 * (consistent with `append`/`map` semantics), preserving source-index order.
 */
class CollectGatherStrategy extends IncrementalGatherStrategy {
  readonly name = 'collect';

  applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) return;
    const value = config.field !== undefined
      ? accessor.get(record.cloneState, config.field)
      : record.output;
    const existing = accessor.get<readonly unknown[]>(state, config.target) ?? [];
    accessor.set(state, config.target, [...existing, value]);
  }

  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) {
      throw new DAGError('Gather collect strategy requires target path');
    }
    const target = config.target;
    // records are already source-index ordered (see GatherExecution.records).
    const values = execution.records.map((r) =>
      config.field !== undefined
        ? execution.accessor.get(r.cloneState, config.field)
        : r.output,
    );
    const existing = execution.accessor.get<readonly unknown[]>(execution.state, target) ?? [];
    execution.accessor.set(execution.state, target, [...existing, ...values]);
  }
}

/** Built-in strategy instances; used by `GatherStrategies.reset()`. */
const BUILTIN_STRATEGIES: ReadonlyArray<GatherStrategy> = [
  new AppendGatherStrategy(),
  new CollectGatherStrategy(),
  new CustomGatherStrategy(),
  new DiscardGatherStrategy(),
  new MapGatherStrategy(),
  new PartitionGatherStrategy(),
];

/**
 * Static registry of `GatherStrategy` instances. Defaults register at
 * module load. Consumers add more via `GatherStrategies.register`.
 */
export class GatherStrategies {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, GatherStrategy>(
    BUILTIN_STRATEGIES.map((s) => [s.name, s]),
  );

  /**
   * Register a strategy. Throws `DAGError` when a strategy with the same
   * `name` is already registered — protects against silent overwrite of
   * built-ins or consumer-registered strategies. Use `replace()` for
   * intentional overrides (e.g. test-time substitution).
   */
  static register(strategy: GatherStrategy): void {
    if (GatherStrategies.registry.has(strategy.name)) {
      throw new DAGError(`GatherStrategy '${strategy.name}' is already registered; use GatherStrategies.replace() to intentionally override`);
    }
    GatherStrategies.registry.set(strategy.name, strategy);
  }

  /**
   * Explicitly replace an existing registration. Does not throw when the
   * name is already present. Use this for intentional test-time or
   * plugin-override substitution where overwriting an existing entry is
   * the deliberate goal.
   */
  static replace(strategy: GatherStrategy): void {
    GatherStrategies.registry.set(strategy.name, strategy);
  }

  /**
   * Remove a previously registered strategy by name. No-op if the name is
   * not present. Used in test `afterEach` to undo `register` calls and
   * prevent cross-test pollution of the global registry.
   */
  static unregister(name: string): void {
    GatherStrategies.registry.delete(name);
  }

  /**
   * Reset the registry to the four built-in strategies, discarding any
   * consumer-registered entries. Used in test `afterEach` to restore a clean
   * baseline.
   */
  static reset(): void {
    GatherStrategies.registry.clear();
    for (const s of BUILTIN_STRATEGIES) {
      GatherStrategies.registry.set(s.name, s);
    }
  }

  /**
   * Resolve a strategy by name. Throws `DAGError` when no strategy is
   * registered under `name`.
   */
  static resolve(name: string): GatherStrategy {
    const strategy = GatherStrategies.registry.get(name);
    if (strategy === undefined) {
      throw new DAGError(`Unknown gather strategy: ${name}`);
    }
    return strategy;
  }

  /** Names of every registered strategy, in registration order. */
  static list(): readonly string[] {
    return [...GatherStrategies.registry.keys()];
  }
}

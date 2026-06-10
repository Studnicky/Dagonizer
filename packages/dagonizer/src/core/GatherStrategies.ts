/**
 * GatherStrategies: pluggable strategy registry that decides how the
 * dispatcher merges scatter clone results back into the parent state.
 *
 * A `GatherStrategy` is a class with a `name`, an `apply` method (batch
 * gather — called after all clones complete), and an optional
 * `applyIncremental` method (fold a single record into parent state as it
 * arrives). Strategies that implement `applyIncremental` produce results
 * progressively; strategies that do not accumulate records and call `apply`
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
 * Subclass and override `apply`. Optionally override `applyIncremental` for
 * streaming gather — the dispatcher calls it after each clone completes when
 * the strategy supports it, enabling results to fold into parent state
 * progressively without waiting for all clones to finish.
 *
 * The class registers in `GatherStrategies` under its `name`; the dispatcher
 * resolves it via `GatherStrategies.resolve(name)` when all scatter clones
 * have reported.
 */
export abstract class GatherStrategy {
  /** Wire-shape identifier; matches `GatherConfig.strategy`. */
  abstract readonly name: string;

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

  /**
   * Apply the strategy incrementally for a single record as it arrives.
   * Called after each clone body completes successfully, before the next clone
   * starts. Implementations mutate `state` in place.
   *
   * When `undefined`, the dispatcher accumulates records and calls `apply` once
   * all clones are done. Override in subclasses to enable streaming gather.
   *
   * The `accessor` and `state` parameters mirror those in `GatherExecution`
   * and are provided directly to avoid constructing a full execution context
   * for every incremental fold.
   */
  applyIncremental?(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void;
}

class MapGatherStrategy extends GatherStrategy {
  readonly name = 'map';

  override applyIncremental(
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

class AppendGatherStrategy extends GatherStrategy {
  readonly name = 'append';

  override applyIncremental(
    config: GatherConfig,
    record: GatherRecord<NodeStateInterface>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) return;
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

class PartitionGatherStrategy extends GatherStrategy {
  readonly name = 'partition';

  override applyIncremental(
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
class DiscardGatherStrategy extends GatherStrategy {
  readonly name = 'discard';

  // applyIncremental is a no-op: never accumulates any state.
  override applyIncremental(): void {
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
class CollectGatherStrategy extends GatherStrategy {
  readonly name = 'collect';

  override applyIncremental(
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

/**
 * Static registry of `GatherStrategy` instances. Defaults register at
 * module load. Consumers add more via `GatherStrategies.register`.
 */
export class GatherStrategies {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, GatherStrategy>([
    ['append', new AppendGatherStrategy()],
    ['collect', new CollectGatherStrategy()],
    ['custom', new CustomGatherStrategy()],
    ['discard', new DiscardGatherStrategy()],
    ['map', new MapGatherStrategy()],
    ['partition', new PartitionGatherStrategy()],
  ]);

  /**
   * Register a strategy. Replaces any prior registration with the same
   * `name`: last-write-wins.
   */
  static register(strategy: GatherStrategy): void {
    GatherStrategies.registry.set(strategy.name, strategy);
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

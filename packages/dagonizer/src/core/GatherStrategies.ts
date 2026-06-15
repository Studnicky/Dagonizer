/**
 * GatherStrategies: pluggable strategy registry that decides how the
 * dispatcher merges scatter clone results back into the parent state.
 *
 * A `GatherStrategy` implements a unified fold contract:
 *   - `initial`:  initialise the accumulator in state before any clones run.
 *   - `reduce`:   fold a batch of clone results into state (batch of 1 for
 *                 per-clone streaming, batch of N for all-at-once).
 *   - `finalize`: end-of-gather work after all clones complete (e.g. custom
 *                 node invocation). Default is a no-op.
 *
 * Four defaults register at module load: `map`, `append`, `partition`,
 * `custom`, `discard`, `collect`. Consumers extend `GatherStrategy` and call
 * `GatherStrategies.register(new MyGather())` to add their own.
 *
 * @example
 * ```ts
 * class TopNGather extends GatherStrategy {
 *   readonly name = 'top-n';
 *   reduce(
 *     config: GatherConfig,
 *     batch: Batch<GatherRecord<NodeStateInterface>>,
 *     state: NodeStateInterface,
 *     accessor: StateAccessor,
 *   ): void {
 *     for (const item of batch) {
 *       const record = item.state;
 *       accessor.set(state, 'topResults', record.item);
 *     }
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

import type { Batch } from './batch/Batch.js';

export type { GatherExecution, GatherRecord };

/**
 * Extension point for gather strategies.
 *
 * Implement `reduce` for per-clone or bulk folding. Override `initial` to
 * initialise accumulator state before any clones run. Override `finalize`
 * for end-of-gather work such as invoking a registered node.
 *
 * The class registers in `GatherStrategies` under its `name`; the dispatcher
 * resolves it via `GatherStrategies.resolve(name)` when all scatter clones
 * have reported.
 */
export abstract class GatherStrategy {
  /** Wire-shape identifier; matches `GatherConfig.strategy`. */
  abstract readonly name: string;

  /**
   * Initialise the accumulator in state before any clones run.
   * Called once per scatter, before the first `reduce`. Default: no-op.
   */
  initial(
    _config: GatherConfig,
    _state: NodeStateInterface,
    _accessor: StateAccessor,
  ): void { /* no-op */ }

  /**
   * Fold a batch of clone results into parent state.
   *
   * `batch.size` is 1 (per-clone streaming) or N (all-at-once). Called once
   * per clone as it completes. Implementations mutate `state` in place.
   */
  abstract reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void | Promise<void>;

  /**
   * End-of-gather work: final computation or node invocation.
   * Called once after all clones complete. Default: no-op.
   */
  async finalize(
    _config: GatherConfig,
    _execution: GatherExecution<NodeStateInterface>,
  ): Promise<void> { /* no-op */ }
}

class MapGatherStrategy extends GatherStrategy {
  readonly name = 'map';

  reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const mapping = config.mapping ?? {};
    for (const item of batch) {
      const record = item.state;
      for (const [clonePath, parentPath] of Object.entries(mapping)) {
        const value = accessor.get(record.cloneState, clonePath);
        const existing = accessor.get<readonly unknown[]>(state, parentPath) ?? [];
        accessor.set(state, parentPath, [...existing, value]);
      }
    }
  }
}

class AppendGatherStrategy extends GatherStrategy {
  readonly name = 'append';

  reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) {
      throw new DAGError('Gather append strategy requires target path');
    }
    for (const item of batch) {
      const record = item.state;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.item;
      const existing = accessor.get<readonly unknown[]>(state, config.target) ?? [];
      accessor.set(state, config.target, [...existing, value]);
    }
  }
}

class PartitionGatherStrategy extends GatherStrategy {
  readonly name = 'partition';

  reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    const partitions = config.partitions ?? {};
    for (const item of batch) {
      const record = item.state;
      const targetPath = partitions[record.output];
      if (targetPath === undefined) continue;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.item;
      const existing = accessor.get<readonly unknown[]>(state, targetPath) ?? [];
      accessor.set(state, targetPath, [...existing, value]);
    }
  }
}

class CustomGatherStrategy extends GatherStrategy {
  readonly name = 'custom';

  // Custom strategy accumulates nothing per-clone — all work is in finalize.
  reduce(): void { /* no-op */ }

  override async finalize(
    config: GatherConfig,
    execution: GatherExecution<NodeStateInterface>,
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

  reduce(): void {
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

  reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) return;
    for (const item of batch) {
      const record = item.state;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.output;
      const existing = accessor.get<readonly unknown[]>(state, config.target) ?? [];
      accessor.set(state, config.target, [...existing, value]);
    }
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
   * Reset the registry to the built-in strategies, discarding any
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

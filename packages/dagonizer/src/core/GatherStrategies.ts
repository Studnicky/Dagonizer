/**
 * GatherStrategies — pluggable strategy registry that decides how the
 * dispatcher merges scatter clone results back into the parent state.
 *
 * A `GatherStrategy` is a class with a `name` and an `apply` method.
 * The dispatcher resolves a strategy by `name` (the `strategy` field
 * on `GatherConfig`) and calls `.apply(config, execution)` once every
 * clone has reported.
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

import type { StateAccessor } from '../contracts/StateAccessor.js';
import type { GatherConfig } from '../entities/dag/GatherConfig.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Per-clone record produced by the scatter loop. Carries the source item
 * (or `undefined` for a singleton scatter), the routing output, the
 * terminal outcome of a DAG body (or `null` for a node body), and the
 * live clone state after the body ran.
 */
export interface GatherRecord<TState extends NodeStateInterface> {
  readonly index: number;
  readonly item: unknown;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly cloneState: TState;
}

/**
 * Per-invocation context handed to `GatherStrategy.apply`. Carries:
 *
 *   - the live parent state object (mutated in place by the strategy)
 *   - the per-clone records produced by every scatter clone
 *   - the current dag/signal for any nested node invocation
 *   - the `StateAccessor` the dispatcher is configured with
 *   - `invokeNode`, the only way for `custom` strategies to dispatch
 *     a registered node back through the engine
 */
export interface GatherExecution<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly records: ReadonlyArray<GatherRecord<TState>>;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly accessor: StateAccessor;
  invokeNode(nodeName: string): Promise<void>;
}

/**
 * Extension point for gather strategies.
 *
 * Subclass and override `apply`. The class registers in
 * `GatherStrategies` under its `name`; the dispatcher resolves it via
 * `GatherStrategies.resolve(name)` when all scatter clones have reported.
 */
export abstract class GatherStrategy {
  /** Wire-shape identifier; matches `GatherConfig.strategy`. */
  abstract readonly name: string;

  /**
   * Apply the strategy. Mutates `execution.state` in place; may invoke
   * a registered node via `execution.invokeNode(name)`.
   */
  abstract apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void>;
}

class MapGatherStrategy extends GatherStrategy {
  readonly name = 'map';
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
        // Multi-clone: collect values in source-index order and append to parent array.
        const values = execution.records
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((r) => execution.accessor.get(r.cloneState, clonePath));
        const existing = (execution.accessor.get(execution.state, parentPath) as unknown[] | undefined) ?? [];
        execution.accessor.set(execution.state, parentPath, [...existing, ...values]);
      }
    }
  }
}

class AppendGatherStrategy extends GatherStrategy {
  readonly name = 'append';
  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) {
      throw new DAGError('Gather append strategy requires target path');
    }
    const target = config.target;
    const sorted = execution.records.slice().sort((a, b) => a.index - b.index);
    const values = sorted.map((r) =>
      config.field !== undefined
        ? execution.accessor.get(r.cloneState, config.field)
        : r.item,
    );
    const existing = (execution.accessor.get(execution.state, target) as unknown[] | undefined) ?? [];
    execution.accessor.set(execution.state, target, [...existing, ...values]);
  }
}

class PartitionGatherStrategy extends GatherStrategy {
  readonly name = 'partition';
  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    const partitions = config.partitions ?? {};
    for (const [outputToken, targetPath] of Object.entries(partitions)) {
      const matching = execution.records
        .filter((r) => r.output === outputToken)
        .sort((a, b) => a.index - b.index);
      const values = matching.map((r) =>
        config.field !== undefined
          ? execution.accessor.get(r.cloneState, config.field)
          : r.item,
      );
      if (values.length > 0) {
        const existing = (execution.accessor.get(execution.state, targetPath) as unknown[] | undefined) ?? [];
        execution.accessor.set(execution.state, targetPath, [...existing, ...values]);
      }
    }
  }
}

class CustomGatherStrategy extends GatherStrategy {
  readonly name = 'custom';
  async apply<TState extends NodeStateInterface>(
    config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    if (config.customNode === undefined) return;
    // Expose a plain projection of records — no cloneState in metadata.
    execution.state.setMetadata(
      'gatherResults',
      execution.records.map((r) => ({
        'index':  r.index,
        'item':   r.item,
        'output': r.output,
      })),
    );
    await execution.invokeNode(config.customNode);
  }
}

/**
 * Static registry of `GatherStrategy` instances. Defaults register at
 * module load. Consumers add more via `GatherStrategies.register`.
 */
export class GatherStrategies {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, GatherStrategy>([
    ['map', new MapGatherStrategy()],
    ['append', new AppendGatherStrategy()],
    ['partition', new PartitionGatherStrategy()],
    ['custom', new CustomGatherStrategy()],
  ]);

  /**
   * Register a strategy. Replaces any prior registration with the same
   * `name` — last-write-wins.
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

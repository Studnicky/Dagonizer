/**
 * FanInStrategies — pluggable strategy registry that decides how the
 * dispatcher merges fan-out results back into node state.
 *
 * A `FanInStrategy` is a class with a `name` and an `apply` method.
 * The dispatcher resolves a strategy by `name` (the `strategy` field
 * on `FanInConfig`) and calls `.apply(config, execution)` once every
 * fan-out item has reported.
 *
 * Three defaults register at module load: `append`, `partition`,
 * `custom`. Consumers extend `FanInStrategy` and call
 * `FanInStrategies.register(new MyFanIn())` to add their own.
 *
 * @example
 * ```ts
 * class TopNFanIn extends FanInStrategy {
 *   readonly name = 'top-n';
 *   async apply<TState extends NodeStateInterface>(
 *     config: FanInConfig,
 *     execution: FanInExecution<TState>,
 *   ): Promise<void> {
 *     const target = config.target ?? 'topResults';
 *     const all = [...execution.results.values()].flat();
 *     execution.accessor.set(execution.state, target, all.slice(0, 10));
 *   }
 * }
 *
 * FanInStrategies.register(new TopNFanIn());
 * ```
 */

import type { StateAccessor } from '../contracts/StateAccessor.js';
import type { FanInConfig } from '../entities/dag/FanInConfig.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Per-invocation context handed to `FanInStrategy.apply`. Carries:
 *
 *   - the live state object (mutated in place by the strategy)
 *   - the per-output buckets returned by every fan-out item
 *   - the current dag/signal for any nested node invocation
 *   - the `StateAccessor` the dispatcher is configured with
 *   - `invokeNode`, the only way for `custom` strategies to dispatch
 *     a registered node back through the engine
 */
export interface FanInExecution<TState extends NodeStateInterface> {
  readonly state: TState;
  readonly results: ReadonlyMap<string, readonly unknown[]>;
  readonly dagName: string;
  readonly signal: AbortSignal | null;
  readonly accessor: StateAccessor;
  invokeNode(nodeName: string): Promise<void>;
}

/**
 * Extension point for fan-in strategies.
 *
 * Subclass and override `apply`. The class registers in
 * `FanInStrategies` under its `name`; the dispatcher resolves it via
 * `FanInStrategies.resolve(name)` when a fan-out reports.
 */
export abstract class FanInStrategy {
  /** Wire-shape identifier; matches `FanInConfig.strategy`. */
  abstract readonly name: string;

  /**
   * Apply the strategy. Mutates `execution.state` in place; may invoke
   * a registered node via `execution.invokeNode(name)`.
   */
  abstract apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void>;
}

class AppendFanInStrategy extends FanInStrategy {
  readonly name = 'append';
  async apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void> {
    if (config.target === undefined) {
      throw new DAGError('Fan-in append strategy requires target path');
    }
    const target = config.target;
    const allResults = [...execution.results.values()].flat();
    const existing = (execution.accessor.get(execution.state, target) as undefined | unknown[]) ?? [];
    execution.accessor.set(execution.state, target, [...existing, ...allResults]);
  }
}

class PartitionFanInStrategy extends FanInStrategy {
  readonly name = 'partition';
  async apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void> {
    for (const [outputName, targetPath] of Object.entries(config.partitions ?? {})) {
      const items = execution.results.get(outputName) ?? [];
      const existing = (execution.accessor.get(execution.state, targetPath) as undefined | unknown[]) ?? [];
      execution.accessor.set(execution.state, targetPath, [...existing, ...items]);
    }
  }
}

class CustomFanInStrategy extends FanInStrategy {
  readonly name = 'custom';
  async apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void> {
    if (config.customNode === undefined) return;
    execution.state.setMetadata(
      'fanInResults',
      Object.fromEntries(execution.results),
    );
    await execution.invokeNode(config.customNode);
  }
}

/**
 * Static registry of `FanInStrategy` instances. Defaults register at
 * module load. Consumers add more via `FanInStrategies.register`.
 */
export class FanInStrategies {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, FanInStrategy>([
    ['append', new AppendFanInStrategy()],
    ['partition', new PartitionFanInStrategy()],
    ['custom', new CustomFanInStrategy()],
  ]);

  /**
   * Register a strategy. Replaces any prior registration with the same
   * `name` — last-write-wins.
   */
  static register(strategy: FanInStrategy): void {
    FanInStrategies.registry.set(strategy.name, strategy);
  }

  /**
   * Resolve a strategy by name. Throws `DAGError` when no strategy is
   * registered under `name`.
   */
  static resolve(name: string): FanInStrategy {
    const strategy = FanInStrategies.registry.get(name);
    if (strategy === undefined) {
      throw new DAGError(`Unknown fan-in strategy: ${name}`);
    }
    return strategy;
  }

  /** Names of every registered strategy, in registration order. */
  static list(): readonly string[] {
    return [...FanInStrategies.registry.keys()];
  }
}

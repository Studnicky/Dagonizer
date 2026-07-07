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
 *     config: GatherConfigType,
 *     batch: Batch<GatherRecordType>,
 *     state: NodeStateInterface,
 *     accessor: StateAccessorInterface,
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

import type { GatherExecutionType, GatherRecordType } from '../contracts/GatherExecution.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import { DAGError } from '../errors/DAGError.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { Registry } from './Registry.js';


export type { GatherExecutionType, GatherRecordType };

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
   * When true, `finalize` consumes the full per-clone record set; the engine
   * retains every acked record across resume (retained checkpoint). When false
   * (default), `finalize`'s result is fully in state during `reduce`, so the
   * engine keeps only bounded bookkeeping (watermark + ahead-acked + tally)
   * and the checkpoint is O(1) with respect to item count.
   */
  readonly retainsRecordsForFinalize: boolean = false;

  /**
   * Initialise the accumulator in state before any clones run.
   * Called once per scatter, before the first `reduce`. Default: no-op.
   */
  initial(
    _config: GatherConfigType,
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void { /* no-op */ }

  /**
   * Fold a batch of clone results into parent state.
   *
   * `batch.size` is 1 (per-clone streaming) or N (all-at-once). Called once
   * per clone as it completes. Implementations mutate `state` in place.
   */
  abstract reduce(
    config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void | Promise<void>;

  /**
   * End-of-gather work: final computation or node invocation.
   * Called once after all clones complete. Default: no-op.
   */
  async finalize(
    _config: GatherConfigType,
    _execution: GatherExecutionType,
  ): Promise<void> { /* no-op */ }

  /**
   * Narrow an accessor read (typed `unknown`) to a list for append-style
   * reducers. Returns the value when it is an array, otherwise an empty list —
   * cast-free; the `readonly unknown[]` annotation keeps `Array.isArray`'s
   * `any[]` from leaking.
   */
  protected static asList(value: unknown): readonly unknown[] {
    const list: readonly unknown[] = Array.isArray(value) ? value : [];
    return list;
  }
}

class MapGatherStrategy extends GatherStrategy {
  readonly name = 'map';

  reduce(
    config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const mapping = config.mapping ?? {};
    for (const item of batch) {
      const record = item.state;
      for (const [clonePath, parentPath] of Object.entries(mapping)) {
        const value = accessor.get(record.cloneState, clonePath);
        const existing = GatherStrategy.asList(accessor.get(state, parentPath));
        accessor.set(state, parentPath, [...existing, value]);
      }
    }
  }
}

class AppendGatherStrategy extends GatherStrategy {
  readonly name = 'append';

  reduce(
    config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    if (config.target === undefined) {
      throw new DAGError('Gather append strategy requires target path');
    }
    for (const item of batch) {
      const record = item.state;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.item;
      const existing = GatherStrategy.asList(accessor.get(state, config.target));
      accessor.set(state, config.target, [...existing, value]);
    }
  }
}

class PartitionGatherStrategy extends GatherStrategy {
  readonly name = 'partition';

  reduce(
    config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const partitions = config.partitions ?? {};
    for (const item of batch) {
      const record = item.state;
      const targetPath = partitions[record.output];
      if (targetPath === undefined) continue;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.item;
      const existing = GatherStrategy.asList(accessor.get(state, targetPath));
      accessor.set(state, targetPath, [...existing, value]);
    }
  }
}

class CustomGatherStrategy extends GatherStrategy {
  readonly name = 'custom';

  // Custom finalize reads the full per-clone record set, so the engine must
  // retain every acked record across resume (retained checkpoint).
  override readonly retainsRecordsForFinalize = true;

  // Custom strategy accumulates nothing per-clone — all work is in finalize.
  reduce(): void { /* no-op */ }

  override async finalize(
    config: GatherConfigType,
    execution: GatherExecutionType,
  ): Promise<void> {
    if (config.customNode === undefined) return;
    // Expose a plain projection of records for the custom gather node to read.
    // Items must be JSON-serialisable (scatter sources are checkpointed);
    // the engine contract requires callers to provide JSON-safe scatter sources.
    execution.state.setMetadata(
      'gatherResults',
      execution.records.map((r) => ({
        'source':          r.source,
        'index':           r.index,
        'item':            r.item,
        'output':          r.output,
        'terminalOutcome': r.terminalOutcome,
        'result':          r.result,
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
    config: GatherConfigType,
    batch: Batch<GatherRecordType>,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    if (config.target === undefined) return;
    for (const item of batch) {
      const record = item.state;
      const value = config.field !== undefined
        ? accessor.get(record.cloneState, config.field)
        : record.output;
      const existing = GatherStrategy.asList(accessor.get(state, config.target));
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
 * Registry of `GatherStrategy` instances, extending the shared `Registry`
 * base. Defaults register at construction. Consumers add more via
 * `GatherStrategies.register`.
 */
class GatherStrategyRegistry extends Registry<GatherStrategy> {
  constructor() {
    super(BUILTIN_STRATEGIES, 'GatherStrategy', 'GatherStrategies', 'gather strategy');
  }
}

/** Singleton registry instance; the public surface consumers call into. */
export const GatherStrategies = new GatherStrategyRegistry();

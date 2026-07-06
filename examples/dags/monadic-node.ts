/**
 * monadic-node/dags: demonstrates the node taxonomy from @studnicky/dagonizer.
 *
 * Defines an abstract `LoggingNode` that extends `MonadicNode` and adds
 * structured timing around `execute(batch, context)`. A concrete subclass fills
 * in the domain logic by implementing the abstract `run` method. The pattern
 * guarantees every code path returns declared output ports — nothing throws
 * past the node boundary.
 *
 * Use `MonadicNode.execute(batch, context)` for every node. Nodes may loop over
 * independent items locally, partition by output, or process a whole batch at
 * once when the domain benefits from a shared operation.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region execute-contract
import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { NodeContextType, NodeStateInterface, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';
import { Batch } from '@studnicky/dagonizer';

// The execute signature: consume Batch<TState>, return RoutedBatchType<TOutput, TState>.
// Items are partitioned across output ports — routing IS partitioning.
export class EchoNode extends MonadicNode<NodeStateInterface, 'out'> {
  readonly name    = 'echo';
  readonly outputs = ['out'] as const;
  override get outputSchema(): Record<'out', SchemaObjectType> {
    return { 'out': { 'type': 'object' } };
  }
  async execute(batch: Batch<NodeStateInterface>, _ctx: NodeContextType): Promise<RoutedBatchType<'out', NodeStateInterface>> {
    return RoutedBatch.create('out', batch);
  }
}
// #endregion execute-contract

// #region monadic-node
import { NodeOutput, NodeStateBase } from '@studnicky/dagonizer';
import type { NodeOutputType } from '@studnicky/dagonizer';

// ── Domain state ──────────────────────────────────────────────────────────────

export class CatalogueState extends NodeStateBase {
  query   = '';
  results: string[] = [];
}

// ── Abstract base: adds structured logging around every batch execution ──────

abstract class LoggingNode<
  TState extends NodeStateBase,
  TOutput extends string,
> extends MonadicNode<TState, TOutput> {
  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, TState>> {
    const start = Date.now();
    const entries: Array<readonly [TOutput, Batch<TState>]> = [];
    for (const item of batch) {
      const result = await this.run(item.state, context);
      for (const error of result.errors) item.state.collectError(error);
      entries.push([result.output, Batch.from([item])]);
    }
    process.stdout.write(`[${this.name}] routed=${entries.length} elapsed=${Date.now() - start}ms\n`);
    return RoutedBatch.create(entries);
  }

  /** Subclasses implement per-state domain logic here. */
  protected abstract run(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TOutput>>;
}

// ── Concrete node: catalogue search ───────────────────────────────────────────

export class SearchCatalogueNode extends LoggingNode<CatalogueState, 'success' | 'empty' | 'error'> {
  readonly name    = 'search-catalogue';
  readonly outputs = ['success', 'empty', 'error'] as const;
  override get outputSchema(): Record<'success' | 'empty' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'empty': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected async run(state: CatalogueState): Promise<NodeOutputType<'success' | 'empty' | 'error'>> {
    if (state.query.trim() === '') {
      return NodeOutput.create('error');
    }
    // Stub: return a synthetic result set.
    state.results = [`${state.query} - Shelf A`, `${state.query} - Shelf B`];

    if (state.results.length === 0) {
      return NodeOutput.create('empty');
    }
    return NodeOutput.create('success');
  }
}
// #endregion monadic-node

// #region node-taxonomy
// EventState: domain state for geo-enrichment nodes.
class EventState extends NodeStateBase {
  coords: string | null = null;
  region                = '';
}

// Stub geo-lookup cache — in production this would be an injected service.
const geoCache = {
  lookup(coords: string): string {
    return coords.length > 0 ? 'us-east' : 'unknown';
  },
};

// item-independent routing: loop locally and preserve each item's route.
export class GeoNode extends MonadicNode<EventState, 'has-geo' | 'needs-geo'> {
  readonly name    = 'geo';
  readonly outputs = ['has-geo', 'needs-geo'] as const;
  override get outputSchema(): Record<'has-geo' | 'needs-geo', SchemaObjectType> {
    return { 'has-geo': { 'type': 'object' }, 'needs-geo': { 'type': 'object' } };
  }

  override async execute(batch: Batch<EventState>) {
    const entries: Array<readonly ['has-geo' | 'needs-geo', Batch<EventState>]> = [];
    for (const item of batch) {
      const output = NodeOutput.create(item.state.coords === null ? 'needs-geo' : 'has-geo');
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

// batch-native: MonadicNode processes the whole batch in one execute call,
// allowing a single shared-cache lookup across all items simultaneously.
export class EnrichNode extends MonadicNode<EventState, 'enriched'> {
  readonly name    = 'enrich';
  readonly outputs = ['enriched'] as const;
  override get outputSchema(): Record<'enriched', SchemaObjectType> {
    return { 'enriched': { 'type': 'object' } };
  }

  async execute(batch: Batch<EventState>, _ctx: NodeContextType): Promise<RoutedBatchType<'enriched', EventState>> {
    for (const item of batch) {
      const state = item.state;
      if (state.coords !== null) {
        state.region = geoCache.lookup(state.coords);
      }
    }
    return RoutedBatch.create('enriched', batch);
  }
}
// #endregion node-taxonomy

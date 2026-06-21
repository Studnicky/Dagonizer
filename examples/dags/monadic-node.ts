/**
 * monadic-node/dags: demonstrates the node taxonomy from @studnicky/dagonizer.
 *
 * Defines an abstract `LoggingNode` that extends `ScalarNode` and adds
 * structured timing around `executeOne`. A concrete subclass fills in the
 * domain logic by implementing the abstract `run` method. The pattern
 * guarantees every code path returns a declared output port — nothing throws
 * past the node boundary.
 *
 * Use `ScalarNode` (the per-item base) for domain nodes that process one state
 * at a time. Extend `MonadicNode` directly only for batch-native nodes that
 * must process the whole batch in one `execute(batch, ctx)` call.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region execute-contract
import { MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
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
    return RoutedBatchBuilder.of('out', batch);
  }
}
// #endregion execute-contract

// #region monadic-node
import { NodeOutputBuilder, NodeStateBase, ScalarNode } from '@studnicky/dagonizer';
import type { NodeOutputType } from '@studnicky/dagonizer';

// ── Domain state ──────────────────────────────────────────────────────────────

export class CatalogueState extends NodeStateBase {
  query   = '';
  results: string[] = [];
}

// ── Abstract base: adds structured logging at every execute ───────────────────

abstract class LoggingNode<
  TState extends NodeStateBase,
  TOutput extends string,
> extends ScalarNode<TState, TOutput> {
  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TOutput>> {
    const start = Date.now();
    const result = await this.run(state, context);
    process.stdout.write(`[${this.name}] output=${result.output} elapsed=${Date.now() - start}ms\n`);
    return result;
  }

  /** Subclasses implement domain logic here instead of in execute. */
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
      return NodeOutputBuilder.of('error');
    }
    // Stub: return a synthetic result set.
    state.results = [`${state.query} - Shelf A`, `${state.query} - Shelf B`];

    if (state.results.length === 0) {
      return NodeOutputBuilder.of('empty');
    }
    return NodeOutputBuilder.of('success');
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

// per-item (the common case): ScalarNode processes one EventState at a time.
export class GeoNode extends ScalarNode<EventState, 'has-geo' | 'needs-geo'> {
  readonly name    = 'geo';
  readonly outputs = ['has-geo', 'needs-geo'] as const;
  override get outputSchema(): Record<'has-geo' | 'needs-geo', SchemaObjectType> {
    return { 'has-geo': { 'type': 'object' }, 'needs-geo': { 'type': 'object' } };
  }

  protected override async executeOne(state: EventState) {
    if (state.coords === null) {
      return NodeOutputBuilder.of('needs-geo');
    }
    return NodeOutputBuilder.of('has-geo');
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
    return RoutedBatchBuilder.of('enriched', batch);
  }
}
// #endregion node-taxonomy

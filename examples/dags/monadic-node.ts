/**
 * monadic-node/dags: demonstrates the node taxonomy from @noocodex/dagonizer.
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

// #region monadic-node
import { NodeOutputBuilder, NodeStateBase, ScalarNode } from '@noocodex/dagonizer';
import type { NodeContextInterface, NodeOutputInterface } from '@noocodex/dagonizer';

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
    context: NodeContextInterface,
  ): Promise<NodeOutputInterface<TOutput>> {
    const start = Date.now();
    const result = await this.run(state, context);
    process.stdout.write(`[${this.name}] output=${result.output} elapsed=${Date.now() - start}ms\n`);
    return result;
  }

  /** Subclasses implement domain logic here instead of in execute. */
  protected abstract run(
    state: TState,
    context: NodeContextInterface,
  ): Promise<NodeOutputInterface<TOutput>>;
}

// ── Concrete node: catalogue search ───────────────────────────────────────────

export class SearchCatalogueNode extends LoggingNode<CatalogueState, 'success' | 'empty' | 'error'> {
  readonly name    = 'search-catalogue';
  readonly outputs = ['success', 'empty', 'error'] as const;

  protected async run(state: CatalogueState): Promise<NodeOutputInterface<'success' | 'empty' | 'error'>> {
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

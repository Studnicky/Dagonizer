/**
 * monadic-node/dags: demonstrates MonadicNode from @noocodex/dagonizer/patterns.
 *
 * Abstract base class extending MonadicNode wires `name`, `outputs`, and
 * `execute`. A concrete subclass fills in the domain logic. The pattern
 * guarantees every code path returns a declared output port — nothing throws
 * past the node boundary.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region monadic-node
import { NodeStateBase } from '@noocodex/dagonizer';
import type { NodeContextInterface } from '@noocodex/dagonizer';
import { MonadicNode } from '@noocodex/dagonizer/patterns';
import type { NodeOutputInterface } from '@noocodex/dagonizer';

// ── Domain state ──────────────────────────────────────────────────────────────

export class CatalogueState extends NodeStateBase {
  query   = '';
  results: string[] = [];
}

// ── Abstract base: adds structured logging at every execute ───────────────────

abstract class LoggingNode<
  TState extends NodeStateBase,
  TOutput extends string,
> extends MonadicNode<TState, TOutput> {
  async execute(
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
      return { output: this.errorPort() };
    }
    // Stub: return a synthetic result set.
    state.results = [`${state.query} - Shelf A`, `${state.query} - Shelf B`];

    if (state.results.length === 0) {
      return { output: this.emptyPort() };
    }
    return { output: this.successPort() };
  }
}
// #endregion monadic-node

// Compile-time assignability check: SearchCatalogueNode satisfies NodeInterface.
export const searchNode = new SearchCatalogueNode();

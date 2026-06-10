/**
 * SelectNode: root for "pick or sort items from a list" patterns.
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';
import { NodeOutputBuilder } from '@noocodex/dagonizer';

import { FlowNode } from './FlowNode.js';

export abstract class SelectNode<
  TState extends NodeStateInterface,
  TItem,
> extends FlowNode<TState, 'success' | 'empty'> {
  protected abstract readItems(state: TState): readonly TItem[];
  protected abstract writeBack(state: TState, items: readonly TItem[]): void;
  protected abstract transform(items: readonly TItem[]): readonly TItem[];


  async execute(
    state: TState,
    _context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<'success' | 'empty'>> {
    const items = this.readItems(state);
    const next = this.transform(items);
    this.writeBack(state, next);
    return NodeOutputBuilder.of(next.length === 0 ? 'empty' : 'success');
  }
}

export abstract class PickByScoreNode<
  TState extends NodeStateInterface,
  TItem,
> extends SelectNode<TState, TItem> {
  protected abstract score(item: TItem): number;
  protected override transform(items: readonly TItem[]): readonly TItem[] {
    // `for…of` yields `TItem` (not `TItem | undefined`), so the best-scoring
    // item is selected without an index-access cast.
    let best: TItem | undefined;
    let bestScore = -Infinity;
    for (const item of items) {
      const s = this.score(item);
      if (best === undefined || s > bestScore) { best = item; bestScore = s; }
    }
    return best === undefined ? [] : [best];
  }
}

export abstract class SortByNode<
  TState extends NodeStateInterface,
  TItem,
> extends SelectNode<TState, TItem> {
  protected abstract compare(a: TItem, b: TItem): number;
  protected override transform(items: readonly TItem[]): readonly TItem[] {
    return [...items].sort((a, b) => this.compare(a, b));
  }
}

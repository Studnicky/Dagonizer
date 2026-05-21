/**
 * SelectNode — root for "pick or sort items from a list" patterns.
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { FlowNode } from './FlowNode.js';

export abstract class SelectNode<
  TState extends NodeStateInterface,
  TItem,
  TOutput extends string = 'success' | 'empty',
> extends FlowNode<TState, TOutput> {
  protected abstract readItems(state: TState): readonly TItem[];
  protected abstract writeBack(state: TState, items: readonly TItem[]): void;
  protected abstract transform(items: readonly TItem[]): readonly TItem[];

  protected successPort(): TOutput { return 'success' as TOutput; }
  protected emptyPort():   TOutput { return 'empty' as TOutput; }

  async execute(
    state: TState,
    _context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<TOutput>> {
    const items = this.readItems(state);
    const next = this.transform(items);
    this.writeBack(state, next);
    return Promise.resolve({ 'output': next.length === 0 ? this.emptyPort() : this.successPort() });
  }
}

export abstract class PickByScoreNode<
  TState extends NodeStateInterface,
  TItem,
  TOutput extends string = 'success' | 'empty',
> extends SelectNode<TState, TItem, TOutput> {
  protected abstract score(item: TItem): number;
  protected override transform(items: readonly TItem[]): readonly TItem[] {
    if (items.length === 0) return [];
    let best = items[0] as TItem;
    let bestScore = this.score(best);
    for (let i = 1; i < items.length; i++) {
      const item = items[i] as TItem;
      const s = this.score(item);
      if (s > bestScore) { best = item; bestScore = s; }
    }
    return [best];
  }
}

export abstract class SortByNode<
  TState extends NodeStateInterface,
  TItem,
  TOutput extends string = 'success' | 'empty',
> extends SelectNode<TState, TItem, TOutput> {
  protected abstract compare(a: TItem, b: TItem): number;
  protected override transform(items: readonly TItem[]): readonly TItem[] {
    return [...items].sort((a, b) => this.compare(a, b));
  }
}

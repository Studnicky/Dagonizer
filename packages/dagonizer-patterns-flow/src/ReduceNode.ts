/**
 * ReduceNode: root for "collapse a list" patterns.
 * Leaves: DedupeByKeyNode, GroupByFieldNode, MergeReducerNode.
 */

import { RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType } from '@studnicky/dagonizer';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

import { FlowNode } from './FlowNode.js';

export abstract class ReduceNode<
  TState extends NodeStateInterface,
  TItem,
  TResult,
> extends FlowNode<TState, 'success'> {
  protected abstract readItems(state: TState): readonly TItem[];
  protected abstract reduce(items: readonly TItem[]): TResult;
  protected abstract writeBack(state: TState, result: TResult): void;


  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'success', TState>> {
    for (const item of batch) {
      const items = this.readItems(item.state);
      const result = this.reduce(items);
      this.writeBack(item.state, result);
    }
    return RoutedBatch.create('success', batch);
  }
}

export abstract class DedupeByKeyNode<
  TState extends NodeStateInterface,
  TItem,
> extends ReduceNode<TState, TItem, readonly TItem[]> {
  protected abstract keyOf(item: TItem): string;

  protected override reduce(items: readonly TItem[]): readonly TItem[] {
    const seen = new Set<string>();
    const out: TItem[] = [];
    for (const item of items) {
      const k = this.keyOf(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }
}

export abstract class GroupByFieldNode<
  TState extends NodeStateInterface,
  TItem,
  TKey,
> extends ReduceNode<TState, TItem, ReadonlyMap<TKey, readonly TItem[]>> {
  protected abstract fieldOf(item: TItem): TKey;

  protected override reduce(items: readonly TItem[]): ReadonlyMap<TKey, readonly TItem[]> {
    const out = new Map<TKey, TItem[]>();
    for (const item of items) {
      const k = this.fieldOf(item);
      const arr = out.get(k) ?? [];
      arr.push(item);
      out.set(k, arr);
    }
    return out;
  }
}

export abstract class MergeReducerNode<
  TState extends NodeStateInterface,
  TItem,
> extends ReduceNode<TState, TItem, readonly TItem[]> {
  // Subclasses override `reduce` directly; this node is the bare base
  // for custom merge semantics. DedupeByKeyNode and GroupByFieldNode
  // demonstrate two common reductions.
}

/**
 * Authoring a node by implementing `NodeInterface` directly is an antipattern.
 * Nodes extend `MonadicNode`.
 *
 * This test asserts the engine treats a hand-rolled `NodeInterface` identically
 * to the equivalent `MonadicNode`. The base class adds no semantics over the
 * bare `execute(batch) → RoutedBatchType` contract; it only supplies common
 * node fields and defaults.
 *
 * Extend `MonadicNode` instead of hand-rolling `NodeInterface`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface, SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { NodeRunner } from '../../src/core/NodeRunner.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeOutput } from '../../src/entities/node/NodeOutput.js';
import { Timeout } from '../../src/entities/Timeout.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

class TagState extends NodeStateBase {
  value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
}

const ctx: NodeContextType = NodeContext.create('antipattern-dag', 'tag', new AbortController().signal, undefined);

/** The supported way: a `MonadicNode` with local item routing. Tags positives, skips the rest. */
class TagMonadicNode extends MonadicNode<TagState, 'tagged' | 'skip'> {
  readonly name = 'tag';
  readonly outputs = ['tagged', 'skip'] as const;
  override get outputSchema(): Record<'tagged' | 'skip', SchemaObjectType> {
    return { 'tagged': { 'type': 'object' }, 'skip': { 'type': 'object' } };
  }
  override async execute(batch: Batch<TagState>): Promise<RoutedBatchType<'tagged' | 'skip', TagState>> {
    const acc = new Map<'tagged' | 'skip', ItemType<TagState>[]>();
    for (const item of batch) {
      const result = NodeOutput.create(item.state.value > 0 ? 'tagged' : 'skip');
      for (const error of result.errors) item.state.collectError(error);
      const bucket = acc.get(result.output);
      if (bucket !== undefined) { bucket.push(item); } else { acc.set(result.output, [item]); }
    }
    const routed = new Map<'tagged' | 'skip', Batch<TagState>>();
    for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
    return routed;
  }
}

void describe('Antipattern — hand-rolled raw NodeInterface', () => {
  void it('the engine accepts a raw NodeInterface, and it is identical to a MonadicNode fixture', async () => {
    // ANTIPATTERN: a node hand-written against the bare contract. Equivalent to
    // TagMonadicNode above — extend MonadicNode instead.
    const rawAntipatternNode: NodeInterface<TagState, 'tagged' | 'skip'> = {
      'name': 'tag-raw',
      'outputs': ['tagged', 'skip'] as const,
      'timeout': Timeout.none(),
      'inputSchema': { 'type': 'object' },
      'outputSchema': {
        'tagged': { 'type': 'object' },
        'skip':   { 'type': 'object' },
      },
      async execute(batch: Batch<TagState>): Promise<RoutedBatchType<'tagged' | 'skip', TagState>> {
        const acc = new Map<'tagged' | 'skip', ItemType<TagState>[]>();
        for (const item of batch) {
          const output = item.state.value > 0 ? 'tagged' as const : 'skip' as const;
          const bucket = acc.get(output);
          if (bucket !== undefined) { bucket.push(item); } else { acc.set(output, [item]); }
        }
        const routed = new Map<'tagged' | 'skip', Batch<TagState>>();
        for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
        return routed;
      },
    };

    const items: ItemType<TagState>[] = [
      { 'id': '1', 'state': new TagState(1) },
      { 'id': '2', 'state': new TagState(-1) },
      { 'id': '3', 'state': new TagState(3) },
    ];

    const taxonomyResult = await NodeRunner.run(new TagMonadicNode(), Batch.from(items), ctx);
    const rawResult = await NodeRunner.run(rawAntipatternNode, Batch.from(items), ctx);

    // Same partitioning: the base class adds no semantics over the raw contract.
    assert.deepEqual(taxonomyResult.get('tagged')?.ids(), ['1', '3']);
    assert.deepEqual(taxonomyResult.get('skip')?.ids(), ['2']);
    assert.equal(rawResult.size, taxonomyResult.size);
    assert.deepEqual(rawResult.get('tagged')?.ids(), taxonomyResult.get('tagged')?.ids());
    assert.deepEqual(rawResult.get('skip')?.ids(), taxonomyResult.get('skip')?.ids());
  });
});

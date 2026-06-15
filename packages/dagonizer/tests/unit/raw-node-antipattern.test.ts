/**
 * Antipattern: hand-rolling a raw `NodeInterface`.
 *
 * Authoring a node by implementing `NodeInterface` directly is an ANTIPATTERN.
 * Production and test nodes should descend from the taxonomy:
 *   - `ScalarNode`  — per-item nodes (implement `executeOne`); the base owns the
 *                     `execute(batch)` loop and the route grouping.
 *   - `MonadicNode` — batch-native / hot-path nodes (implement `execute(batch)`).
 *
 * This single test pins WHY the raw form is only an antipattern and not a
 * second contract: the engine accepts a hand-written `NodeInterface`, and it is
 * behaviourally identical to the equivalent `ScalarNode` — so the taxonomy base
 * classes can never drift from the bare `execute(batch) → RoutedBatch` contract
 * they are built on. It also shows a static reader (e.g. `DAGDeriver`) can read a
 * node's `contract` field without running it — but, again, a `ScalarNode`
 * carries `contract` just as well, so the raw form buys nothing.
 *
 * If you are tempted to hand-roll a `NodeInterface`, extend `ScalarNode` or
 * `MonadicNode` instead.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Batch } from '../../src/core/batch/Batch.js';
import type { Item } from '../../src/core/batch/Item.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import { NodeRunner } from '../../src/core/NodeRunner.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

class TagState extends NodeStateBase {
  value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
}

const ctx: NodeContextInterface = {
  'signal': new AbortController().signal,
  'dagName': 'antipattern-dag',
  'nodeName': 'tag',
  'services': undefined,
};

/** The supported way: a per-item `ScalarNode`. Tags positives, skips the rest. */
class TagScalarNode extends ScalarNode<TagState, 'tagged' | 'skip'> {
  readonly name = 'tag';
  readonly outputs = ['tagged', 'skip'] as const;
  protected override async executeOne(state: TagState): Promise<NodeOutputInterface<'tagged' | 'skip'>> {
    return NodeOutputBuilder.of(state.value > 0 ? 'tagged' : 'skip');
  }
}

void describe('Antipattern — hand-rolled raw NodeInterface', () => {
  void it('the engine accepts a raw NodeInterface, and it is identical to the ScalarNode taxonomy (prefer the taxonomy)', async () => {
    // ANTIPATTERN: a node hand-written against the bare contract. Equivalent to
    // TagScalarNode above — but you should extend ScalarNode, not write this.
    const rawAntipatternNode: NodeInterface<TagState, 'tagged' | 'skip'> = {
      'name': 'tag-raw',
      'outputs': ['tagged', 'skip'] as const,
      // A raw node carries `contract` as a plain field; a ScalarNode/MonadicNode
      // supplies it as a required-with-default, so static readers like DAGDeriver
      // work the same either way.
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout': Timeout.none(),
      async execute(batch: Batch<TagState>): Promise<RoutedBatch<'tagged' | 'skip', TagState>> {
        const acc = new Map<'tagged' | 'skip', Item<TagState>[]>();
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

    const items: Item<TagState>[] = [
      { 'id': '1', 'state': new TagState(1) },
      { 'id': '2', 'state': new TagState(-1) },
      { 'id': '3', 'state': new TagState(3) },
    ];

    const taxonomyResult = await NodeRunner.run(new TagScalarNode(), Batch.from(items), ctx);
    const rawResult = await NodeRunner.run(rawAntipatternNode, Batch.from(items), ctx);

    // Same partitioning: the taxonomy adds no semantics over the raw contract.
    assert.deepEqual(taxonomyResult.get('tagged')?.ids(), ['1', '3']);
    assert.deepEqual(taxonomyResult.get('skip')?.ids(), ['2']);
    assert.equal(rawResult.size, taxonomyResult.size);
    assert.deepEqual(rawResult.get('tagged')?.ids(), taxonomyResult.get('tagged')?.ids());
    assert.deepEqual(rawResult.get('skip')?.ids(), taxonomyResult.get('skip')?.ids());

    // A static reader can inspect the contract field without running the node —
    // true for the raw form and the taxonomy alike (so raw buys nothing here).
    assert.deepEqual(rawAntipatternNode.contract, EMPTY_CONTRACT_FRAGMENT);
    assert.deepEqual(new TagScalarNode().contract, EMPTY_CONTRACT_FRAGMENT);
  });
});

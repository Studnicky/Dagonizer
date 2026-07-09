/**
 * MonadicNode route contract: nodes return routed batches and collect errors
 * onto item state before routing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { NodeRunner } from '../../src/core/NodeRunner.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeError } from '../../src/entities/node/NodeError.js';
import { NodeOutput } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const CTX: NodeContextType = NodeContext.create(
  'test-dag',
  'test-node',
  new AbortController().signal,
  undefined,
);

class NormalNode extends MonadicNode<NodeStateBase, 'done'> {
  readonly name = 'normal-node';
  readonly '@id' = 'urn:noocodec:node:normal-node';
  readonly outputs: readonly ['done'] = ['done'];

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<NodeStateBase>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done', NodeStateBase>> {
    return new Map([['done', batch]]);
  }
}

class ErrorRoutingNode extends MonadicNode<NodeStateBase, 'done' | 'error'> {
  readonly name = 'error-routing-node';
  readonly '@id' = 'urn:noocodec:node:error-routing-node';
  readonly outputs: readonly ['done', 'error'] = ['done', 'error'];

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<NodeStateBase>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done' | 'error', NodeStateBase>> {
    const doneItems: ItemType<NodeStateBase>[] = [];
    const errorItems: ItemType<NodeStateBase>[] = [];

    for (const item of batch) {
      const output: 'done' | 'error' = item.id === 'bad' ? 'error' : 'done';
      const result = output === 'error'
        ? NodeOutput.create(output, {
          'errors': [NodeError.create(
            'nodeContractViolation',
            'node routed an item to error',
            'execute',
            true,
            '2020-01-01T00:00:00Z',
            { 'context': { 'nodeName': this.name } },
          )],
        })
        : NodeOutput.create(output);

      for (const error of result.errors) item.state.collectError(error);
      if (result.output === 'error') {
        errorItems.push(item);
      } else {
        doneItems.push(item);
      }
    }

    const routed = new Map<'done' | 'error', Batch<NodeStateBase>>();
    if (doneItems.length > 0) routed.set('done', Batch.from(doneItems));
    if (errorItems.length > 0) routed.set('error', Batch.from(errorItems));
    return routed;
  }
}

void describe('MonadicNode routing contract', () => {
  void it('routes to the declared output port over a batch', async () => {
    const node = new NormalNode();
    const state = new NodeStateBase();
    const routed = await NodeRunner.run(node, Batch.of(state), CTX);

    assert.ok(routed.has('done'), "result has 'done' port");
    assert.equal(routed.get('done')?.size, 1, "'done' batch has one item");
    assert.equal(state.errors.length, 0, 'no errors collected on state');
  });

  void it('collects NodeOutput errors onto the routed item state before returning', async () => {
    const node = new ErrorRoutingNode();
    const good = new NodeStateBase();
    const bad = new NodeStateBase();

    const routed = await NodeRunner.run(
      node,
      Batch.from([
        { 'id': 'good', 'state': good },
        { 'id': 'bad', 'state': bad },
      ]),
      CTX,
    );

    assert.deepEqual(routed.get('done')?.ids(), ['good']);
    assert.deepEqual(routed.get('error')?.ids(), ['bad']);
    assert.equal(good.errors.length, 0, 'done item has no collected errors');
    assert.equal(bad.errors.length, 1, 'error item carries collected errors');
    assert.equal(bad.errors[0]?.code, 'nodeContractViolation');
    assert.equal(bad.errors[0]?.context['nodeName'], 'error-routing-node');
  });
});

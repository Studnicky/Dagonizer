/**
 * MonadicNode.permissiveSchema: convenience for nodes that don't need
 * per-output-port validation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('MonadicNode.permissiveSchema', () => {
  void it('provides a permissive inputSchema by default', () => {
    class DefaultInputNode extends MonadicNode<NodeStateBase, 'ok'> {
      readonly name = 'default-input';
      readonly '@id' = 'urn:noocodec:node:default-input';
      readonly outputs: readonly ['ok'] = ['ok'];

      override get outputSchema(): Record<'ok', SchemaObjectType> {
        return { 'ok': { 'type': 'object' } };
      }

      override async execute(
        batch: Batch<NodeStateBase>,
        _context: NodeContextType,
      ): Promise<RoutedBatchType<'ok', NodeStateBase>> {
        return new Map([['ok', batch]]);
      }
    }

    const node = new DefaultInputNode();
    assert.deepEqual(node.inputSchema, { 'type': 'object' });
  });

  void it('builds a { type: object } entry for every listed output', () => {
    const outputs: readonly ['ok', 'fail'] = ['ok', 'fail'];
    const schema = MonadicNode.permissiveSchema(outputs);
    assert.deepEqual(schema, { 'ok': { 'type': 'object' }, 'fail': { 'type': 'object' } });
  });

  void it('works with a single output', () => {
    const outputs: readonly ['success'] = ['success'];
    const schema = MonadicNode.permissiveSchema(outputs);
    assert.deepEqual(schema, { 'success': { 'type': 'object' } });
  });

  void it('produces a record usable directly as outputSchema on a concrete subclass', () => {
    class PermissiveNode extends MonadicNode<NodeStateBase, 'ok' | 'fail'> {
      readonly name = 'permissive';
      readonly '@id' = 'urn:noocodec:node:permissive';
      readonly outputs: readonly ['ok', 'fail'] = ['ok', 'fail'];
      override get outputSchema(): Record<'ok' | 'fail', SchemaObjectType> {
        return MonadicNode.permissiveSchema(this.outputs);
      }

      override async execute(
        batch: Batch<NodeStateBase>,
        _context: NodeContextType,
      ): Promise<RoutedBatchType<'ok' | 'fail', NodeStateBase>> {
        return new Map([['ok', batch]]);
      }
    }

    const node = new PermissiveNode();
    assert.deepEqual(node.outputSchema, { 'ok': { 'type': 'object' }, 'fail': { 'type': 'object' } });
  });
});

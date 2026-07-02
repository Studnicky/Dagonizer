/**
 * ScalarNode.permissiveSchema: convenience for nodes that don't need
 * per-output-port validation.
 *
 * Covers:
 *   (a) Builds a `{ type: 'object' }` schema entry for every listed output.
 *   (b) Works with a single output.
 *   (c) The produced record is usable directly as `outputSchema` on a
 *       concrete subclass (compile-time + structural check via a fixture node).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('ScalarNode.permissiveSchema', () => {
  void it('builds a { type: object } entry for every listed output', () => {
    const schema = ScalarNode.permissiveSchema(['ok', 'fail'] as const);
    assert.deepEqual(schema, { 'ok': { 'type': 'object' }, 'fail': { 'type': 'object' } });
  });

  void it('works with a single output', () => {
    const schema = ScalarNode.permissiveSchema(['success'] as const);
    assert.deepEqual(schema, { 'success': { 'type': 'object' } });
  });

  void it('produces a record usable directly as outputSchema on a concrete subclass', () => {
    class PermissiveNode extends ScalarNode<NodeStateBase, 'ok' | 'fail'> {
      readonly name = 'permissive';
      readonly outputs = ['ok', 'fail'] as const;
      override get outputSchema(): Record<'ok' | 'fail', SchemaObjectType> {
        return ScalarNode.permissiveSchema(this.outputs);
      }
      protected override async executeOne() {
        return NodeOutputBuilder.of<'ok' | 'fail'>('ok');
      }
    }

    const node = new PermissiveNode();
    assert.deepEqual(node.outputSchema, { 'ok': { 'type': 'object' }, 'fail': { 'type': 'object' } });
  });
});

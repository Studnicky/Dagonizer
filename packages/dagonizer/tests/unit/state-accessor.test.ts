import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StateAccessor } from '../../src/contracts/StateAccessor.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DottedPathAccessor } from '../../src/runtime/DottedPathAccessor.js';

void describe('DottedPathAccessor', () => {
  void it('reads a top-level field', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': 1 }, 'a'), 1);
  });

  void it('reads a nested field via dotted path', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': { 'b': { 'c': 42 } } }, 'a.b.c'), 42);
  });

  void it('returns null for a missing path', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({}, 'a.b.c'), null);
  });

  void it('writes a top-level field', () => {
    const accessor = new DottedPathAccessor();
    const target: Record<string, unknown> = {};
    accessor.set(target, 'a', 1);
    assert.equal(target['a'], 1);
  });

  void it('creates intermediate objects on nested write', () => {
    const accessor = new DottedPathAccessor();
    const target: Record<string, unknown> = {};
    accessor.set(target, 'a.b.c', 'value');
    assert.deepEqual(target, { 'a': { 'b': { 'c': 'value' } } });
  });

  void it('refuses to write through __proto__ (no prototype pollution)', () => {
    const accessor = new DottedPathAccessor();
    accessor.set({}, '__proto__.polluted', 'yes');
    accessor.set({}, 'a.__proto__.polluted', 'yes');
    accessor.set({}, 'constructor.prototype.polluted', 'yes');
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal((Object.prototype as Record<string, unknown>)['polluted'], undefined);
  });

  void it('returns null for a path that walks a prototype key', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({ 'a': 1 }, '__proto__'), null);
    assert.equal(accessor.get({ 'a': 1 }, 'a.constructor'), null);
  });
});

void describe('Dagonizer accepts a custom StateAccessor', () => {
  void it('uses the supplied accessor for scatter source reads', async () => {
    let getCalls = 0;
    const trackingAccessor: StateAccessor = {
      get<T = unknown>(state: object, path: string): T | null {
        getCalls += 1;
        return new DottedPathAccessor().get<T>(state, path);
      },
      set(state: object, path: string, value: unknown): void {
        new DottedPathAccessor().set(state, path, value);
      },
    };

    class ScatterState extends NodeStateBase {
      items: number[] = [10, 20, 30];
      results: number[] = [];
    }

    class HandlerNode extends ScalarNode<ScatterState, 'success'> {
      readonly name = 'handler';
      readonly outputs = ['success'] as const;
      protected async executeOne(state: ScatterState): Promise<NodeOutputInterface<'success'>> {
        const item = state.getMetadata<number>('item') ?? 0;
        state.results.push(item * 2);
        return { 'errors': [], 'output': 'success' as const };
      }
    }

    const dispatcher = new Dagonizer<ScatterState>({ 'accessor': trackingAccessor });
    dispatcher.registerNode(new HandlerNode());
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan-test',
      '@type':    'DAG',
      'name': 'fan-test',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan-test/node/fan',
        '@type':  'ScatterNode',
        'name':   'fan',
        'body':   { 'node': 'handler' },
        'source': 'items',
        'itemKey': 'item',
        'gather': { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
        { '@id': 'urn:noocodex:dag:fan-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('fan-test', new ScatterState());

    assert.ok(getCalls > 0, 'custom accessor.get was invoked at least once');
  });
});

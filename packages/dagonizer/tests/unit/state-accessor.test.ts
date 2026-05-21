import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { StateAccessor } from '../../src/contracts/StateAccessor.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
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

  void it('returns undefined for a missing path', () => {
    const accessor = new DottedPathAccessor();
    assert.equal(accessor.get({}, 'a.b.c'), undefined);
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
});

void describe('Dagonizer accepts a custom StateAccessor', () => {
  void it('uses the supplied accessor for fan-out source reads', async () => {
    let getCalls = 0;
    const trackingAccessor: StateAccessor = {
      get(state: object, path: string): unknown {
        getCalls += 1;
        return new DottedPathAccessor().get(state, path);
      },
      set(state: object, path: string, value: unknown): void {
        new DottedPathAccessor().set(state, path, value);
      },
    };

    class FanOutState extends NodeStateBase {
      items: number[] = [10, 20, 30];
      results: number[] = [];
    }

    const handler: NodeInterface<FanOutState, 'success'> = {
      'name': 'handler',
      'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item') ?? 0;
        state.results.push(item * 2);
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<FanOutState>({ 'accessor': trackingAccessor });
    dispatcher.registerNode(handler);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan-test',
      '@type':    'DAG',
      'name': 'fan-test',
      'version': '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan-test/node/fan',
        '@type':  'FanOutNode',
        'name':   'fan',
        'node':   'handler',
        'source': 'items',
        'itemKey': 'item',
        'fanIn': { 'strategy': 'append', 'target': 'collected' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }],
    };
    dispatcher.registerDAG(dag);

    await dispatcher.execute('fan-test', new FanOutState());

    assert.ok(getCalls > 0, 'custom accessor.get was invoked at least once');
  });
});

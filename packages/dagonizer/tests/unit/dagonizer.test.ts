import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAGError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

void describe('Dagonizer single-node routing', () => {
  void it('routes per output and terminates at explicit TerminalNode', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:classify', ['ok', 'no'], (s) => {
      s.setMetadata('classified', true);
      return 'ok';
    }));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:plan', ['success'], () => 'success'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:reject', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:classify-route',
      '@type':    'DAG',
      'name': 'classify-route',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:classify-route/node/classify' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:classify-route/node/classify', '@type': 'SingleNode',
          'name': 'classify', 'node': 'urn:noocodec:node:classify', 'outputs': {
            'ok': 'urn:noocodec:dag:classify-route/node/plan',
            'no': 'urn:noocodec:dag:classify-route/node/reject',
          } },
        { '@id': 'urn:noocodec:dag:classify-route/node/plan', '@type': 'SingleNode',
          'name': 'plan', 'node': 'urn:noocodec:node:plan', 'outputs': { 'success': 'urn:noocodec:dag:classify-route/node/end' } },
        { '@id': 'urn:noocodec:dag:classify-route/node/reject', '@type': 'SingleNode',
          'name': 'reject', 'node': 'urn:noocodec:node:reject', 'outputs': { 'success': 'urn:noocodec:dag:classify-route/node/end' } },
        { '@id': 'urn:noocodec:dag:classify-route/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(dag));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('urn:noocodec:dag:classify-route', state);

    assert.deepEqual(result.executedNodes, ['classify', 'plan', 'end']);
    assert.equal(result.skippedNodes.length, 0);
    assert.equal(state.getMetadata('classified'), true);
    assert.equal(state.lifecycle.variant, 'completed');
  });

  void it('marks state failed when node returns unwired output', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    // Node declares only 'success'; at runtime it returns 'phantom' (not in
    // the placement routing map) — exercises the unwired-output error path
    // without requiring a second registration.
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:rogue', ['success'], () => 'phantom'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:rogue',
      '@type':    'DAG',
      'name': 'rogue',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:rogue/node/rogue' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:rogue/node/rogue', '@type': 'SingleNode',
          'name': 'rogue', 'node': 'urn:noocodec:node:rogue', 'outputs': { 'success': 'urn:noocodec:dag:rogue/node/end' } },
        { '@id': 'urn:noocodec:dag:rogue/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(dag));

    const result = await dispatcher.execute('urn:noocodec:dag:rogue', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'failed');
    assert.equal(result.cursor, 'urn:noocodec:dag:rogue/node/rogue');
    if (result.state.lifecycle.variant === 'failed') {
      assert.ok(result.state.lifecycle.error instanceof DAGError);
    }
  });
});

void describe('Dagonizer scatter (source-based fork)', () => {
  void it('executes the node once per item and appends results', async () => {
    class FanState extends NodeStateBase {
      items: number[] = [];
      doubled: number[] = [];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    const seen: number[] = [];
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:double', ['success'], (state) => {
      const item = state.getter.number('item');
      seen.push(item);
      return 'success';
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:fan',
      '@type':    'DAG',
      'name': 'fan',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:fan/node/scatter' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:fan/node/scatter', '@type': 'ScatterNode',
          'name': 'scatter', 'body': { 'node': 'urn:noocodec:node:double' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 2 },
          'outputs': {
            'all-success': 'urn:noocodec:dag:fan/node/join',
            'partial': 'urn:noocodec:dag:fan/node/join',
            'all-error': 'urn:noocodec:dag:fan/node/join',
            'empty': 'urn:noocodec:dag:fan/node/end',
          } },
        { '@id': 'urn:noocodec:dag:fan/node/join', '@type': 'GatherNode',
          'name': 'join', 'sources': { 'urn:noocodec:dag:fan/node/scatter': {} }, 'gather': { 'strategy': 'append', 'target': 'doubled' },
          'outputs': {
            'success': 'urn:noocodec:dag:fan/node/end',
            'error': 'urn:noocodec:dag:fan/node/end',
            'empty': 'urn:noocodec:dag:fan/node/end',
          } },
        { '@id': 'urn:noocodec:dag:fan/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(dag));

    const state = new FanState();
    state.items = [1, 2, 3, 4];
    state.doubled = [];
    await dispatcher.execute('urn:noocodec:dag:fan', state);
    assert.equal(seen.length, 4);
    assert.deepEqual(state.doubled.sort(), [1, 2, 3, 4]);
  });

  void it('skips with empty output when source array is empty', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:noop', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:empty',
      '@type':    'DAG',
      'name': 'empty',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:empty/node/scatter' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:empty/node/scatter', '@type': 'ScatterNode',
          'name': 'scatter', 'body': { 'node': 'urn:noocodec:node:noop' },
          'source': 'missing.items',
          'outputs': {
            'all-success': 'urn:noocodec:dag:empty/node/end',
            'partial': 'urn:noocodec:dag:empty/node/end',
            'all-error': 'urn:noocodec:dag:empty/node/end',
            'empty': 'urn:noocodec:dag:empty/node/end',
          } },
        { '@id': 'urn:noocodec:dag:empty/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(dag));

    const result = await dispatcher.execute('urn:noocodec:dag:empty', new NodeStateBase());
    assert.deepEqual(result.skippedNodes, ['scatter']);
  });
});

void describe('Dagonizer embedded-DAG (nested sub-DAG)', () => {
  void it('maps node state into and out of nested DAG via stateMapping', async () => {
    class NestState extends NodeStateBase {
      parentValue: number = 0;
      childValue: number = 0;
      result: number = 0;
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make<NestState>('urn:noocodec:node:inc', ['success'], (state) => {
      state.result = (state.childValue ?? 0) + 1;
      return 'success';
    }));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:done', ['success'], () => 'success'));

    const child: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:child',
      '@type':    'DAG',
      'name': 'child',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:child/node/inc' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:child/node/inc', '@type': 'SingleNode',
          'name': 'inc', 'node': 'urn:noocodec:node:inc', 'outputs': { 'success': 'urn:noocodec:dag:child/node/end' } },
        { '@id': 'urn:noocodec:dag:child/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    // Parent DAG: embedded-DAG invocation routes to a parent-owned terminal node.
    const parent: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:parent',
      '@type':    'DAG',
      'name': 'parent',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:parent/node/invoke' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:parent/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'urn:noocodec:dag:child',
          'stateMapping': {
            'input':  { 'childValue': 'parentValue' },
            'output': { 'parentValue': 'result' },
          },
          'outputs': {
            'success': 'urn:noocodec:dag:parent/node/done',
            'error': 'urn:noocodec:dag:parent/node/done',
          } },
        { '@id': 'urn:noocodec:dag:parent/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'urn:noocodec:node:done', 'outputs': { 'success': 'urn:noocodec:dag:parent/node/end' } },
        { '@id': 'urn:noocodec:dag:parent/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(child));
    dispatcher.registerDAG(TestDag.from(parent));

    const state = new NestState();
    state.parentValue = 41;
    await dispatcher.execute('urn:noocodec:dag:parent', state);
    assert.equal(state.parentValue, 42);
  });

  void it('rejects scatter placement referencing an unregistered DAG', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:done', ['success'], () => 'success'));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:orphan',
      '@type':    'DAG',
      'name': 'orphan',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:orphan/node/s' },
      'nodes': [
        // EmbeddedDAGNode outputs route to a parent placement so the
        // output invariant passes; registration still fails because
        // 'ghost' is not a registered DAG.
        { '@id': 'urn:noocodec:dag:orphan/node/s', '@type': 'EmbeddedDAGNode',
          'name': 's', 'dag': 'urn:noocodec:dag:ghost', 'outputs': {
            'success': 'urn:noocodec:dag:orphan/node/done',
            'error': 'urn:noocodec:dag:orphan/node/done',
          } },
        { '@id': 'urn:noocodec:dag:orphan/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'urn:noocodec:node:done', 'outputs': { 'success': 'urn:noocodec:dag:orphan/node/end' } },
        { '@id': 'urn:noocodec:dag:orphan/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });
});

void describe('Dagonizer validation', () => {
  void it('rejects duplicate node names', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:dup',
      '@type':    'DAG',
      'name': 'dup',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:dup/node/a' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:dup/node/a',  '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': 'urn:noocodec:dag:dup/node/end' } },
        { '@id': 'urn:noocodec:dag:dup/node/a2', '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': 'urn:noocodec:dag:dup/node/end' } },
        { '@id': 'urn:noocodec:dag:dup/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects missing entrypoint', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:noentry',
      '@type':    'DAG',
      'name': 'noentry',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:noentry/node/ghost' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:noentry/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': 'urn:noocodec:dag:noentry/node/end' } },
        { '@id': 'urn:noocodec:dag:noentry/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects nodes with invalid validate result', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class BadNode extends MonadicNode<NodeStateBase, string> {
      readonly name = 'bad';
      readonly '@id' = 'urn:noocodec:node:bad';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      override async execute(batch: Batch<NodeStateBase>): Promise<Map<string, Batch<NodeStateBase>>> { return new Map([['success', batch]]); }
      override validate() { return { 'valid': false, 'errors': ['bad config'] }; }
    }
    assert.throws(() => dispatcher.registerNode(new BadNode()), DAGError);
  });

  void it('single node registration succeeds', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    assert.doesNotThrow(() => {
      dispatcher.registerNode(TestNode.make('urn:noocodec:node:once', ['success'], () => 'success'));
    });
  });

  void it('registering two nodes with the same name throws DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:dup', ['success'], () => 'success'));
    assert.throws(
      () => dispatcher.registerNode(TestNode.make('urn:noocodec:node:dup', ['success'], () => 'success')),
      DAGError,
    );
  });

  void it('single DAG registration succeeds', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:once',
      '@type':    'DAG',
      'name': 'once',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:once/node/op' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:once/node/op', '@type': 'SingleNode',
          'name': 'op', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': 'urn:noocodec:dag:once/node/end' } },
        { '@id': 'urn:noocodec:dag:once/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.doesNotThrow(() => { dispatcher.registerDAG(TestDag.from(dag)); });
  });

  void it('registering two DAGs with the same name throws DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op2', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:dup-dag',
      '@type':    'DAG',
      'name': 'dup-dag',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:dup-dag/node/op2' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:dup-dag/node/op2', '@type': 'SingleNode',
          'name': 'op2', 'node': 'urn:noocodec:node:op2', 'outputs': { 'success': 'urn:noocodec:dag:dup-dag/node/end' } },
        { '@id': 'urn:noocodec:dag:dup-dag/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    const canonicalDag = TestDag.from(dag);
    dispatcher.registerDAG(canonicalDag);
    // Idempotent by identity: re-registering the SAME object is a no-op.
    assert.doesNotThrow(() => dispatcher.registerDAG(canonicalDag));
    // A DIFFERENT object under the same name is a real collision → throws.
    const other: DAGType = { ...canonicalDag };
    assert.throws(() => dispatcher.registerDAG(other), DAGError);
  });
});

void describe('Dagonizer iterative execution', () => {
  void it('yields each node result in order', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:a', ['success'], () => 'success'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:b', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodec:dag:iter',
      '@type':    'DAG',
      'name': 'iter',
      'version': '1',
      'entrypoints': { 'main': 'urn:noocodec:dag:iter/node/a' },
      'nodes': [
        { '@id': 'urn:noocodec:dag:iter/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:a', 'outputs': { 'success': 'urn:noocodec:dag:iter/node/b' } },
        { '@id': 'urn:noocodec:dag:iter/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'urn:noocodec:node:b', 'outputs': { 'success': 'urn:noocodec:dag:iter/node/end' } },
        { '@id': 'urn:noocodec:dag:iter/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(TestDag.from(dag));

    const seen: string[] = [];
    for await (const node of dispatcher.execute('urn:noocodec:dag:iter', new NodeStateBase())) {
      seen.push(node.nodeName);
    }
    assert.deepEqual(seen, ['a', 'b', 'end']);
  });
});

void describe('error hierarchy', () => {
  void it('DAGError carries the CONFIGURATION_ERROR code', () => {
    const error = new DAGError('boom', { 'code': 'CONFIGURATION_ERROR' });
    assert.ok(error instanceof DAGError);
    assert.equal(error.code, 'CONFIGURATION_ERROR');
    const serialized = error.toJSON();
    assert.equal(serialized['code'], 'CONFIGURATION_ERROR');
    assert.equal(serialized['name'], 'DAGError');
  });
});

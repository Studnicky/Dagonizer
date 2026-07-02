import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { DAGError } from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

void describe('Dagonizer single-node routing', () => {
  void it('routes per output and terminates at explicit TerminalNode', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('classify', ['ok', 'no'], (s) => {
      s.setMetadata('classified', true);
      return 'ok';
    }));
    dispatcher.registerNode(TestNode.make('plan', ['success'], () => 'success'));
    dispatcher.registerNode(TestNode.make('reject', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:classify-route',
      '@type':    'DAG',
      'name': 'classify-route',
      'version': '1',
      'entrypoint': 'classify',
      'nodes': [
        { '@id': 'urn:noocodex:dag:classify-route/node/classify', '@type': 'SingleNode',
          'name': 'classify', 'node': 'classify', 'outputs': { 'ok': 'plan', 'no': 'reject' } },
        { '@id': 'urn:noocodex:dag:classify-route/node/plan', '@type': 'SingleNode',
          'name': 'plan', 'node': 'plan', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:classify-route/node/reject', '@type': 'SingleNode',
          'name': 'reject', 'node': 'reject', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:classify-route/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('classify-route', state);

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
    dispatcher.registerNode(TestNode.make('rogue', ['success'], () => 'phantom'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:rogue',
      '@type':    'DAG',
      'name': 'rogue',
      'version': '1',
      'entrypoint': 'rogue',
      'nodes': [
        { '@id': 'urn:noocodex:dag:rogue/node/rogue', '@type': 'SingleNode',
          'name': 'rogue', 'node': 'rogue', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:rogue/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('rogue', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'failed');
    assert.equal(result.cursor, 'rogue');
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
    dispatcher.registerNode(TestNode.make('double', ['success'], (state) => {
      const item = state.getter.number('item');
      seen.push(item);
      return 'success';
    }));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name': 'fan',
      'version': '1',
      'entrypoint': 'scatter',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fan/node/scatter', '@type': 'ScatterNode',
          'name': 'scatter', 'body': { 'node': 'double' },
          'source': 'items', 'itemKey': 'item', 'execution': { 'mode': 'item', 'concurrency': 2 },
          'gather': { 'strategy': 'append', 'target': 'doubled' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:fan/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new FanState();
    state.items = [1, 2, 3, 4];
    state.doubled = [];
    await dispatcher.execute('fan', state);
    assert.equal(seen.length, 4);
    assert.deepEqual(state.doubled.sort(), [1, 2, 3, 4]);
  });

  void it('skips with empty output when source array is empty', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('noop', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:empty',
      '@type':    'DAG',
      'name': 'empty',
      'version': '1',
      'entrypoint': 'scatter',
      'nodes': [
        { '@id': 'urn:noocodex:dag:empty/node/scatter', '@type': 'ScatterNode',
          'name': 'scatter', 'body': { 'node': 'noop' },
          'source': 'missing.items',
          'gather': { 'strategy': 'append', 'target': 'out' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' } },
        { '@id': 'urn:noocodex:dag:empty/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('empty', new NodeStateBase());
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
    dispatcher.registerNode(TestNode.make<NestState>('inc', ['success'], (state) => {
      state.result = (state.childValue ?? 0) + 1;
      return 'success';
    }));
    dispatcher.registerNode(TestNode.make('done', ['success'], () => 'success'));

    const child: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child',
      '@type':    'DAG',
      'name': 'child',
      'version': '1',
      'entrypoint': 'inc',
      'nodes': [
        { '@id': 'urn:noocodex:dag:child/node/inc', '@type': 'SingleNode',
          'name': 'inc', 'node': 'inc', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:child/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    // Parent DAG: embedded-DAG invocation routes to a parent-owned terminal node.
    const parent: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent',
      '@type':    'DAG',
      'name': 'parent',
      'version': '1',
      'entrypoint': 'invoke',
      'nodes': [
        { '@id': 'urn:noocodex:dag:parent/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child',
          'stateMapping': {
            'input':  { 'childValue': 'parentValue' },
            'output': { 'parentValue': 'result' },
          },
          'outputs': { 'success': 'done', 'error': 'done' } },
        { '@id': 'urn:noocodex:dag:parent/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'done', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:parent/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(child);
    dispatcher.registerDAG(parent);

    const state = new NestState();
    state.parentValue = 41;
    await dispatcher.execute('parent', state);
    assert.equal(state.parentValue, 42);
  });

  void it('rejects scatter placement referencing an unregistered DAG', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('done', ['success'], () => 'success'));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:orphan',
      '@type':    'DAG',
      'name': 'orphan',
      'version': '1',
      'entrypoint': 's',
      'nodes': [
        // EmbeddedDAGNode outputs route to a parent placement so the
        // output invariant passes; registration still fails because
        // 'ghost' is not a registered DAG.
        { '@id': 'urn:noocodex:dag:orphan/node/s', '@type': 'EmbeddedDAGNode',
          'name': 's', 'dag': 'ghost', 'outputs': { 'success': 'done', 'error': 'done' } },
        { '@id': 'urn:noocodex:dag:orphan/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'done', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:orphan/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });
});

void describe('Dagonizer validation', () => {
  void it('rejects duplicate node names', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:dup',
      '@type':    'DAG',
      'name': 'dup',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:dup/node/a',  '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:dup/node/a2', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:dup/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects missing entrypoint', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:noentry',
      '@type':    'DAG',
      'name': 'noentry',
      'version': '1',
      'entrypoint': 'ghost',
      'nodes': [
        { '@id': 'urn:noocodex:dag:noentry/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:noentry/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects nodes with invalid validate result', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class BadNode extends ScalarNode<NodeStateBase, string> {
      readonly name = 'bad';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      protected override async executeOne(): Promise<NodeOutputType<string>> { return { 'errors': [], 'output': 'success' as const }; }
      override validate() { return { 'valid': false, 'errors': ['bad config'] }; }
    }
    assert.throws(() => dispatcher.registerNode(new BadNode()), DAGError);
  });

  void it('single node registration succeeds', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    assert.doesNotThrow(() => {
      dispatcher.registerNode(TestNode.make('once', ['success'], () => 'success'));
    });
  });

  void it('registering two nodes with the same name throws DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('dup', ['success'], () => 'success'));
    assert.throws(
      () => dispatcher.registerNode(TestNode.make('dup', ['success'], () => 'success')),
      DAGError,
    );
  });

  void it('single DAG registration succeeds', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:once',
      '@type':    'DAG',
      'name': 'once',
      'version': '1',
      'entrypoint': 'op',
      'nodes': [
        { '@id': 'urn:noocodex:dag:once/node/op', '@type': 'SingleNode',
          'name': 'op', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:once/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.doesNotThrow(() => { dispatcher.registerDAG(dag); });
  });

  void it('registering two DAGs with the same name throws DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op2', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:dup-dag',
      '@type':    'DAG',
      'name': 'dup-dag',
      'version': '1',
      'entrypoint': 'op2',
      'nodes': [
        { '@id': 'urn:noocodex:dag:dup-dag/node/op2', '@type': 'SingleNode',
          'name': 'op2', 'node': 'op2', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:dup-dag/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);
    // Idempotent by identity: re-registering the SAME object is a no-op.
    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
    // A DIFFERENT object under the same name is a real collision → throws.
    const other: DAGType = { ...dag };
    assert.throws(() => dispatcher.registerDAG(other), DAGError);
  });
});

void describe('Dagonizer iterative execution', () => {
  void it('yields each node result in order', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('a', ['success'], () => 'success'));
    dispatcher.registerNode(TestNode.make('b', ['success'], () => 'success'));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:iter',
      '@type':    'DAG',
      'name': 'iter',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:iter/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'a', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:iter/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'b', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:iter/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(dag);

    const seen: string[] = [];
    for await (const node of dispatcher.execute('iter', new NodeStateBase())) {
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

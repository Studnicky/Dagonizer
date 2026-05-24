import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import {
  ConfigurationError,
  DAGError,
} from '../../src/errors/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const makeNode = (
  name: string,
  outputs: readonly string[],
  exec: (state: NodeStateBase) => Promise<string> | string,
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute(state) {
    const output = await exec(state);
    return { output };
  },
});

void describe('Dagonizer single-node routing', () => {
  void it('routes per output and terminates on null', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('classify', ['ok', 'no'], (s) => {
      s.setMetadata('classified', true);
      return 'ok';
    }));
    dispatcher.registerNode(makeNode('plan', ['success'], () => 'success'));
    dispatcher.registerNode(makeNode('reject', ['success'], () => 'success'));

    const dag: DAG = {
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
          'name': 'plan', 'node': 'plan', 'outputs': { 'success': null } },
        { '@id': 'urn:noocodex:dag:classify-route/node/reject', '@type': 'SingleNode',
          'name': 'reject', 'node': 'reject', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('classify-route', state);

    assert.deepEqual(result.executedNodes, ['classify', 'plan']);
    assert.equal(result.skippedNodes.length, 0);
    assert.equal(state.getMetadata('classified'), true);
    assert.equal(state.lifecycle.kind, 'completed');
  });

  void it('marks state failed when node returns unwired output', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('rogue', ['success', 'mystery'], () => 'mystery'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:rogue',
      '@type':    'DAG',
      'name': 'rogue',
      'version': '1',
      'entrypoint': 'rogue',
      'nodes': [
        { '@id': 'urn:noocodex:dag:rogue/node/rogue', '@type': 'SingleNode',
          'name': 'rogue', 'node': 'rogue', 'outputs': { 'success': null, 'mystery': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    // Force the rogue node to return an output that has no wiring by
    // replacing the registered node after DAG validation passes.
    dispatcher.registerNode(makeNode('rogue', ['success'], () => 'phantom'));

    const result = await dispatcher.execute('rogue', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'failed');
    assert.equal(result.cursor, 'rogue');
    if (result.state.lifecycle.kind === 'failed') {
      assert.ok(result.state.lifecycle.error instanceof DAGError);
    }
  });
});

void describe('Dagonizer parallel groups', () => {
  void it('all-success combiner requires every output to be success', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['success', 'error'], () => 'success'));
    dispatcher.registerNode(makeNode('b', ['success', 'error'], () => 'error'));
    dispatcher.registerNode(makeNode('done', ['success'], () => 'success'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:p',
      '@type':    'DAG',
      'name': 'p',
      'version': '1',
      'entrypoint': 'group',
      'nodes': [
        { '@id': 'urn:noocodex:dag:p/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'a', 'outputs': { 'success': null, 'error': null } },
        { '@id': 'urn:noocodex:dag:p/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'b', 'outputs': { 'success': null, 'error': null } },
        { '@id': 'urn:noocodex:dag:p/node/group', '@type': 'ParallelNode',
          'name': 'group', 'nodes': ['a', 'b'], 'combine': 'all-success',
          'outputs': { 'success': 'done', 'error': null } },
        { '@id': 'urn:noocodex:dag:p/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'done', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('p', new NodeStateBase());
    assert.ok(!result.executedNodes.includes('done'));
  });

  void it('collect combiner stashes parallel outputs in metadata', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['success'], () => 'success'));
    dispatcher.registerNode(makeNode('b', ['warn'], () => 'warn'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:collect',
      '@type':    'DAG',
      'name': 'collect',
      'version': '1',
      'entrypoint': 'group',
      'nodes': [
        { '@id': 'urn:noocodex:dag:collect/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'a', 'outputs': { 'success': null } },
        { '@id': 'urn:noocodex:dag:collect/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'b', 'outputs': { 'warn': null } },
        { '@id': 'urn:noocodex:dag:collect/node/group', '@type': 'ParallelNode',
          'name': 'group', 'nodes': ['a', 'b'], 'combine': 'collect',
          'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    await dispatcher.execute('collect', state);
    const collected = state.getMetadata<Record<string, string>>('parallelOutputs');
    assert.deepEqual(collected, { 'a': 'success', 'b': 'warn' });
  });
});

void describe('Dagonizer fan-out', () => {
  void it('executes the node once per item and appends results', async () => {
    interface FanState extends NodeStateBase {
      items: number[];
      doubled: number[];
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    const seen: number[] = [];
    dispatcher.registerNode({
      'name': 'double',
      'outputs': ['success'],
      async execute(state) {
        const item = state.getMetadata<number>('item');
        if (item === undefined) throw new Error('no item');
        seen.push(item);
        return { 'output': 'success' };
      },
    });

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name': 'fan',
      'version': '1',
      'entrypoint': 'fanout',
      'nodes': [
        { '@id': 'urn:noocodex:dag:fan/node/fanout', '@type': 'FanOutNode',
          'name': 'fanout', 'node': 'double',
          'source': 'items', 'itemKey': 'item', 'concurrency': 2,
          'fanIn': { 'strategy': 'append', 'target': 'doubled' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const state = new NodeStateBase() as FanState;
    state.items = [1, 2, 3, 4];
    state.doubled = [];
    await dispatcher.execute('fan', state);
    assert.equal(seen.length, 4);
    assert.deepEqual(state.doubled.sort(), [1, 2, 3, 4]);
  });

  void it('skips with empty output when source array is empty', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('noop', ['success'], () => 'success'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:empty',
      '@type':    'DAG',
      'name': 'empty',
      'version': '1',
      'entrypoint': 'fanout',
      'nodes': [
        { '@id': 'urn:noocodex:dag:empty/node/fanout', '@type': 'FanOutNode',
          'name': 'fanout', 'node': 'noop',
          'source': 'missing.items',
          'fanIn': { 'strategy': 'append', 'target': 'out' },
          'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('empty', new NodeStateBase());
    assert.deepEqual(result.skippedNodes, ['fanout']);
  });
});

void describe('Dagonizer embedded-DAGs', () => {
  void it('maps node state into and out of nested DAG', async () => {
    interface NestState extends NodeStateBase {
      parentValue: number;
      childValue: number;
      result: number;
    }
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode({
      'name': 'inc',
      'outputs': ['success'],
      async execute(state) {
        const s = state as NestState;
        s.result = (s.childValue ?? 0) + 1;
        return { 'output': 'success' };
      },
    });
    dispatcher.registerNode(makeNode('done', ['success'], () => 'success'));

    const child: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child',
      '@type':    'DAG',
      'name': 'child',
      'version': '1',
      'entrypoint': 'inc',
      'nodes': [
        { '@id': 'urn:noocodex:dag:child/node/inc', '@type': 'SingleNode',
          'name': 'inc', 'node': 'inc', 'outputs': { 'success': null } },
      ],
    };
    // Parent DAG: embedded-dag placement routes to a parent-owned terminal node.
    // Embedded-DAGs are reusable components — only the parent DAG owns END (null).
    const parent: DAG = {
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
          'name': 'done', 'node': 'done', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(child);
    dispatcher.registerDAG(parent);

    const state = new NodeStateBase() as NestState;
    state.parentValue = 41;
    await dispatcher.execute('parent', state);
    assert.equal(state.parentValue, 42);
  });

  void it('rejects embedded-DAG referencing an unregistered DAG', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('done', ['success'], () => 'success'));
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:orphan',
      '@type':    'DAG',
      'name': 'orphan',
      'version': '1',
      'entrypoint': 's',
      'nodes': [
        // Embedded-dag outputs route to a parent placement (not null) so the
        // terminal-output invariant passes; registration still fails because
        // 'ghost' is not a registered DAG.
        { '@id': 'urn:noocodex:dag:orphan/node/s', '@type': 'EmbeddedDAGNode',
          'name': 's', 'dag': 'ghost', 'outputs': { 'success': 'done', 'error': 'done' } },
        { '@id': 'urn:noocodex:dag:orphan/node/done', '@type': 'SingleNode',
          'name': 'done', 'node': 'done', 'outputs': { 'success': null } },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });
});

void describe('Dagonizer validation', () => {
  void it('rejects duplicate node names', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('op', ['success'], () => 'success'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:dup',
      '@type':    'DAG',
      'name': 'dup',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:dup/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': null } },
        { '@id': 'urn:noocodex:dag:dup/node/a2', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': null } },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects missing entrypoint', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('op', ['success'], () => 'success'));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:noentry',
      '@type':    'DAG',
      'name': 'noentry',
      'version': '1',
      'entrypoint': 'ghost',
      'nodes': [
        { '@id': 'urn:noocodex:dag:noentry/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': null } },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), DAGError);
  });

  void it('rejects nodes with invalid validate result', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const bad: NodeInterface<NodeStateBase> = {
      'name': 'bad',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
      validate() { return { 'valid': false, 'errors': ['bad config'] }; },
    };
    assert.throws(() => dispatcher.registerNode(bad), DAGError);
  });
});

void describe('Dagonizer iterative execution', () => {
  void it('yields each node result in order', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['success'], () => 'success'));
    dispatcher.registerNode(makeNode('b', ['success'], () => 'success'));

    const dag: DAG = {
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
          'name': 'b', 'node': 'b', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const seen: string[] = [];
    for await (const node of dispatcher.execute('iter', new NodeStateBase())) {
      seen.push(node.nodeName);
    }
    assert.deepEqual(seen, ['a', 'b']);
  });
});

void describe('error hierarchy', () => {
  void it('ConfigurationError extends DAGError', () => {
    const error = new ConfigurationError('boom');
    assert.ok(error instanceof DAGError);
    assert.equal(error.code, 'CONFIGURATION_ERROR');
    const serialized = error.toJSON();
    assert.equal(serialized.code, 'CONFIGURATION_ERROR');
    assert.equal(serialized.name, 'ConfigurationError');
  });
});

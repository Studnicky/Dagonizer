import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import type { DAGType } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// Recording Dagonizer subclass captures every hook invocation in order so
// tests can assert on the full call sequence rather than aggregate counts.
type Call = {
  readonly hook: string;
  readonly args: readonly unknown[];
}

class RecordingDagonizer extends Dagonizer<NodeStateBase> {
  readonly calls: Call[] = [];

  protected override onFlowStart(dagName: string, state: NodeStateBase): void {
    this.calls.push({ 'hook': 'flowStart', 'args': [dagName, state] });
  }
  protected override onFlowEnd(dagName: string, state: NodeStateBase, result: ExecutionResultType<NodeStateBase>): void {
    this.calls.push({ 'hook': 'flowEnd', 'args': [dagName, state, result] });
  }
  protected override onNodeStart(nodeName: string, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeStart', 'args': [nodeName, state, placementPath] });
  }
  protected override onNodeEnd(nodeName: string, output: string | null, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeEnd', 'args': [nodeName, output, state, placementPath] });
  }
  protected override onError(nodeName: string, error: Error, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'error', 'args': [nodeName, error, state, placementPath] });
  }

  hooksOfType(hookName: string): Call[] {
    return this.calls.filter((call) => call.hook === hookName);
  }

  // Placement paths the dispatcher threaded into `onNodeStart` / `onNodeEnd`
  // for a given node, in fire order. The path is the last positional arg of
  // each hook (index 2 for nodeStart, index 3 for nodeEnd). Each path is
  // copied so callers see a stable snapshot rather than the live readonly view.
  pathsFor(hook: 'nodeStart' | 'nodeEnd', nodeName: string): readonly (readonly string[])[] {
    const pathIndex = hook === 'nodeStart' ? 2 : 3;
    return this.calls
      .filter((call) => call.hook === hook && call.args[0] === nodeName)
      .map((call) => {
        const raw = call.args[pathIndex];
        assert.ok(Array.isArray(raw), `args[${String(pathIndex)}] must be an array`);
        return raw.filter((e): e is string => typeof e === 'string');
      });
  }
}

// ── Three-node linear DAG used by several tests ──────────────────────────

const linearDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:linear',
  '@type':    'DAG',
  'name':       'linear',
  'version':    '1',
  'entrypoint': 'a',
  'nodes': [
    { '@id': 'urn:noocodex:dag:linear/node/a', '@type': 'SingleNode',
      'name': 'a', 'node': 'a', 'outputs': { 'success': 'b' } },
    { '@id': 'urn:noocodex:dag:linear/node/b', '@type': 'SingleNode',
      'name': 'b', 'node': 'b', 'outputs': { 'success': 'c' } },
    { '@id': 'urn:noocodex:dag:linear/node/c', '@type': 'SingleNode',
      'name': 'c', 'node': 'c', 'outputs': { 'success': 'end' } },
    { '@id': 'urn:noocodex:dag:linear/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// ── Nested DAG fixtures for placementPath threading ──────────────────────
//
// Three levels: pp-parent embeds pp-middle, which embeds pp-leaf. A single
// execution exercises empty / one-deep / two-deep placement paths.

// Innermost DAG: used as the inner placement inside `middleDAG`.
const leafDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-leaf',
  '@type': 'DAG',
  'name': 'pp-leaf',
  'version': '1',
  'entrypoint': 'leaf-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-leaf/node/leaf-step',
      '@type': 'SingleNode',
      'name':  'leaf-step',
      'node':  'leaf-step',
      'outputs': { 'done': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-leaf/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Middle DAG: wraps `leafDAG` so the leaf runs at depth 2 inside the parent.
const middleDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-middle',
  '@type': 'DAG',
  'name': 'pp-middle',
  'version': '1',
  'entrypoint': 'middle-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-middle/node/middle-step',
      '@type': 'SingleNode',
      'name':  'middle-step',
      'node':  'middle-step',
      'outputs': { 'next': 'run-leaf' },
    },
    {
      '@id':   'urn:noocodex:dag:pp-middle/node/run-leaf',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-leaf',
      'dag':   'pp-leaf',
      'outputs': { 'success': 'end', 'error': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-middle/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// Parent DAG: top-level placement, then one embedded-DAG (which itself
// nests another embedded-DAG). Used to assert empty / one-deep / two-deep
// paths in a single execution.
const placementParentDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':   'urn:noocodex:dag:pp-parent',
  '@type': 'DAG',
  'name': 'pp-parent',
  'version': '1',
  'entrypoint': 'top-step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:pp-parent/node/top-step',
      '@type': 'SingleNode',
      'name':  'top-step',
      'node':  'top-step',
      'outputs': { 'next': 'run-middle' },
    },
    {
      '@id':   'urn:noocodex:dag:pp-parent/node/run-middle',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-middle',
      'dag':   'pp-middle',
      'outputs': { 'success': 'end', 'error': 'end' },
    },
    { '@id': 'urn:noocodex:dag:pp-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
  ],
};

// ─────────────────────────────────────────────────────────────────────────

void describe('Dagonizer subclass hooks contract', () => {
  void it('runs end-to-end without subclass hooks (base protected hooks are no-ops)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('only', ['success']));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:noop-default',
      '@type':    'DAG',
      'name':       'noop-default',
      'version':    '1',
      'entrypoint': 'only',
      'nodes': [
        { '@id': 'urn:noocodex:dag:noop-default/node/only', '@type': 'SingleNode',
          'name': 'only', 'node': 'only', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:noop-default/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('noop-default', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'completed');
  });

  void it('fires onNodeStart and onNodeEnd in order across a 3-node DAG', async () => {
    const dispatcher = new RecordingDagonizer();

    dispatcher.registerNode(TestNode.make('a', ['success']));
    dispatcher.registerNode(TestNode.make('b', ['success']));
    dispatcher.registerNode(TestNode.make('c', ['success']));
    dispatcher.registerDAG(linearDAG);

    const result = await dispatcher.execute('linear', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'completed');

    const nodeStartNames = dispatcher.hooksOfType('nodeStart').map((c) => c.args[0]).filter((x): x is string => typeof x === 'string');
    const nodeEndNames   = dispatcher.hooksOfType('nodeEnd').map((c) => c.args[0]).filter((x): x is string => typeof x === 'string');
    assert.deepEqual(nodeStartNames, ['a', 'b', 'c', 'end']);
    assert.deepEqual(nodeEndNames,   ['a', 'b', 'c', 'end']);
  });

  void it('onFlowStart and onFlowEnd fire exactly once per top-level execute(), with no embedded-DAG re-entry', async () => {
    const dispatcher = new RecordingDagonizer();

    // Child DAG ----------------------------------------------------------
    const childDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inst-child',
      '@type':    'DAG',
      'name':       'inst-child',
      'version':    '1',
      'entrypoint': 'child-only',
      'nodes': [
        { '@id': 'urn:noocodex:dag:inst-child/node/child-only', '@type': 'SingleNode',
          'name': 'child-only', 'node': 'child-only', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:inst-child/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    // Parent DAG with an embedded-DAG placement ----------------------------
    const parentDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inst-parent',
      '@type':    'DAG',
      'name':       'inst-parent',
      'version':    '1',
      'entrypoint': 'parent-entry',
      'nodes': [
        { '@id': 'urn:noocodex:dag:inst-parent/node/parent-entry', '@type': 'SingleNode',
          'name': 'parent-entry', 'node': 'parent-entry', 'outputs': { 'success': 'run-child' } },
        { '@id': 'urn:noocodex:dag:inst-parent/node/run-child', '@type': 'EmbeddedDAGNode',
          'name': 'run-child', 'dag': 'inst-child',
          'outputs': { 'success': 'end', 'error': 'end' } },
        { '@id': 'urn:noocodex:dag:inst-parent/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    dispatcher.registerNode(TestNode.make('child-only',   ['success']));
    dispatcher.registerNode(TestNode.make('parent-entry', ['success']));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    await dispatcher.execute('inst-parent', new NodeStateBase());

    assert.equal(dispatcher.hooksOfType('flowStart').length, 1, 'onFlowStart fires exactly once');
    assert.equal(dispatcher.hooksOfType('flowEnd').length,   1, 'onFlowEnd fires exactly once');
    // Top-level flow hook is scoped to the parent DAG name
    assert.equal(dispatcher.hooksOfType('flowStart')[0]?.args[0], 'inst-parent');
    assert.equal(dispatcher.hooksOfType('flowEnd')[0]?.args[0],   'inst-parent');
  });

  void it('onError fires when a node throws', async () => {
    const dispatcher = new RecordingDagonizer();

    class BoomNode extends MonadicNode<NodeStateBase, 'success'> {
      readonly name = 'boom';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> {
        return { 'success': { 'type': 'object' } };
      }
      override async execute(_batch: Batch<NodeStateBase>): Promise<Map<'success', Batch<NodeStateBase>>> { throw new Error('boom went off'); }
    }
    dispatcher.registerNode(new BoomNode());

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inst-err',
      '@type':    'DAG',
      'name':       'inst-err',
      'version':    '1',
      'entrypoint': 'boom',
      'nodes': [
        { '@id': 'urn:noocodex:dag:inst-err/node/boom', '@type': 'SingleNode',
          'name': 'boom', 'node': 'boom', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:inst-err/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('inst-err', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'failed');

    const errors = dispatcher.hooksOfType('error');
    assert.equal(errors.length, 1, 'onError fires exactly once');
    assert.equal(errors[0]?.args[0], 'boom');
    const errorArg = errors[0]?.args[1];
    assert.ok(errorArg instanceof Error);
    assert.match(errorArg.message, /boom went off/);
  });

  void it('a throwing hook propagates and aborts the flow (hooks MUST NOT throw)', async () => {
    // The contract JSDoc warns subclasses not to throw from hooks. The
    // dispatcher does not wrap hook invocations in try/catch; a hook that
    // throws crashes the surrounding node execution. This test pins that
    // behavior so a future "swallow hook errors" change is an explicit
    // decision rather than a silent regression.
    class ThrowingDagonizer extends Dagonizer<NodeStateBase> {
      protected override onNodeStart(nodeName: string, _state: NodeStateBase, _placementPath: readonly string[]): void {
        throw new Error(`hook exploded on ${nodeName}`);
      }
    }

    const dispatcher = new ThrowingDagonizer();
    dispatcher.registerNode(TestNode.make('a', ['success']));
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inst-throw',
      '@type':    'DAG',
      'name':       'inst-throw',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:inst-throw/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'a', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:inst-throw/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    dispatcher.registerDAG(dag);

    // The thrown error escapes the run loop synchronously inside the
    // node iteration (onNodeStart is called outside the per-node try),
    // so awaiting execute() rejects rather than producing a result.
    // `Execution` is PromiseLike, not Promise, so wrap in an async fn
    // for assert.rejects.
    await assert.rejects(
      async () => { await dispatcher.execute('inst-throw', new NodeStateBase()); },
      /hook exploded on a/,
    );
  });

  void it('threads placementPath: empty for top-level nodes, single-element for one-deep, full path for two-deep', async () => {
    const dispatcher = new RecordingDagonizer();

    dispatcher.registerNode(TestNode.make('top-step',    ['next']));
    dispatcher.registerNode(TestNode.make('middle-step', ['next']));
    dispatcher.registerNode(TestNode.make('leaf-step',   ['done']));

    dispatcher.registerDAG(leafDAG);
    dispatcher.registerDAG(middleDAG);
    dispatcher.registerDAG(placementParentDAG);

    const result = await dispatcher.execute('pp-parent', new NodeStateBase());
    assert.equal(result.state.lifecycle.variant, 'completed');

    // top-step ran at the root of pp-parent: path is empty
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'top-step'),
      [[]],
      'top-step fires onNodeStart with empty placementPath',
    );
    assert.deepEqual(
      dispatcher.pathsFor('nodeEnd', 'top-step'),
      [[]],
      'top-step fires onNodeEnd with empty placementPath',
    );

    // run-middle is the embedded-DAG placement in pp-parent; its own
    // onNodeStart fires at the parent level so it too carries an empty path.
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'run-middle'),
      [[]],
      'run-middle (top-level placement) carries empty path',
    );

    // middle-step runs inside the run-middle placement: path is ['run-middle']
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'middle-step'),
      [['run-middle']],
      'middle-step carries one-deep placementPath',
    );

    // leaf-step lives inside run-leaf inside run-middle: full ancestry.
    assert.deepEqual(
      dispatcher.pathsFor('nodeStart', 'leaf-step'),
      [['run-middle', 'run-leaf']],
      'leaf-step carries the full two-deep placementPath',
    );
    assert.deepEqual(
      dispatcher.pathsFor('nodeEnd', 'leaf-step'),
      [['run-middle', 'run-leaf']],
      'leaf-step onNodeEnd matches the same two-deep path',
    );
  });

  void it('emits distinct placement paths for two embed placements pointing at the same inner DAG', async () => {
    // Mirrors the Archivist case: two embedded-DAG placements point at the
    // SAME inner DAG. The inner node fires twice, once per outer placement,
    // and each fire must carry its OWN outer name as the path so the
    // visualiser can disambiguate same-named inner nodes.

    const innerDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':   'urn:noocodex:dag:pp-shared-inner',
      '@type': 'DAG',
      'name': 'pp-shared-inner',
      'version': '1',
      'entrypoint': 'inner-step',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:pp-shared-inner/node/inner-step',
          '@type': 'SingleNode',
          'name':  'inner-step',
          'node':  'inner-step',
          'outputs': { 'done': 'end' },
        },
        { '@id': 'urn:noocodex:dag:pp-shared-inner/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    const twoInstancesDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':   'urn:noocodex:dag:pp-two-instances',
      '@type': 'DAG',
      'name': 'pp-two-instances',
      'version': '1',
      'entrypoint': 'first-embed',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:pp-two-instances/node/first-embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'first-embed',
          'dag':   'pp-shared-inner',
          'outputs': { 'success': 'second-embed', 'error': 'second-embed' },
        },
        {
          '@id':   'urn:noocodex:dag:pp-two-instances/node/second-embed',
          '@type': 'EmbeddedDAGNode',
          'name':  'second-embed',
          'dag':   'pp-shared-inner',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        { '@id': 'urn:noocodex:dag:pp-two-instances/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };

    const dispatcher = new RecordingDagonizer();

    dispatcher.registerNode(TestNode.make('inner-step', ['done']));
    dispatcher.registerDAG(innerDAG);
    dispatcher.registerDAG(twoInstancesDAG);

    await dispatcher.execute('pp-two-instances', new NodeStateBase());

    // inner-step fires once under `first-embed` and once under
    // `second-embed`. The path discriminates the two instances.
    const innerPaths = dispatcher.pathsFor('nodeStart', 'inner-step');
    assert.equal(innerPaths.length, 2, 'inner-step fires once per outer placement');
    assert.deepEqual(innerPaths[0], ['first-embed']);
    assert.deepEqual(innerPaths[1], ['second-embed']);
  });
});

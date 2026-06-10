import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultInterface } from '../../src/entities/execution/ExecutionResult.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeNode             = TestNode.make;
const makeNodeWithContract = TestNode.withContract;

// Recording Dagonizer subclass captures every hook invocation in order so
// tests can assert on the full call sequence rather than aggregate counts.
interface Call {
  readonly hook: string;
  readonly args: readonly unknown[];
}

class RecordingDagonizer extends Dagonizer<NodeStateBase> {
  readonly calls: Call[] = [];

  protected override onFlowStart(dagName: string, state: NodeStateBase): void {
    this.calls.push({ 'hook': 'flowStart', 'args': [dagName, state] });
  }
  protected override onFlowEnd(dagName: string, state: NodeStateBase, result: ExecutionResultInterface<NodeStateBase>): void {
    this.calls.push({ 'hook': 'flowEnd', 'args': [dagName, state, result] });
  }
  protected override onNodeStart(nodeName: string, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeStart', 'args': [nodeName, state, placementPath] });
  }
  protected override onNodeEnd(nodeName: string, output: string | null, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeEnd', 'args': [nodeName, output, state, placementPath] });
  }
  protected override onContractWarning(message: string): void {
    this.calls.push({ 'hook': 'contractWarning', 'args': [message] });
  }
  protected override onError(nodeName: string, error: Error, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'error', 'args': [nodeName, error, state, placementPath] });
  }

  hooksOfType(hookName: string): Call[] {
    return this.calls.filter((call) => call.hook === hookName);
  }
}

// ── Three-node linear DAG used by several tests ──────────────────────────

const linearDAG: DAG = {
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

// ─────────────────────────────────────────────────────────────────────────

void describe('Dagonizer subclass hooks contract', () => {
  void it('runs end-to-end without subclass hooks (base protected hooks are no-ops)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('only', ['success']));
    const dag: DAG = {
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
    assert.equal(result.state.lifecycle.kind, 'completed');
  });

  void it('fires onNodeStart and onNodeEnd in order across a 3-node DAG', async () => {
    const dispatcher = new RecordingDagonizer();

    dispatcher.registerNode(makeNode('a', ['success']));
    dispatcher.registerNode(makeNode('b', ['success']));
    dispatcher.registerNode(makeNode('c', ['success']));
    dispatcher.registerDAG(linearDAG);

    const result = await dispatcher.execute('linear', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');

    const nodeStartNames = dispatcher.hooksOfType('nodeStart').map((c) => c.args[0] as string);
    const nodeEndNames   = dispatcher.hooksOfType('nodeEnd').map((c) => c.args[0] as string);
    assert.deepEqual(nodeStartNames, ['a', 'b', 'c', 'end']);
    assert.deepEqual(nodeEndNames,   ['a', 'b', 'c', 'end']);
  });

  void it('onFlowStart and onFlowEnd fire exactly once per top-level execute(), with no embedded-DAG re-entry', async () => {
    const dispatcher = new RecordingDagonizer();

    // Child DAG ----------------------------------------------------------
    const childDAG: DAG = {
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
    const parentDAG: DAG = {
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

    dispatcher.registerNode(makeNode('child-only',   ['success']));
    dispatcher.registerNode(makeNode('parent-entry', ['success']));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    await dispatcher.execute('inst-parent', new NodeStateBase());

    assert.equal(dispatcher.hooksOfType('flowStart').length, 1, 'onFlowStart fires exactly once');
    assert.equal(dispatcher.hooksOfType('flowEnd').length,   1, 'onFlowEnd fires exactly once');
    // Top-level flow hook is scoped to the parent DAG name
    assert.equal(dispatcher.hooksOfType('flowStart')[0]?.args[0], 'inst-parent');
    assert.equal(dispatcher.hooksOfType('flowEnd')[0]?.args[0],   'inst-parent');
  });

  void it('onContractWarning fires when a contract-bearing DAG has a dead-write', () => {
    const dispatcher = new RecordingDagonizer();

    const rootNode = makeNodeWithContract('root', ['success'], { 'hardRequired': [], 'produces': ['input'] });
    const aNode    = makeNodeWithContract('a',    ['success'], { 'hardRequired': ['input'], 'produces': ['x', 'unused'] });
    const bNode    = makeNodeWithContract('b',    ['success'], { 'hardRequired': ['x'],     'produces': ['done'] });

    dispatcher.registerNode(rootNode);
    dispatcher.registerNode(aNode);
    dispatcher.registerNode(bNode);

    const dag = DAGDeriver.derive({
      'name':       'inst-warn',
      'version':    '1',
      'entrypoint': 'root',
      'nodes':      [rootNode, aNode, bNode],
    });
    dispatcher.registerDAG(dag);

    const warnings = dispatcher.hooksOfType('contractWarning').map((c) => c.args[0] as string);
    const deadWrite = warnings.find((w) => w.includes("'unused'"));
    assert.ok(deadWrite !== undefined, `expected dead-write warning; got: ${JSON.stringify(warnings)}`);
  });

  void it('onError fires when a node throws', async () => {
    const dispatcher = new RecordingDagonizer();

    const boomNode: NodeInterface<NodeStateBase> = {
      'name': 'boom',
      'outputs': ['success'],
      async execute() { throw new Error('boom went off'); },
    };
    dispatcher.registerNode(boomNode);

    const dag: DAG = {
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
    assert.equal(result.state.lifecycle.kind, 'failed');

    const errors = dispatcher.hooksOfType('error');
    assert.equal(errors.length, 1, 'onError fires exactly once');
    assert.equal(errors[0]?.args[0], 'boom');
    assert.ok(errors[0]?.args[1] instanceof Error);
    assert.match((errors[0]?.args[1] as Error).message, /boom went off/);
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
    dispatcher.registerNode(makeNode('a', ['success']));
    const dag: DAG = {
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
});

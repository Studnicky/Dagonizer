import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGDeriver } from '../../src/derive/DAGDeriver.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultInterface } from '../../src/entities/execution/ExecutionResult.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { NoopInstrumentation } from '../../src/runtime/NoopInstrumentation.js';
import { TestNode } from '../_support/TestNode.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeNode             = TestNode.make;
const makeNodeWithContract = TestNode.withContract;

// Recording instrumentation captures every hook invocation in order so
// tests can assert on the full call sequence rather than aggregate counts.
interface Call {
  readonly hook: string;
  readonly args: readonly unknown[];
}

class RecordingInstrumentation extends NoopInstrumentation<NodeStateBase> {
  readonly calls: Call[] = [];

  override flowStart(dagName: string, state: NodeStateBase): void {
    this.calls.push({ 'hook': 'flowStart', 'args': [dagName, state] });
  }
  override flowEnd(dagName: string, state: NodeStateBase, result: ExecutionResultInterface<NodeStateBase>): void {
    this.calls.push({ 'hook': 'flowEnd', 'args': [dagName, state, result] });
  }
  override nodeStart(dagName: string, nodeName: string, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeStart', 'args': [dagName, nodeName, state, placementPath] });
  }
  override nodeEnd(dagName: string, nodeName: string, output: string | null, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'nodeEnd', 'args': [dagName, nodeName, output, state, placementPath] });
  }
  override contractWarning(message: string): void {
    this.calls.push({ 'hook': 'contractWarning', 'args': [message] });
  }
  override error(dagName: string, nodeName: string, error: Error, state: NodeStateBase, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'error', 'args': [dagName, nodeName, error, state, placementPath] });
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
      'name': 'c', 'node': 'c', 'outputs': { 'success': null } },
  ],
};

// ─────────────────────────────────────────────────────────────────────────

void describe('Instrumentation contract', () => {
  void it('defaults to NoopInstrumentation when no option is supplied', async () => {
    // Constructor must accept omission of the instrumentation option and
    // the dispatcher must run end-to-end without observable side effects.
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
          'name': 'only', 'node': 'only', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('noop-default', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');
  });

  void it('fires nodeStart and nodeEnd in order across a 3-node DAG', async () => {
    const instrumentation = new RecordingInstrumentation();
    const dispatcher = new Dagonizer<NodeStateBase>({ instrumentation });

    dispatcher.registerNode(makeNode('a', ['success']));
    dispatcher.registerNode(makeNode('b', ['success']));
    dispatcher.registerNode(makeNode('c', ['success']));
    dispatcher.registerDAG(linearDAG);

    const result = await dispatcher.execute('linear', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'completed');

    const nodeStartNames = instrumentation.hooksOfType('nodeStart').map((c) => c.args[1] as string);
    const nodeEndNames   = instrumentation.hooksOfType('nodeEnd').map((c) => c.args[1] as string);
    assert.deepEqual(nodeStartNames, ['a', 'b', 'c']);
    assert.deepEqual(nodeEndNames,   ['a', 'b', 'c']);

    // Per-hook dagName carried correctly
    for (const call of instrumentation.hooksOfType('nodeStart')) {
      assert.equal(call.args[0], 'linear');
    }
  });

  void it('flowStart and flowEnd fire exactly once per top-level execute(), with no embedded-DAG re-entry', async () => {
    const instrumentation = new RecordingInstrumentation();
    const dispatcher = new Dagonizer<NodeStateBase>({ instrumentation });

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
          'name': 'child-only', 'node': 'child-only', 'outputs': { 'success': null } },
      ],
    };

    // Parent DAG with a embedded-DAG placement -------------------------------
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
          'outputs': { 'success': null, 'error': null } },
      ],
    };

    dispatcher.registerNode(makeNode('child-only',   ['success']));
    dispatcher.registerNode(makeNode('parent-entry', ['success']));
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(parentDAG);

    await dispatcher.execute('inst-parent', new NodeStateBase());

    assert.equal(instrumentation.hooksOfType('flowStart').length, 1, 'flowStart fires exactly once');
    assert.equal(instrumentation.hooksOfType('flowEnd').length,   1, 'flowEnd fires exactly once');
    // Top-level flow hook is scoped to the parent DAG name
    assert.equal(instrumentation.hooksOfType('flowStart')[0]?.args[0], 'inst-parent');
    assert.equal(instrumentation.hooksOfType('flowEnd')[0]?.args[0],   'inst-parent');
  });

  void it('contractWarning fires when a contract-bearing DAG has a dead-write', () => {
    const instrumentation = new RecordingInstrumentation();
    const dispatcher = new Dagonizer<NodeStateBase>({ instrumentation });

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

    const warnings = instrumentation.hooksOfType('contractWarning').map((c) => c.args[0] as string);
    const deadWrite = warnings.find((w) => w.includes("'unused'"));
    assert.ok(deadWrite !== undefined, `expected dead-write warning; got: ${JSON.stringify(warnings)}`);
  });

  void it('error fires when a node throws', async () => {
    const instrumentation = new RecordingInstrumentation();
    const dispatcher = new Dagonizer<NodeStateBase>({ instrumentation });

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
          'name': 'boom', 'node': 'boom', 'outputs': { 'success': null } },
      ],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('inst-err', new NodeStateBase());
    assert.equal(result.state.lifecycle.kind, 'failed');

    const errors = instrumentation.hooksOfType('error');
    assert.equal(errors.length, 1, 'error hook fires exactly once');
    assert.equal(errors[0]?.args[0], 'inst-err');
    assert.equal(errors[0]?.args[1], 'boom');
    assert.ok(errors[0]?.args[2] instanceof Error);
    assert.match((errors[0]?.args[2] as Error).message, /boom went off/);
  });

  void it('a throwing hook propagates and aborts the flow (documented rule: hooks MUST NOT throw)', async () => {
    // The contract JSDoc warns plugins not to throw. The dispatcher does
    // not wrap hook invocations in try/catch; a hook that throws crashes
    // the surrounding node execution. This test pins that behavior so a
    // future "swallow plugin errors" change is an explicit decision rather
    // than a silent regression.
    class ThrowingInstrumentation extends NoopInstrumentation<NodeStateBase> {
      override nodeStart(_dagName: string, nodeName: string, _state: NodeStateBase, _placementPath: readonly string[]): void {
        throw new Error(`hook exploded on ${nodeName}`);
      }
    }

    const dispatcher = new Dagonizer<NodeStateBase>({ 'instrumentation': new ThrowingInstrumentation() });
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
          'name': 'a', 'node': 'a', 'outputs': { 'success': null } },
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

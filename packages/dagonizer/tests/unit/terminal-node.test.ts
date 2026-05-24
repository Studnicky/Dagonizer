import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultInterface } from '../../src/entities/execution/ExecutionResult.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ── Observer subclass ─────────────────────────────────────────────────────

class CountingDagonizer<TState extends NodeStateBase> extends Dagonizer<TState> {
  flowStartCount = 0;
  flowEndCount   = 0;
  nodeStartNames: string[] = [];
  nodeEndNames:   string[] = [];

  protected override onFlowStart(_dagName: string, _state: TState): void {
    this.flowStartCount++;
  }

  protected override onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultInterface<TState>): void {
    this.flowEndCount++;
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    this.nodeStartNames.push(nodeName);
  }

  protected override onNodeEnd(nodeName: string, _output: string | undefined, _state: TState): void {
    this.nodeEndNames.push(nodeName);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'output': outputs[0] as string }; },
});

const makeErrorNode = (
  name: string,
): NodeInterface<NodeStateBase> => ({
  name,
  'outputs': ['done'],
  async execute(state) {
    state.collectError({
      'message':     'node failed',
      'code':        'ERR',
      'operation':   name,
      'recoverable': false,
      'timestamp':   new Date().toISOString(),
    });
    return { 'output': 'done' };
  },
});

// ── 1. Schema validation ──────────────────────────────────────────────────

void describe('TerminalNode — schema validation', () => {
  void it('accepts a well-formed TerminalNode object', () => {
    const valid = {
      '@id':     'urn:noocodex:dag:demo/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
    assert.equal(Validator.terminalNode.is(valid), true);
  });

  void it('accepts outcome=failed', () => {
    const valid = {
      '@id':     'urn:noocodex:dag:demo/node/fail',
      '@type':   'TerminalNode',
      'name':    'fail',
      'outcome': 'failed',
    };
    assert.equal(Validator.terminalNode.is(valid), true);
  });

  void it('rejects a TerminalNode missing outcome', () => {
    const noOutcome = {
      '@id':   'urn:noocodex:dag:demo/node/end',
      '@type': 'TerminalNode',
      'name':  'end',
    };
    assert.equal(Validator.terminalNode.is(noOutcome), false);
  });

  void it('rejects outcome=cancelled (not in enum)', () => {
    const badOutcome = {
      '@id':     'urn:noocodex:dag:demo/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'cancelled',
    };
    assert.equal(Validator.terminalNode.is(badOutcome), false);
  });

  void it('TerminalNode passes Validator.dag.is() when embedded in a DAG', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:demo',
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoint': 'end',
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:demo/node/end',
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
    assert.equal(Validator.dag.is(dag), true);
  });
});

// ── 2. Builder ────────────────────────────────────────────────────────────

void describe('TerminalNode — DAGBuilder.terminal()', () => {
  void it('produces a TerminalNode placement with @type and default outcome=completed', () => {
    const dag = new DAGBuilder('demo', '1')
      .node('a', makeNode('a', ['ok']), { 'ok': 'end' })
      .terminal('end')
      .build();

    const terminalPlacement = dag.nodes[1];
    assert.ok(terminalPlacement !== undefined, 'second node exists');
    assert.equal(terminalPlacement['@type'], 'TerminalNode');
    assert.equal((terminalPlacement as { outcome: string }).outcome, 'completed');
    assert.equal(terminalPlacement.name, 'end');
  });

  void it('produces a TerminalNode placement with outcome=failed', () => {
    const dag = new DAGBuilder('demo', '1')
      .node('a', makeNode('a', ['ok']), { 'ok': 'fail-end' })
      .terminal('fail-end', 'failed')
      .build();

    const terminalPlacement = dag.nodes[1];
    assert.ok(terminalPlacement !== undefined);
    assert.equal((terminalPlacement as { outcome: string }).outcome, 'failed');
  });
});

// ── 3. Execution — outcome=completed ─────────────────────────────────────

void describe('TerminalNode — execution with outcome=completed', () => {
  void it('state ends completed, executedNodes includes terminal, onFlowEnd fires once', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['ok']));

    const dag = new DAGBuilder('term-completed', '1')
      .node('a', makeNode('a', ['ok']), { 'ok': 'end' })
      .terminal('end', 'completed')
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('term-completed', state);

    assert.equal(result.state.lifecycle.kind, 'completed', 'lifecycle is completed');
    assert.ok(result.executedNodes.includes('a'),   'a is in executedNodes');
    assert.ok(result.executedNodes.includes('end'), 'end is in executedNodes');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fires once');
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fires once');
    assert.ok(dispatcher.nodeStartNames.includes('end'), 'onNodeStart fires for terminal');
    assert.ok(dispatcher.nodeEndNames.includes('end'),   'onNodeEnd fires for terminal');
  });
});

// ── 4. Execution — outcome=failed ─────────────────────────────────────────

void describe('TerminalNode — execution with outcome=failed', () => {
  void it('state ends failed when terminal has outcome=failed', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('a', ['ok']));

    const dag = new DAGBuilder('term-failed', '1')
      .node('a', makeNode('a', ['ok']), { 'ok': 'fail-end' })
      .terminal('fail-end', 'failed')
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('term-failed', state);

    assert.equal(result.state.lifecycle.kind, 'failed', 'lifecycle is failed');
    assert.ok(result.executedNodes.includes('fail-end'), 'terminal is in executedNodes');
  });
});

// ── 5. Embedded-DAG routing to null is now legal ───────────────────────────────

void describe('TerminalNode — embedded-DAG routing to null is legal', () => {
  const childDAG: DAG = {
    '@context': DAG_CONTEXT,
    '@id':      'urn:noocodex:dag:child-tn',
    '@type':    'DAG',
    'name':       'child-tn',
    'version':    '1',
    'entrypoint': 'child-step',
    'nodes': [
      {
        '@id':   'urn:noocodex:dag:child-tn/node/child-step',
        '@type': 'SingleNode',
        'name':  'child-step',
        'node':  'child-step',
        'outputs': { 'done': null },
      },
    ],
  };

  void it('doesNotThrow at registerDAG and completes cleanly', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('parent-entry', ['next']));
    dispatcher.registerNode(makeNode('child-step', ['done']));
    dispatcher.registerDAG(childDAG);

    const parentDAG: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:parent-tn',
      '@type':    'DAG',
      'name':       'parent-tn',
      'version':    '1',
      'entrypoint': 'parent-entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:parent-tn/node/parent-entry',
          '@type': 'SingleNode',
          'name':  'parent-entry',
          'node':  'parent-entry',
          'outputs': { 'next': 'run-child' },
        },
        {
          '@id':   'urn:noocodex:dag:parent-tn/node/run-child',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-child',
          'dag':   'child-tn',
          'outputs': { 'success': null, 'error': null },
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentDAG));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-tn', state);

    assert.equal(result.state.lifecycle.kind, 'completed', 'flow completes cleanly');
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fires exactly once');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fires exactly once');
  });
});

// ── 6. Embedded-DAG routing to a TerminalNode ─────────────────────────────────

void describe('TerminalNode — embedded-DAG routes to explicit TerminalNode placements', () => {
  const makeChildDAG = (emitError: boolean): DAG => ({
    '@context': DAG_CONTEXT,
    '@id':      'urn:noocodex:dag:child-explicit',
    '@type':    'DAG',
    'name':       'child-explicit',
    'version':    '1',
    'entrypoint': 'child-work',
    'nodes': [
      {
        '@id':   'urn:noocodex:dag:child-explicit/node/child-work',
        '@type': 'SingleNode',
        'name':  'child-work',
        'node':  emitError ? 'child-work-err' : 'child-work-ok',
        'outputs': { 'done': null },
      },
    ],
  });

  const buildParentWithTerminals = (): DAG => ({
    '@context': DAG_CONTEXT,
    '@id':      'urn:noocodex:dag:parent-explicit',
    '@type':    'DAG',
    'name':       'parent-explicit',
    'version':    '1',
    'entrypoint': 'run-child',
    'nodes': [
      {
        '@id':   'urn:noocodex:dag:parent-explicit/node/run-child',
        '@type': 'EmbeddedDAGNode',
        'name':  'run-child',
        'dag':   'child-explicit',
        'outputs': { 'success': 'end-ok', 'error': 'end-fail' },
      },
      {
        '@id':     'urn:noocodex:dag:parent-explicit/node/end-ok',
        '@type':   'TerminalNode',
        'name':    'end-ok',
        'outcome': 'completed',
      },
      {
        '@id':     'urn:noocodex:dag:parent-explicit/node/end-fail',
        '@type':   'TerminalNode',
        'name':    'end-fail',
        'outcome': 'failed',
      },
    ],
  });

  void it('ends completed when child emits no errors (routes to end-ok)', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('child-work-ok', ['done']));

    // Register child DAG with ok-node
    const childOk: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child-explicit',
      '@type':    'DAG',
      'name':       'child-explicit',
      'version':    '1',
      'entrypoint': 'child-work',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:child-explicit/node/child-work',
          '@type': 'SingleNode',
          'name':  'child-work',
          'node':  'child-work-ok',
          'outputs': { 'done': null },
        },
      ],
    };
    dispatcher.registerDAG(childOk);
    dispatcher.registerDAG(buildParentWithTerminals());

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-explicit', state);
    assert.equal(result.state.lifecycle.kind, 'completed', 'routes to end-ok → completed');
  });

  void it('ends failed when child emits errors (routes to end-fail)', async () => {
    // Use a fresh dispatcher to avoid shared child DAG name collision
    const dispatcher2 = new CountingDagonizer<NodeStateBase>();
    dispatcher2.registerNode(makeErrorNode('child-work-err'));

    const childErr: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child-explicit',
      '@type':    'DAG',
      'name':       'child-explicit',
      'version':    '1',
      'entrypoint': 'child-work',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:child-explicit/node/child-work',
          '@type': 'SingleNode',
          'name':  'child-work',
          'node':  'child-work-err',
          'outputs': { 'done': null },
        },
      ],
    };
    dispatcher2.registerDAG(childErr);
    dispatcher2.registerDAG(buildParentWithTerminals());

    const state = new NodeStateBase();
    const result = await dispatcher2.execute('parent-explicit', state);
    assert.equal(result.state.lifecycle.kind, 'failed', 'routes to end-fail → failed');
  });

  void it('makeChildDAG is defined (smoke test for helper)', () => {
    const dag = makeChildDAG(false);
    assert.equal(dag.name, 'child-explicit');
  });
});

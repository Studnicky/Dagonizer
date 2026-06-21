import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

// ── Observer subclass ─────────────────────────────────────────────────────

class CountingDagonizer<TState extends NodeStateBase> extends Dagonizer<TState> {
  flowStartCount = 0;
  flowEndCount   = 0;
  nodeStartNames: string[] = [];
  nodeEndNames:   string[] = [];

  protected override onFlowStart(_dagName: string, _state: TState): void {
    this.flowStartCount++;
  }

  protected override onFlowEnd(_dagName: string, _state: TState, _result: ExecutionResultType<TState>): void {
    this.flowEndCount++;
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    this.nodeStartNames.push(nodeName);
  }

  protected override onNodeEnd(nodeName: string, _output: string | null, _state: TState): void {
    this.nodeEndNames.push(nodeName);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

class TestErrorNode {
  private constructor() { /* static class */ }
  static of(nodeName: string): ScalarNode<NodeStateBase, 'done'> {
    class ErrorNode extends ScalarNode<NodeStateBase, 'done'> {
      readonly name = nodeName;
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }
      protected async executeOne(state: NodeStateBase): Promise<NodeOutputType<'done'>> {
        state.collectError({
          'code':        'ERR',
          'context':     {},
          'message':     'node failed',
          'operation':   nodeName,
          'recoverable': false,
          'timestamp':   new Date().toISOString(),
        });
        return { 'errors': [], 'output': 'done' as const };
      }
    }
    return new ErrorNode();
  }
}

// ── 1. Schema validation ──────────────────────────────────────────────────

void describe('TerminalNode: schema validation', () => {
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

  void it('rejects a SingleNode whose output value is null (null routes are schema-invalid)', () => {
    const bad: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:demo',
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoint': 's',
      'nodes': [{
        '@id':   'urn:noocodex:dag:demo/node/s',
        '@type': 'SingleNode',
        'name':  's', 'node': 's',
        'outputs': { 'done': null },
      }],
    };
    assert.equal(Validator.dag.is(bad), false, 'null route must fail schema validation');
  });
});

// ── 2. Builder ────────────────────────────────────────────────────────────

void describe('TerminalNode: DAGBuilder.terminal()', () => {
  void it('produces a TerminalNode placement with @type and default outcome=completed', () => {
    const dag = new DAGBuilder('demo', '1')
      .node('a', TestNode.make('a', ['ok'], () => 'ok'), { 'ok': 'end' })
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
      .node('a', TestNode.make('a', ['ok'], () => 'ok'), { 'ok': 'fail-end' })
      .terminal('fail-end', { 'outcome': 'failed' })
      .build();

    const terminalPlacement = dag.nodes[1];
    assert.ok(terminalPlacement !== undefined);
    assert.equal((terminalPlacement as { outcome: string }).outcome, 'failed');
  });
});

// ── 3. Execution: outcome=completed ──────────────────────────────────────

void describe('TerminalNode: execution with outcome=completed', () => {
  void it('state ends completed, executedNodes includes terminal, onFlowEnd fires once', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('a', ['ok'], () => 'ok'));

    const dag = new DAGBuilder('term-completed', '1')
      .node('a', TestNode.make('a', ['ok'], () => 'ok'), { 'ok': 'end' })
      .terminal('end', { 'outcome': 'completed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('term-completed', state);

    assert.equal(result.state.lifecycle.variant, 'completed', 'lifecycle is completed');
    assert.ok(result.executedNodes.includes('a'),   'a is in executedNodes');
    assert.ok(result.executedNodes.includes('end'), 'end is in executedNodes');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fires once');
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fires once');
    assert.ok(dispatcher.nodeStartNames.includes('end'), 'onNodeStart fires for terminal');
    assert.ok(dispatcher.nodeEndNames.includes('end'),   'onNodeEnd fires for terminal');
  });
});

// ── 4. Execution: outcome=failed ──────────────────────────────────────────

void describe('TerminalNode: execution with outcome=failed', () => {
  void it('state ends failed when terminal has outcome=failed', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('a', ['ok'], () => 'ok'));

    const dag = new DAGBuilder('term-failed', '1')
      .node('a', TestNode.make('a', ['ok'], () => 'ok'), { 'ok': 'fail-end' })
      .terminal('fail-end', { 'outcome': 'failed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('term-failed', state);

    assert.equal(result.state.lifecycle.variant, 'failed', 'lifecycle is failed');
    assert.ok(result.executedNodes.includes('fail-end'), 'terminal is in executedNodes');
  });
});

// ── 5. Embedded-DAG routing to explicit TerminalNode ─────────────────────────

void describe('TerminalNode: embedded-DAG routing to explicit TerminalNode', () => {
  const childDAG: DAGType = {
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
        'outputs': { 'done': 'end' },
      },
      {
        '@id':     'urn:noocodex:dag:child-tn/node/end',
        '@type':   'TerminalNode',
        'name':    'end',
        'outcome': 'completed',
      },
    ],
  };

  void it('registers and executes cleanly when child ends at an explicit TerminalNode', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('parent-entry', ['next'], () => 'next'));
    dispatcher.registerNode(TestNode.make('child-step', ['done'], () => 'done'));
    dispatcher.registerDAG(childDAG);

    const parentDAG: DAGType = {
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
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        {
          '@id':     'urn:noocodex:dag:parent-tn/node/end',
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentDAG));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-tn', state);

    assert.equal(result.state.lifecycle.variant, 'completed', 'flow completes cleanly');
    assert.equal(dispatcher.flowStartCount, 1, 'onFlowStart fires exactly once');
    assert.equal(dispatcher.flowEndCount,   1, 'onFlowEnd fires exactly once');
  });
});

// ── 6. Embedded-DAG routing to a TerminalNode ─────────────────────────────────

void describe('TerminalNode: embedded-DAG routes to explicit TerminalNode placements', () => {
  class TestParentWithTerminals {
    private constructor() { /* static class */ }
    static build(): DAGType {
      return {
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
      };
    }
  }

  void it('ends completed when child emits no errors (routes to end-ok)', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('child-work-ok', ['done'], () => 'done'));

    // Register child DAG with ok-node
    const childOk: DAGType = {
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
          'outputs': { 'done': 'end' },
        },
        { '@id': 'urn:noocodex:dag:child-explicit/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(childOk);
    dispatcher.registerDAG(TestParentWithTerminals.build());

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-explicit', state);
    assert.equal(result.state.lifecycle.variant, 'completed', 'routes to end-ok → completed');
  });

  void it('ends failed when child emits errors (routes to end-fail)', async () => {
    // Use a fresh dispatcher to avoid shared child DAG name collision
    const dispatcher2 = new CountingDagonizer<NodeStateBase>();
    dispatcher2.registerNode(TestErrorNode.of('child-work-err'));

    const childErr: DAGType = {
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
          'outputs': { 'done': 'end' },
        },
        { '@id': 'urn:noocodex:dag:child-explicit/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher2.registerDAG(childErr);
    dispatcher2.registerDAG(TestParentWithTerminals.build());

    const state = new NodeStateBase();
    const result = await dispatcher2.execute('parent-explicit', state);
    assert.equal(result.state.lifecycle.variant, 'failed', 'routes to end-fail → failed');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { ExecutionResultType } from '../../src/entities/execution/ExecutionResult.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;
const DEMO_DAG_IRI = 'urn:noocodec:dag:demo';
const DEMO_A_IRI = 'urn:noocodec:dag:demo/node/a';
const DEMO_END_IRI = 'urn:noocodec:dag:demo/node/end';
const DEMO_FAIL_END_IRI = 'urn:noocodec:dag:demo/node/fail-end';
const TERM_COMPLETED_DAG_IRI = 'urn:noocodec:dag:term-completed';
const TERM_COMPLETED_A_IRI = 'urn:noocodec:dag:term-completed/node/a';
const TERM_COMPLETED_END_IRI = 'urn:noocodec:dag:term-completed/node/end';
const TERM_FAILED_DAG_IRI = 'urn:noocodec:dag:term-failed';
const TERM_FAILED_A_IRI = 'urn:noocodec:dag:term-failed/node/a';
const TERM_FAILED_END_IRI = 'urn:noocodec:dag:term-failed/node/fail-end';
const CHILD_TN_DAG_IRI = 'urn:noocodec:dag:child-tn';
const PARENT_TN_DAG_IRI = 'urn:noocodec:dag:parent-tn';
const CHILD_EXPLICIT_DAG_IRI = 'urn:noocodec:dag:child-explicit';
const PARENT_EXPLICIT_DAG_IRI = 'urn:noocodec:dag:parent-explicit';

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
  static of(nodeName: string): MonadicNode<NodeStateBase, 'done'> {
    class ErrorNode extends MonadicNode<NodeStateBase, 'done'> {
      readonly '@id' = `urn:noocodec:node:${encodeURIComponent(nodeName)}`;
      readonly name = nodeName;
      readonly outputs = ['done'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'done': { 'type': 'object' } }; }
      override async execute(batch: Batch<NodeStateBase>): Promise<Map<'done', Batch<NodeStateBase>>> {
        const output: NodeOutputType<'done'> = {
          'errors': [{
          'code':        'ERR',
          'context':     {},
          'message':     'node failed',
          'operation':   nodeName,
          'recoverable': false,
          'timestamp':   new Date().toISOString(),
          }],
          'output': 'done',
        };
        for (const item of batch) {
          for (const error of output.errors) item.state.collectError(error);
        }
        return new Map([[output.output, batch]]);
      }
    }
    return new ErrorNode();
  }
}

// ── 1. Schema validation ──────────────────────────────────────────────────

void describe('TerminalNode: schema validation', () => {
  void it('accepts a well-formed TerminalNode object', () => {
    const valid = {
      '@id': 'urn:noocodec:dag:demo/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
    assert.equal(Validator.terminalNode.is(valid), true);
  });

  void it('accepts outcome=failed', () => {
    const valid = {
      '@id': 'urn:noocodec:dag:demo/node/fail',
      '@type':   'TerminalNode',
      'name':    'fail',
      'outcome': 'failed',
    };
    assert.equal(Validator.terminalNode.is(valid), true);
  });

  void it('rejects a TerminalNode missing outcome', () => {
    const noOutcome = {
      '@id': 'urn:noocodec:dag:demo/node/end',
      '@type': 'TerminalNode',
      'name':  'end',
    };
    assert.equal(Validator.terminalNode.is(noOutcome), false);
  });

  void it('rejects outcome=cancelled (not in enum)', () => {
    const badOutcome = {
      '@id': 'urn:noocodec:dag:demo/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'cancelled',
    };
    assert.equal(Validator.terminalNode.is(badOutcome), false);
  });

  void it('TerminalNode passes Validator.dag.is() when embedded in a DAG', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodec:dag:demo',
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoints': { 'main': 'end' },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:demo/node/end',
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
      '@id': 'urn:noocodec:dag:demo',
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoints': { 'main': 's' },
      'nodes': [{
        '@id': 'urn:noocodec:dag:demo/node/s',
        '@type': 'SingleNode',
        'name':  's', 'node': 'urn:noocodec:node:s',
        'outputs': { 'done': null },
      }],
    };
    assert.equal(Validator.dag.is(bad), false, 'null route must fail schema validation');
  });
});

// ── 2. Builder ────────────────────────────────────────────────────────────

void describe('TerminalNode: DAGBuilder.terminal()', () => {
  void it('produces a TerminalNode placement with @type and default outcome=completed', () => {
    const dag = new DAGBuilder(DEMO_DAG_IRI, '1', { 'name': 'demo' })
      .node(DEMO_A_IRI, TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'), { 'ok': DEMO_END_IRI }, { 'name': 'a' })
      .terminal(DEMO_END_IRI, { 'name': 'end' })
      .build();

    const terminalPlacement = dag.nodes[1];
    assert.ok(terminalPlacement !== undefined, 'second node exists');
    assert.equal(terminalPlacement['@type'], 'TerminalNode');
    assert.equal((terminalPlacement as { outcome: string }).outcome, 'completed');
    assert.equal(terminalPlacement.name, 'end');
  });

  void it('produces a TerminalNode placement with outcome=failed', () => {
    const dag = new DAGBuilder(DEMO_DAG_IRI, '1', { 'name': 'demo' })
      .node(DEMO_A_IRI, TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'), { 'ok': DEMO_FAIL_END_IRI }, { 'name': 'a' })
      .terminal(DEMO_FAIL_END_IRI, { 'name': 'fail-end', 'outcome': 'failed' })
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
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'));

    const dag = new DAGBuilder(TERM_COMPLETED_DAG_IRI, '1', { 'name': 'term-completed' })
      .node(TERM_COMPLETED_A_IRI, TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'), { 'ok': TERM_COMPLETED_END_IRI }, { 'name': 'a' })
      .terminal(TERM_COMPLETED_END_IRI, { 'name': 'end', 'outcome': 'completed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(TERM_COMPLETED_DAG_IRI, state);

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
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'));

    const dag = new DAGBuilder(TERM_FAILED_DAG_IRI, '1', { 'name': 'term-failed' })
      .node(TERM_FAILED_A_IRI, TestNode.make('urn:noocodec:node:a', ['ok'], () => 'ok'), { 'ok': TERM_FAILED_END_IRI }, { 'name': 'a' })
      .terminal(TERM_FAILED_END_IRI, { 'name': 'fail-end', 'outcome': 'failed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute(TERM_FAILED_DAG_IRI, state);

    assert.equal(result.state.lifecycle.variant, 'failed', 'lifecycle is failed');
    assert.ok(result.executedNodes.includes('fail-end'), 'terminal is in executedNodes');
  });
});

// ── 5. Embedded-DAG routing to explicit TerminalNode ─────────────────────────

void describe('TerminalNode: embedded-DAG routing to explicit TerminalNode', () => {
  const childDAG: DAGType = {
    '@context': DAG_CONTEXT,
    '@id': CHILD_TN_DAG_IRI,
    '@type':    'DAG',
    'name':       'child-tn',
    'version':    '1',
    'entrypoints': { 'main': placementIri(CHILD_TN_DAG_IRI, 'child-step') },
    'nodes': [
      {
        '@id': 'urn:noocodec:dag:child-tn/node/child-step',
        '@type': 'SingleNode',
        'name':  'child-step',
        'node':  'urn:noocodec:node:child-step',
        'outputs': { 'done': placementIri(CHILD_TN_DAG_IRI, 'end') },
      },
      {
        '@id': 'urn:noocodec:dag:child-tn/node/end',
        '@type':   'TerminalNode',
        'name':    'end',
        'outcome': 'completed',
      },
    ],
  };

  void it('registers and executes cleanly when child ends at an explicit TerminalNode', async () => {
    const dispatcher = new CountingDagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:parent-entry', ['next'], () => 'next'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:child-step', ['done'], () => 'done'));
    dispatcher.registerDAG(childDAG);

    const parentDAG: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': PARENT_TN_DAG_IRI,
      '@type':    'DAG',
      'name':       'parent-tn',
      'version':    '1',
      'entrypoints': { 'main': placementIri(PARENT_TN_DAG_IRI, 'parent-entry') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:parent-tn/node/parent-entry',
          '@type': 'SingleNode',
          'name':  'parent-entry',
          'node':  'urn:noocodec:node:parent-entry',
          'outputs': { 'next': placementIri(PARENT_TN_DAG_IRI, 'run-child') },
        },
        {
          '@id': 'urn:noocodec:dag:parent-tn/node/run-child',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-child',
          'dag':   CHILD_TN_DAG_IRI,
          'outputs': {
            'success': placementIri(PARENT_TN_DAG_IRI, 'end'),
            'error': placementIri(PARENT_TN_DAG_IRI, 'end'),
          },
        },
        {
          '@id': 'urn:noocodec:dag:parent-tn/node/end',
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };

    dispatcher.registerDAG(parentDAG);
    assert.ok(dispatcher.getDAG(PARENT_TN_DAG_IRI) !== undefined, 'parent DAG is registered');

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_TN_DAG_IRI, state);

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
        '@id': PARENT_EXPLICIT_DAG_IRI,
        '@type':    'DAG',
        'name':       'parent-explicit',
        'version':    '1',
        'entrypoints': { 'main': placementIri(PARENT_EXPLICIT_DAG_IRI, 'run-child') },
        'nodes': [
          {
            '@id': 'urn:noocodec:dag:parent-explicit/node/run-child',
            '@type': 'EmbeddedDAGNode',
            'name':  'run-child',
            'dag':   CHILD_EXPLICIT_DAG_IRI,
            'outputs': {
              'success': placementIri(PARENT_EXPLICIT_DAG_IRI, 'end-ok'),
              'error': placementIri(PARENT_EXPLICIT_DAG_IRI, 'end-fail'),
            },
          },
          {
            '@id': 'urn:noocodec:dag:parent-explicit/node/end-ok',
            '@type':   'TerminalNode',
            'name':    'end-ok',
            'outcome': 'completed',
          },
          {
            '@id': 'urn:noocodec:dag:parent-explicit/node/end-fail',
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
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:child-work-ok', ['done'], () => 'done'));

    // Register child DAG with ok-node
    const childOk: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': CHILD_EXPLICIT_DAG_IRI,
      '@type':    'DAG',
      'name':       'child-explicit',
      'version':    '1',
      'entrypoints': { 'main': placementIri(CHILD_EXPLICIT_DAG_IRI, 'child-work') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:child-explicit/node/child-work',
          '@type': 'SingleNode',
          'name':  'child-work',
          'node':  'urn:noocodec:node:child-work-ok',
          'outputs': { 'done': placementIri(CHILD_EXPLICIT_DAG_IRI, 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:child-explicit/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    dispatcher.registerDAG(childOk);
    dispatcher.registerDAG(TestParentWithTerminals.build());

    const state = new NodeStateBase();
    const result = await dispatcher.execute(PARENT_EXPLICIT_DAG_IRI, state);
    assert.equal(result.state.lifecycle.variant, 'completed', 'routes to end-ok → completed');
  });

  void it('ends failed when child reaches a failed terminal (routes to end-fail)', async () => {
    // A child author signals failure by routing to a `failed` terminal — that
    // terminal outcome is authoritative and routes the parent to `error`. The
    // node also collects a recoverable:false error, propagated to the parent
    // state for observability; the failed terminal, not the error, drives the
    // route. (The mirror case — a `completed` terminal that tolerated an error
    // still routing the parent to success — is covered in embedded-dag.test.ts.)
    const dispatcher2 = new CountingDagonizer<NodeStateBase>();
    dispatcher2.registerNode(TestErrorNode.of('child-work-err'));

    const childErr: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': CHILD_EXPLICIT_DAG_IRI,
      '@type':    'DAG',
      'name':       'child-explicit',
      'version':    '1',
      'entrypoints': { 'main': placementIri(CHILD_EXPLICIT_DAG_IRI, 'child-work') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:child-explicit/node/child-work',
          '@type': 'SingleNode',
          'name':  'child-work',
          'node':  'urn:noocodec:node:child-work-err',
          'outputs': { 'done': placementIri(CHILD_EXPLICIT_DAG_IRI, 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:child-explicit/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'failed' },
      ],
    };
    dispatcher2.registerDAG(childErr);
    dispatcher2.registerDAG(TestParentWithTerminals.build());

    const state = new NodeStateBase();
    const result = await dispatcher2.execute(PARENT_EXPLICIT_DAG_IRI, state);
    assert.equal(result.state.lifecycle.variant, 'failed', 'routes to end-fail → failed');
  });
});

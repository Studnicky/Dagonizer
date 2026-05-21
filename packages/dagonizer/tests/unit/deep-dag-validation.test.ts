import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { DAGError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'output': outputs[0] as string }; },
});

// ── DeepDAG used as a reusable component ─────────────────────────────────
const helperDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:helper',
  '@type':    'DAG',
  'name':       'helper',
  'version':    '1',
  'entrypoint': 'step',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:helper/node/step',
      '@type': 'SingleNode',
      'name':  'step',
      'node':  'step',
      'outputs': { 'done': null },
    },
  ],
};

void describe('registerDAG — deep-DAG terminal output invariant', () => {
  void it('throws DAGError when a deep-DAG placement routes any output to null', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerDAG(helperDAG);

    // Parent DAG where the deep-dag routes 'success' → null (forbidden)
    const parentWithBadDeepDag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bad-parent',
      '@type':    'DAG',
      'name':       'bad-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:bad-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:bad-parent/node/run-helper',
          '@type': 'DeepDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': { 'success': null },   // ← violation: deep-dag routes to END
        },
      ],
    };

    assert.throws(() => dispatcher.registerDAG(parentWithBadDeepDag), DAGError);

    let thrown: DAGError | undefined;
    try { dispatcher.registerDAG(parentWithBadDeepDag); } catch (e) { thrown = e as DAGError; }
    assert.ok(thrown !== undefined);
    assert.ok(thrown.message.includes('run-helper'), 'error includes placement name');
    assert.ok(thrown.message.includes('success'),    'error includes offending route name');
    assert.ok(thrown.message.includes('bad-parent'), 'error includes DAG name');
  });

  void it('throws when any output on a multi-output deep-DAG placement routes to null', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('terminal', ['done']));

    dispatcher.registerDAG(helperDAG);

    const parentWithPartialNull: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:partial-null-parent',
      '@type':    'DAG',
      'name':       'partial-null-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:partial-null-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:partial-null-parent/node/terminal',
          '@type': 'SingleNode',
          'name':  'terminal',
          'node':  'terminal',
          'outputs': { 'done': null },
        },
        {
          '@id':   'urn:noocodex:dag:partial-null-parent/node/run-helper',
          '@type': 'DeepDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': {
            'error':   'terminal',  // valid
            'success': null,        // ← violation
          },
        },
      ],
    };

    assert.throws(() => dispatcher.registerDAG(parentWithPartialNull), DAGError);

    let thrown: DAGError | undefined;
    try { dispatcher.registerDAG(parentWithPartialNull); } catch (e) { thrown = e as DAGError; }
    assert.ok(thrown !== undefined);
    assert.ok(thrown.message.includes('run-helper'));
    assert.ok(thrown.message.includes('success'));
  });

  void it('accepts valid deep-DAG placements where all outputs route to parent placements', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('terminal', ['done']));
    dispatcher.registerDAG(helperDAG);

    // All deep-dag outputs route to a real parent placement — no nulls
    const validParent: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:valid-parent',
      '@type':    'DAG',
      'name':       'valid-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/terminal',
          '@type': 'SingleNode',
          'name':  'terminal',
          'node':  'terminal',
          'outputs': { 'done': null },
        },
        {
          '@id':   'urn:noocodex:dag:valid-parent/node/run-helper',
          '@type': 'DeepDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': {
            'success': 'terminal',
            'error':   'terminal',
          },
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(validParent));
  });

  void it('rejects a DAG without @context, @id, @type fields', () => {
    // A flat (non-JSON-LD) DAG object must fail schema validation
    const flatDag = {
      'name':       'flat',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        { 'type': 'single', 'name': 'step', 'node': 'step', 'outputs': { 'done': null } },
      ],
    };
    assert.throws(() => Validator.dag.validate(flatDag));
  });

  void it('rejects a node placement using the old deep-dag discriminator string', () => {
    // Placements must use @type: 'DeepDAGNode', not the old flat type: 'deep-dag'
    const oldStylePlacement = {
      'type': 'deep-dag',
      'name': 'run-helper',
      'dag':  'helper',
      'outputs': { 'success': 'next', 'error': 'next' },
    };
    assert.equal(Validator.deepDAGNode.is(oldStylePlacement), false);
  });
});

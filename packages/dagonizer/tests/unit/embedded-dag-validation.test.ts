import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'output': outputs[0] as string }; },
});

// ── Sub-DAG used as a reusable component ─────────────────────────────────────
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

void describe('registerDAG: scatter/dag-body null-route acceptance', () => {
  void it('accepts scatter placement with success → null (sugar for terminate-completed)', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerDAG(helperDAG);

    // Parent DAG where the scatter (dag body) routes 'success' → null (terminate-completed)
    const parentWithNullScatter: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:null-parent',
      '@type':    'DAG',
      'name':       'null-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:null-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:null-parent/node/run-helper',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': { 'success': null, 'error': null },
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithNullScatter));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('null-parent', state);
    assert.equal(result.state.lifecycle.kind, 'completed', 'flow completes cleanly');
  });

  void it('accepts scatter with mixed null and explicit-target routes', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('after', ['done']));

    dispatcher.registerDAG(helperDAG);

    const parentWithMixedRoutes: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mixed-parent',
      '@type':    'DAG',
      'name':       'mixed-parent',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'next': 'run-helper' },
        },
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/after',
          '@type': 'SingleNode',
          'name':  'after',
          'node':  'after',
          'outputs': { 'done': null },
        },
        {
          '@id':   'urn:noocodex:dag:mixed-parent/node/run-helper',
          '@type': 'EmbeddedDAGNode',
          'name':  'run-helper',
          'dag':   'helper',
          'outputs': {
            'error':   'after',  // routes to a parent placement
            'success': null,     // terminate-completed
          },
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(parentWithMixedRoutes));

    const state = new NodeStateBase();
    const result = await dispatcher.execute('mixed-parent', state);
    assert.equal(result.state.lifecycle.kind, 'completed', 'flow completes cleanly');
  });

  void it('accepts valid scatter placements where all outputs route to parent placements', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('terminal', ['done']));
    dispatcher.registerDAG(helperDAG);

    // All scatter outputs route to a real parent placement; no nulls
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
          '@type': 'EmbeddedDAGNode',
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

  void it('rejects a node placement using the old discriminator string (not ScatterNode)', () => {
    // Placements must use @type: 'ScatterNode'; the old 'EmbeddedDAGNode' string is invalid.
    const oldStylePlacement = {
      '@id':   'urn:noocodex:dag:x/node/run-helper',
      '@type': 'EmbeddedDAGNode',
      'name':  'run-helper',
      'dag':   'helper',
      'outputs': { 'success': 'next', 'error': 'next' },
    };
    assert.equal(Validator.scatterNode.is(oldStylePlacement), false);
  });
});

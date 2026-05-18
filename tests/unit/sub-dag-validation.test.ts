import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { DAG } from '../../src/entities/index.js';
import { DAGError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

const makeNode = (
  name: string,
  outputs: readonly string[],
): NodeInterface<NodeStateBase> => ({
  name,
  outputs,
  async execute() { return { 'output': outputs[0] as string }; },
});

// ── Sub-DAG used as a reusable component ─────────────────────────────────
const helperDAG: DAG = {
  'name': 'helper',
  'version': '1',
  'entrypoint': 'step',
  'nodes': [
    { 'type': 'single', 'name': 'step', 'node': 'step', 'outputs': { 'done': null } },
  ],
};

void describe('registerDAG — sub-DAG terminal output invariant', () => {
  void it('throws DAGError when a sub-DAG placement routes any output to null', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerDAG(helperDAG);

    // Parent DAG where the sub-dag routes 'success' → null (forbidden)
    const parentWithBadSubDag: DAG = {
      'name': 'bad-parent',
      'version': '1',
      'entrypoint': 'entry',
      'nodes': [
        { 'type': 'single', 'name': 'entry', 'node': 'entry', 'outputs': { 'next': 'run-helper' } },
        {
          'type': 'sub-dag',
          'name': 'run-helper',
          'dag': 'helper',
          'outputs': { 'success': null },   // ← violation: sub-dag routes to END
        },
      ],
    };

    assert.throws(() => dispatcher.registerDAG(parentWithBadSubDag), DAGError);

    let thrown: DAGError | undefined;
    try { dispatcher.registerDAG(parentWithBadSubDag); } catch (e) { thrown = e as DAGError; }
    assert.ok(thrown !== undefined);
    assert.ok(thrown.message.includes('run-helper'), 'error includes placement name');
    assert.ok(thrown.message.includes('success'),    'error includes offending route name');
    assert.ok(thrown.message.includes('bad-parent'), 'error includes DAG name');
  });

  void it('throws when any output on a multi-output sub-dag placement routes to null', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('terminal', ['done']));

    // Sub-dag with two output routes: error → terminal (ok), success → null (violation)
    dispatcher.registerDAG(helperDAG);

    const parentWithPartialNull: DAG = {
      'name': 'partial-null-parent',
      'version': '1',
      'entrypoint': 'entry',
      'nodes': [
        { 'type': 'single', 'name': 'entry', 'node': 'entry', 'outputs': { 'next': 'run-helper' } },
        { 'type': 'single', 'name': 'terminal', 'node': 'terminal', 'outputs': { 'done': null } },
        {
          'type': 'sub-dag',
          'name': 'run-helper',
          'dag': 'helper',
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

  void it('accepts valid sub-DAG placements where all outputs route to parent placements', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(makeNode('step', ['done']));
    dispatcher.registerNode(makeNode('entry', ['next']));
    dispatcher.registerNode(makeNode('terminal', ['done']));
    dispatcher.registerDAG(helperDAG);

    // All sub-dag outputs route to a real parent placement — no nulls
    const validParent: DAG = {
      'name': 'valid-parent',
      'version': '1',
      'entrypoint': 'entry',
      'nodes': [
        { 'type': 'single', 'name': 'entry', 'node': 'entry', 'outputs': { 'next': 'run-helper' } },
        { 'type': 'single', 'name': 'terminal', 'node': 'terminal', 'outputs': { 'done': null } },
        {
          'type': 'sub-dag',
          'name': 'run-helper',
          'dag': 'helper',
          'outputs': {
            'success': 'terminal',
            'error':   'terminal',
          },
        },
      ],
    };

    assert.doesNotThrow(() => dispatcher.registerDAG(validParent));
  });
});

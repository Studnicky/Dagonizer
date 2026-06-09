import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import { DAGError, ValidationError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

const validDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:demo',
  '@type':    'DAG',
  'name': 'demo',
  'version': '1',
  'entrypoint': 's',
  'nodes': [
    { '@id': 'urn:noocodex:dag:demo/node/s', '@type': 'SingleNode',
      'name': 's', 'node': 'op', 'outputs': { 'success': null } },
  ],
};

void describe('Validator.dag', () => {
  void it('accepts a minimal valid DAG', () => {
    assert.equal(Validator.dag.is(validDAG), true);
    assert.deepEqual(Validator.dag.validate(validDAG), validDAG);
  });

  void it('rejects DAG with missing entrypoint field', () => {
    const bad = { ...validDAG };
    delete (bad as Partial<DAG>).entrypoint;
    assert.equal(Validator.dag.is(bad), false);
    assert.throws(() => Validator.dag.validate(bad), ValidationError);
  });

  void it('rejects a flat DAG missing @context, @id, @type', () => {
    // A flat (non-JSON-LD) DAG must fail schema validation
    const flat = {
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{ '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(flat), ValidationError);
  });

  void it('rejects unknown @type on a node placement', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{ '@id': 'urn:x', '@type': 'NotANodeType', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(bad), ValidationError);
  });

  void it('accepts a scatter node with a custom registered gather strategy name', () => {
    // GatherConfig.strategy is an open string: custom strategies are registered
    // via GatherStrategies.register() and resolved at runtime. The schema no longer
    // restricts strategy to a closed enum — unknown names are caught by
    // GatherStrategies.resolve() when the scatter executes, not at author time.
    const doc = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 'f',
      'nodes': [{
        '@id':    'urn:noocodex:dag:x/node/f',
        '@type':  'ScatterNode',
        'name':   'f', 'body': { 'node': 'op' }, 'source': 'items',
        'gather': { 'strategy': 'my-domain-specific-gather' },
        'outputs': { 'all-success': null },
      }],
    };
    assert.doesNotThrow(() => Validator.dag.validate(doc));
  });

  void it('returns formatted errors list without throwing', () => {
    const errs = Validator.dag.errors({});
    assert.ok(Array.isArray(errs));
    assert.ok(errs !== null && errs.length > 0);
  });
});

void describe('Dagonizer.load', () => {
  void it('parses + validates a JSON DAG', () => {
    const json = JSON.stringify(validDAG);
    const parsed = Dagonizer.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('rejects malformed JSON', () => {
    assert.throws(() => Dagonizer.load('{not json'), ValidationError);
  });

  void it('rejects schema-noncompliant JSON', () => {
    assert.throws(() => Dagonizer.load('{"name": "x"}'), ValidationError);
  });
});

void describe('Dagonizer.serialize round-trip', () => {
  void it('serialize → load yields the original DAG', () => {
    const json = Dagonizer.serialize(validDAG);
    const parsed = Dagonizer.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('serializeCompact omits whitespace', () => {
    const compact = Dagonizer.serializeCompact(validDAG);
    assert.equal(compact.includes('\n'), false);
  });
});

void describe('Dagonizer.registerDAG schema pre-pass', () => {
  void it('rejects schema-invalid DAGs with ValidationError, not DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(op);

    // Missing @context, @id, @type; fails schema pre-pass before semantic check.
    const bad = { 'name': 'x', 'entrypoint': 's', 'nodes': [
      { '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op', 'outputs': { 'success': null } },
    ] } as unknown as DAG;

    assert.throws(() => dispatcher.registerDAG(bad), ValidationError);
  });

  void it('semantic errors still surface as DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(op);

    // Schema-valid but references unknown node; semantic tier rejects.
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{ '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
        'name': 's', 'node': 'ghost', 'outputs': { 'success': null } }],
    };
    try {
      dispatcher.registerDAG(dag);
      assert.fail('expected registerDAG to throw');
    } catch (error) {
      assert.ok(error instanceof DAGError);
      assert.ok(!(error instanceof ValidationError));
    }
  });
});

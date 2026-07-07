import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGDocument } from '../../src/dag/DAGDocument.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { DAGErrorPredicate } from '../_support/DAGErrorPredicate.js';
import { TestNode } from '../_support/TestNode.js';

// validDAG: a minimal well-formed DAG — SingleNode routes to an explicit TerminalNode.
const validDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:demo',
  '@type':    'DAG',
  'name': 'demo',
  'version': '1',
  'entrypoint': 's',
  'nodes': [
    { '@id': 'urn:noocodex:dag:demo/node/s', '@type': 'SingleNode',
      'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
    { '@id': 'urn:noocodex:dag:demo/node/done', '@type': 'TerminalNode',
      'name': 'done', 'outcome': 'completed' },
  ],
};

void describe('Validator.dag', () => {
  void it('accepts a minimal valid DAG', () => {
    assert.equal(Validator.dag.is(validDAG), true);
    assert.deepEqual(Validator.dag.validate(validDAG), validDAG);
  });

  void it('rejects DAG with missing entrypoint field', () => {
    const bad = { ...validDAG };
    Reflect.deleteProperty(bad, 'entrypoint');
    assert.equal(Validator.dag.is(bad), false);
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('rejects a flat DAG missing @context, @id, @type', () => {
    // A flat (non-JSON-LD) DAG must fail schema validation
    const flat = {
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{ '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(flat), DAGErrorPredicate.isValidationError);
  });

  void it('rejects unknown @type on a node placement', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{ '@id': 'urn:x', '@type': 'NotANodeType', 'name': 's', 'node': 'op', 'outputs': {} }],
    };
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);
  });

  void it('rejects a SingleNode whose output value is null', () => {
    const bad: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op',
        'outputs': { 'success': null },
      }],
    };
    assert.equal(Validator.dag.is(bad), false, 'null route must fail schema validation');
    assert.throws(() => Validator.dag.validate(bad), DAGErrorPredicate.isValidationError);

    // A single null route and multiple null routes both fail schema validation:
    // null is never a valid output target, regardless of how many appear.
    const oneNull: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:test',
      '@type':    'DAG',
      'name':     'test',
      'version':  '1',
      'entrypoint': 'start',
      'nodes': [{
        '@id':   'urn:noocodex:dag:test/node/start',
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'start',
        'outputs': { 'done': null },
      }],
    };
    assert.equal(Validator.dag.is(oneNull), false, 'null output must not satisfy the schema');

    const multiNull: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:test',
      '@type':    'DAG',
      'name':     'test',
      'version':  '1',
      'entrypoint': 'start',
      'nodes': [{
        '@id':   'urn:noocodex:dag:test/node/start',
        '@type': 'SingleNode',
        'name':  'start',
        'node':  'start',
        'outputs': { 'ok': null, 'fail': null },
      }],
    };
    assert.equal(Validator.dag.is(multiNull), false, 'null outputs must not satisfy the schema');
  });

  void it('accepts a scatter node with a custom registered gather strategy name', () => {
    // GatherConfig.strategy is an open string: custom strategies are registered
    // via GatherStrategies.register() and resolved at runtime. The schema does
    // not restrict strategy to a closed enum — unknown names are caught by
    // GatherStrategies.resolve() when the scatter executes, not at author time.
    const doc = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 'f',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:x/node/f',
          '@type':  'ScatterNode',
          'name':   'f', 'body': { 'node': 'op' }, 'source': 'items',
          'gather': { 'strategy': 'my-domain-specific-gather' },
          'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
        },
        { '@id': 'urn:noocodex:dag:x/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed' },
      ],
    };
    assert.doesNotThrow(() => Validator.dag.validate(doc));
  });

  void it('returns formatted errors list without throwing', () => {
    const errs = Validator.dag.errors({});
    assert.ok(Array.isArray(errs));
    assert.ok(errs !== null && errs.length > 0);
  });
});

void describe('DAGDocument.load', () => {
  void it('parses + validates a JSON DAG', () => {
    const json = JSON.stringify(validDAG);
    const parsed = DAGDocument.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('rejects malformed JSON', () => {
    assert.throws(() => DAGDocument.load('{not json'), DAGErrorPredicate.isValidationError);
  });

  void it('rejects schema-noncompliant JSON', () => {
    assert.throws(() => DAGDocument.load('{"name": "x"}'), DAGErrorPredicate.isValidationError);
  });
});

void describe('DAGDocument.serialize round-trip', () => {
  void it('serialize → load yields the original DAG', () => {
    const json = DAGDocument.serialize(validDAG);
    const parsed = DAGDocument.load(json);
    assert.deepEqual(parsed, validDAG);
  });

  void it('serializeCompact omits whitespace', () => {
    const compact = DAGDocument.serializeCompact(validDAG);
    assert.equal(compact.includes('\n'), false);
  });
});

void describe('DAGDocument.ofValue', () => {
  void it('accepts an already-decoded valid DAG', () => {
    const result = DAGDocument.ofValue(validDAG);
    assert.deepEqual(result, validDAG);
  });

  void it('rejects schema-noncompliant value', () => {
    assert.throws(() => DAGDocument.ofValue({ 'name': 'x' }), DAGErrorPredicate.isValidationError);
  });
});

void describe('Dagonizer.registerDAG validation layers', () => {
  void it('leaves schema validation at the DAGDocument ingest boundary', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': '', 'version': '1', 'entrypoint': 's',
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(() => DAGDocument.ofValue(bad), DAGErrorPredicate.isValidationError);
  });

  void it('shape layer rejects entrypoint and route closure errors on hand-built DAGs', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 'missing',
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'ghost' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /Entrypoint 'missing' does not exist in nodes[\s\S]*output 'success' routes to unknown node 'ghost'/u,
    );
  });

  void it('shape layer rejects invalid embedded DAG selector shape before registry lookup', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:child',
      '@type':    'DAG',
      'name': 'child', 'version': '1', 'entrypoint': 'done',
      'nodes': [
        { '@id': 'urn:noocodex:dag:child/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    });

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 'invoke',
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/invoke', '@type': 'EmbeddedDAGNode',
          'name': 'invoke', 'dag': 'child', 'dagFrom': 'selectedDag',
          'outputs': { 'success': 'done', 'error': 'failed' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:x/node/failed', '@type': 'TerminalNode',
          'name': 'failed', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /EmbeddedDAGNode 'invoke': requires exactly one of dag or dagFrom, not both/u,
    );
  });

  void it('registry layer rejects unknown registered node references', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'ghost', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), /references unknown registered node: ghost/u);
  });

  void it('registry layer rejects missing registered-node output routes', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('op', ['success', 'error']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [
        { '@id': 'urn:noocodex:dag:x/node/s', '@type': 'SingleNode',
          'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
        { '@id': 'urn:noocodex:dag:x/node/done', '@type': 'TerminalNode',
          'name': 'done', 'outcome': 'completed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /registered node 'op' declares output 'error' but no routing is defined/u,
    );
  });
});

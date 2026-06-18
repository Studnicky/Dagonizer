import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScalarNode } from '../../src/core/ScalarNode.js';
import { DAGDocument } from '../../src/dag/DAGDocument.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import { DAGError, ValidationError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// validDAG: a minimal well-formed DAG — SingleNode routes to an explicit TerminalNode.
const validDAG: DAG = {
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

  void it('rejects a SingleNode whose output value is null', () => {
    const bad = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:x',
      '@type':    'DAG',
      'name': 'x', 'version': '1', 'entrypoint': 's',
      'nodes': [{
        '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op',
        'outputs': { 'success': null },
      }],
    } as unknown as DAG;
    assert.equal(Validator.dag.is(bad), false, 'null route must fail schema validation');
    assert.throws(() => Validator.dag.validate(bad), ValidationError);

    // A single null route and multiple null routes both fail schema validation:
    // null is never a valid output target, regardless of how many appear.
    const oneNull = {
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
    } as unknown as DAG;
    assert.equal(Validator.dag.is(oneNull), false, 'null output must not satisfy the schema');

    const multiNull = {
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
    } as unknown as DAG;
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
    assert.throws(() => DAGDocument.load('{not json'), ValidationError);
  });

  void it('rejects schema-noncompliant JSON', () => {
    assert.throws(() => DAGDocument.load('{"name": "x"}'), ValidationError);
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
    assert.throws(() => DAGDocument.ofValue({ 'name': 'x' }), ValidationError);
  });
});

void describe('Dagonizer.registerDAG schema pre-pass', () => {
  void it('rejects schema-invalid DAGs with ValidationError, not DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class OpNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'op';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
    }
    dispatcher.registerNode(new OpNode());

    // Constructs intentionally-invalid input: missing @context, @id, @type so the
    // schema pre-pass rejects it before the semantic check. The cast is necessary
    // because the object deliberately omits required DAG fields.
    const bad = { 'name': 'x', 'entrypoint': 's', 'nodes': [
      { '@id': 'urn:x', '@type': 'SingleNode', 'name': 's', 'node': 'op', 'outputs': { 'success': 'done' } },
      { '@id': 'urn:x/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' },
    ] } as unknown as DAG;

    assert.throws(() => dispatcher.registerDAG(bad), ValidationError);
  });

  void it('semantic errors still surface as DAGError', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class OpNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'op';
      readonly outputs = ['success'] as const;
      protected async executeOne(): Promise<NodeOutputInterface<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
    }
    dispatcher.registerNode(new OpNode());

    // Schema-valid but references unknown node; semantic tier rejects.
    // Uses a TerminalNode so the schema passes; DAGValidator catches the unknown node reference.
    const dag: DAG = {
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
    try {
      dispatcher.registerDAG(dag);
      assert.fail('expected registerDAG to throw');
    } catch (error) {
      assert.ok(error instanceof DAGError);
      assert.ok(!(error instanceof ValidationError));
    }
  });
});

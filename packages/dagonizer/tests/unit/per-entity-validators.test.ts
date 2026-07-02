import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Validator } from '../../src/validation/Validator.js';
import { DAGErrorPredicate } from '../_support/DAGErrorPredicate.js';

void describe('Validator per-entity sub-validators', () => {
  void it('Validator.node accepts a minimal Node', () => {
    assert.equal(Validator.node.is({ 'name': 'greet', 'outputs': ['done'] }), true);
  });

  void it('Validator.node rejects missing fields', () => {
    assert.throws(() => Validator.node.validate({ 'outputs': ['done'] }), DAGErrorPredicate.isValidationError);
  });

  void it('Validator.nodeContext accepts a wire shape', () => {
    assert.equal(
      Validator.nodeContext.is({ 'dagName': 'demo', 'nodeName': 'greet' }),
      true,
    );
  });

  void it('Validator.nodeOutput accepts a minimal output', () => {
    assert.equal(Validator.nodeOutput.is({ 'errors': [], 'output': 'success' }), true);
  });

  void it('Validator.scatterNode accepts a node-body scatter placement', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/scout',
        '@type':  'ScatterNode',
        'name':   'scout',
        'body':   { 'node': 'scoutOne' },
        'source': 'tasks',
        'gather': { 'strategy': 'append', 'target': 'results' },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      }),
      true,
    );
  });

  void it('Validator.scatterNode rejects a scatter with null output values', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/scout',
        '@type':  'ScatterNode',
        'name':   'scout',
        'body':   { 'node': 'scoutOne' },
        'source': 'tasks',
        'gather': { 'strategy': 'append', 'target': 'results' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }),
      false,
    );
  });

  void it('Validator.embeddedDAGNode accepts a dag-body embed placement', () => {
    assert.equal(
      Validator.embeddedDAGNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/enrich',
        '@type':  'EmbeddedDAGNode',
        'name':   'enrich',
        'dag':    'enrichment',
        'outputs': { 'success': 'end', 'error': 'end' },
      }),
      true,
    );
  });

  void it('Validator.embeddedDAGNode rejects null output values', () => {
    assert.equal(
      Validator.embeddedDAGNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/enrich',
        '@type':  'EmbeddedDAGNode',
        'name':   'enrich',
        'dag':    'enrichment',
        'outputs': { 'success': null, 'error': null },
      }),
      false,
    );
  });

  void it('Validator.scatterNode rejects a scatter without a source', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/transform',
        '@type':  'ScatterNode',
        'name':   'transform',
        'body':   { 'node': 'transformNode' },
        'gather': { 'strategy': 'map', 'mapping': { 'result': 'output' } },
        'outputs': { 'success': 'end', 'error': 'end' },
      }),
      false,
    );
  });

  void it('Validator.scatterNode accepts partition gather config', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/classify',
        '@type':  'ScatterNode',
        'name':   'classify',
        'body':   { 'node': 'classifyOne' },
        'source': 'items',
        'gather': {
          'strategy':   'partition',
          'partitions': { 'even': 'evens', 'odd': 'odds' },
        },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      }),
      true,
    );
  });

  void it('Validator.scatterNode accepts custom gather config', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/custom',
        '@type':  'ScatterNode',
        'name':   'custom',
        'body':   { 'node': 'processOne' },
        'source': 'items',
        'gather': { 'strategy': 'custom', 'customNode': 'mergeNode' },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      }),
      true,
    );
  });

  void it('Validator.scatterNode rejects missing body', () => {
    assert.throws(
      () => Validator.scatterNode.validate({
        '@id':    'urn:noocodex:dag:pipeline/node/broken',
        '@type':  'ScatterNode',
        'name':   'broken',
        'outputs': { 'success': 'end' },
      }),
      DAGErrorPredicate.isValidationError,
    );
  });

  void it('Validator.scatterNode rejects invalid body shape (no node or dag key)', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/broken',
        '@type':  'ScatterNode',
        'name':   'broken',
        'body':   { 'unknown': 'x' },
        'outputs': { 'success': 'end' },
      }),
      false,
    );
  });

  void it('Validator.singleNode accepts a placement with string output targets', () => {
    assert.equal(
      Validator.singleNode.is({
        '@id':   'urn:noocodex:dag:pipeline/node/greet',
        '@type': 'SingleNode',
        'name':  'greet',
        'node':  'greet',
        'outputs': { 'done': 'end' },
      }),
      true,
    );
  });

  void it('Validator.singleNode rejects a placement with null output values', () => {
    assert.equal(
      Validator.singleNode.is({
        '@id':   'urn:noocodex:dag:pipeline/node/greet',
        '@type': 'SingleNode',
        'name':  'greet',
        'node':  'greet',
        'outputs': { 'done': null },
      }),
      false,
    );
  });

  void it('Validator.executionResult accepts a run summary', () => {
    assert.equal(
      Validator.executionResult.is({
        'cursor': null,
        'executedNodes': ['a', 'b'],
        'skippedNodes': [],
        'state': {},
        'interruptedAt': null,
        'terminalOutcome': null,
      }),
      true,
    );
  });

  void it('Validator.dagLifecycleState accepts a wire-shape lifecycle record', () => {
    assert.equal(
      Validator.dagLifecycleState.is({
        'variant': 'pending',
        'startedAt': null,
        'finishedAt': null,
        'error': null,
        'reason': null,
        'correlationKey': null,
      }),
      true,
    );
  });

  void it('errors() returns formatted strings for invalid input', () => {
    const errors = Validator.node.errors({ 'outputs': ['done'] });
    assert.ok(Array.isArray(errors));
    assert.ok((errors ?? []).length > 0);
  });

  void it('errors() returns null for valid input', () => {
    assert.equal(Validator.node.errors({ 'name': 'greet', 'outputs': ['done'] }), null);
  });
});

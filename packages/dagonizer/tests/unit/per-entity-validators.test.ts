import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValidationError } from '../../src/errors/index.js';
import { Validator } from '../../src/validation/Validator.js';

void describe('Validator per-entity sub-validators', () => {
  void it('Validator.node accepts a minimal Node', () => {
    assert.equal(Validator.node.is({ 'name': 'greet', 'outputs': ['done'] }), true);
  });

  void it('Validator.node rejects missing fields', () => {
    assert.throws(() => Validator.node.validate({ 'outputs': ['done'] }), ValidationError);
  });

  void it('Validator.nodeContext accepts a wire shape', () => {
    assert.equal(
      Validator.nodeContext.is({ 'dagName': 'demo', 'nodeName': 'greet' }),
      true,
    );
  });

  void it('Validator.nodeOutput accepts a minimal output', () => {
    assert.equal(Validator.nodeOutput.is({ 'output': 'success' }), true);
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
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }),
      true,
    );
  });

  void it('Validator.embeddedDAGNode accepts a dag-body embed placement', () => {
    assert.equal(
      Validator.embeddedDAGNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/enrich',
        '@type':  'EmbeddedDAGNode',
        'name':   'enrich',
        'dag':    'enrichment',
        'outputs': { 'success': null, 'error': null },
      }),
      true,
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
        'outputs': { 'success': null, 'error': null },
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
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
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
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
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
        'outputs': { 'success': null },
      }),
      ValidationError,
    );
  });

  void it('Validator.scatterNode rejects invalid body shape (no node or dag key)', () => {
    assert.equal(
      Validator.scatterNode.is({
        '@id':    'urn:noocodex:dag:pipeline/node/broken',
        '@type':  'ScatterNode',
        'name':   'broken',
        'body':   { 'unknown': 'x' },
        'outputs': { 'success': null },
      }),
      false,
    );
  });

  void it('Validator.singleNode accepts a placement', () => {
    assert.equal(
      Validator.singleNode.is({
        '@id':   'urn:noocodex:dag:pipeline/node/greet',
        '@type': 'SingleNode',
        'name':  'greet',
        'node':  'greet',
        'outputs': { 'done': null },
      }),
      true,
    );
  });

  void it('Validator.parallelNode accepts a parallel placement', () => {
    assert.equal(
      Validator.parallelNode.is({
        '@id':     'urn:noocodex:dag:pipeline/node/group',
        '@type':   'ParallelNode',
        'name':    'group',
        'nodes':   ['a', 'b'],
        'combine': 'all-success',
        'outputs': { 'success': null, 'error': null },
      }),
      true,
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
      }),
      true,
    );
  });

  void it('Validator.dagLifecycleState accepts a wire-shape lifecycle record', () => {
    assert.equal(
      Validator.dagLifecycleState.is({
        'kind': 'pending',
        'startedAt': null,
        'finishedAt': null,
        'error': null,
        'reason': null,
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

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

  void it('Validator.fanInConfig accepts an append config', () => {
    assert.equal(
      Validator.fanInConfig.is({ 'strategy': 'append', 'target': 'results' }),
      true,
    );
  });

  void it('Validator.singleNode accepts a placement', () => {
    assert.equal(
      Validator.singleNode.is({
        'type': 'single',
        'name': 'greet',
        'node': 'greet',
        'outputs': { 'done': null },
      }),
      true,
    );
  });

  void it('Validator.parallelNode accepts a parallel placement', () => {
    assert.equal(
      Validator.parallelNode.is({
        'type': 'parallel',
        'name': 'fanout',
        'nodes': ['a', 'b'],
        'combine': 'all-success',
        'outputs': { 'success': null, 'error': null },
      }),
      true,
    );
  });

  void it('Validator.fanOutNode accepts a fan-out placement', () => {
    assert.equal(
      Validator.fanOutNode.is({
        'type': 'fan-out',
        'name': 'scout',
        'node': 'scoutOne',
        'source': 'tasks',
        'fanIn': { 'strategy': 'append', 'target': 'results' },
        'outputs': { 'all-success': null, 'partial': null, 'all-error': null, 'empty': null },
      }),
      true,
    );
  });

  void it('Validator.subDAGNode accepts a sub-dag placement', () => {
    assert.equal(
      Validator.subDAGNode.is({
        'type': 'sub-dag',
        'name': 'enrich',
        'dag': 'enrichment',
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

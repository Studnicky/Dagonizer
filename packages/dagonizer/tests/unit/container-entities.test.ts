/**
 * container-entities.test.ts
 *
 * Schema validation round-trips for W1 executor entities:
 *   ExecutionRequest, ExecutionResponse, ExecutorIntermediate.
 *
 * Each entity: valid shape passes, additionalProperties fails, missing-required fails.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ExecutionRequestSchema } from '../../src/entities/executor/ExecutionRequest.js';
import { ExecutionResponseSchema } from '../../src/entities/executor/ExecutionResponse.js';
import { ExecutorIntermediateSchema } from '../../src/entities/executor/ExecutorIntermediate.js';
import { sharedAjv } from '../../src/validation/sharedAjv.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// Compile local validators (per existing entity test pattern)
// ---------------------------------------------------------------------------

const requestValidator = (() => {
  const existing = sharedAjv.getSchema(ExecutionRequestSchema.$id);
  return existing ?? sharedAjv.compile(ExecutionRequestSchema);
})();

const responseValidator = (() => {
  const existing = sharedAjv.getSchema(ExecutionResponseSchema.$id);
  return existing ?? sharedAjv.compile(ExecutionResponseSchema);
})();

const intermediateValidator = (() => {
  const existing = sharedAjv.getSchema(ExecutorIntermediateSchema.$id);
  return existing ?? sharedAjv.compile(ExecutorIntermediateSchema);
})();

// ---------------------------------------------------------------------------
// ExecutorIntermediate
// ---------------------------------------------------------------------------

void describe('ExecutorIntermediate schema', () => {
  void it('accepts a valid intermediate (output string)', () => {
    assert.equal(
      intermediateValidator({ 'output': 'success', 'skipped': false, 'nodeName': 'increment' }),
      true,
    );
  });

  void it('accepts a valid intermediate (output null)', () => {
    assert.equal(
      intermediateValidator({ 'output': null, 'skipped': true, 'nodeName': 'phase-pre' }),
      true,
    );
  });

  void it('rejects additionalProperties', () => {
    assert.equal(
      intermediateValidator({ 'output': 'success', 'skipped': false, 'nodeName': 'x', 'extra': true }),
      false,
    );
  });

  void it('rejects missing required nodeName', () => {
    assert.equal(
      intermediateValidator({ 'output': 'success', 'skipped': false }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// ExecutionRequest
// ---------------------------------------------------------------------------

const validRequest = {
  'dagName':       'child',
  'placementPath': ['parent', 'embed'],
  'stateSnapshot': { 'metadata': {}, 'retries': {}, 'warnings': [] },
  'timeoutMs':     null,
  'correlationId': 'child:1',
};

void describe('ExecutionRequest schema', () => {
  void it('accepts a valid request', () => {
    assert.equal(requestValidator(validRequest), true);
  });

  void it('accepts timeoutMs as a number', () => {
    assert.equal(requestValidator({ ...validRequest, 'timeoutMs': 5000 }), true);
  });

  void it('rejects additionalProperties (kind field from old reference schema)', () => {
    assert.equal(requestValidator({ ...validRequest, 'kind': 'dag' }), false);
  });

  void it('rejects additionalProperties (nodeName field from old reference schema)', () => {
    assert.equal(requestValidator({ ...validRequest, 'nodeName': 'increment' }), false);
  });

  void it('rejects missing required dagName', () => {
     
    const { 'dagName': _dagName, ...rest } = validRequest;
    assert.equal(requestValidator(rest), false);
  });

  void it('rejects missing required correlationId', () => {

    const { 'correlationId': _correlationId, ...rest } = validRequest;
    assert.equal(requestValidator(rest), false);
  });

  void it('rejects empty dagName (minLength 1)', () => {
    assert.equal(requestValidator({ ...validRequest, 'dagName': '' }), false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionResponse
// ---------------------------------------------------------------------------

const validResponse = {
  'correlationId':  'child:1',
  'terminalOutput': 'success',
  'errors': [],
  'stateSnapshot': { 'metadata': {}, 'retries': {}, 'warnings': [], 'value': 10 },
  'intermediates': [
    { 'output': 'success', 'skipped': false, 'nodeName': 'increment' },
  ],
};

void describe('ExecutionResponse schema', () => {
  void it('accepts a valid response', () => {
    assert.equal(responseValidator(validResponse), true);
  });

  void it('accepts null stateSnapshot', () => {
    assert.equal(responseValidator({ ...validResponse, 'stateSnapshot': null }), true);
  });

  void it('accepts an error item in errors array', () => {
    const withError = {
      ...validResponse,
      'errors': [{
        'code': 'ERR_TRANSPORT',
        'message': 'timeout',
        'operation': 'runDag',
        'recoverable': false,
        'timestamp': new Date().toISOString(),
      }],
    };
    assert.equal(responseValidator(withError), true);
  });

  void it('rejects old output field name (should be terminalOutput)', () => {
     
    const { 'terminalOutput': _terminalOutput, ...rest } = validResponse;
    // Missing terminalOutput — add old `output` field instead
    assert.equal(responseValidator({ ...rest, 'output': 'success' }), false);
  });

  void it('rejects additionalProperties', () => {
    assert.equal(responseValidator({ ...validResponse, 'extra': true }), false);
  });

  void it('rejects missing required terminalOutput', () => {
     
    const { 'terminalOutput': _terminalOutput2, ...rest } = validResponse;
    assert.equal(responseValidator(rest), false);
  });
});

// ---------------------------------------------------------------------------
// Verify round-trip via Validator (if added — optional in W1)
// Ensure the schemas are accessible from the Validator module's shared Ajv
// by registering them if not already present.
// ---------------------------------------------------------------------------

void describe('Executor entity schemas are registered in sharedAjv', () => {
  void it('ExecutorIntermediateSchema is accessible by $id', () => {
    const v = sharedAjv.getSchema(ExecutorIntermediateSchema.$id);
    assert.ok(v !== undefined, 'ExecutorIntermediate schema not found in sharedAjv');
  });

  void it('ExecutionRequestSchema is accessible by $id', () => {
    const v = sharedAjv.getSchema(ExecutionRequestSchema.$id);
    assert.ok(v !== undefined, 'ExecutionRequest schema not found in sharedAjv');
  });

  void it('ExecutionResponseSchema is accessible by $id after compile', () => {
    const v = sharedAjv.getSchema(ExecutionResponseSchema.$id);
    assert.ok(v !== undefined, 'ExecutionResponse schema not found in sharedAjv');
  });
});

void describe('Validator.dag validates a well-formed DAG literal', () => {
  void it('Validator.dag.is accepts a minimal valid DAG and returns true', () => {
    const minimalDag: unknown = {
      '@context': { '@version': 1.1 },
      '@id': 'urn:noocodex:dag:cte-smoke',
      '@type': 'DAG',
      'name': 'cte-smoke',
      'version': '1',
      'entrypoint': 'step',
      'nodes': [{
        '@id': 'urn:noocodex:dag:cte-smoke/node/step',
        '@type': 'SingleNode',
        'name': 'step',
        'node': 'step',
        'outputs': { 'done': null },
      }],
    };
    assert.ok(Validator.dag.is(minimalDag), 'Validator.dag.is must return true for a valid DAG');
  });

  void it('Validator.dag.is rejects an object missing required fields', () => {
    assert.ok(!Validator.dag.is({ '@type': 'DAG' }), 'incomplete DAG must fail is() check');
  });
});

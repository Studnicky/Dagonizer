/**
 * wave3-coverage.test.ts
 *
 * Behavioral tests for new and changed surface added in Waves 1–2:
 *
 *   TST-W3-1: BridgeMessage inline shape structural identity
 *             (InlineNodeErrorShape ≡ NodeErrorSchema properties,
 *              InlineExecutionRequestShape ≡ ExecutionRequestSchema properties,
 *              InlineExecutionResponseShape ≡ ExecutionResponseSchema properties)
 *
 *   TST-W3-2: Validator.gatherConfig — valid/invalid/errors
 *   TST-W3-3: Validator.interruptionInfo — valid/invalid/errors
 *   TST-W3-4: Validator.openAiResponseBody — valid/invalid/errors
 *
 *   TST-W3-5: DAGIdentity.id and DAGIdentity.placementId canonical URN helpers
 *
 *   TST-W3-6: StoreError extends DAGError, code, classification preserved
 *
 *   TST-W3-7: BaseStore.connect / BaseStore.disconnect no-op defaults (MemoryStore)
 *
 *   TST-W3-8: NodeErrorBuilder.from positional signature and options bag
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';


import { DAGIdentity } from '../../src/entities/dag/DAG.js';
import { BridgeMessageSchema } from '../../src/entities/executor/BridgeMessage.js';
import { ExecutionRequestSchema } from '../../src/entities/executor/ExecutionRequest.js';
import { ExecutionResponseSchema } from '../../src/entities/executor/ExecutionResponse.js';
import { NodeErrorSchema, NodeErrorBuilder  } from '../../src/entities/node/NodeError.js';
import type { NodeErrorInterface } from '../../src/entities/node/NodeError.js';
import { DAGError, ValidationError  } from '../../src/errors/DAGError.js';
import { MemoryStore } from '../../src/store/MemoryStore.js';
import { StoreError } from '../../src/store/StoreError.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// TST-W3-1: BridgeMessage inline shape structural identity
// ---------------------------------------------------------------------------
//
// The inline shapes are embedded inside the BridgeMessageSchema oneOf branches.
// They are not exported as named constants, so we assert structural identity
// via validator round-trips: a value accepted by the canonical schema must
// also be accepted by the BridgeMessage branch that uses the corresponding
// inline shape, and vice versa.
//
// Tested via Validator.bridgeMessage round-trips because the inline shapes are
// private constants (not exported). This guards against silent drift between
// the inline copies and the canonical schemas.

void describe('TST-W3-1: BridgeMessage inline shapes — structural identity via validator round-trips', () => {
  // ── InlineNodeErrorShape ≡ NodeErrorSchema ───────────────────────────────

  void it('a value valid per NodeErrorSchema is accepted in the result.response.errors array', () => {
    const validNodeError = {
      'code': 'FETCH_FAILED',
      'context': {},
      'message': 'HTTP 503',
      'operation': 'fetchUser',
      'recoverable': true,
      'timestamp': '2024-01-01T00:00:00.000Z',
    };

    // Confirm the canonical NodeErrorSchema accepts it.
    assert.ok(Validator.nodeError.is(validNodeError),
      'canonical NodeErrorSchema must accept the fixture');

    // Confirm the inline shape inside BridgeMessage result.response.errors also accepts it.
    const resultMsg = {
      'kind': 'result',
      'response': {
        'correlationId': 'test-1',
        'items': [{ 'id': 'test-1', 'snapshot': null, 'terminalOutcome': 'completed' }],
        'errors': [validNodeError],
        'intermediates': [],
      },
    };
    assert.ok(Validator.bridgeMessage.is(resultMsg),
      'BridgeMessage result branch must accept a NodeError-valid errors entry');
  });

  void it('a NodeError with an extra property is rejected by both NodeErrorSchema and the inline shape', () => {
    const withExtra = {
      'code': 'ERR',
      'context': {},
      'message': 'fail',
      'operation': 'op',
      'recoverable': false,
      'timestamp': '2024-01-01T00:00:00.000Z',
      'extra': 'boom',   // additionalProperties: false must reject this
    };

    // Canonical schema rejects additionalProperties.
    assert.equal(Validator.nodeError.is(withExtra), false,
      'canonical NodeErrorSchema must reject extra property');

    // BridgeMessage result branch must also reject it via inline shape.
    const resultMsg = {
      'kind': 'result',
      'response': {
        'correlationId': 'test-2',
        'items': [{ 'id': 'test-2', 'snapshot': null, 'terminalOutcome': 'completed' }],
        'errors': [withExtra],
        'intermediates': [],
      },
    };
    assert.equal(Validator.bridgeMessage.is(resultMsg), false,
      'BridgeMessage result branch must reject extra property in errors entry (inline shape ≡ canonical)');
  });

  void it('a NodeError missing a required field is rejected by both schemas', () => {
    const missingTimestamp = {
      'code': 'ERR',
      'context': {},
      'message': 'fail',
      'operation': 'op',
      'recoverable': false,
      // timestamp omitted
    };

    assert.equal(Validator.nodeError.is(missingTimestamp), false,
      'canonical NodeErrorSchema must reject missing timestamp');

    const resultMsg = {
      'kind': 'result',
      'response': {
        'correlationId': 'test-3',
        'items': [{ 'id': 'test-3', 'snapshot': null, 'terminalOutcome': 'completed' }],
        'errors': [missingTimestamp],
        'intermediates': [],
      },
    };
    assert.equal(Validator.bridgeMessage.is(resultMsg), false,
      'BridgeMessage result branch must reject errors entry missing required field');
  });

  // ── InlineExecutionRequestShape ≡ ExecutionRequestSchema ────────────────

  void it('a value valid per ExecutionRequestSchema is accepted in the execute.request branch', () => {
    const validRequest = {
      'dagName': 'pipeline',
      'placementPath': ['parent', 'child'],
      'items': [{ 'id': 'corr-1', 'snapshot': { 'count': 0 } }],
      'timeoutMs': 5000,
      'correlationId': 'corr-1',
    };

    assert.ok(Validator.executionRequest.is(validRequest),
      'canonical ExecutionRequestSchema must accept the fixture');

    const executeMsg = {
      'kind': 'execute',
      'request': validRequest,
    };
    assert.ok(Validator.bridgeMessage.is(executeMsg),
      'BridgeMessage execute branch must accept an ExecutionRequest-valid request');
  });

  void it('a request with an extra field is rejected by both ExecutionRequestSchema and inline shape', () => {
    const withExtra = {
      'dagName': 'pipeline',
      'placementPath': [],
      'items': [{ 'id': 'corr-x', 'snapshot': {} }],
      'timeoutMs': null,
      'correlationId': 'corr-x',
      'nodeName': 'step1',   // additionalProperties: false must reject this
    };

    assert.equal(Validator.executionRequest.is(withExtra), false,
      'canonical ExecutionRequestSchema must reject extra nodeName field');

    const executeMsg = {
      'kind': 'execute',
      'request': withExtra,
    };
    assert.equal(Validator.bridgeMessage.is(executeMsg), false,
      'BridgeMessage execute branch must reject extra nodeName in request (inline shape ≡ canonical)');
  });

  // ── InlineExecutionResponseShape ≡ ExecutionResponseSchema ──────────────

  void it('a value valid per ExecutionResponseSchema is accepted in the result.response branch', () => {
    const validResponse = {
      'correlationId': 'corr-1',
      'items': [{ 'id': 'corr-1', 'snapshot': { 'done': true }, 'terminalOutcome': 'completed' }],
      'errors': [],
      'intermediates': [{ 'output': 'ok', 'skipped': false, 'nodeName': 'step1' }],
    };

    assert.ok(Validator.executionResponse.is(validResponse),
      'canonical ExecutionResponseSchema must accept the fixture');

    const resultMsg = {
      'kind': 'result',
      'response': validResponse,
    };
    assert.ok(Validator.bridgeMessage.is(resultMsg),
      'BridgeMessage result branch must accept an ExecutionResponse-valid response');
  });

  void it('a response with extra field on intermediate item is rejected by both', () => {
    const withExtra = {
      'correlationId': 'corr-2',
      'items': [{ 'id': 'corr-2', 'snapshot': null, 'terminalOutcome': 'failed' }],
      'errors': [],
      'intermediates': [{
        'output': 'done',
        'skipped': false,
        'nodeName': 'step1',
        'extra': 99,   // additionalProperties: false on items
      }],
    };

    assert.equal(Validator.executionResponse.is(withExtra), false,
      'canonical ExecutionResponseSchema must reject extra field on intermediates item');

    const resultMsg = {
      'kind': 'result',
      'response': withExtra,
    };
    assert.equal(Validator.bridgeMessage.is(resultMsg), false,
      'BridgeMessage result branch must reject extra field on intermediates item (inline shape ≡ canonical)');
  });

  // ── Schema property/required keys are identical ──────────────────────────

  void it('NodeErrorSchema and InlineNodeErrorShape declare the same required fields', () => {
    // Extract inline shape from BridgeMessageSchema. The result branch's
    // response.properties.errors.items is the InlineNodeErrorShape.
    const resultBranch = BridgeMessageSchema.oneOf.find(
      (b) => 'properties' in b && 'kind' in b.properties && 'const' in b.properties.kind && b.properties.kind.const === 'result',
    );
    assert.ok(resultBranch !== undefined, 'result branch must exist in BridgeMessageSchema.oneOf');

    const inlineErrShape = (resultBranch as {
      properties: { response: { properties: { errors: { items: { required: readonly string[] } } } } };
    }).properties.response.properties.errors.items;

    const canonicalRequired = [...NodeErrorSchema.required].sort();
    const inlineRequired    = [...inlineErrShape.required].sort();

    assert.deepEqual(
      inlineRequired,
      canonicalRequired,
      'InlineNodeErrorShape.required must match NodeErrorSchema.required',
    );
  });

  void it('ExecutionRequestSchema and InlineExecutionRequestShape declare the same required fields', () => {
    const executeBranch = BridgeMessageSchema.oneOf.find(
      (b) => 'properties' in b && 'kind' in b.properties && 'const' in b.properties.kind && b.properties.kind.const === 'execute',
    );
    assert.ok(executeBranch !== undefined, 'execute branch must exist in BridgeMessageSchema.oneOf');

    const inlineReqShape = (executeBranch as {
      properties: { request: { required: readonly string[] } };
    }).properties.request;

    const canonicalRequired = [...ExecutionRequestSchema.required].sort();
    const inlineRequired    = [...inlineReqShape.required].sort();

    assert.deepEqual(
      inlineRequired,
      canonicalRequired,
      'InlineExecutionRequestShape.required must match ExecutionRequestSchema.required',
    );
  });

  void it('ExecutionResponseSchema and InlineExecutionResponseShape declare the same required fields', () => {
    const resultBranch = BridgeMessageSchema.oneOf.find(
      (b) => 'properties' in b && 'kind' in b.properties && 'const' in b.properties.kind && b.properties.kind.const === 'result',
    );
    assert.ok(resultBranch !== undefined, 'result branch must exist in BridgeMessageSchema.oneOf');

    const inlineRespShape = (resultBranch as {
      properties: { response: { required: readonly string[] } };
    }).properties.response;

    const canonicalRequired = [...ExecutionResponseSchema.required].sort();
    const inlineRequired    = [...inlineRespShape.required].sort();

    assert.deepEqual(
      inlineRequired,
      canonicalRequired,
      'InlineExecutionResponseShape.required must match ExecutionResponseSchema.required',
    );
  });
});

// ---------------------------------------------------------------------------
// TST-W3-2: Validator.gatherConfig
// ---------------------------------------------------------------------------

void describe('TST-W3-2: Validator.gatherConfig', () => {
  void it('accepts a valid append config', () => {
    const valid = { 'strategy': 'append', 'target': 'results' };
    assert.ok(Validator.gatherConfig.is(valid),
      'append config with required target must be valid');
  });

  void it('accepts a valid map config', () => {
    const valid = {
      'strategy': 'map',
      'mapping': { 'cloneField': 'parentField' },
    };
    assert.ok(Validator.gatherConfig.is(valid),
      'map config with required mapping must be valid');
  });

  void it('accepts a valid partition config', () => {
    const valid = {
      'strategy': 'partition',
      'partitions': { 'even': 'evens', 'odd': 'odds' },
    };
    assert.ok(Validator.gatherConfig.is(valid),
      'partition config with required partitions must be valid');
  });

  void it('accepts a valid custom config', () => {
    const valid = { 'strategy': 'custom', 'customNode': 'mergeNode' };
    assert.ok(Validator.gatherConfig.is(valid),
      'custom config with required customNode must be valid');
  });

  void it('accepts a valid discard config (no extra fields required)', () => {
    const valid = { 'strategy': 'discard' };
    assert.ok(Validator.gatherConfig.is(valid),
      'discard config with strategy only must be valid');
  });

  void it('rejects a config missing the required strategy field', () => {
    const invalid = { 'target': 'results' };
    assert.equal(Validator.gatherConfig.is(invalid), false,
      'config without strategy must be invalid');
  });

  void it('validate() throws ValidationError for invalid input', () => {
    assert.throws(
      () => Validator.gatherConfig.validate({}),
      ValidationError,
      'validate() must throw ValidationError for missing strategy',
    );
  });

  void it('errors() returns non-null string array for invalid input', () => {
    const errs = Validator.gatherConfig.errors({});
    assert.ok(Array.isArray(errs) && (errs ?? []).length > 0,
      'errors() must return non-empty array for invalid input');
  });

  void it('errors() returns null for valid input', () => {
    assert.equal(
      Validator.gatherConfig.errors({ 'strategy': 'discard' }),
      null,
      'errors() must return null for valid input',
    );
  });

  void it('rejects an append config missing the required target', () => {
    const invalid = { 'strategy': 'append' };  // append requires target
    assert.equal(Validator.gatherConfig.is(invalid), false,
      'append strategy without target must be invalid');
  });

  void it('rejects a config with additionalProperties', () => {
    const invalid = {
      'strategy': 'discard',
      'unknownField': true,
    };
    assert.equal(Validator.gatherConfig.is(invalid), false,
      'config with unknown field must be rejected by additionalProperties: false');
  });
});

// ---------------------------------------------------------------------------
// TST-W3-3: Validator.interruptionInfo
// ---------------------------------------------------------------------------

void describe('TST-W3-3: Validator.interruptionInfo', () => {
  void it('accepts a valid abort interruption', () => {
    const valid = { 'nodeName': 'fetchUser', 'reason': 'abort' };
    assert.ok(Validator.interruptionInfo.is(valid),
      'abort interruption must be valid');
  });

  void it('accepts a valid timeout interruption', () => {
    const valid = { 'nodeName': 'enrichData', 'reason': 'timeout' };
    assert.ok(Validator.interruptionInfo.is(valid),
      'timeout interruption must be valid');
  });

  void it('rejects an unknown reason', () => {
    const invalid = { 'nodeName': 'step1', 'reason': 'cancelled' };
    assert.equal(Validator.interruptionInfo.is(invalid), false,
      'unknown reason must be rejected');
  });

  void it('rejects missing nodeName', () => {
    const invalid = { 'reason': 'abort' };
    assert.equal(Validator.interruptionInfo.is(invalid), false,
      'missing nodeName must be rejected');
  });

  void it('rejects empty nodeName (minLength: 1)', () => {
    const invalid = { 'nodeName': '', 'reason': 'abort' };
    assert.equal(Validator.interruptionInfo.is(invalid), false,
      'empty nodeName must be rejected');
  });

  void it('validate() throws ValidationError for invalid input', () => {
    assert.throws(
      () => Validator.interruptionInfo.validate({ 'nodeName': 'step1', 'reason': 'invalid-reason' }),
      ValidationError,
      'validate() must throw ValidationError for unknown reason',
    );
  });

  void it('errors() returns non-null for invalid input', () => {
    const errs = Validator.interruptionInfo.errors({ 'reason': 'abort' });
    assert.ok(Array.isArray(errs) && (errs ?? []).length > 0,
      'errors() must return non-empty array for missing nodeName');
  });

  void it('errors() returns null for valid input', () => {
    assert.equal(
      Validator.interruptionInfo.errors({ 'nodeName': 'step', 'reason': 'timeout' }),
      null,
      'errors() must return null for valid input',
    );
  });
});

// ---------------------------------------------------------------------------
// TST-W3-4: Validator.openAiResponseBody
// ---------------------------------------------------------------------------

void describe('TST-W3-4: Validator.openAiResponseBody', () => {
  void it('accepts a minimal valid response (no choices, no usage)', () => {
    // Schema uses all-optional top-level fields (permissive for provider variation).
    const valid = {};
    assert.ok(Validator.openAiResponseBody.is(valid),
      'empty object must be valid (all top-level fields optional)');
  });

  void it('accepts a full valid response with choices and usage', () => {
    const valid = {
      'choices': [{
        'message': { 'content': 'Hello', 'tool_calls': [] },
        'finish_reason': 'stop',
      }],
      'usage': {
        'prompt_tokens': 10,
        'completion_tokens': 5,
      },
    };
    assert.ok(Validator.openAiResponseBody.is(valid),
      'full response with choices and usage must be valid');
  });

  void it('rejects a non-object (string)', () => {
    assert.equal(Validator.openAiResponseBody.is('not an object'), false,
      'string value must be rejected (must be object)');
  });

  void it('rejects choices that is a string instead of array', () => {
    const invalid = { 'choices': 'not-an-array' };
    assert.equal(Validator.openAiResponseBody.is(invalid), false,
      'choices must be an array, not a string');
  });

  void it('validate() throws ValidationError for a non-object body', () => {
    assert.throws(
      () => Validator.openAiResponseBody.validate(42),
      ValidationError,
      'validate() must throw ValidationError for non-object input',
    );
  });

  void it('errors() returns non-null for invalid input', () => {
    const errs = Validator.openAiResponseBody.errors('string-body');
    assert.ok(Array.isArray(errs) && (errs ?? []).length > 0,
      'errors() must return non-empty array for invalid input');
  });

  void it('errors() returns null for valid input', () => {
    assert.equal(
      Validator.openAiResponseBody.errors({}),
      null,
      'errors() must return null for valid input',
    );
  });
});

// ---------------------------------------------------------------------------
// TST-W3-5: DAGIdentity.id and DAGIdentity.placementId canonical URN helpers
// ---------------------------------------------------------------------------

void describe('TST-W3-5: DAGIdentity.id and DAGIdentity.placementId URN helpers', () => {
  void it('DAGIdentity.id produces the canonical DAG URN', () => {
    assert.equal(DAGIdentity.id('demo'), 'urn:noocodex:dag:demo');
  });

  void it('DAGIdentity.placementId produces the canonical placement URN', () => {
    assert.equal(DAGIdentity.placementId('demo', 'increment'), 'urn:noocodex:dag:demo/node/increment');
  });

  void it('DAGIdentity.id handles names with hyphens and underscores', () => {
    assert.equal(DAGIdentity.id('my-workflow_v2'), 'urn:noocodex:dag:my-workflow_v2');
  });

  void it('DAGIdentity.placementId handles multi-word placement names', () => {
    assert.equal(
      DAGIdentity.placementId('pipeline', 'fetch-data'),
      'urn:noocodex:dag:pipeline/node/fetch-data',
    );
  });

  void it('DAGIdentity (namespace object) is frozen — mutations are silently ignored', () => {
    // Object.freeze means assignment to an existing property is a no-op (strict:
    // TypeError in strict mode, silently ignored otherwise). Verify the property
    // values are unchanged.
    const originalId = DAGIdentity.id;
    try {
      // This assignment will throw in strict mode; catch it so the test continues.
      (DAGIdentity as Record<string, unknown>)['id'] = 'mutated';
    } catch {
      // Expected in strict mode.
    }
    assert.strictEqual(DAGIdentity.id, originalId,
      'frozen DAGIdentity namespace must not allow mutation of id helper');
  });
});

// ---------------------------------------------------------------------------
// TST-W3-6: StoreError extends DAGError — code and classification
// ---------------------------------------------------------------------------

void describe('TST-W3-6: StoreError extends DAGError', () => {
  void it('StoreError is instanceof DAGError', () => {
    const err = new StoreError('backing failed', {
      'reason': 'BACKING_ERROR',
      'cause': new Error('redis timeout'),
    });
    assert.ok(err instanceof DAGError,
      'StoreError must be instanceof DAGError');
  });

  void it('StoreError.code equals STORE_ERROR', () => {
    const err = new StoreError('something went wrong', {
      'reason': 'KEY_NOT_FOUND',
      'key': 'missing-key',
    });
    assert.equal(err.code, 'STORE_ERROR',
      'StoreError must carry code STORE_ERROR');
  });

  void it('classification field is preserved for KEY_NOT_FOUND', () => {
    const err = new StoreError('key missing', {
      'reason': 'KEY_NOT_FOUND',
      'key': 'user:42',
    });
    assert.equal(err.classification.reason, 'KEY_NOT_FOUND');
    if (err.classification.reason === 'KEY_NOT_FOUND') {
      assert.equal(err.classification.key, 'user:42');
    }
  });

  void it('classification field is preserved for BACKING_ERROR', () => {
    const cause = new Error('connection refused');
    const err = new StoreError('redis down', {
      'reason': 'BACKING_ERROR',
      'cause': cause,
    });
    assert.equal(err.classification.reason, 'BACKING_ERROR');
    if (err.classification.reason === 'BACKING_ERROR') {
      assert.strictEqual(err.classification.cause, cause);
    }
  });

  void it('classification field is preserved for LEASE_DENIED', () => {
    const err = new StoreError('lease denied', {
      'reason': 'LEASE_DENIED',
      'subject': 'dag:pipeline:run-42',
      'holder': 'worker-7',
    });
    assert.equal(err.classification.reason, 'LEASE_DENIED');
    if (err.classification.reason === 'LEASE_DENIED') {
      assert.equal(err.classification.subject, 'dag:pipeline:run-42');
      assert.equal(err.classification.holder, 'worker-7');
    }
  });

  void it('classification field is preserved for INCOMPATIBLE_SNAPSHOT', () => {
    const err = new StoreError('incompatible snapshot', {
      'reason': 'INCOMPATIBLE_SNAPSHOT',
      'expectedType': 'memory-store',
      'actualType': 'redis-store',
      'expectedVersion': 1,
      'actualVersion': 2,
    });
    assert.equal(err.classification.reason, 'INCOMPATIBLE_SNAPSHOT');
    if (err.classification.reason === 'INCOMPATIBLE_SNAPSHOT') {
      assert.equal(err.classification.expectedType, 'memory-store');
      assert.equal(err.classification.actualType, 'redis-store');
      assert.equal(err.classification.expectedVersion, 1);
      assert.equal(err.classification.actualVersion, 2);
    }
  });

  void it('StoreError inherits DAGError.toJSON() shape', () => {
    const err = new StoreError('test', {
      'reason': 'KEY_NOT_FOUND',
      'key': 'x',
    });
    const json = err.toJSON();
    assert.equal(json.code, 'STORE_ERROR');
    assert.ok(typeof json.timestamp === 'string' && json.timestamp.length > 0,
      'toJSON must include ISO timestamp');
  });
});

// ---------------------------------------------------------------------------
// TST-W3-7: BaseStore.connect / disconnect no-op defaults (MemoryStore)
// ---------------------------------------------------------------------------

void describe('TST-W3-7: BaseStore.connect / disconnect no-op defaults', () => {
  void it('MemoryStore.connect() resolves without error', async () => {
    const store = new MemoryStore();
    await assert.doesNotReject(
      () => store.connect(),
      'connect() must resolve without error (no-op default)',
    );
  });

  void it('MemoryStore.disconnect() resolves without error', async () => {
    const store = new MemoryStore();
    await assert.doesNotReject(
      () => store.disconnect(),
      'disconnect() must resolve without error (no-op default)',
    );
  });

  void it('connect() then disconnect() leave the store operational', async () => {
    const store = new MemoryStore();
    await store.connect();
    await store.set('key', 'value');
    assert.equal(await store.get('key'), 'value');
    await store.disconnect();
    // Store remains readable after disconnect (in-memory; no actual teardown).
    assert.equal(await store.get('key'), 'value',
      'store must remain operational after no-op disconnect');
  });

  void it('connect() is idempotent (multiple calls resolve without error)', async () => {
    const store = new MemoryStore();
    await assert.doesNotReject(async () => {
      await store.connect();
      await store.connect();
    }, 'multiple connect() calls must all resolve without error');
  });

  void it('disconnect() is idempotent (multiple calls resolve without error)', async () => {
    const store = new MemoryStore();
    await store.connect();
    await assert.doesNotReject(async () => {
      await store.disconnect();
      await store.disconnect();
    }, 'multiple disconnect() calls must all resolve without error');
  });
});

// ---------------------------------------------------------------------------
// TST-W3-8: NodeErrorBuilder.from positional signature
// ---------------------------------------------------------------------------

void describe('TST-W3-8: NodeErrorBuilder.from positional signature', () => {
  void it('fills context: {} by default when options bag is omitted', () => {
    const err = NodeErrorBuilder.from(
      'CODE',
      'msg',
      'op',
      false,
      '2020-01-01T00:00:00Z',
    );
    assert.deepEqual(err.context, {},
      'context must default to {} when options bag is omitted');
  });

  void it('fills context: {} by default when options bag is empty', () => {
    const err = NodeErrorBuilder.from(
      'CODE',
      'msg',
      'op',
      false,
      '2020-01-01T00:00:00Z',
      {},
    );
    assert.deepEqual(err.context, {},
      'context must default to {} when options bag provides no context');
  });

  void it('honors the context when provided in the options bag', () => {
    const ctx = { 'field': 'email', 'value': null };
    const err = NodeErrorBuilder.from(
      'VALIDATION_ERROR',
      'missing required field',
      'validate',
      false,
      '2020-01-01T00:00:00Z',
      { 'context': ctx },
    );
    assert.deepEqual(err.context, ctx,
      'provided context must be preserved');
  });

  void it('produces an object satisfying NodeErrorInterface shape', () => {
    const err: NodeErrorInterface = NodeErrorBuilder.from(
      'FETCH_FAILED',
      'HTTP 503',
      'fetchUser',
      true,
      '2024-06-01T12:00:00.000Z',
    );
    assert.equal(err.code, 'FETCH_FAILED');
    assert.equal(err.message, 'HTTP 503');
    assert.equal(err.operation, 'fetchUser');
    assert.equal(err.recoverable, true);
    assert.equal(err.timestamp, '2024-06-01T12:00:00.000Z');
    assert.deepEqual(err.context, {});
  });

  void it('produced object passes Validator.nodeError.is()', () => {
    const err = NodeErrorBuilder.from(
      'INTERNAL',
      'unexpected state',
      'executeNode',
      false,
      new Date().toISOString(),
      { 'context': { 'nodeId': 'step-1' } },
    );
    assert.ok(Validator.nodeError.is(err),
      'NodeErrorBuilder.from result must satisfy NodeErrorSchema');
  });

  void it('positional args are mapped to correct fields', () => {
    const err = NodeErrorBuilder.from(
      'MY_CODE',
      'my message',
      'my-operation',
      true,
      '2025-01-15T08:30:00.000Z',
    );
    assert.equal(err.code, 'MY_CODE');
    assert.equal(err.message, 'my message');
    assert.equal(err.operation, 'my-operation');
    assert.equal(err.recoverable, true);
    assert.equal(err.timestamp, '2025-01-15T08:30:00.000Z');
  });
});

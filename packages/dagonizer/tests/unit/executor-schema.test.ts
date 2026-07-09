/**
 * executor-schema.test.ts
 *
 * Schema validation round-trips for the executor wire surface:
 *   - ExecutorIntermediate, ExecutionRequest, ExecutionResponse entity schemas
 *     (valid shape passes; additionalProperties fails; missing-required fails).
 *   - The same schemas are reachable from the package's shared Ajv by $id.
 *   - Validator.dag accepts a minimal well-formed DAG and rejects an incomplete one.
 *   - BridgeMessageType envelope: every branch validates; additionalProperties is
 *     rejected per branch; the execute request is dag-only (no per-node routing);
 *     Validator.bridgeMessage.validate() throws on invalid and returns a typed
 *     message on valid input.
 *
 * The BridgeMessageType execute branch wraps an ExecutionRequest and the result
 * branch wraps an ExecutionResponse (with ExecutorIntermediate items), so the
 * entity schemas and the envelope schema validate one cohesive wire contract.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGIdentity } from '../../src/entities/dag/DAG.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
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

const placementIri = (dagName: string, placementName: string): string => DAGIdentity.placementId(dagName, placementName);

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
  'items':         [{ 'id': 'child:1', 'snapshot': { 'metadata': {}, 'retries': {}, 'warnings': [] } }],
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

  void it('rejects additionalProperties (variant field from old reference schema)', () => {
    assert.equal(requestValidator({ ...validRequest, 'variant': 'dag' }), false);
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
  'correlationId': 'child:1',
  'items': [{ 'id': 'child:1', 'snapshot': { 'metadata': {}, 'retries': {}, 'warnings': [], 'value': 10 }, 'terminalOutcome': 'success' }],
  'errors': [],
  'intermediates': [
    { 'output': 'success', 'skipped': false, 'nodeName': 'increment' },
  ],
};

void describe('ExecutionResponse schema', () => {
  void it('accepts a valid response', () => {
    assert.equal(responseValidator(validResponse), true);
  });

  void it('accepts null snapshot in items[0]', () => {
    const withNullSnapshot = {
      ...validResponse,
      'items': [{ 'id': 'child:1', 'snapshot': null, 'terminalOutcome': 'failed' }],
    };
    assert.equal(responseValidator(withNullSnapshot), true);
  });

  void it('accepts an error item in errors array', () => {
    const withError = {
      ...validResponse,
      'errors': [{
        'code': 'ERR_TRANSPORT',
        'context': {},
        'message': 'timeout',
        'operation': 'runDag',
        'recoverable': false,
        'timestamp': new Date().toISOString(),
      }],
    };
    assert.equal(responseValidator(withError), true);
  });

  void it('rejects old terminalOutput field name (should be items[].terminalOutcome)', () => {
    // Missing items entirely — add old `terminalOutput` field instead
    const { 'items': _items, ...rest } = validResponse;
    assert.equal(responseValidator({ ...rest, 'terminalOutput': 'success' }), false);
  });

  void it('rejects additionalProperties', () => {
    assert.equal(responseValidator({ ...validResponse, 'extra': true }), false);
  });

  void it('rejects missing required items', () => {
    const { 'items': _items2, ...rest } = validResponse;
    assert.equal(responseValidator(rest), false);
  });
});

// ---------------------------------------------------------------------------
// Verify round-trip via Validator
// Ensure the schemas are accessible from the Validator module's shared Ajv.
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
      '@id': 'urn:noocodec:dag:cte-smoke',
      '@type': 'DAG',
      'name': 'cte-smoke',
      'version': '1',
      'entrypoints': { 'main': placementIri('urn:noocodec:dag:cte-smoke', 'step') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:cte-smoke/node/step',
          '@type': 'SingleNode',
          'name': 'step',
          'node': 'urn:noocodec:node:step',
          'outputs': { 'done': placementIri('urn:noocodec:dag:cte-smoke', 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:cte-smoke/node/end',
          '@type': 'TerminalNode',
          'name': 'end',
          'outcome': 'completed',
        },
      ],
    };
    assert.ok(Validator.dag.is(minimalDag), 'Validator.dag.is must return true for a valid DAG');
  });

  void it('Validator.dag.is rejects an object missing required fields', () => {
    assert.ok(!Validator.dag.is({ '@type': 'DAG' }), 'incomplete DAG must fail is() check');
  });
});

// ---------------------------------------------------------------------------
// BridgeMessageType envelope — valid branch fixtures
// ---------------------------------------------------------------------------

const validInit: BridgeMessageType = {
  'variant': 'init',
  'registryModule': '/some/module.js',
  'registryVersion': '1.0.0',
  'servicesConfig': {},
};

const validExecute: BridgeMessageType = {
  'variant': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': ['a', 'b'],
    'items': [{ 'id': 'req-1', 'snapshot': { 'value': 42 } }],
    'timeoutMs': 5000,
    'correlationId': 'req-1',
  },
};

const validExecuteNullTimeout: BridgeMessageType = {
  'variant': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': [],
    'items': [{ 'id': 'req-2', 'snapshot': {} }],
    'timeoutMs': null,
    'correlationId': 'req-2',
  },
};

const validAbort: BridgeMessageType = {
  'variant': 'abort',
  'correlationId': 'req-1',
  'reason': 'abort',
};

const validShutdown: BridgeMessageType = {
  'variant': 'shutdown',
};

const validReady: BridgeMessageType = {
  'variant': 'ready',
  'registryVersion': '1.0.0',
  'capabilities': [],
};

const validResult: BridgeMessageType = {
  'variant': 'result',
  'response': {
    'correlationId': 'req-1',
    'items': [{ 'id': 'req-1', 'snapshot': { 'value': 99 }, 'terminalOutcome': 'completed' }],
    'errors': [],
    'intermediates': [
      { 'output': 'done', 'skipped': false, 'nodeName': 'step1' },
    ],
  },
};

const validResultNullSnapshot: BridgeMessageType = {
  'variant': 'result',
  'response': {
    'correlationId': 'req-1',
    'items': [{ 'id': 'req-1', 'snapshot': null, 'terminalOutcome': 'failed' }],
    'errors': [{
      'code': 'ERR',
      'context': {},
      'message': 'something failed',
      'operation': 'dag',
      'recoverable': false,
      'timestamp': '2024-01-01T00:00:00.000Z',
    }],
    'intermediates': [],
  },
};

const validIntermediate: BridgeMessageType = {
  'variant': 'intermediate',
  'correlationId': 'req-1',
  'nodeName': 'step1',
  'output': 'done',
  'placementPath': ['parent'],
};

const validInstrumentation: BridgeMessageType = {
  'variant': 'instrumentation',
  'correlationId': 'req-1',
  'hook': 'nodeStart',
  'phase': '',
  'dagName': 'my-dag',
  'nodeName': 'step1',
  'output': null,
  'message': '',
  'placementPath': ['parent'],
};

const validError: BridgeMessageType = {
  'variant': 'error',
  'correlationId': null,
  'code': 'INIT_FAILED',
  'message': 'module not found',
  'recoverable': false,
};

describe('BridgeMessageType schema — valid branches', () => {
  it('validates init branch', () => {
    assert.ok(Validator.bridgeMessage.is(validInit));
  });

  it('validates execute branch with timeoutMs', () => {
    assert.ok(Validator.bridgeMessage.is(validExecute));
  });

  it('validates execute branch with null timeoutMs', () => {
    assert.ok(Validator.bridgeMessage.is(validExecuteNullTimeout));
  });

  it('validates abort branch', () => {
    assert.ok(Validator.bridgeMessage.is(validAbort));
  });

  it('validates shutdown branch', () => {
    assert.ok(Validator.bridgeMessage.is(validShutdown));
  });

  it('validates ready branch', () => {
    assert.ok(Validator.bridgeMessage.is(validReady));
  });

  it('validates result branch with stateSnapshot', () => {
    assert.ok(Validator.bridgeMessage.is(validResult));
  });

  it('validates result branch with null stateSnapshot', () => {
    assert.ok(Validator.bridgeMessage.is(validResultNullSnapshot));
  });

  it('validates intermediate branch', () => {
    assert.ok(Validator.bridgeMessage.is(validIntermediate));
  });

  it('validates instrumentation branch', () => {
    assert.ok(Validator.bridgeMessage.is(validInstrumentation));
  });

  it('validates error branch with null correlationId', () => {
    assert.ok(Validator.bridgeMessage.is(validError));
  });
});

describe('BridgeMessageType schema — dag-only proof (execute request)', () => {
  it('rejects execute request with stray nodeName field', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'dagName': 'my-dag',
        'placementPath': [],
        'stateSnapshot': {},
        'timeoutMs': null,
        'correlationId': 'req-1',
        'nodeName': 'step1',   // must be rejected: no per-node routing
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects execute request with stray variant discriminant on request', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'variant': 'dag',          // must be rejected: no variant in dag-only request
        'dagName': 'my-dag',
        'placementPath': [],
        'stateSnapshot': {},
        'timeoutMs': null,
        'correlationId': 'req-1',
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects execute request missing required dagName', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'placementPath': [],
        'stateSnapshot': {},
        'timeoutMs': null,
        'correlationId': 'req-1',
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects execute request missing required correlationId', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'dagName': 'my-dag',
        'placementPath': [],
        'stateSnapshot': {},
        'timeoutMs': null,
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });
});

describe('BridgeMessageType schema — additionalProperties rejection', () => {
  it('rejects init branch with extra property', () => {
    const invalid = {
      'variant': 'init',
      'registryModule': '/some/module.js',
      'registryVersion': '1.0.0',
      'servicesConfig': {},
      'extra': true,
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects result response with extra property on intermediates item', () => {
    const invalid = {
      'variant': 'result',
      'response': {
        'correlationId': 'req-1',
        'terminalOutput': 'completed',
        'errors': [],
        'stateSnapshot': null,
        'intermediates': [
          { 'output': 'done', 'skipped': false, 'nodeName': 'step1', 'extra': 1 },
        ],
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });
});

describe('BridgeMessageType schema — Validator.validate() throws on invalid', () => {
  it('throws ValidationError for completely invalid input', () => {
    assert.throws(
      () => Validator.bridgeMessage.validate({ 'variant': 'unknown-kind' }),
      (err) => err instanceof Error,
    );
  });

  it('returns typed message for valid execute', () => {
    const msg = Validator.bridgeMessage.validate(validExecute);
    assert.strictEqual(msg.variant, 'execute');
    if (msg.variant === 'execute') {
      assert.strictEqual(msg.request.dagName, 'my-dag');
    }
  });
});

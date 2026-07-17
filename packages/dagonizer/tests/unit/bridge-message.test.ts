/**
 * bridge-message.test.ts
 *
 * BridgeMessageType schema validation round-trips per branch.
 *
 * Tests:
 *   - Each valid branch passes Validator.bridgeMessage.is()
 *   - additionalProperties rejection per branch
 *   - missing-required rejection per branch
 *   - execute request rejects stray `nodeName` key (dag-only proof)
 *   - execute request rejects stray `variant` discriminant on the request object
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';


import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import { Validator } from '../../src/validation/Validator.js';
import { emptyInlineTransfer, FULL_RESPONSE_STATE } from '../_support/GraphStateSupport.js';

// ---------------------------------------------------------------------------
// Valid branch fixtures
// ---------------------------------------------------------------------------

const validInit: BridgeMessageType = {
  'variant': 'init',
  'registryModule': '/some/module.js',
  'registryVersion': '1.0.0',
  'servicesConfig': {},
  'graphStateTransferFormats': ['application/n-quads'],
  'instrumentationPlacementPathDepth': 1,
};

const validExecute: BridgeMessageType = {
  'variant': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': ['a', 'b'],
    'graphState': emptyInlineTransfer(['req-1']),
    'items': [{ 'id': 'req-1', 'runIri': 'req-1' }],
    'timeoutMs': 5000,
    'correlationId': 'req-1',
    'responseState': FULL_RESPONSE_STATE,
  },
};

const validExecuteNullTimeout: BridgeMessageType = {
  'variant': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': [],
    'graphState': emptyInlineTransfer(['req-2']),
    'items': [{ 'id': 'req-2', 'runIri': 'req-2' }],
    'timeoutMs': null,
    'correlationId': 'req-2',
    'responseState': FULL_RESPONSE_STATE,
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
  'graphStateTransferFormats': ['application/n-quads'],
};

const validResult: BridgeMessageType = {
  'variant': 'result',
  'response': {
    'correlationId': 'req-1',
    'graphState': emptyInlineTransfer(['req-1']),
    'items': [{ 'id': 'req-1', 'runIri': 'req-1', 'terminalOutcome': 'completed' }],
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
    'graphState': emptyInlineTransfer(['req-1']),
    'items': [{ 'id': 'req-1', 'runIri': 'req-1', 'terminalOutcome': 'failed' }],
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

const validInstrumentationBatch: BridgeMessageType = {
  'variant': 'instrumentationBatch',
  'correlationId': 'req-1',
  'items': [
    {
      'correlationId': 'req-1',
      'hook': 'nodeStart',
      'phase': '',
      'dagName': 'my-dag',
      'nodeName': 'step1',
      'output': null,
      'message': '',
      'placementPath': ['parent'],
    },
  ],
};

const validError: BridgeMessageType = {
  'variant': 'error',
  'correlationId': null,
  'code': 'INIT_FAILED',
  'message': 'module not found',
  'recoverable': false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  it('validates result branch with item snapshot', () => {
    assert.ok(Validator.bridgeMessage.is(validResult));
  });

  it('validates result branch with null item snapshot', () => {
    assert.ok(Validator.bridgeMessage.is(validResultNullSnapshot));
  });

  it('validates intermediate branch', () => {
    assert.ok(Validator.bridgeMessage.is(validIntermediate));
  });

  it('validates instrumentation branch', () => {
    assert.ok(Validator.bridgeMessage.is(validInstrumentation));
  });

  it('validates instrumentation batch branch', () => {
    assert.ok(Validator.bridgeMessage.is(validInstrumentationBatch));
  });

  it('validates error branch with null correlationId', () => {
    assert.ok(Validator.bridgeMessage.is(validError));
  });
});

describe('BridgeMessageType schema — graph-state format contract', () => {
  it('rejects init when graphStateTransferFormats is not an array', () => {
    const invalid: unknown = {
      ...validInit,
      'graphStateTransferFormats': 'application/n-quads',
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects ready when graphStateTransferFormats is not an array', () => {
    const invalid: unknown = {
      ...validReady,
      'graphStateTransferFormats': 'application/n-quads',
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });
});

describe('BridgeMessageType schema — dag-only proof (execute request)', () => {
  it('rejects execute request with stray nodeName field', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'dagName': 'my-dag',
        'placementPath': [],
        'graphState': emptyInlineTransfer(['req-1']),
        'items': [{ 'id': 'req-1', 'runIri': 'req-1' }],
        'timeoutMs': null,
        'correlationId': 'req-1',
        'responseState': FULL_RESPONSE_STATE,
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
        'graphState': emptyInlineTransfer(['req-1']),
        'items': [{ 'id': 'req-1', 'runIri': 'req-1' }],
        'timeoutMs': null,
        'correlationId': 'req-1',
        'responseState': FULL_RESPONSE_STATE,
      },
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects execute request missing required dagName', () => {
    const invalid = {
      'variant': 'execute',
      'request': {
        'placementPath': [],
        'graphState': emptyInlineTransfer(['req-1']),
        'items': [{ 'id': 'req-1', 'runIri': 'req-1' }],
        'timeoutMs': null,
        'correlationId': 'req-1',
        'responseState': FULL_RESPONSE_STATE,
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
        'graphState': emptyInlineTransfer(['req-1']),
        'items': [{ 'id': 'req-1', 'runIri': 'req-1' }],
        'timeoutMs': null,
        'responseState': FULL_RESPONSE_STATE,
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
        'graphState': emptyInlineTransfer(['req-1']),
        'items': [{ 'id': 'req-1', 'runIri': 'req-1', 'terminalOutcome': 'completed' }],
        'errors': [],
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

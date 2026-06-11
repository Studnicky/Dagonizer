/**
 * bridge-message.test.ts
 *
 * BridgeMessage schema validation round-trips per branch.
 *
 * Tests:
 *   - Each valid branch passes Validator.bridgeMessage.is()
 *   - additionalProperties rejection per branch
 *   - missing-required rejection per branch
 *   - execute request rejects stray `nodeName` key (dag-only proof)
 *   - execute request rejects stray `kind` discriminant on the request object
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// Valid branch fixtures
// ---------------------------------------------------------------------------

const validInit: BridgeMessage = {
  'kind': 'init',
  'registryModule': '/some/module.js',
  'registryVersion': '1.0.0',
  'servicesConfig': {},
};

const validExecute: BridgeMessage = {
  'kind': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': ['a', 'b'],
    'stateSnapshot': { 'value': 42 },
    'timeoutMs': 5000,
    'correlationId': 'req-1',
  },
};

const validExecuteNullTimeout: BridgeMessage = {
  'kind': 'execute',
  'request': {
    'dagName': 'my-dag',
    'placementPath': [],
    'stateSnapshot': {},
    'timeoutMs': null,
    'correlationId': 'req-2',
  },
};

const validAbort: BridgeMessage = {
  'kind': 'abort',
  'correlationId': 'req-1',
  'reason': 'abort',
};

const validShutdown: BridgeMessage = {
  'kind': 'shutdown',
};

const validReady: BridgeMessage = {
  'kind': 'ready',
  'registryVersion': '1.0.0',
  'capabilities': [],
};

const validResult: BridgeMessage = {
  'kind': 'result',
  'response': {
    'correlationId': 'req-1',
    'terminalOutput': 'completed',
    'errors': [],
    'stateSnapshot': { 'value': 99 },
    'intermediates': [
      { 'output': 'done', 'skipped': false, 'nodeName': 'step1' },
    ],
  },
};

const validResultNullSnapshot: BridgeMessage = {
  'kind': 'result',
  'response': {
    'correlationId': 'req-1',
    'terminalOutput': 'failed',
    'errors': [{
      'code': 'ERR',
      'context': {},
      'message': 'something failed',
      'operation': 'dag',
      'recoverable': false,
      'timestamp': '2024-01-01T00:00:00.000Z',
    }],
    'stateSnapshot': null,
    'intermediates': [],
  },
};

const validIntermediate: BridgeMessage = {
  'kind': 'intermediate',
  'correlationId': 'req-1',
  'nodeName': 'step1',
  'output': 'done',
  'placementPath': ['parent'],
};

const validInstrumentation: BridgeMessage = {
  'kind': 'instrumentation',
  'correlationId': 'req-1',
  'hook': 'nodeStart',
  'phase': '',
  'dagName': 'my-dag',
  'nodeName': 'step1',
  'output': null,
  'message': '',
  'placementPath': ['parent'],
};

const validError: BridgeMessage = {
  'kind': 'error',
  'correlationId': null,
  'code': 'INIT_FAILED',
  'message': 'module not found',
  'recoverable': false,
};

const validLog: BridgeMessage = {
  'kind': 'log',
  'level': 'info',
  'component': 'DagHost',
  'operation': 'init',
  'message': 'host started',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BridgeMessage schema — valid branches', () => {
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

  it('validates log branch', () => {
    assert.ok(Validator.bridgeMessage.is(validLog));
  });
});

describe('BridgeMessage schema — dag-only proof (execute request)', () => {
  it('rejects execute request with stray nodeName field', () => {
    const invalid = {
      'kind': 'execute',
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

  it('rejects execute request with stray kind discriminant on request', () => {
    const invalid = {
      'kind': 'execute',
      'request': {
        'kind': 'dag',          // must be rejected: no kind in dag-only request
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
      'kind': 'execute',
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
      'kind': 'execute',
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

describe('BridgeMessage schema — additionalProperties rejection', () => {
  it('rejects init branch with extra property', () => {
    const invalid = {
      'kind': 'init',
      'registryModule': '/some/module.js',
      'registryVersion': '1.0.0',
      'servicesConfig': {},
      'extra': true,
    };
    assert.strictEqual(Validator.bridgeMessage.is(invalid), false);
  });

  it('rejects result response with extra property on intermediates item', () => {
    const invalid = {
      'kind': 'result',
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

describe('BridgeMessage schema — Validator.validate() throws on invalid', () => {
  it('throws ValidationError for completely invalid input', () => {
    assert.throws(
      () => Validator.bridgeMessage.validate({ 'kind': 'unknown-kind' }),
      (err) => err instanceof Error,
    );
  });

  it('returns typed message for valid execute', () => {
    const msg = Validator.bridgeMessage.validate(validExecute);
    assert.strictEqual(msg.kind, 'execute');
    if (msg.kind === 'execute') {
      assert.strictEqual(msg.request.dagName, 'my-dag');
    }
  });
});

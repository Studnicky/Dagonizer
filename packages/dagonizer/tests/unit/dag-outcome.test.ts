/**
 * dag-outcome.test.ts
 *
 * Pins the shape of DagOutcome.transportError(correlationId) and the
 * TransportErrorCode.isInfrastructureFailure predicate.
 *
 * DagOutcome.transportError returns a DagOutcomeType that the scatter and
 * embedded-DAG execution branches use to distinguish an infrastructure failure
 * (retryable: leave the scatter item un-acked) from a legitimate body-error
 * outcome (the DAG ran and routed to its error output; ack it as completed).
 * Pinning the exact shape here ensures that no refactor silently breaks the
 * discriminator contract.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DAG_CONTAINER_TRANSPORT,
  DAG_CONTAINER_WORKER_DIED,
  DagOutcome,
  TransportErrorCode,
} from '../../src/container/index.js';

// ---------------------------------------------------------------------------
// DagOutcome.transportError — default-code shape
// ---------------------------------------------------------------------------

describe('DagOutcome.transportError — default shape', () => {
  it('pins the full structural contract (excluding timestamp)', () => {
    const correlationId = 'corr-shape';
    const outcome = DagOutcome.transportError(correlationId);
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');

    // All structural fields in one assertion: terminalOutput, intermediates,
    // error count, code, operation, recoverable, message.
    assert.deepStrictEqual(
      {
        'terminalOutput':          outcome.terminalOutput,
        'intermediates':           outcome.intermediates,
        'errorCount':              outcome.errors.length,
        'errorCode':               error.code,
        'errorOperation':          error.operation,
        'errorRecoverable':        error.recoverable,
        'correlationIdInMessage':  error.message.includes(correlationId),
      },
      {
        'terminalOutput':          'failed',
        'intermediates':           [],
        'errorCount':              1,
        'errorCode':               DAG_CONTAINER_TRANSPORT,
        'errorOperation':          'runDag',
        'errorRecoverable':        false,
        'correlationIdInMessage':  true,
      },
    );
  });

  it('error.timestamp is a non-empty valid ISO 8601 date string', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.ok(typeof error.timestamp === 'string' && error.timestamp.length > 0,
      'timestamp must be a non-empty string');
    assert.ok(!isNaN(Date.parse(error.timestamp)),
      `timestamp must be valid ISO 8601; got: "${error.timestamp}"`);
  });
});

// ---------------------------------------------------------------------------
// DagOutcome.transportError — custom code overrides
// ---------------------------------------------------------------------------

describe('DagOutcome.transportError — custom code override', () => {
  it('accepts DAG_CONTAINER_WORKER_DIED as the code', () => {
    const outcome = DagOutcome.transportError('corr-w', { 'code': DAG_CONTAINER_WORKER_DIED });
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.code, DAG_CONTAINER_WORKER_DIED);
    assert.strictEqual(error.recoverable, false);
  });

  it('accepts a custom code and message', () => {
    const outcome = DagOutcome.transportError('corr-x', { 'code': 'CUSTOM_CODE', 'message': 'custom message' });
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.code, 'CUSTOM_CODE');
    assert.strictEqual(error.message, 'custom message');
    assert.strictEqual(error.recoverable, false);
    assert.strictEqual(outcome.terminalOutput, 'failed');
    assert.deepStrictEqual(outcome.intermediates, []);
  });
});

// ---------------------------------------------------------------------------
// TransportErrorCode.isInfrastructureFailure — predicate
// ---------------------------------------------------------------------------

describe('TransportErrorCode.isInfrastructureFailure', () => {
  it('returns true for DAG_CONTAINER_TRANSPORT', () => {
    assert.strictEqual(TransportErrorCode.isInfrastructureFailure(DAG_CONTAINER_TRANSPORT), true);
  });

  it('returns true for DAG_CONTAINER_WORKER_DIED', () => {
    assert.strictEqual(TransportErrorCode.isInfrastructureFailure(DAG_CONTAINER_WORKER_DIED), true);
  });

  it('returns false for a normal application error code', () => {
    assert.strictEqual(TransportErrorCode.isInfrastructureFailure('APP_ERROR'), false);
  });

  it('returns false for an empty string', () => {
    assert.strictEqual(TransportErrorCode.isInfrastructureFailure(''), false);
  });

  it('the default DagOutcome.transportError code is an infrastructure failure', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(
      TransportErrorCode.isInfrastructureFailure(error.code),
      true,
      `default transport error code must be an infrastructure failure; got: "${error.code}"`,
    );
  });

  it('DAG_CONTAINER_WORKER_DIED outcome code is an infrastructure failure', () => {
    const outcome = DagOutcome.transportError('corr-w', { 'code': DAG_CONTAINER_WORKER_DIED });
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(
      TransportErrorCode.isInfrastructureFailure(error.code),
      true,
      `DAG_CONTAINER_WORKER_DIED must be an infrastructure failure code`,
    );
  });
});

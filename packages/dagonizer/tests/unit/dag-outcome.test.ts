/**
 * dag-outcome.test.ts
 *
 * Pins the shape of DagOutcome.transportError(correlationId) and the
 * TransportErrorCode.isInfrastructureFailure predicate.
 *
 * DagOutcome.transportError returns a DagOutcomeInterface that the scatter and
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
  it('returns terminalOutput: "failed"', () => {
    const outcome = DagOutcome.transportError('corr-123');
    assert.strictEqual(outcome.terminalOutput, 'failed');
  });

  it('carries exactly one error', () => {
    const outcome = DagOutcome.transportError('corr-123');
    assert.strictEqual(outcome.errors.length, 1);
  });

  it('error.recoverable is false', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.recoverable, false);
  });

  it('error.code is DAG_CONTAINER_TRANSPORT by default', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.code, DAG_CONTAINER_TRANSPORT);
  });

  it('error.operation is "runDag"', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.operation, 'runDag');
  });

  it('stateSnapshot is null', () => {
    const outcome = DagOutcome.transportError('corr-123');
    assert.strictEqual(outcome.stateSnapshot, null);
  });

  it('intermediates is an empty array', () => {
    const outcome = DagOutcome.transportError('corr-123');
    assert.deepStrictEqual(outcome.intermediates, []);
  });

  it('error.message interpolates correlationId', () => {
    const correlationId = 'corr-abc-456';
    const outcome = DagOutcome.transportError(correlationId);
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.ok(
      error.message.includes(correlationId),
      `default message must include correlationId; got: "${error.message}"`,
    );
  });

  it('error.timestamp is a non-empty ISO string', () => {
    const outcome = DagOutcome.transportError('corr-123');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.ok(typeof error.timestamp === 'string' && error.timestamp.length > 0, 'timestamp must be a non-empty string');
    // Must parse as a valid date (ISO 8601).
    assert.ok(!isNaN(Date.parse(error.timestamp)), `timestamp must be a valid ISO date; got: "${error.timestamp}"`);
  });
});

// ---------------------------------------------------------------------------
// DagOutcome.transportError — custom code overrides
// ---------------------------------------------------------------------------

describe('DagOutcome.transportError — custom code override', () => {
  it('accepts DAG_CONTAINER_WORKER_DIED as the code', () => {
    const outcome = DagOutcome.transportError('corr-w', DAG_CONTAINER_WORKER_DIED);
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.code, DAG_CONTAINER_WORKER_DIED);
    assert.strictEqual(error.recoverable, false);
  });

  it('accepts a custom code and message', () => {
    const outcome = DagOutcome.transportError('corr-x', 'CUSTOM_CODE', 'custom message');
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(error.code, 'CUSTOM_CODE');
    assert.strictEqual(error.message, 'custom message');
    assert.strictEqual(error.recoverable, false);
    assert.strictEqual(outcome.terminalOutput, 'failed');
    assert.strictEqual(outcome.stateSnapshot, null);
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
    const outcome = DagOutcome.transportError('corr-w', DAG_CONTAINER_WORKER_DIED);
    const error = outcome.errors[0];
    assert.ok(error !== undefined, 'error must be present');
    assert.strictEqual(
      TransportErrorCode.isInfrastructureFailure(error.code),
      true,
      `DAG_CONTAINER_WORKER_DIED must be an infrastructure failure code`,
    );
  });
});

/**
 * StoreError: error taxonomy for store operations.
 *
 * Mirrors `LlmError` in structure. Plugin authors classify backing
 * errors into one of these reasons; callers can discriminate on
 * `classification.reason` without instanceof checks.
 */

import { DAGError } from '../errors/DAGError.js';

export type StoreErrorClassification =
  | {
      reason:           'INCOMPATIBLE_SNAPSHOT';
      expectedType:     string;
      actualType:       string;
      expectedVersion:  number;
      actualVersion:    number;
    }
  | {
      reason: 'KEY_NOT_FOUND';
      key:    string;
    }
  | {
      reason: 'BACKING_ERROR';
      cause:  Error;
    }
  | {
      reason:   'LEASE_DENIED';
      subject:  string;
      /** Identifier of current lease holder (opaque; store-defined format). */
      holder:   string;
    }
  | {
      reason:  'LEASE_EXPIRED';
      subject: string;
      token:   string;
    }
  | {
      reason:    'UNREACHABLE';
      endpoint:  string;
      cause:     Error;
    };

export class StoreError extends DAGError {
  readonly classification: StoreErrorClassification;

  constructor(message: string, classification: StoreErrorClassification, options?: { cause?: Error }) {
    super(message, { 'code': 'STORE_ERROR', ...(options?.cause !== undefined && { 'cause': options.cause }) });
    this.name = 'StoreError';
    this.classification = classification;
  }
}

/**
 * StoreError: error taxonomy for store operations.
 *
 * Mirrors `LlmError` in structure. Plugin authors classify backing
 * errors into one of these reasons; callers can discriminate on
 * `classification.reason` without instanceof checks.
 */

export type StoreErrorClassification =
  | {
      readonly reason:           'INCOMPATIBLE_SNAPSHOT';
      readonly expectedType:     string;
      readonly actualType:       string;
      readonly expectedVersion:  number;
      readonly actualVersion:    number;
    }
  | {
      readonly reason: 'KEY_NOT_FOUND';
      readonly key:    string;
    }
  | {
      readonly reason: 'BACKING_ERROR';
      readonly cause:  Error;
    }
  | {
      readonly reason:   'LEASE_DENIED';
      readonly subject:  string;
      /** Identifier of current lease holder (opaque; store-defined format). */
      readonly holder:   string;
    }
  | {
      readonly reason:  'LEASE_EXPIRED';
      readonly subject: string;
      readonly token:   string;
    }
  | {
      readonly reason:    'UNREACHABLE';
      readonly endpoint:  string;
      readonly cause:     Error;
    };

export class StoreError extends Error {
  readonly classification: StoreErrorClassification;

  constructor(message: string, classification: StoreErrorClassification) {
    super(message);
    this.name = 'StoreError';
    this.classification = classification;
  }
}

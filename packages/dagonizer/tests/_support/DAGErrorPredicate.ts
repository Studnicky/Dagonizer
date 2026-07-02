/**
 * DAGErrorPredicate: shared `assert.throws`/`assert.rejects` predicates for
 * `DAGError` across unit tests.
 *
 * The single source for the `VALIDATION_ERROR` predicate — every test that
 * needs to assert a thrown/rejected `DAGError` code uses
 * `DAGErrorPredicate.isValidationError` rather than defining a local helper.
 */

import { DAGError } from '../../src/errors/index.js';

export class DAGErrorPredicate {
  private constructor() { /* static class */ }

  /** A `DAGError` coded `VALIDATION_ERROR`. */
  static isValidationError(err: unknown): boolean {
    return err instanceof DAGError && err.code === 'VALIDATION_ERROR';
  }
}

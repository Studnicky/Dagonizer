/**
 * JsonValue: cast-free coercion of an `unknown` into a `JsonValueType`.
 *
 * The honest narrowing at a JSON-storage boundary (snapshot of a genuinely
 * `unknown` value such as a generic tool's return). Rather than asserting
 * `value as JsonValueType` — a cast that lies when the value is a function,
 * `undefined`, symbol, or bigint — `JsonValue.from` delegates to
 * `@studnicky/types`'s `JsonValue.from`, which walks the value and returns a
 * real `JsonValueType`: primitives pass through, arrays and plain objects
 * recurse, and anything not representable in JSON becomes `null`. No cast.
 */

import * as SubstrateTypes from '@studnicky/types';

import type { JsonValueType } from './json.js';

export class JsonValue {
  private constructor() { /* static class */ }

  /**
   * Coerce an arbitrary value into a `JsonValueType`. Strings, numbers,
   * booleans, and `null` pass through; arrays and plain string-keyed objects
   * are coerced element-/field-wise; everything else (functions, `undefined`,
   * symbols, bigints) becomes `null`.
   */
  static from(value: unknown): JsonValueType {
    return SubstrateTypes.JsonValue.from(value);
  }
}

/**
 * JsonValue: cast-free coercion of an `unknown` into a `JsonValueType`.
 *
 * The honest narrowing at a JSON-storage boundary (snapshot of a genuinely
 * `unknown` value such as a generic tool's return). Rather than asserting
 * `value as JsonValueType` — a cast that lies when the value is a function,
 * `undefined`, symbol, or bigint — `JsonValue.from` walks the value and returns
 * a real `JsonValueType`: primitives pass through, arrays and plain objects
 * recurse, and anything not representable in JSON becomes `null`. No cast.
 */

import type { JsonObjectType, JsonValueType } from './json.js';

export class JsonValue {
  private constructor() { /* static class */ }

  /**
   * Coerce an arbitrary value into a `JsonValueType`. Strings, numbers,
   * booleans, and `null` pass through; arrays and plain string-keyed objects
   * are coerced element-/field-wise; everything else (functions, `undefined`,
   * symbols, bigints) becomes `null`.
   */
  static from(value: unknown): JsonValueType {
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((element) => JsonValue.from(element));
    }
    if (typeof value === 'object') {
      const out: JsonObjectType = {};
      for (const [key, element] of Object.entries(value)) {
        out[key] = JsonValue.from(element);
      }
      return out;
    }
    return null;
  }
}

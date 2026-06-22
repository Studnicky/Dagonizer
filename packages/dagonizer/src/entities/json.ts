/**
 * Recursive JSON value types. The single permitted boundary type for any
 * shape that must be serializable (state snapshots, checkpoint records,
 * wire payloads). Shape matches what `@studnicky/jsontology` will consume
 * when that workspace package lands.
 */

/** JSON scalar: string, number, boolean, or null. */
export type JsonPrimitiveType = string | number | boolean | null;

/** Any JSON-serializable value: a primitive, an object, or an array thereof. */
export type JsonValueType = JsonPrimitiveType | JsonObjectType | JsonArrayType;

/**
 * JSON object: string-keyed record whose values are `JsonValueType`.
 *
 * Used as the type for state snapshots, checkpoint records, and any
 * wire payload that must survive a JSON round-trip.
 */
export type JsonObjectType = { [key: string]: JsonValueType };

/**
 * JSON array: ordered list of `JsonValueType` elements.
 *
 * Used wherever a top-level JSON array is the expected wire shape.
 */
export type JsonArrayType = JsonValueType[];

/**
 * Narrowing primitive for the JSON-object boundary: turns a schema-validated
 * but loosely-typed value (`unknown` / `Record<string, unknown>`) into a
 * `JsonObjectType` via a type-guard predicate, so call sites never reach for an
 * `as` cast. The shallow object check is the sanctioned narrowing point — the
 * upstream JSON Schema validation already guarantees the values are JSON.
 */
export class JsonObject {
  private constructor() { /* static class */ }

  static is(value: unknown): value is JsonObjectType {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

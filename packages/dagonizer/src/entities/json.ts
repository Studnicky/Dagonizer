/**
 * Recursive JSON value types. The single permitted boundary type for any
 * shape that must be serializable (state snapshots, checkpoint records,
 * wire payloads). Shape matches what `@noocodex/jsontology` will consume
 * when that workspace package lands.
 */

/** JSON scalar: string, number, boolean, or null. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-serializable value: a primitive, an object, or an array thereof. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * JSON object: string-keyed record whose values are `JsonValue`.
 *
 * Used as the type for state snapshots, checkpoint records, and any
 * wire payload that must survive a JSON round-trip.
 */
export interface JsonObject { [key: string]: JsonValue }

/**
 * JSON array: ordered list of `JsonValue` elements.
 *
 * Used wherever a top-level JSON array is the expected wire shape.
 */
export type JsonArray = JsonValue[];

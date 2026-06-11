/**
 * Recursive JSON value types. The single permitted boundary type for any
 * shape that must be serializable (state snapshots, checkpoint records,
 * wire payloads). Shape matches what `@noocodex/jsontology` will consume
 * when that workspace package lands.
 */

/** JSON scalar: string, number, boolean, or null. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-serializable value. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** JSON object: keys are strings, values are `JsonValue`. */
export interface JsonObject { [key: string]: JsonValue }

/** JSON array: elements are `JsonValue`. */
export type JsonArray = JsonValue[];

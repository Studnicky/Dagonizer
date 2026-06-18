/**
 * JsonSchema: TypeScript model of JSON Schema draft 2020-12.
 *
 * Narrow by design: only keywords defined by the 2020-12 core, validation,
 * format-annotation, content, and meta-data vocabularies are representable.
 * Draft-07 carry-overs that 2020-12 removed are intentionally absent:
 *   - `definitions`       (replaced by `$defs`)
 *   - `dependencies`      (replaced by `dependentSchemas` + `dependentRequired`)
 *   - `additionalItems`   (replaced by `items` + `prefixItems`)
 *   - the array form of `items` (now requires `prefixItems`)
 *   - the boolean form of `exclusiveMaximum` / `exclusiveMinimum`
 *
 * Specs:
 *   https://json-schema.org/draft/2020-12/json-schema-core
 *   https://json-schema.org/draft/2020-12/json-schema-validation
 *
 * A JSON Schema is either an object with the keywords below, or a boolean
 * (`true` accepts everything, `false` rejects everything).
 */

/**
 * Union of the seven primitive type names defined by JSON Schema 2020-12.
 * Used as the type for the `type` keyword in `JsonSchemaObject`.
 */
export type JsonSchemaTypeName =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

/**
 * TypeScript model of a JSON Schema 2020-12 keyword object.
 *
 * All keyword fields are optional; only the keywords applicable to the
 * schema's type need be present. A `JsonSchema` is either a
 * `JsonSchemaObject` or a boolean (`true` accepts everything, `false`
 * rejects everything).
 *
 * See `JsonSchema` for the full union, and the file-level comment for the
 * list of draft-07 keywords intentionally omitted.
 */
export interface JsonSchemaObject {
  // ── Core: identifiers and references ────────────────────────────
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: { [name: string]: JsonSchema };
  $anchor?: string;
  $dynamicAnchor?: string;
  $dynamicRef?: string;
  $vocabulary?: { [uri: string]: boolean };
  $comment?: string;

  // ── Applicators: composition ────────────────────────────────────
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;

  // ── Applicators: conditional ────────────────────────────────────
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;

  // ── Applicators: objects ────────────────────────────────────────
  properties?: { [name: string]: JsonSchema };
  patternProperties?: { [regex: string]: JsonSchema };
  additionalProperties?: JsonSchema;
  propertyNames?: JsonSchema;
  unevaluatedProperties?: JsonSchema;
  dependentSchemas?: { [name: string]: JsonSchema };

  // ── Applicators: arrays ─────────────────────────────────────────
  prefixItems?: JsonSchema[];
  items?: JsonSchema;
  contains?: JsonSchema;
  unevaluatedItems?: JsonSchema;

  // ── Validation: any instance ────────────────────────────────────
  type?: JsonSchemaTypeName | JsonSchemaTypeName[];
  enum?: unknown[];
  const?: unknown;

  // ── Validation: numbers ─────────────────────────────────────────
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minimum?: number;
  exclusiveMinimum?: number;

  // ── Validation: strings ─────────────────────────────────────────
  maxLength?: number;
  minLength?: number;
  pattern?: string;

  // ── Validation: arrays ──────────────────────────────────────────
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  maxContains?: number;
  minContains?: number;

  // ── Validation: objects ─────────────────────────────────────────
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  dependentRequired?: { [name: string]: string[] };

  // ── Format (annotation by default in 2020-12) ───────────────────
  format?: string;

  // ── Content ─────────────────────────────────────────────────────
  contentEncoding?: string;
  contentMediaType?: string;
  contentSchema?: JsonSchema;

  // ── Meta-data ───────────────────────────────────────────────────
  title?: string;
  description?: string;
  default?: unknown;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  examples?: unknown[];
}

/**
 * A JSON Schema 2020-12 value: either a keyword-object or a boolean.
 * `true` is the schema that accepts every instance; `false` is the schema
 * that rejects every instance.
 */
export type JsonSchema = JsonSchemaObject | boolean;

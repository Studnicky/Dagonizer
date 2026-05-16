/**
 * JsonSchema — TypeScript model of JSON Schema draft 2020-12.
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

export type JsonSchemaTypeName =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

export interface JsonSchemaObject {
  // ── Core: identifiers and references ────────────────────────────
  readonly $schema?: string;
  readonly $id?: string;
  readonly $ref?: string;
  readonly $defs?: { readonly [name: string]: JsonSchema };
  readonly $anchor?: string;
  readonly $dynamicAnchor?: string;
  readonly $dynamicRef?: string;
  readonly $vocabulary?: { readonly [uri: string]: boolean };
  readonly $comment?: string;

  // ── Applicators: composition ────────────────────────────────────
  readonly allOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly not?: JsonSchema;

  // ── Applicators: conditional ────────────────────────────────────
  readonly if?: JsonSchema;
  readonly then?: JsonSchema;
  readonly else?: JsonSchema;

  // ── Applicators: objects ────────────────────────────────────────
  readonly properties?: { readonly [name: string]: JsonSchema };
  readonly patternProperties?: { readonly [regex: string]: JsonSchema };
  readonly additionalProperties?: JsonSchema;
  readonly propertyNames?: JsonSchema;
  readonly unevaluatedProperties?: JsonSchema;
  readonly dependentSchemas?: { readonly [name: string]: JsonSchema };

  // ── Applicators: arrays ─────────────────────────────────────────
  readonly prefixItems?: readonly JsonSchema[];
  readonly items?: JsonSchema;
  readonly contains?: JsonSchema;
  readonly unevaluatedItems?: JsonSchema;

  // ── Validation: any instance ────────────────────────────────────
  readonly type?: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;

  // ── Validation: numbers ─────────────────────────────────────────
  readonly multipleOf?: number;
  readonly maximum?: number;
  readonly exclusiveMaximum?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;

  // ── Validation: strings ─────────────────────────────────────────
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: string;

  // ── Validation: arrays ──────────────────────────────────────────
  readonly maxItems?: number;
  readonly minItems?: number;
  readonly uniqueItems?: boolean;
  readonly maxContains?: number;
  readonly minContains?: number;

  // ── Validation: objects ─────────────────────────────────────────
  readonly maxProperties?: number;
  readonly minProperties?: number;
  readonly required?: readonly string[];
  readonly dependentRequired?: { readonly [name: string]: readonly string[] };

  // ── Format (annotation by default in 2020-12) ───────────────────
  readonly format?: string;

  // ── Content ─────────────────────────────────────────────────────
  readonly contentEncoding?: string;
  readonly contentMediaType?: string;
  readonly contentSchema?: JsonSchema;

  // ── Meta-data ───────────────────────────────────────────────────
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly deprecated?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly examples?: readonly unknown[];
}

export type JsonSchema = JsonSchemaObject | boolean;

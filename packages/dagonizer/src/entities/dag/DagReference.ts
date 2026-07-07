import type { FromSchema } from 'json-schema-to-ts';

export const LiteralDagReferenceSchema = {
  'type': 'string',
  'minLength': 1,
} as const;

export const DynamicDagReferenceSchema = {
  'type': 'object',
  'required': ['@type', 'from', 'path', 'candidates'],
  'properties': {
    '@type': { 'type': 'string', 'const': 'DagReference' },
    'from': { 'type': 'string', 'enum': ['state', 'item'] },
    'path': { 'type': 'string', 'minLength': 1 },
    'candidates': {
      'type': 'array',
      'items': { 'type': 'string', 'minLength': 1 },
      'minItems': 1,
      'uniqueItems': true,
    },
  },
  'additionalProperties': false,
} as const;

export const DagReferenceShapeSchema = {
  'oneOf': [LiteralDagReferenceSchema, DynamicDagReferenceSchema],
} as const;

export const DagReferenceSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DagReference',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  ...DagReferenceShapeSchema,
} as const;

export type DagReferenceType = FromSchema<typeof DagReferenceSchema>;
export type DynamicDagReferenceType = FromSchema<typeof DynamicDagReferenceSchema>;

export class DagReference {
  private constructor() { /* static-only */ }

  static isDynamic(reference: DagReferenceType): reference is DynamicDagReferenceType {
    return typeof reference !== 'string';
  }

  static candidates(reference: DagReferenceType): readonly string[] {
    return typeof reference === 'string' ? [reference] : reference.candidates;
  }
}

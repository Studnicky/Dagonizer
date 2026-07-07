import type { FromSchema } from 'json-schema-to-ts';

import { GatherConfigShapeSchema } from './GatherConfig.js';

export const GatherNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'sources', 'gather', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'GatherNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'sources': {
      'type': 'array',
      'items': { 'type': 'string', 'minLength': 1 },
      'minItems': 1,
      'uniqueItems': true,
    },
    'gather': GatherConfigShapeSchema,
    'policy': {
      'type': 'object',
      'properties': {
        'mode': { 'type': 'string', 'enum': ['all', 'any', 'quorum'] },
        'quorum': { 'type': 'integer', 'minimum': 1 },
        'includeErrors': { 'type': 'boolean' },
      },
      'additionalProperties': false,
    },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
  },
  'additionalProperties': false,
} as const;

export type GatherNodeType = FromSchema<typeof GatherNodeSchema>;
export type GatherPolicyType = NonNullable<GatherNodeType['policy']>;

const GATHER_POLICY_DEFAULT = Object.freeze({
  'mode': 'all',
  'quorum': null,
  'includeErrors': true,
} as const);

export class GatherNodeDefaults {
  private constructor() { /* static-only */ }

  static policy(node: GatherNodeType): { mode: 'all' | 'any' | 'quorum'; quorum: number | null; includeErrors: boolean } {
    const policy = node.policy ?? GATHER_POLICY_DEFAULT;
    return {
      'mode': policy.mode ?? 'all',
      'quorum': policy.quorum ?? null,
      'includeErrors': policy.includeErrors ?? true,
    };
  }
}

/**
 * DeepDAGNode — invoke a nested DAG with optional state mapping,
 * in JSON-LD canonical form.
 *
 * Uses `@type: 'DeepDAGNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const DeepDAGNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DeepDAGNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'dag', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'DeepDAGNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'dag':   { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
    'stateMapping': {
      'type': 'object',
      'properties': {
        'input':  { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
        'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `DeepDAGNodeSchema` via `json-schema-to-ts`. */
export type DeepDAGNode = FromSchema<typeof DeepDAGNodeSchema>;

/** TypeScript interface for `DeepDAGNode`. */
export interface DeepDAGNodeInterface {
  readonly '@id': string;
  readonly '@type': 'DeepDAGNode';
  readonly name: string;
  readonly dag: string;
  readonly outputs: Record<string, string | null>;
  readonly stateMapping?: {
    readonly input?: Record<string, string>;
    readonly output?: Record<string, string>;
  };
}

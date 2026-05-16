/**
 * SubDAGNode — invoke a nested DAG with optional state mapping.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const SubDAGNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/SubDAGNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'dag', 'outputs', 'type'],
  'properties': {
    'type': { 'type': 'string', 'const': 'sub-dag' },
    'name': { 'type': 'string', 'minLength': 1 },
    'dag': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': ['string', 'null'] },
    },
    'stateMapping': {
      'type': 'object',
      'properties': {
        'input': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
        'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `SubDAGNodeSchema` via `json-schema-to-ts`. */
export type SubDAGNode = FromSchema<typeof SubDAGNodeSchema>;

/** TypeScript interface for `SubDAGNode`. */
export interface SubDAGNodeInterface {
  readonly type: 'sub-dag';
  readonly name: string;
  readonly dag: string;
  readonly outputs: Record<string, string | null>;
  readonly stateMapping?: {
    readonly input?: Record<string, string>;
    readonly output?: Record<string, string>;
  };
}

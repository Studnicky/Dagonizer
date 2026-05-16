/**
 * DAG — top-level DAG declaration. Inlines its node-entry sub-shapes
 * via `oneOf` so a single validator covers the whole document; the standalone
 * `SingleNodeSchema` / `ParallelNodeSchema` / `FanOutNodeSchema` /
 * `SubDAGNodeSchema` exports remain available for per-shape validation.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { FanInConfigSchema } from './FanInConfig.js';

const DAGNodeEntrySchema = {
  'oneOf': [
    {
      'type': 'object',
      'required': ['name', 'node', 'outputs', 'type'],
      'properties': {
        'type': { 'type': 'string', 'const': 'single' },
        'name': { 'type': 'string', 'minLength': 1 },
        'node': { 'type': 'string', 'minLength': 1 },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['name', 'nodes', 'combine', 'outputs', 'type'],
      'properties': {
        'type': { 'type': 'string', 'const': 'parallel' },
        'name': { 'type': 'string', 'minLength': 1 },
        'nodes': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 }, 'minItems': 1 },
        'combine': { 'type': 'string', 'enum': ['all-success', 'any-success', 'collect'] },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['name', 'node', 'source', 'fanIn', 'outputs', 'type'],
      'properties': {
        'type': { 'type': 'string', 'const': 'fan-out' },
        'name': { 'type': 'string', 'minLength': 1 },
        'node': { 'type': 'string', 'minLength': 1 },
        'source': { 'type': 'string', 'minLength': 1 },
        'itemKey': { 'type': 'string', 'minLength': 1 },
        'concurrency': { 'type': 'integer', 'minimum': 1 },
        'fanIn': FanInConfigSchema,
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
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
    },
  ],
} as const;

export const DAGSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAG',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'version', 'entrypoint', 'nodes'],
  'properties': {
    'name': { 'type': 'string', 'minLength': 1 },
    'version': { 'type': 'string', 'minLength': 1 },
    'entrypoint': { 'type': 'string', 'minLength': 1 },
    'nodes': { 'type': 'array', 'items': DAGNodeEntrySchema, 'minItems': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `DAGSchema` via `json-schema-to-ts`. */
export type DAG = FromSchema<typeof DAGSchema>;

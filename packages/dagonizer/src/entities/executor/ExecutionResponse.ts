/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `graphState` is ONE batch-level plain transient-state payload for the whole
 * response. It carries the terminal clone state as plain JSON data, batched
 * once for the entire item set. `items` carries one `{ id, runIri,
 * terminalOutcome }` entry per item, and `terminalOutcome` is the routing
 * output the child DAG resolved to for that item.
 *
 * The NodeError item shape references the single-source `NodeErrorProperties`
 * const and `NodeErrorSchema.required` from `node/NodeError.ts` structurally;
 * `json-schema-to-ts` reads the literal at compile time, so the derived type is
 * identical to an inline copy while field changes propagate from one place.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { NodeErrorProperties, NodeErrorSchema } from '../node/NodeError.js';

import { TransientNodeStateBatchSchema } from './TransientNodeState.js';
import type { TransientNodeStateBatchType } from './TransientNodeState.js';

export const ExecutionResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationId', 'graphState', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'graphState':    TransientNodeStateBatchSchema,
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'runIri', 'terminalOutcome'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'runIri':          { 'type': 'string', 'minLength': 1 },
          'terminalOutcome': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeErrorSchema.required,
        'properties': NodeErrorProperties,
        'additionalProperties': false,
      },
    },
    'intermediates': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['output', 'skipped', 'nodeName'],
        'properties': {
          'output':   { 'type': ['string', 'null'] },
          'skipped':  { 'type': 'boolean' },
          'nodeName': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
  },
  'additionalProperties': false,
} as const;

type ExecutionResponseWireType = FromSchema<typeof ExecutionResponseSchema>;
type ExecutionResponseItemWireType = ExecutionResponseWireType['items'][number];
type ExecutionResponseItemType = ExecutionResponseItemWireType;

/** One response item: id, its state-graph run IRI, and terminal outcome. */
export type { ExecutionResponseItemType };

/** TypeScript type derived from `ExecutionResponseSchema` with plain transient-state batch typing. */
export type ExecutionResponseType = Omit<ExecutionResponseWireType, 'graphState' | 'items'> & {
  graphState: TransientNodeStateBatchType;
  items: ExecutionResponseItemType[];
};

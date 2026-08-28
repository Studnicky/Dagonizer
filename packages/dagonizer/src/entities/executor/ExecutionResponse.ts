/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `graphState` is ONE batch-level graph transfer for the whole response. It
 * carries selected terminal clone state as N-Quads, encoded once for the
 * entire item set. `items` carries one `{ id, runIri, terminalOutcome,
 * errors, intermediates }` entry per item. `terminalOutcome` is the routing
 * output the child DAG resolved to for that item — `'completed'` |
 * `'failed'` for a resolved terminal, or `'awaiting-input'` when the item's
 * lifecycle parked (human-in-the-loop) without reaching a terminal. `errors`
 * and `intermediates` are scoped to that item alone: one item's failure never
 * appears on a sibling's `errors`, and one item's per-node yields never
 * appear on a sibling's `intermediates`. There is no response-level `errors`
 * or `intermediates` field — every item owns its own.
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

import { GraphStateTransferSchema } from './GraphStateTransferSchema.js';
import type { GraphStateTransferType } from './GraphStateTransferSchema.js';

export const ExecutionResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationId', 'graphState', 'items'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'graphState':    GraphStateTransferSchema,
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'runIri', 'terminalOutcome', 'errors', 'intermediates'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'runIri':          { 'type': 'string', 'pattern': '^[A-Za-z][A-Za-z0-9+.-]*:' },
          'terminalOutcome': { 'type': 'string' },
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

/** TypeScript type derived from `ExecutionResponseSchema` with graph-transfer typing. */
export type ExecutionResponseType = Omit<ExecutionResponseWireType, 'graphState' | 'items'> & {
  graphState: GraphStateTransferType;
  items: ExecutionResponseItemType[];
};

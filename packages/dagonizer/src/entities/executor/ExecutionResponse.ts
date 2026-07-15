/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `items` carries one per-item result `{ id, graphState, terminalOutcome }`.
 * Single-item responses (N=1) use `items[0]`; multi-item batch responses
 * (N>1) carry one entry per item in the original request. The per-item
 * `terminalOutcome` is the routing output the child DAG resolved to for
 * that item. The per-item `snapshot` is the terminal state snapshot; null
 * when the item's DAG failed before producing a snapshot.
 *
 * The NodeError item shape references the single-source `NodeErrorProperties`
 * const and `NodeErrorSchema.required` from `node/NodeError.ts` structurally;
 * `json-schema-to-ts` reads the literal at compile time, so the derived type is
 * identical to an inline copy while field changes propagate from one place.
 *
 * The ExecutorIntermediate shape is also inlined here (same structural-copy
 * pattern). ExecutorIntermediate.ts is the canonical source of truth.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { GraphStateTransferType } from '../../contracts/GraphStateTransfer.js';
import { NodeErrorProperties, NodeErrorSchema } from '../node/NodeError.js';

import { GraphStateTransferSchema } from './GraphStateTransferSchema.js';

export const ExecutionResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationId', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'graphState', 'terminalOutcome'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'graphState':      GraphStateTransferSchema,
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
type ExecutionResponseItemType = Omit<ExecutionResponseWireType['items'][number], 'graphState'> & { graphState: GraphStateTransferType };

/** TypeScript type derived from `ExecutionResponseSchema` with canonical graph transfer typing. */
export type ExecutionResponseType = Omit<ExecutionResponseWireType, 'items'> & { items: ExecutionResponseItemType[] };

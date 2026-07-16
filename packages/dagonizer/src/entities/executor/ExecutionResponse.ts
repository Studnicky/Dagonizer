/**
 * ExecutionResponse: wire-safe result returned from an isolating container
 * backend to the dispatcher after completing a whole embedded DAG.
 *
 * `graphState` is ONE batch-level payload (`GraphStateTransfer`) for the whole
 * response. In the default `combined-nquads` transport it is the union of every
 * item's terminal state graph, encoded and hashed once; in the `per-item`
 * transport (non-inline modes) it carries one full transfer per item. `items`
 * carries one `{ id, runIri, terminalOutcome, jsonLd? }` entry per item; `runIri`
 * locates the item's `${runIri}#state` subgraph within the combined payload (or
 * matches its per-item transfer), and `terminalOutcome` is the routing output
 * the child DAG resolved to for that item. `jsonLd` carries the optional ld+json
 * cold-path view when that format is negotiated. Single-item responses (N=1)
 * are a batch of one through the identical path.
 *
 * The NodeError item shape references the single-source `NodeErrorProperties`
 * const and `NodeErrorSchema.required` from `node/NodeError.ts` structurally;
 * `json-schema-to-ts` reads the literal at compile time, so the derived type is
 * identical to an inline copy while field changes propagate from one place.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { GraphStateJsonLdDocumentType } from '../../contracts/GraphStateJsonLd.js';
import { NodeErrorProperties, NodeErrorSchema } from '../node/NodeError.js';

import { GraphStateJsonLdSchema, GraphStateTransferSchema } from './GraphStateTransferSchema.js';
import type { GraphStateTransferType } from './GraphStateTransferSchema.js';

export const ExecutionResponseSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationId', 'graphState', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'graphState':    GraphStateTransferSchema,
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
          'jsonLd':          GraphStateJsonLdSchema,
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
type ExecutionResponseItemType = Omit<ExecutionResponseItemWireType, 'jsonLd'> & { jsonLd?: GraphStateJsonLdDocumentType };

/** One response item: id, its state-graph run IRI, terminal outcome, and optional ld+json view. */
export type { ExecutionResponseItemType };

/** TypeScript type derived from `ExecutionResponseSchema` with canonical graph transfer typing. */
export type ExecutionResponseType = Omit<ExecutionResponseWireType, 'graphState' | 'items'> & {
  graphState: GraphStateTransferType;
  items: ExecutionResponseItemType[];
};

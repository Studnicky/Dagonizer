/**
 * ExecutionRequest: wire-safe representation of a DAG execution unit
 * sent from the dispatcher to an isolating container backend.
 *
 * DAG-only: no `variant` discriminant, no `nodeName`. A container runs
 * only whole DAGs, never individual nodes.
 *
 * `graphState` is ONE batch-level payload (`GraphStateTransfer`) for the whole
 * request. In the default `combined-nquads` transport it is a single inline
 * N-Quads document encoded and hashed once regardless of item count; in the
 * `per-item` transport (non-inline modes, store injected) it carries one full
 * transfer per item. `items` carries one `{ id, runIri, jsonLd? }` entry per
 * item; `runIri` identifies the item's `${runIri}#state` named subgraph within
 * the combined payload (or matches its per-item transfer). Single-item requests
 * (N=1) are a batch of one through the identical path. `jsonLd` carries the
 * optional ld+json cold-path view when that format is negotiated; it never
 * appears on the N-Quads hot path.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { GraphStateJsonLdDocumentType } from '../../contracts/GraphStateJsonLd.js';

import { GraphStateJsonLdSchema, GraphStateTransferSchema } from './GraphStateTransferSchema.js';
import type { GraphStateTransferType } from './GraphStateTransferSchema.js';

export const ExecutionRequestSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionRequest',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'placementPath', 'graphState', 'items', 'timeoutMs', 'correlationId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'graphState':    GraphStateTransferSchema,
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'runIri'],
        'properties': {
          'id':     { 'type': 'string', 'minLength': 1 },
          'runIri': { 'type': 'string', 'minLength': 1 },
          'jsonLd': GraphStateJsonLdSchema,
        },
        'additionalProperties': false,
      },
    },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'correlationId': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

type ExecutionRequestWireType = FromSchema<typeof ExecutionRequestSchema>;
type ExecutionRequestItemWireType = ExecutionRequestWireType['items'][number];
type ExecutionRequestItemType = Omit<ExecutionRequestItemWireType, 'jsonLd'> & { jsonLd?: GraphStateJsonLdDocumentType };

/** One request item: id, its state-graph run IRI, and optional ld+json view. */
export type { ExecutionRequestItemType };

/** TypeScript type derived from `ExecutionRequestSchema` with canonical graph transfer typing. */
export type ExecutionRequestType = Omit<ExecutionRequestWireType, 'graphState' | 'items'> & {
  graphState: GraphStateTransferType;
  items: ExecutionRequestItemType[];
};

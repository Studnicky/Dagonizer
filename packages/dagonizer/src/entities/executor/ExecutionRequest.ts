/**
 * ExecutionRequest: wire-safe representation of a DAG execution unit
 * sent from the dispatcher to an isolating container backend.
 *
 * DAG-only: no `variant` discriminant, no `nodeName`. A container runs
 * only whole DAGs, never individual nodes.
 *
 * `graphState` is ONE batch-level graph transfer for the whole request. The
 * selected child clone state is encoded as N-Quads once for the entire item
 * set. `items` carries one `{ id, runIri }` entry per
 * item; `runIri` remains the execution identity for that item. Single-item
 * requests (N=1) are a batch of one through the identical path.
 *
 * `responseState` declares the exact terminal child-state surface the caller
 * wants the host to return after contained execution. `defaultSelection`
 * applies to every item unless an `outputSelections[routeOutput]` override is
 * present for that routed output.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GraphStateTransferSchema } from './GraphStateTransferSchema.js';
import type { GraphStateTransferType } from './GraphStateTransferSchema.js';
import { TransientNodeStateResponseStateSchema } from './TransientNodeState.js';
import type { TransientNodeStateResponseStateType } from './TransientNodeState.js';

export const ExecutionRequestSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ExecutionRequest',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'placementPath', 'graphState', 'items', 'timeoutMs', 'correlationId', 'responseState'],
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
          'runIri': { 'type': 'string', 'pattern': '^[A-Za-z][A-Za-z0-9+.-]*:' },
        },
        'additionalProperties': false,
      },
    },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'responseState': TransientNodeStateResponseStateSchema,
  },
  'additionalProperties': false,
} as const;

type ExecutionRequestWireType = FromSchema<typeof ExecutionRequestSchema>;
type ExecutionRequestItemWireType = ExecutionRequestWireType['items'][number];
type ExecutionRequestItemType = ExecutionRequestItemWireType;

/** One request item: id and its state-graph run IRI. */
export type { ExecutionRequestItemType };

/** TypeScript type derived from `ExecutionRequestSchema` with graph-transfer typing. */
export type ExecutionRequestType = Omit<ExecutionRequestWireType, 'graphState' | 'items'> & {
  graphState: GraphStateTransferType;
  items: ExecutionRequestItemType[];
  responseState: TransientNodeStateResponseStateType;
};

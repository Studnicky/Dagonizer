/**
 * Parked: HITL park-and-correlate wire entity.
 *
 * Surfaced on `ExecutionResultType.parked` when a node routes to the
 * reserved `'parked'` output. The engine captures a checkpoint, transitions
 * the lifecycle to `awaiting-input`, and populates this entity so the caller
 * can persist the correlation key and resume later.
 *
 * Fields:
 *   correlationKey — opaque caller-supplied key for correlating the resume
 *                    with the original park. Written to state metadata by the
 *                    parking node via `state.setMetadata('correlationKey', key)`.
 *   cursor         — name of the parked placement (the resume entry point).
 *                    Pass this to `dispatcher.resume(dagName, state, cursor)`.
 *   dagName        — name of the parked DAG.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ParkedSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/Parked',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['correlationKey', 'cursor', 'dagName'],
  'properties': {
    'correlationKey': { 'type': 'string' },
    'cursor':         { 'type': 'string', 'minLength': 1 },
    'dagName':        { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ParkedSchema` via `json-schema-to-ts`. */
export type ParkedType = FromSchema<typeof ParkedSchema>;

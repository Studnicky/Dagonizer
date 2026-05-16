/**
 * DAGLifecycleStateSchema — uniform single-object schema for the DAG lifecycle
 * wire shape. All six kinds share an identical 5-field shape; `kind` is the
 * discriminator.
 *
 * The `error` field is opaque (`{ type: ['object', 'null'] }`) because `Error`
 * is not expressible in JSON Schema. The runtime carries the actual `Error`
 * instance via the canonical TS type at `lifecycle/DAGLifecycleState.ts`;
 * this schema is the wire/persistence shape only.
 *
 * The runtime reducer at `lifecycle/DAGLifecycleMachine.ts` is the
 * source of truth on transitions.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const DAGLifecycleStateSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAGLifecycleState',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['kind', 'startedAt', 'finishedAt', 'error', 'reason'],
  'properties': {
    'kind': { 'type': 'string', 'enum': ['pending', 'running', 'completed', 'failed', 'cancelled', 'timed_out'] },
    'startedAt': { 'type': ['integer', 'null'], 'minimum': 0 },
    'finishedAt': { 'type': ['integer', 'null'], 'minimum': 0 },
    'error': { 'type': ['object', 'null'] },
    'reason': { 'type': ['string', 'null'] },
  },
  'additionalProperties': false,
} as const;

/**
 * Wire-shape derived from the schema. Note: the canonical in-memory type
 * lives at `src/lifecycle/DAGLifecycleState.ts` and uses `Error`
 * directly on the `failed` branch — this `DAGLifecycleStateData` is
 * the persistence/transport shape where `error` is an opaque object.
 */
export type DAGLifecycleStateData = FromSchema<typeof DAGLifecycleStateSchema>;

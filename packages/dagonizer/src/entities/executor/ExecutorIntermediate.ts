/**
 * ExecutorIntermediate: one step yielded by a composite execution unit
 * (embedded DAG or scatter dag-body) as part of an ExecutionResponse.
 *
 * JSON Schema 2020-12 entity following the NodeContext pattern:
 * schema value + FromSchema-derived TypeScript type.
 *
 * Wire-safe: all fields are required; `output` is string-or-null because
 * the engine emits null for nodes that do not produce a routing token
 * (skipped, phase, or terminal-without-route). `skipped` and `nodeName`
 * are always present so the receiver never disambiguates absence from zero.
 *
 * This shape replaces the inline `{ output, skipped, nodeName, state }`
 * item in ExecutionResponse.intermediates and the equivalent copy in
 * BridgeMessageSchema's result branch. Both inline copies intentionally
 * duplicate this shape to avoid $ref resolution at compile time; the
 * canonical source of truth is this file.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ExecutorIntermediateSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ExecutorIntermediate',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['output', 'skipped', 'nodeName'],
  'properties': {
    'output':   { 'type': ['string', 'null'] },
    'skipped':  { 'type': 'boolean' },
    'nodeName': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ExecutorIntermediateSchema` via `json-schema-to-ts`. */
export type ExecutorIntermediate = FromSchema<typeof ExecutorIntermediateSchema>;

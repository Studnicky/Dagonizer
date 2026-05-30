/**
 * CheckpointData: persistable snapshot of an in-flight flow execution.
 *
 * Contains the flow name, the next-node cursor (`null` if the flow has
 * completed), the state snapshot as a JsonObject, and the executed /
 * skipped node history.
 *
 * The schema's `version` field tracks the wire format itself, not the
 * user's flow version; independent so wire migrations can ship without
 * invalidating existing checkpoints.
 *
 * jsontology migration: replace `FromSchema<typeof CheckpointDataSchema>`
 * with `EntityType<typeof CheckpointDataSchema['$id']>` and register the
 * schema in `entities/jt.ts`.
 */

import type { FromSchema } from 'json-schema-to-ts';

/** Current wire-format version for `CheckpointData`. Increment when the schema changes incompatibly. */
export const CHECKPOINT_DATA_VERSION = '1' as const;

export const CheckpointDataSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/CheckpointData',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['version', 'dagName', 'cursor', 'state', 'executedNodes', 'skippedNodes', 'stores'],
  'properties': {
    'version': { 'type': 'string', 'const': '1' },
    'dagName': { 'type': 'string', 'minLength': 1 },
    'cursor': { 'type': ['string', 'null'] },
    'state': { 'type': 'object' },
    'executedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    'skippedNodes': { 'type': 'array', 'items': { 'type': 'string' } },
    /**
     * Named-store snapshots, keyed by the store names passed to `capture`
     * (an empty object when no stores were captured). The same names must be
     * passed to `restoreStores` on resume.
     */
    'stores': {
      'type': 'object',
      'additionalProperties': {
        'type': 'object',
        'required': ['version', 'type', 'entries'],
        'properties': {
          'version': { 'type': 'integer' },
          'type':    { 'type': 'string' },
          'entries': {
            'type': 'array',
            'items': {
              'type': 'object',
              'required': ['key', 'value'],
              'properties': {
                'key':   { 'type': 'string' },
                'value': {},
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

/** TypeScript type derived from `CheckpointDataSchema` via `json-schema-to-ts`. */
export type CheckpointData = FromSchema<typeof CheckpointDataSchema>;

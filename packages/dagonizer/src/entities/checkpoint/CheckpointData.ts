/**
 * CheckpointData: persistable snapshot of an in-flight flow execution.
 *
 * Contains the flow name, the next-node cursor (`null` if the flow has
 * completed), the state snapshot as a JsonObjectType, and the executed /
 * skipped node history.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { StoreSnapshotType } from '../../contracts/SnapshottableInterface.js';
import type { JsonObjectType } from '../json.js';

export const CheckpointDataSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/CheckpointData',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'cursor', 'state', 'executedNodes', 'skippedNodes', 'stores'],
  'properties': {
    'dagName': { 'type': 'string', 'minLength': 1 },
    'cursor': { 'type': ['string', 'null'] },
    'state': { 'type': 'object', 'additionalProperties': true },
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

/**
 * TypeScript type derived from `CheckpointDataSchema` via `json-schema-to-ts`.
 *
 * `state` and `stores` are narrowed from the schema's open `object` shapes to
 * the precise in-process types (`JsonObjectType`, `StoreSnapshotType`): the
 * schema validates the wire structure at the ingest boundary, and the JSON it
 * admits is exactly these types, so every call site reads them without a cast.
 */
export type CheckpointDataType = Omit<FromSchema<typeof CheckpointDataSchema>, 'state' | 'stores'> & {
  state: JsonObjectType;
  stores: Record<string, StoreSnapshotType>;
};

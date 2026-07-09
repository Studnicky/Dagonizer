/**
 * StoreSnapshotType: persistable snapshot envelope for a named store.
 *
 * `StoreSnapshotEntryType` is one key-value pair in the snapshot.
 * `StoreSnapshotType` is the versioned envelope that wraps a store's full
 * contents at a point in time. Authors set `type` to a stable identifier
 * (e.g. `'memory-store-v1'`) so resume code can refuse incompatible snapshots.
 *
 * These schemas are the single source of truth; `contracts/SnapshottableInterface.ts`
 * imports its `StoreSnapshotEntryType` and `StoreSnapshotType` types from here.
 * `CheckpointDataSchema` embeds structurally identical inline shapes inside its
 * `stores` additionalProperties; both representations describe the same wire
 * format. The schema-derived types are identical due to structural typing.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const StoreSnapshotEntrySchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/StoreSnapshotEntryType',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['key', 'value'],
  'properties': {
    'key':   { 'type': 'string' },
    'value': {},
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `StoreSnapshotEntrySchema` via `json-schema-to-ts`. */
export type StoreSnapshotEntryWireType = FromSchema<typeof StoreSnapshotEntrySchema>;

export const StoreSnapshotSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/StoreSnapshotType',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
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
} as const;

/** TypeScript type derived from `StoreSnapshotSchema` via `json-schema-to-ts`. */
export type StoreSnapshotWireType = FromSchema<typeof StoreSnapshotSchema>;

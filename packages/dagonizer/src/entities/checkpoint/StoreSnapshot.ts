/**
 * StoreSnapshot: persistable snapshot envelope for a named store.
 *
 * `StoreSnapshotEntry` is one key-value pair in the snapshot.
 * `StoreSnapshot` is the versioned envelope that wraps a store's full
 * contents at a point in time. Authors set `type` to a stable identifier
 * (e.g. `'memory-store-v1'`) so resume code can refuse incompatible snapshots.
 *
 * These schemas are the single source of truth; `contracts/Snapshottable.ts`
 * imports its `StoreSnapshotEntry` and `StoreSnapshot` types from here.
 * `CheckpointDataSchema` embeds structurally identical inline shapes inside its
 * `stores` additionalProperties; both representations describe the same wire
 * format. The schema-derived types are identical due to structural typing.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const StoreSnapshotEntrySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/StoreSnapshotEntry',
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
export type StoreSnapshotEntry = FromSchema<typeof StoreSnapshotEntrySchema>;

export const StoreSnapshotSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/StoreSnapshot',
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
export type StoreSnapshot = FromSchema<typeof StoreSnapshotSchema>;

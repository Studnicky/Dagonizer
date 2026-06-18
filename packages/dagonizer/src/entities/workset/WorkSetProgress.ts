/**
 * WorkSet progress wire shapes: JSON Schema 2020-12 definitions for the
 * entities persisted to checkpoint metadata under `WORKSET_PROGRESS_KEY`.
 *
 * Shape summary:
 *   WorkSetItem     — one item in the work set: its id + its state snapshot.
 *   WorkSetEntry    — all items pending at a single placement.
 *   WorkSetProgress — the full in-flight work set captured at interruption.
 *
 * This entity mirrors the `ScatterProgress` precedent from
 * `entities/scatter/ScatterProgress.ts`. It is written to top-level state
 * metadata by `WorkSetCheckpoint` at the abort boundary and read back at
 * the resume boundary to rebuild `pending` with the correct item states.
 *
 * The blob is absent for size-1 canonical runs (one item whose state IS
 * the top-level state) because the cursor model covers that case exactly.
 */

import type { FromSchema } from 'json-schema-to-ts';

// ---------------------------------------------------------------------------
// WorkSetItem
// ---------------------------------------------------------------------------

export const WorkSetItemSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/WorkSetItem',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['id', 'snapshot'],
  'properties': {
    'id':       { 'type': 'string' },
    'snapshot': { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

/**
 * One item in the work set: its stable string `id` and its state `snapshot`
 * at the point of interruption. Used by `WorkSetCheckpoint` to rehydrate
 * the pending batch on resume.
 */
export type WorkSetItem = FromSchema<typeof WorkSetItemSchema>;

// ---------------------------------------------------------------------------
// WorkSetEntry
// ---------------------------------------------------------------------------

export const WorkSetEntrySchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/WorkSetEntry',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['placement', 'items'],
  'properties': {
    'placement': { 'type': 'string', 'minLength': 1 },
    'items': {
      'type': 'array',
      'items': WorkSetItemSchema,
    },
  },
  'additionalProperties': false,
} as const;

/**
 * All work-set items pending at a single placement at interruption time.
 * `placement` is the placement name; `items` is the ordered list of pending
 * `WorkSetItem` values for that placement.
 */
export type WorkSetEntry = FromSchema<typeof WorkSetEntrySchema>;

// ---------------------------------------------------------------------------
// WorkSetProgress
// ---------------------------------------------------------------------------

export const WorkSetProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/WorkSetProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['entries'],
  'properties': {
    'entries': {
      'type': 'array',
      'items': WorkSetEntrySchema,
    },
  },
  'additionalProperties': false,
} as const;

/**
 * Full in-flight work set captured at interruption, keyed by placement.
 * Written to top-level state metadata by `WorkSetCheckpoint` at the abort
 * boundary; read back on resume to rebuild the pending batches. Absent for
 * size-1 canonical runs (single item whose state is the top-level state).
 */
export type WorkSetProgress = FromSchema<typeof WorkSetProgressSchema>;

/**
 * Scatter progress wire shapes: JSON Schema 2020-12 definitions for the
 * entities persisted to checkpoint metadata under `SCATTER_PROGRESS_KEY`.
 *
 * Shape summary:
 *   ScatterInboxItem      — one item pulled from the source but not yet acked.
 *   ScatterAckedResult    — one successfully completed item; discriminated on `variant`.
 *   ScatterProgress       — per-placement resume bookkeeping; discriminated on `mode`:
 *                           'retained' (full acked results) or 'bounded' (watermark).
 *   StoredScatterProgress — map keyed by placement name stored in metadata.
 */

import type { FromSchema } from 'json-schema-to-ts';

// ---------------------------------------------------------------------------
// ScatterInboxItem
// ---------------------------------------------------------------------------

/**
 * One item pulled from the scatter source array that has not yet been
 * acknowledged (i.e., its body has not completed). Persisted to checkpoint
 * metadata so the scatter loop can resume without reprocessing items.
 *
 * `index` is the 0-based position in the source array.
 * `item` is the raw source element (opaque at the schema layer).
 * `bufferKey` is the reservoir partition key when the scatter placement
 * uses a `reservoir` config; absent for non-reservoir scatter.
 */
export const ScatterInboxItemSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterInboxItem',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['index', 'item'],
  'properties': {
    'index':     { 'type': 'integer', 'minimum': 0 },
    'item':      {},
    'bufferKey': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterInboxItemSchema` via `json-schema-to-ts`. */
export type ScatterInboxItemType = FromSchema<typeof ScatterInboxItemSchema>;

// ---------------------------------------------------------------------------
// ScatterAckedResult
// ---------------------------------------------------------------------------

export const ScatterAckedResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterAckedResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output', 'mappingValues'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'map' },
        'index':         { 'type': 'integer', 'minimum': 0 },
        'item':          {},
        'output':        { 'type': 'string' },
        'mappingValues': { 'type': 'object' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output', 'fieldValue'],
      'properties': {
        'variant':    { 'type': 'string', 'const': 'field' },
        'index':      { 'type': 'integer', 'minimum': 0 },
        'item':       {},
        'output':     { 'type': 'string' },
        'fieldValue': {},
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output'],
      'properties': {
        'variant': { 'type': 'string', 'const': 'plain' },
        'index':   { 'type': 'integer', 'minimum': 0 },
        'item':    {},
        'output':  { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/**
 * One successfully completed scatter item.
 * Discriminated on `variant`:
 *   `map`:   carries `mappingValues`, the resolved clone-field-to-parent-path mapping values.
 *   `field`: carries `fieldValue`, the value of `gather.field` read from the clone state.
 *   `plain`: carries only the routing `output`; used by `collect`, `discard`, and `partition` strategies.
 */
export type ScatterAckedResultType = FromSchema<typeof ScatterAckedResultSchema>;

// ---------------------------------------------------------------------------
// ScatterProgress (discriminated union: 'retained' | 'bounded')
// ---------------------------------------------------------------------------

/** Inline inbox-item shape for use inside ScatterProgressSchema oneOf branches. */
const inboxItemInline = {
  'type': 'object',
  'required': ['index', 'item'],
  'properties': {
    'index':     { 'type': 'integer', 'minimum': 0 },
    'item':      {},
    'bufferKey': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/** Inline acked-result shape for use inside the retained branch. */
const ackedResultInline = {
  'oneOf': [
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output', 'mappingValues'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'map' },
        'index':         { 'type': 'integer', 'minimum': 0 },
        'item':          {},
        'output':        { 'type': 'string' },
        'mappingValues': { 'type': 'object' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output', 'fieldValue'],
      'properties': {
        'variant':    { 'type': 'string', 'const': 'field' },
        'index':      { 'type': 'integer', 'minimum': 0 },
        'item':       {},
        'output':     { 'type': 'string' },
        'fieldValue': {},
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'index', 'item', 'output'],
      'properties': {
        'variant': { 'type': 'string', 'const': 'plain' },
        'index':   { 'type': 'integer', 'minimum': 0 },
        'item':    {},
        'output':  { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

export const ScatterProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['mode', 'placementName', 'inbox', 'ackedResults'],
      'properties': {
        'mode':          { 'type': 'string', 'const': 'retained' },
        'placementName': { 'type': 'string', 'minLength': 1 },
        'inbox':         { 'type': 'array', 'items': inboxItemInline },
        'ackedResults':  { 'type': 'array', 'items': ackedResultInline },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['mode', 'placementName', 'inbox', 'watermark', 'aheadAcked', 'outcomeTally'],
      'properties': {
        'mode':          { 'type': 'string', 'const': 'bounded' },
        'placementName': { 'type': 'string', 'minLength': 1 },
        'inbox':         { 'type': 'array', 'items': inboxItemInline },
        'watermark':     { 'type': 'integer', 'minimum': 0 },
        'aheadAcked':    {
          'type': 'array',
          'items': {
            'type': 'object',
            'required': ['index', 'output'],
            'properties': {
              'index':  { 'type': 'integer', 'minimum': 0 },
              'output': { 'type': 'string' },
            },
            'additionalProperties': false,
          },
        },
        'outcomeTally':  {
          'type': 'object',
          'additionalProperties': { 'type': 'integer', 'minimum': 0 },
        },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/**
 * Per-placement resume bookkeeping persisted under `SCATTER_PROGRESS_KEY`.
 * Discriminated on `mode`:
 *   `retained`: full acked results are stored (used by strategies that need
 *               per-clone data on gather, e.g. `map`, `append`, `collect`).
 *   `bounded`:  only a watermark + ahead-acked indices are stored; used by
 *               memory-bounded strategies (`collect` with large source arrays,
 *               `partition`, `discard`) where retaining all results is not needed.
 */
export type ScatterProgressType = FromSchema<typeof ScatterProgressSchema>;

// ---------------------------------------------------------------------------
// StoredScatterProgress
// ---------------------------------------------------------------------------

export const StoredScatterProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/StoredScatterProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'additionalProperties': ScatterProgressSchema,
} as const;

/**
 * Map of `ScatterProgressType` values keyed by placement name.
 * Stored in checkpoint metadata under `SCATTER_PROGRESS_KEY` when a
 * scatter run is interrupted; each key is the scatter placement's `name`.
 */
export type StoredScatterProgressType = FromSchema<typeof StoredScatterProgressSchema>;

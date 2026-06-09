/**
 * Scatter progress wire shapes: canonical JSON Schema 2020-12 definitions
 * for the entities persisted to checkpoint metadata under `SCATTER_PROGRESS_KEY`.
 *
 * These types mirror the hand-written interfaces in `Dagonizer.ts` exactly so
 * Wave 3 can swap the import and delete the hand-written declarations without
 * touching call sites.
 *
 * Shape summary:
 *   ScatterInboxItem     — one item pulled from the source but not yet acked.
 *   ScatterAckedResult   — one successfully completed item; discriminated on `kind`.
 *   ScatterProgress      — per-placement resume bookkeeping (inbox + ackedResults).
 *   StoredScatterProgress — map keyed by placement name stored in metadata.
 */

import type { FromSchema } from 'json-schema-to-ts';

// ---------------------------------------------------------------------------
// ScatterInboxItem
// ---------------------------------------------------------------------------

export const ScatterInboxItemSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterInboxItem',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['index', 'item'],
  'properties': {
    'index': { 'type': 'integer', 'minimum': 0 },
    'item':  {},
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterInboxItemSchema` via `json-schema-to-ts`. */
export type ScatterInboxItem = FromSchema<typeof ScatterInboxItemSchema>;

// ---------------------------------------------------------------------------
// ScatterAckedResult
// ---------------------------------------------------------------------------

export const ScatterAckedResultSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterAckedResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['kind', 'index', 'item', 'output', 'mappingValues'],
      'properties': {
        'kind':          { 'type': 'string', 'const': 'map' },
        'index':         { 'type': 'integer', 'minimum': 0 },
        'item':          {},
        'output':        { 'type': 'string' },
        'mappingValues': { 'type': 'object' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'index', 'item', 'output', 'fieldValue'],
      'properties': {
        'kind':       { 'type': 'string', 'const': 'field' },
        'index':      { 'type': 'integer', 'minimum': 0 },
        'item':       {},
        'output':     { 'type': 'string' },
        'fieldValue': {},
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'index', 'item', 'output'],
      'properties': {
        'kind':   { 'type': 'string', 'const': 'plain' },
        'index':  { 'type': 'integer', 'minimum': 0 },
        'item':   {},
        'output': { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/** TypeScript type derived from `ScatterAckedResultSchema` via `json-schema-to-ts`. */
export type ScatterAckedResult = FromSchema<typeof ScatterAckedResultSchema>;

// ---------------------------------------------------------------------------
// ScatterProgress
// ---------------------------------------------------------------------------

export const ScatterProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/ScatterProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['placementName', 'inbox', 'ackedResults'],
  'properties': {
    'placementName': { 'type': 'string', 'minLength': 1 },
    'inbox': {
      'type': 'array',
      'items': ScatterInboxItemSchema,
    },
    'ackedResults': {
      'type': 'array',
      'items': ScatterAckedResultSchema,
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `ScatterProgressSchema` via `json-schema-to-ts`. */
export type ScatterProgress = FromSchema<typeof ScatterProgressSchema>;

// ---------------------------------------------------------------------------
// StoredScatterProgress
// ---------------------------------------------------------------------------

export const StoredScatterProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/StoredScatterProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'additionalProperties': ScatterProgressSchema,
} as const;

/** TypeScript type derived from `StoredScatterProgressSchema` via `json-schema-to-ts`. */
export type StoredScatterProgress = FromSchema<typeof StoredScatterProgressSchema>;

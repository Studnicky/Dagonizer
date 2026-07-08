import type { FromSchema } from 'json-schema-to-ts';

export const GatherRecordProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherRecordProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['source', 'index', 'output', 'terminalOutcome'],
  'properties': {
    'source':          { 'type': 'string', 'minLength': 1 },
    'index':           { 'type': ['integer', 'null'], 'minimum': 0 },
    'item':            {},
    'output':          { 'type': 'string' },
    'terminalOutcome': { 'type': ['string', 'null'], 'enum': ['completed', 'failed', null] },
    'result':          {},
    'snapshot':        { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

export const GatherProgressSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/GatherProgress',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['entries'],
  'properties': {
    'entries': {
      'type': 'object',
      'additionalProperties': {
        'type': 'array',
        'items': GatherRecordProgressSchema,
      },
    },
  },
  'additionalProperties': false,
} as const;

export type GatherRecordProgressType = FromSchema<typeof GatherRecordProgressSchema>;
export type GatherProgressType = FromSchema<typeof GatherProgressSchema>;

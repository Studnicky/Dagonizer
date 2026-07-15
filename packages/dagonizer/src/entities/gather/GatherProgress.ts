import type { FromSchema } from 'json-schema-to-ts';

import type { GraphStateJsonLdDocumentType } from '../../contracts/GraphStateJsonLd.js';

export const GatherRecordProgressSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/GatherRecordProgress',
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
    'graphState':      { 'type': 'object', 'required': ['@context', '@graph'], 'additionalProperties': true },
  },
  'additionalProperties': false,
  'anyOf': [
    { 'required': ['graphState'] },
    { 'required': ['result'] },
  ],
} as const;

export const GatherProgressSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/GatherProgress',
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

export type GatherRecordProgressType = Omit<FromSchema<typeof GatherRecordProgressSchema>, 'graphState'> & { graphState?: GraphStateJsonLdDocumentType };
export type GatherProgressType = { entries: Record<string, GatherRecordProgressType[]> };

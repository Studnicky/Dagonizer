/**
 * CheckpointData: persistable snapshot of an in-flight flow execution.
 *
 * Contains the flow name, the next-node cursor (`null` if the flow has
 * completed), the graph-state JSON-LD document, and execution history.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { GraphStateJsonLdDocumentType } from '../../contracts/GraphStateJsonLd.js';
import type { StoreSnapshotType } from '../../contracts/SnapshottableInterface.js';

export const CheckpointDataSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/CheckpointData',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['dagName', 'cursor', 'graph', 'executedNodes', 'skippedNodes', 'stores'],
  'properties': {
    'dagName': { 'type': 'string', 'minLength': 1 },
    'cursor': { 'type': ['string', 'null'] },
    'graph': {
      'type': 'object',
      'required': ['runIri', 'graphIri', 'nquads', 'hash', 'jsonLd'],
      'properties': {
        'runIri': { 'type': 'string', 'minLength': 1 },
        'graphIri': { 'type': 'string', 'minLength': 1 },
        'nquads': { 'type': 'string' },
        'hash': { 'type': 'string', 'minLength': 1 },
        'jsonLd': { 'type': 'object', 'required': ['@context', '@graph'], 'additionalProperties': true },
      },
      'additionalProperties': false,
    },
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
 * `stores` is narrowed from the schema's open object shape to the precise
 * in-process type; graph state is always the context-bound JSON-LD document.
 */
export type CheckpointDataType = Omit<FromSchema<typeof CheckpointDataSchema>, 'stores'> & {
  stores: Record<string, StoreSnapshotType>;
  graph: {
    runIri: string;
    graphIri: string;
    nquads: string;
    hash: string;
    jsonLd: GraphStateJsonLdDocumentType;
  };
};

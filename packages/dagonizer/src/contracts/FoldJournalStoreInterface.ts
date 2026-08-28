import type { GatherRecordProgressType } from '../entities/gather/GatherProgress.js';
import type { ScatterProgressType } from '../entities/scatter/ScatterProgress.js';

export namespace FoldJournalStoreInterface {
  export const CommitSchema = {
    '$id': 'https://noocodec.dev/schemas/dagonizer/FoldJournalCommit',
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    'type': 'object',
    'required': ['commitId', 'scatterIri', 'completed', 'progress', 'entries'],
    'properties': {
      'commitId': { 'type': 'string', 'minLength': 1 },
      'scatterIri': { 'type': 'string', 'minLength': 1 },
      'completed': { 'type': 'boolean' },
      'progress': {
        'type': 'object',
        'required': ['mode', 'placementName', 'inbox', 'watermark', 'aheadAcked', 'outcomeTally'],
        'properties': {
          'mode': { 'type': 'string', 'const': 'bounded' },
          'placementName': { 'type': 'string', 'minLength': 1 },
          'inbox': {
            'type': 'array',
            'items': {
              'type': 'object',
              'required': ['index', 'item'],
              'properties': {
                'index': { 'type': 'integer', 'minimum': 0 },
                'item': {},
                'bufferKey': { 'type': 'string' },
              },
              'additionalProperties': false,
            },
          },
          'watermark': { 'type': 'integer', 'minimum': 0 },
          'aheadAcked': {
            'type': 'array',
            'items': {
              'type': 'object',
              'required': ['index', 'output'],
              'properties': {
                'index': { 'type': 'integer', 'minimum': 0 },
                'output': { 'type': 'string' },
              },
              'additionalProperties': false,
            },
          },
          'outcomeTally': {
            'type': 'object',
            'additionalProperties': { 'type': 'integer', 'minimum': 0 },
          },
        },
        'additionalProperties': false,
      },
      'entries': {
        'type': 'array',
        'items': {
          'type': 'object',
          'required': ['gatherKey', 'record'],
          'properties': {
            'gatherKey': { 'type': 'string', 'minLength': 1 },
            'record': {
              'type': 'object',
              'required': ['source', 'index', 'output', 'terminalOutcome', 'contribution'],
              'properties': {
                'source': { 'type': 'string', 'minLength': 1 },
                'index': { 'type': 'integer', 'minimum': 0 },
                'item': {},
                'output': { 'type': 'string' },
                'terminalOutcome': { 'type': ['string', 'null'], 'enum': ['completed', 'failed', null] },
                'result': {},
                'contribution': {},
              },
              'additionalProperties': false,
            },
          },
          'additionalProperties': false,
        },
      },
    },
    'additionalProperties': false,
  } as const;

  export type EntryType = {
    readonly gatherKey: string;
    readonly record: Omit<GatherRecordProgressType, 'contribution' | 'graphState' | 'index'> & {
      readonly index: number;
      readonly contribution: unknown;
    };
  };

  export type CommitType = {
    readonly commitId: string;
    readonly scatterIri: string;
    readonly completed: boolean;
    readonly progress: Extract<ScatterProgressType, { readonly mode: 'bounded' }>;
    readonly entries: readonly EntryType[];
  };
}

/** Durable append log for atomic fold-contribution and scatter-watermark commits. */
export interface FoldJournalStoreInterface {
  /**
   * Atomically persist one commit before resolving. Repeating an existing
   * `commitId` for the same run is an idempotent success.
   */
  append(runIri: string, commit: FoldJournalStoreInterface.CommitType): Promise<void>;

  /** Read committed records in append order. */
  read(runIri: string): AsyncIterable<FoldJournalStoreInterface.CommitType>;
}

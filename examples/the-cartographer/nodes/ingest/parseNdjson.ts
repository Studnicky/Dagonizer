/**
 * parse-ndjson: shared ingest transform — NDJSON text → array of records.
 *
 * Reads the decompressed NDJSON text from state.decodedText (the decompress node
 * inflated the gzip payload), parses each non-empty line as a JSON object, and
 * writes the records to state.parsedRecords for the map-fields node. Malformed
 * lines are skipped (the node never throws).
 *
 * Routes 'map-fields' on success; 'invalid' when no line parses.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region parse-ndjson-node
export const parseNdjson: NodeInterface<CartographerState, 'map-fields' | 'invalid', CartographerServices> = {
  'name': 'parse-ndjson',
  'outputs': ['map-fields', 'invalid'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const lines = state.decodedText.split('\n').filter((l) => l.trim().length > 0);
    const records: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          records.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Skip a malformed line; the rest of the source still ingests.
      }
    }
    if (records.length === 0) {
      return { 'output': 'invalid' };
    }
    state.parsedRecords = records;
    return { 'output': 'map-fields' };
  },
};
// #endregion parse-ndjson-node

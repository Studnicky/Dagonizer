/**
 * parse-ndjson: ingest transform — NDJSON text → array of records.
 *
 * Reads NDJSON text from state.decodedText when the source was gzipped
 * (decodedText populated by the decompress node), else from
 * state.currentSource.payload for plain NDJSON sources. Parses each non-empty
 * line as a JSON object and writes the records to state.parsedRecords.
 * Malformed lines are skipped (the node never throws).
 *
 * Routes 'normalized' on success; 'invalid' when no line parses.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region parse-ndjson-node
export class ParseNdjsonNode extends ScalarNode<CartographerState, 'normalized' | 'invalid', CartographerServices> {
  readonly 'name' = 'parse-ndjson';
  readonly 'outputs' = ['normalized', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalized' | 'invalid'>> {
    // Use decompressed text when available (gzip path), else the raw payload.
    const text = state.decodedText.length > 0 ? state.decodedText : state.currentSource.payload;
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
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
      return NodeOutputBuilder.of('invalid');
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('normalized');
  }
}

export const parseNdjson = new ParseNdjsonNode();
// #endregion parse-ndjson-node

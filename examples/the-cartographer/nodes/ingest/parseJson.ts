/**
 * parse-json: ingest transform — JSON array text → array of records.
 *
 * Reads JSON text from state.decodedText when the source was gzipped
 * (decodedText populated by the decompress node), else from
 * state.currentSource.payload for plain JSON sources. Parses the text and
 * (when it is an array of objects) writes the records to state.parsedRecords.
 * JSON sources carry native types (numbers as numbers), which the coerce-types
 * node tolerates.
 *
 * Routes 'normalized' on success; 'invalid' when the payload is not a JSON array.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region parse-json-node
export class ParseJsonNode extends ScalarNode<CartographerState, 'normalized' | 'invalid', CartographerServices> {
  readonly 'name' = 'parse-json';
  readonly 'outputs' = ['normalized', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextType<CartographerServices>): Promise<NodeOutputType<'normalized' | 'invalid'>> {
    // Use decompressed text when available (gzip path), else the raw payload.
    const text = state.decodedText.length > 0 ? state.decodedText : state.currentSource.payload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NodeOutputBuilder.of('invalid');
    }
    if (!Array.isArray(parsed)) {
      return NodeOutputBuilder.of('invalid');
    }
    const records: Array<Record<string, unknown>> = [];
    for (const row of parsed) {
      if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
        records.push(row as Record<string, unknown>);
      }
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('normalized');
  }
}

export const parseJson = new ParseJsonNode();
// #endregion parse-json-node

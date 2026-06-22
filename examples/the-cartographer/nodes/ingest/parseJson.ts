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

import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-json-node
export class ParseJsonNode extends ScalarNode<CartographerState, 'normalized' | 'invalid'> {
  readonly 'name' = 'parse-json';
  readonly 'outputs' = ['normalized', 'invalid'] as const;

  /** Narrows `unknown` to `Record<string, unknown>` via structural runtime checks. */
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  override get outputSchema(): Record<'normalized' | 'invalid', SchemaObjectType> {
    return {
      'normalized': { 'type': 'object' },
      'invalid':    { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'normalized' | 'invalid'>> {
    // Use decompressed text when available (gzip path), else the raw payload.
    const text = state.decodedText.length > 0 ? state.decodedText : state.currentSource.payload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (caught) {
      // Capture the parse failure as data rather than swallowing it. The node
      // still routes 'invalid' (graceful); the error rides on state.capturedErrors.
      state.capturedErrors = [...state.capturedErrors, GeoErrorRecord.capture('parse-json', caught, `source=${state.currentSource.sourceId}`)];
      return NodeOutputBuilder.of('invalid');
    }
    if (!Array.isArray(parsed)) {
      return NodeOutputBuilder.of('invalid');
    }
    const records: Array<Record<string, unknown>> = [];
    for (const row of parsed) {
      if (ParseJsonNode.isRecord(row)) {
        records.push(row);
      }
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('normalized');
  }
}

export const parseJson = new ParseJsonNode();
// #endregion parse-json-node

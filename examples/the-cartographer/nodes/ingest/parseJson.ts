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

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-json-node
export class ParseJsonNode extends MonadicNode<CartographerState, 'normalized' | 'invalid'> {
  readonly '@id' = 'urn:noocodec:node:parse-json';
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

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'normalized' | 'invalid', CartographerState>> {
    const acc = new Map<'normalized' | 'invalid', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'normalized' | 'invalid', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'normalized' | 'invalid'> {
    // Use decompressed text when available (gzip path), else the raw payload.
    const text = state.decodedText.length > 0 ? state.decodedText : state.currentSource.payload;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (caught) {
      // Capture the parse failure as data rather than swallowing it. The node
      // still routes 'invalid' (graceful); the error rides on state.capturedErrors.
      state.capturedErrors = [...state.capturedErrors, GeoErrorRecord.capture('parse-json', caught, `source=${state.currentSource.sourceId}`)];
      return NodeOutput.create('invalid');
    }
    if (!Array.isArray(parsed)) {
      return NodeOutput.create('invalid');
    }
    const records: Array<Record<string, unknown>> = [];
    for (const row of parsed) {
      if (ParseJsonNode.isRecord(row)) {
        records.push(row);
      }
    }
    state.parsedRecords = records;
    return NodeOutput.create('normalized');
  }
}

export const parseJson = new ParseJsonNode();
// #endregion parse-json-node

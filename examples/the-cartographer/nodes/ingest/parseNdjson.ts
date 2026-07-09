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

import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';
import type { GeoErrorRecordType } from '../../errors/GeoErrorRecord.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-ndjson-node
export class ParseNdjsonNode extends MonadicNode<CartographerState, 'normalized' | 'invalid'> {
  readonly '@id' = 'urn:noocodec:node:parse-ndjson';
  readonly 'name' = 'parse-ndjson';
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
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const records: Array<Record<string, unknown>> = [];
    const lineErrors: GeoErrorRecordType[] = [];
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (ParseNdjsonNode.isRecord(parsed)) {
          records.push(parsed);
        }
      } catch (caught) {
        // Capture the malformed line as data; the rest of the source still ingests.
        lineErrors.push(GeoErrorRecord.capture('parse-ndjson', caught, `source=${state.currentSource.sourceId}`));
      }
    }
    if (lineErrors.length > 0) {
      state.capturedErrors = [...state.capturedErrors, ...lineErrors];
    }
    if (records.length === 0) {
      return NodeOutput.create('invalid');
    }
    state.parsedRecords = records;
    return NodeOutput.create('normalized');
  }
}

export const parseNdjson = new ParseNdjsonNode();
// #endregion parse-ndjson-node

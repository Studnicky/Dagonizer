/**
 * parse-yaml: ingest transform — YAML sequence text → array of records.
 *
 * Reads YAML text from state.decodedText when the source was gzipped
 * (decodedText populated by the decompress node), else from
 * state.currentSource.payload for plain YAML sources. Parses the text as a
 * YAML sequence of mappings and writes the records to state.parsedRecords.
 * The node never throws: parse failure and non-array results both route 'invalid'.
 *
 * Routes 'normalized' on success; 'invalid' when the payload fails to parse
 * or does not yield an array.
 */

import { parse as yamlParse } from 'yaml';

import type { CartographerState } from '../../CartographerState.ts';

import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';

import { Batch, MonadicNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-yaml-node
export class ParseYamlNode extends MonadicNode<CartographerState, 'normalized' | 'invalid'> {
  readonly 'name' = 'parse-yaml';
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
      parsed = yamlParse(text);
    } catch (caught) {
      // Capture the parse failure as data rather than swallowing it.
      state.capturedErrors = [...state.capturedErrors, GeoErrorRecord.capture('parse-yaml', caught, `source=${state.currentSource.sourceId}`)];
      return NodeOutputBuilder.of('invalid');
    }
    if (!Array.isArray(parsed)) {
      return NodeOutputBuilder.of('invalid');
    }
    const records: Array<Record<string, unknown>> = [];
    for (const row of parsed) {
      if (ParseYamlNode.isRecord(row)) {
        records.push(row);
      }
    }
    if (records.length === 0) {
      return NodeOutputBuilder.of('invalid');
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('normalized');
  }
}

export const parseYaml = new ParseYamlNode();
// #endregion parse-yaml-node

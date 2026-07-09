/**
 * route-format: reads the current source's format and routes to the matching
 * format-specific parser. Format and compression are orthogonal: both plain
 * and decompressed sources arrive here regardless of their original compression.
 *
 * Routes:
 *   - 'csv'    → parse-csv
 *   - 'json'   → parse-json
 *   - 'ndjson' → parse-ndjson
 *   - 'yaml'   → parse-yaml
 *   - 'invalid' for an unrecognised format value
 *
 * Text source for parsers: decompressed sources have state.decodedText populated
 * by the decompress node; plain sources carry text in state.currentSource.payload.
 * Each parser reads whichever is populated (decodedText when non-empty, else payload).
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { SourcePayload } from '../../entities/SourcePayload.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region route-format-node
const FORMAT_ROUTE: Readonly<Record<SourcePayload['format'], 'csv' | 'json' | 'ndjson' | 'yaml'>> = {
  'csv':   'csv',
  'json':  'json',
  'ndjson': 'ndjson',
  'yaml':  'yaml',
};

export class RouteFormatNode extends MonadicNode<CartographerState, 'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid'> {
  readonly '@id' = 'urn:noocodec:node:route-format';
  readonly 'name' = 'route-format';
  readonly 'outputs' = ['csv', 'json', 'ndjson', 'yaml', 'invalid'] as const;

  override get outputSchema(): Record<'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid', SchemaObjectType> {
    return {
      'csv':     { 'type': 'object' },
      'json':    { 'type': 'object' },
      'ndjson':  { 'type': 'object' },
      'yaml':    { 'type': 'object' },
      'invalid': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid', CartographerState>> {
    const acc = new Map<'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid', ItemType<CartographerState>[]>();

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

    const routed = new Map<'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'csv' | 'json' | 'ndjson' | 'yaml' | 'invalid'> {
    const route = FORMAT_ROUTE[state.currentSource.format];
    if (route === undefined) {
      return NodeOutput.create('invalid');
    }
    return NodeOutput.create(route);
  }
}

export const routeFormat = new RouteFormatNode();
// #endregion route-format-node

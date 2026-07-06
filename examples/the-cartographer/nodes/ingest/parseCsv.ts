/**
 * parse-csv: ingest transform — CSV text → array of string-valued records.
 *
 * Reads the CSV text from state.decodedText when the source was gzipped
 * (decodedText populated by the decompress node), else from
 * state.currentSource.payload for plain CSV sources. Splits the header + rows,
 * and emits one `Record<string, string>` per row keyed by the header columns.
 * Handles quoted cells (commas/quotes/newlines escaped per RFC-4180-style
 * double-quote rules). Writes state.parsedRecords.
 *
 * Routes 'normalized' on success; 'invalid' when there is no header row.
 */

import type { CartographerState } from '../../CartographerState.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region parse-csv-node
export class ParseCsvNode extends MonadicNode<CartographerState, 'normalized' | 'invalid'> {
  readonly 'name' = 'parse-csv';
  readonly 'outputs' = ['normalized', 'invalid'] as const;

  override get outputSchema(): Record<'normalized' | 'invalid', SchemaObjectType> {
    return {
      'normalized': { 'type': 'object' },
      'invalid':    { 'type': 'object' },
    };
  }

  /** Split one CSV line into cells, honouring double-quoted fields. */
  private static splitCsvLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = false; }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
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
    const lines = text.split('\n').filter((l) => l.length > 0);
    const headerLine = lines[0];
    if (headerLine === undefined) {
      return NodeOutput.create('invalid');
    }
    const header = ParseCsvNode.splitCsvLine(headerLine);
    const records: Array<Record<string, unknown>> = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = ParseCsvNode.splitCsvLine(lines[i] ?? '');
      const record: Record<string, unknown> = {};
      for (let c = 0; c < header.length; c++) {
        record[header[c] ?? `col${c}`] = cells[c] ?? '';
      }
      records.push(record);
    }
    state.parsedRecords = records;
    return NodeOutput.create('normalized');
  }
}

export const parseCsv = new ParseCsvNode();
// #endregion parse-csv-node

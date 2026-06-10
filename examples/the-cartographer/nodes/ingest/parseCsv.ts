/**
 * parse-csv: shared ingest transform — CSV text → array of string-valued records.
 *
 * Reads the CSV payload from state.currentSource.payload (CSV is not compressed),
 * splits the header + rows, and emits one `Record<string, string>` per row keyed
 * by the header columns. Handles quoted cells (commas/quotes/newlines escaped per
 * RFC-4180-style double-quote rules). Writes state.parsedRecords.
 *
 * Routes 'map-fields' on success; 'invalid' when there is no header row.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region parse-csv-node
/** Split one CSV line into cells, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
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

export const parseCsv: NodeInterface<CartographerState, 'map-fields' | 'invalid', CartographerServices> = {
  'name': 'parse-csv',
  'outputs': ['map-fields', 'invalid'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const text = state.currentSource.payload;
    const lines = text.split('\n').filter((l) => l.length > 0);
    const headerLine = lines[0];
    if (headerLine === undefined) {
      return NodeOutputBuilder.of('invalid');
    }
    const header = splitCsvLine(headerLine);
    const records: Array<Record<string, unknown>> = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i] ?? '');
      const record: Record<string, unknown> = {};
      for (let c = 0; c < header.length; c++) {
        record[header[c] ?? `col${c}`] = cells[c] ?? '';
      }
      records.push(record);
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('map-fields');
  },
};
// #endregion parse-csv-node

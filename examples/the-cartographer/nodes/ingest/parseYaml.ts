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
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region parse-yaml-node
export class ParseYamlNode implements NodeInterface<CartographerState, 'normalized' | 'invalid', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'parse-yaml';
  readonly 'outputs' = ['normalized', 'invalid'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalized' | 'invalid'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    // Use decompressed text when available (gzip path), else the raw payload.
    const text = state.decodedText.length > 0 ? state.decodedText : state.currentSource.payload;
    let parsed: unknown;
    try {
      parsed = yamlParse(text);
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
    if (records.length === 0) {
      return NodeOutputBuilder.of('invalid');
    }
    state.parsedRecords = records;
    return NodeOutputBuilder.of('normalized');
  }
}

export const parseYaml = new ParseYamlNode();
// #endregion parse-yaml-node

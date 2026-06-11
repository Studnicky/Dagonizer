/**
 * parse-json: shared ingest transform — JSON array text → array of records.
 *
 * Reads the JSON payload from state.currentSource.payload, parses it, and (when
 * it is an array of objects) writes the records to state.parsedRecords for the
 * map-fields node. JSON sources carry native types (numbers as numbers), which
 * the coerce-types node tolerates.
 *
 * Routes 'map-fields' on success; 'invalid' when the payload is not a JSON array.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region parse-json-node
export class ParseJsonNode implements NodeInterface<CartographerState, 'map-fields' | 'invalid', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'parse-json';
  readonly 'outputs' = ['map-fields', 'invalid'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'map-fields' | 'invalid'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.currentSource.payload);
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
    return NodeOutputBuilder.of('map-fields');
  }
}
// #endregion parse-json-node

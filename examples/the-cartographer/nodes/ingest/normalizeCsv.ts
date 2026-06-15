/**
 * normalize-csv-map: CSV-format field normalization — source header names → canonical names.
 *
 * Applies the per-source FieldMap keyed by state.currentSource.mappingKey to
 * rename state.parsedRecords keys from source column names to canonical body
 * field names. Because CSV emits a header row and parseCsv keys records BY
 * HEADER NAME (not column position), a shuffled column order is handled
 * transparently here — the FieldMap is name-keyed, so column-order independence
 * is the header-alignment path. Reads state.parsedRecords, writes state.mappedRecords.
 *
 * Routes 'normalized'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import { FieldMappings } from '../../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region normalize-csv-node
export class NormalizeCsvNode implements NodeInterface<CartographerState, 'normalized', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'normalize-csv-map';
  readonly 'outputs' = ['normalized'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'normalized'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const map = FieldMappings.forKey(state.currentSource.mappingKey);
    const mapped: Array<Record<string, unknown>> = state.parsedRecords.map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [canonical, sourceKey] of Object.entries(map)) {
        if (sourceKey in rec) out[canonical] = rec[sourceKey];
      }
      return out;
    });
    state.mappedRecords = mapped;
    return NodeOutputBuilder.of('normalized');
  }
}

export const normalizeCsv = new NormalizeCsvNode();
// #endregion normalize-csv-node

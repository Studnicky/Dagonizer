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
import { FieldMappings } from '../../services.ts';

import { MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region normalize-csv-node
export class NormalizeCsvNode extends MonadicNode<CartographerState, 'normalized'> {
  readonly 'name' = 'normalize-csv-map';
  readonly 'outputs' = ['normalized'] as const;

  override get outputSchema(): Record<'normalized', SchemaObjectType> {
    return {
      'normalized': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'normalized', CartographerState>> {
    for (const item of batch) {
      const map = FieldMappings.forKey(item.state.currentSource.mappingKey);
      const mapped: Array<Record<string, unknown>> = item.state.parsedRecords.map((rec) => {
        const out: Record<string, unknown> = {};
        for (const [canonical, sourceKey] of Object.entries(map)) {
          if (sourceKey in rec) out[canonical] = rec[sourceKey];
        }
        return out;
      });
      item.state.mappedRecords = mapped;
    }
    return RoutedBatchBuilder.of('normalized', batch);
  }
}

export const normalizeCsv = new NormalizeCsvNode();
// #endregion normalize-csv-node

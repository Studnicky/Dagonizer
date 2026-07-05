/**
 * normalize-ndjson-map: NDJSON-format field normalization — source key names → canonical names.
 *
 * Applies the per-source FieldMap keyed by state.currentSource.mappingKey to
 * rename state.parsedRecords keys from source field names to canonical body
 * field names. Reads state.parsedRecords, writes state.mappedRecords.
 *
 * Routes 'normalized'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import { FieldMappings } from '../../services.ts';

import { MonadicNode, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region normalize-ndjson-node
export class NormalizeNdjsonNode extends MonadicNode<CartographerState, 'normalized'> {
  readonly 'name' = 'normalize-ndjson-map';
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

export const normalizeNdjson = new NormalizeNdjsonNode();
// #endregion normalize-ndjson-node

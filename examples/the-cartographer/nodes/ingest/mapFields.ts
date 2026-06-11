/**
 * map-fields: shared ingest transform — source field names → canonical names.
 *
 * Parameterised by the source's `mappingKey` (state.currentSource.mappingKey),
 * which selects a `{ canonicalField: sourceFieldName }` map from FieldMappings.
 * Each parsed record's source-named keys are renamed to the canonical field
 * names the coerce-types + validate-event nodes expect. Reads state.parsedRecords,
 * writes state.mappedRecords.
 *
 * This is the node that makes the sources' heterogeneous on-the-wire shapes
 * converge — the SAME node is reused across every source sub-DAG, driven only by
 * the per-source mapping it is told to use.
 *
 * Routes 'coerce-types'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import { FieldMappings } from '../../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region map-fields-node
export class MapFieldsNode implements NodeInterface<CartographerState, 'coerce-types', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'map-fields';
  readonly 'outputs' = ['coerce-types'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'coerce-types'>> {
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
    return NodeOutputBuilder.of('coerce-types');
  }
}
// #endregion map-fields-node

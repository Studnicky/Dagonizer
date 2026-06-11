/**
 * selectSource: reads the per-source feed from the ingestion-scatter metadata
 * and writes it to state.currentSource, then routes by format so IngestSourceDAG
 * can embed the correct per-format sub-DAG.
 *
 * The ingestion scatter writes each SourcePayload under the itemKey 'source' in
 * the clone metadata. This node retrieves it and routes:
 *   - 'ndjson.gz' → 'gz'     (embedded ingest-ndjson-gz sub-DAG)
 *   - 'csv'       → 'csv'    (embedded ingest-csv sub-DAG)
 *   - 'json'      → 'json'   (embedded ingest-json sub-DAG)
 *
 * Routes 'invalid' when the metadata item is absent.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import type { SourcePayload } from '../../entities/SourcePayload.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region select-source-node
const FORMAT_ROUTE: Readonly<Record<SourcePayload['format'], 'json' | 'csv' | 'gz'>> = {
  'ndjson.gz': 'gz',
  'csv':       'csv',
  'json':      'json',
};

export class SelectSourceNode implements NodeInterface<CartographerState, 'json' | 'csv' | 'gz' | 'invalid', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'select-source';
  readonly 'outputs' = ['json', 'csv', 'gz', 'invalid'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'json' | 'csv' | 'gz' | 'invalid'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const item = state.getMetadata<SourcePayload>('source');
    if (item === null || item === undefined || !item.sourceId || !item.payload) {
      return NodeOutputBuilder.of('invalid');
    }
    state.currentSource = item;
    return NodeOutputBuilder.of(FORMAT_ROUTE[item.format]);
  }
}
// #endregion select-source-node

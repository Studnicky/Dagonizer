/**
 * selectSource: reads the per-source feed from the ingestion-scatter metadata
 * and writes it to state.currentSource, then routes by compression so the
 * decompress node runs for gzipped sources and all formats skip straight to
 * route-format for plain text.
 *
 * The ingestion scatter writes each SourcePayload under the itemKey 'source' in
 * the clone metadata. This node retrieves it and routes:
 *   - compression === 'gzip'  → 'compressed'  (decompress → route-format)
 *   - compression === 'none'  → 'plain'        (route-format directly)
 *
 * Routes 'invalid' when the metadata item is absent or empty.
 */

import type { CartographerState } from '../../CartographerState.ts';
import type { CartographerServices } from '../../CartographerServices.ts';
import type { SourcePayload } from '../../entities/SourcePayload.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region select-source-node
export class SelectSourceNode implements NodeInterface<CartographerState, 'compressed' | 'plain' | 'invalid', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'select-source';
  readonly 'outputs' = ['compressed', 'plain', 'invalid'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'compressed' | 'plain' | 'invalid'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const item = state.getMetadata<SourcePayload>('source');
    if (item === null || item === undefined || !item.sourceId || !item.payload) {
      return NodeOutputBuilder.of('invalid');
    }
    state.currentSource = item;
    return NodeOutputBuilder.of(item.compression === 'gzip' ? 'compressed' : 'plain');
  }
}

export const selectSource = new SelectSourceNode();
// #endregion select-source-node

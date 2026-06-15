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

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region select-source-node
export class SelectSourceNode extends ScalarNode<CartographerState, 'compressed' | 'plain' | 'invalid', CartographerServices> {
  readonly 'name' = 'select-source';
  readonly 'outputs' = ['compressed', 'plain', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'compressed' | 'plain' | 'invalid'>> {
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

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
import { SourcePayloadGuard } from '../../entities/SourcePayload.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region select-source-node
export class SelectSourceNode extends MonadicNode<CartographerState, 'compressed' | 'plain' | 'invalid'> {
  readonly 'name' = 'select-source';
  readonly 'outputs' = ['compressed', 'plain', 'invalid'] as const;

  override get outputSchema(): Record<'compressed' | 'plain' | 'invalid', SchemaObjectType> {
    return {
      'compressed': { 'type': 'object' },
      'plain':      { 'type': 'object' },
      'invalid':    { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'compressed' | 'plain' | 'invalid', CartographerState>> {
    const acc = new Map<'compressed' | 'plain' | 'invalid', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'compressed' | 'plain' | 'invalid', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'compressed' | 'plain' | 'invalid'> {
    const raw = state.getMetadata('source');
    if (!SourcePayloadGuard.is(raw)) {
      return NodeOutput.create('invalid');
    }
    state.currentSource = raw;
    return NodeOutput.create(raw.compression === 'gzip' ? 'compressed' : 'plain');
  }
}

export const selectSource = new SelectSourceNode();
// #endregion select-source-node

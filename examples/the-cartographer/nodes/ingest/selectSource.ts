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

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region select-source-node
export class SelectSourceNode extends ScalarNode<CartographerState, 'compressed' | 'plain' | 'invalid'> {
  readonly 'name' = 'select-source';
  readonly 'outputs' = ['compressed', 'plain', 'invalid'] as const;

  override get outputSchema(): Record<'compressed' | 'plain' | 'invalid', SchemaObjectType> {
    return {
      'compressed': { 'type': 'object' },
      'plain':      { 'type': 'object' },
      'invalid':    { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'compressed' | 'plain' | 'invalid'>> {
    const raw = state.getMetadata('source');
    if (!SourcePayloadGuard.is(raw)) {
      return NodeOutputBuilder.of('invalid');
    }
    state.currentSource = raw;
    return NodeOutputBuilder.of(raw.compression === 'gzip' ? 'compressed' : 'plain');
  }
}

export const selectSource = new SelectSourceNode();
// #endregion select-source-node

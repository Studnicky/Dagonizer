/**
 * decodePayload: reads a scattered SourcePayload from metadata key 'source-payload',
 * decodes all four wire formats (json, csv, ndjson, yaml — including gzip), and
 * builds the discriminated CanonicalEventVariant via CanonicalEventVariantBuilder.
 * Sets state.canonicalVariant so the downstream route-event-type-variant node can
 * branch on eventType without a separate metadata read.
 *
 * Routes 'decoded' on success, 'invalid' when the metadata item is absent or the
 * produced variant has no shipmentId.
 *
 * Writes the decoded variant onto metadata key 'canonical-event' so the
 * unchanged per-type pipeline DAGs (whose entry node parse-variant reads
 * 'canonical-event' from metadata) consume it transparently — the same key the
 * superseded process-events scatter set as its itemKey. NodeStateBase.clone()
 * copies _metadata, so the key propagates into every embedded child clone.
 */

import type { CartographerState } from '../CartographerState.ts';
import { SourcePayloadGuard } from '../entities/SourcePayload.ts';
import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import { TypedPayloadDecoder } from '../services.ts';

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region decode-payload-node
export class DecodePayloadNode extends MonadicNode<CartographerState, 'decoded' | 'invalid'> {
  readonly '@id' = 'urn:noocodec:node:decode-payload';
  readonly 'name' = 'decode-payload';
  readonly 'outputs' = ['decoded', 'invalid'] as const;

  override get outputSchema(): Record<'decoded' | 'invalid', SchemaObjectType> {
    return {
      'decoded': { 'type': 'object' },
      'invalid': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'decoded' | 'invalid', CartographerState>> {
    const acc = new Map<'decoded' | 'invalid', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = await this.routeItem(item.state);
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

    const routed = new Map<'decoded' | 'invalid', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private async routeItem(state: CartographerState): Promise<NodeOutputType<'decoded' | 'invalid'>> {
    const raw = state.getMetadata('source-payload');
    if (!SourcePayloadGuard.is(raw)) {
      return NodeOutput.create('invalid');
    }

    const decoded = await TypedPayloadDecoder.decode(raw);
    const variant = CanonicalEventVariantBuilder.fromSourcePayload(raw, decoded);

    if (!variant.shipmentId) {
      return NodeOutput.create('invalid');
    }

    state.canonicalVariant = variant;
    // Hand the decoded variant to the per-type pipelines via the metadata key
    // their parse-variant entry node reads ('canonical-event').
    state.setMetadata('canonical-event', variant);

    return NodeOutput.create('decoded');
  }
}

export const decodePayload = new DecodePayloadNode();
// #endregion decode-payload-node

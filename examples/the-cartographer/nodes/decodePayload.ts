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
import type { CartographerServices } from '../CartographerServices.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';
import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import { TypedPayloadDecoder } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region decode-payload-node
export class DecodePayloadNode extends ScalarNode<CartographerState, 'decoded' | 'invalid', CartographerServices> {
  readonly 'name' = 'decode-payload';
  readonly 'outputs' = ['decoded', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'decoded' | 'invalid'>> {
    const payload = state.getMetadata<SourcePayload>('source-payload');
    if (payload === undefined || payload === null) {
      return NodeOutputBuilder.of('invalid');
    }

    const decoded = await TypedPayloadDecoder.decode(payload);
    const variant = CanonicalEventVariantBuilder.fromSourcePayload(payload, decoded);

    if (!variant.shipmentId) {
      return NodeOutputBuilder.of('invalid');
    }

    state.canonicalVariant = variant;
    // Hand the decoded variant to the per-type pipelines via the metadata key
    // their parse-variant entry node reads ('canonical-event').
    state.setMetadata('canonical-event', variant);

    return NodeOutputBuilder.of('decoded');
  }
}

export const decodePayload = new DecodePayloadNode();
// #endregion decode-payload-node

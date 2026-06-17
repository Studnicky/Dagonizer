/**
 * decodeBatch: reads a SourcePayload[] batch from metadata key 'source-batch',
 * decodes each item via TypedPayloadDecoder.decode then
 * CanonicalEventVariantBuilder.fromSourcePayload — the same two-step path as
 * the per-event DecodePayloadNode. Items where the produced variant has no
 * shipmentId are dropped. Sets state.batchEventType from the first successfully
 * decoded variant's eventType and state.variantBatch to the decoded array.
 *
 * Routes 'decoded' when at least one variant survives filtering, 'invalid'
 * when the batch is absent, empty, or every item is dropped.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';
import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';
import { TypedPayloadDecoder } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region decode-batch-node
export class DecodeBatchNode extends ScalarNode<CartographerState, 'decoded' | 'invalid', CartographerServices> {
  readonly 'name' = 'decode-batch';
  readonly 'outputs' = ['decoded', 'invalid'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'decoded' | 'invalid'>> {
    const batch = state.getMetadata<SourcePayload[]>('source-batch');
    if (batch === undefined || batch === null || batch.length === 0) {
      return NodeOutputBuilder.of('invalid');
    }

    const variants = await Promise.all(
      batch.map(async (payload) => {
        const decoded = await TypedPayloadDecoder.decode(payload);
        return CanonicalEventVariantBuilder.fromSourcePayload(payload, decoded);
      }),
    );

    const valid = variants.filter((variant: CanonicalEventVariant) => Boolean(variant.shipmentId));

    if (valid.length === 0) {
      return NodeOutputBuilder.of('invalid');
    }

    const first = valid[0];
    state.batchEventType = first !== undefined ? first.eventType : 'position-ping';
    // valid.length > 0 is guaranteed above; the first check is a type narrowing guard.
    state.variantBatch = valid;

    return NodeOutputBuilder.of('decoded');
  }
}

export const decodeBatch = new DecodeBatchNode();
// #endregion decode-batch-node

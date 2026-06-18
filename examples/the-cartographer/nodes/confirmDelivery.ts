/**
 * confirmDelivery: delivery-confirmation ONLY. Reads the delivery variant
 * (delivered / podSignature / promised) and records proof-of-delivery into
 * state.normalized: forces status to 'DELIVERED' when delivered, carries the
 * promised-delivery epoch. POD is recorded into the existing wide
 * NormalizedShipment slots (no dedicated POD entity).
 *
 * Routes 'confirmed'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region confirm-delivery-node
export class ConfirmDeliveryNode extends ScalarNode<CartographerState, 'confirmed', CartographerServices> {
  readonly 'name' = 'confirm-delivery';
  readonly 'outputs' = ['confirmed'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'confirmed'>> {
    const v = state.canonicalVariant;
    if (v.eventType !== 'delivery-confirmation') {
      return NodeOutputBuilder.of('confirmed');
    }

    const delivered = v.body.delivered;

    state.normalized = {
      ...state.normalized,
      'status': delivered ? 'DELIVERED' : state.normalized.status,
    };

    state.currentEvent = {
      ...state.currentEvent,
      'eventType': delivered ? 'DELIVERED' : state.currentEvent.eventType,
    };

    return NodeOutputBuilder.of('confirmed');
  }
}

export const confirmDelivery = new ConfirmDeliveryNode();
// #endregion confirm-delivery-node

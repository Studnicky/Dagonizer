/**
 * routeBatchEventType: dispatches the homogeneous batch to the corresponding
 * per-type batch pipeline by reading state.batchEventType.
 *
 * The batch-path counterpart to routeEventType, which reads the per-event
 * state.canonicalVariant. This node reads state.batchEventType (set by
 * decode-batch from the first decoded variant in the batch).
 *
 * For this slice only position-ping is wired to an active batch pipeline;
 * all other event types route to 'rejected' until their batch pipelines
 * are built in later waves.
 *
 * Routes 'position-ping' | 'rejected'.
 */

import type { CartographerState }    from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region route-batch-event-type-node
type BatchRoute = 'position-ping' | 'rejected';

export class RouteBatchEventTypeNode extends ScalarNode<CartographerState, BatchRoute, CartographerServices> {
  readonly 'name' = 'route-batch-event-type';
  readonly 'outputs' = ['position-ping', 'rejected'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<BatchRoute>> {
    const t: CanonicalEventVariant['eventType'] = state.batchEventType;
    if (t === 'position-ping') {
      return NodeOutputBuilder.of('position-ping');
    }
    // Other event types route to 'rejected' until their batch pipelines land.
    return NodeOutputBuilder.of('rejected');
  }
}

export const routeBatchEventType = new RouteBatchEventTypeNode();
// #endregion route-batch-event-type-node

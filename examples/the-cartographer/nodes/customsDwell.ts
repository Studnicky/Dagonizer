/**
 * customs-dwell: customs-lane only — compute the clearance dwell hours.
 *
 * Runs ONLY on the route-event-type 'customs' lane (customs-event). Other event types skip
 * it — the per-event-type skip showcase. Sets state.customsDwellHours from the
 * canonical body's customsStatus (held dwells longer than cleared).
 *
 * Routes 'dwelled'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Customs } from '../services.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region customs-dwell-node
export class CustomsDwellNode extends ScalarNode<CartographerState, 'dwelled', CartographerServices> {
  readonly 'name' = 'customs-dwell';
  readonly 'outputs' = ['dwelled'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextType<CartographerServices>): Promise<NodeOutputType<'dwelled'>> {
    const v = state.canonicalVariant;
    const customsStatus = v.eventType === 'customs-event' ? v.body.customsStatus : '';
    state.customsDwellHours = Customs.dwellHours(customsStatus);
    return NodeOutputBuilder.of('dwelled');
  }
}
// #endregion customs-dwell-node

export const customsDwell = new CustomsDwellNode();

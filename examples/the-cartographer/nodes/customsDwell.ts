/**
 * customs-dwell: customs-lane only — compute the clearance dwell hours.
 *
 * Runs ONLY on the route-kind 'customs' lane (customs-event). Other kinds skip
 * it — the per-kind skip showcase. Sets state.customsDwellHours from the
 * canonical body's customsStatus (held dwells longer than cleared).
 *
 * Routes 'dwelled'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Customs } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeInterface, type NodeOutputInterface,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';

// #region customs-dwell-node
export class CustomsDwellNode implements NodeInterface<CartographerState, 'dwelled', CartographerServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly 'name' = 'customs-dwell';
  readonly 'outputs' = ['dwelled'] as const;

  async execute(state: CartographerState, context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'dwelled'>> {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.customsDwellHours = Customs.dwellHours(state.canonical.body.customsStatus);
    return NodeOutputBuilder.of('dwelled');
  }
}
// #endregion customs-dwell-node

export const customsDwell = new CustomsDwellNode();

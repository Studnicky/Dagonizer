/**
 * seedEvents: pre-phase node for the cartographer DAG.
 *
 * Sets state.sources = Sources.buildFromConfig(state.feedConfig) — one SourcePayload
 * per FeedConfig entry — before the ingestion fan-in reads them. Called as a
 * PhaseNode('pre') so it runs before the entrypoint and never appears in the
 * routing graph.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Sources } from '../services.ts';

import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@noocodex/dagonizer';

// #region seed-events-node
export class SeedEventsNode extends ScalarNode<CartographerState, never, CartographerServices> {
  readonly 'name' = 'seed';
  readonly 'outputs' = [] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<never>> {
    state.sources = await Sources.buildFromConfig(state.feedConfig);
    return NodeOutputBuilder.of(undefined as never);
  }
}

export const seedEvents = new SeedEventsNode();
// #endregion seed-events-node

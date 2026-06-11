/**
 * seedEvents: pre-phase node for the cartographer DAG.
 *
 * Sets state.sources = Sources.build(state.eventCount) — the fixed list of
 * heterogeneous-format source feeds (JSON / CSV / gzip NDJSON / customs) — before
 * the ingestion fan-in reads them. Called as a PhaseNode('pre') so it runs before
 * the entrypoint and never appears in the routing graph.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Sources } from '../services.ts';

import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region seed-events-node
export const seedEvents: NodeInterface<CartographerState, never, CartographerServices> = {
  'name': 'seed',
  'outputs': [],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    state.sources = await Sources.build(state.eventCount);
    return NodeOutputBuilder.of(undefined as never);
  },
};
// #endregion seed-events-node

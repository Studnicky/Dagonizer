/**
 * seedEvents: pre-phase node for the cartographer DAG.
 *
 * Sets state.sources before the ingestion fan-in reads them from state.eventConfig
 * via Sources.buildTypedFeed (array) or EventStreamSource.streamTyped (streaming).
 * Each SourcePayload carries an authoritative per-type eventType.
 *
 *   Array path (default, state.useStreamingSource = false):
 *     state.sources = await Sources.buildTypedFeed(state.eventConfig)
 *     A materialised SourcePayload[] — the engine's scatter consumes it as a
 *     plain array. All payloads are built and held in memory before dispatch.
 *
 *   Streaming path (state.useStreamingSource = true):
 *     state.sources = EventStreamSource.streamTyped(state.eventConfig, count)
 *     An AsyncIterable<SourcePayload> yielded lazily one payload at a time.
 *     The engine's scatter reads it with backpressure, enabling pipeline
 *     start before all payloads are fully materialised.
 *     `count` comes from state.streamCount when > 0; otherwise EventStreamSource
 *     derives it from CARTO_EVENT_COUNT env or the eventConfig sum.
 *
 * Called as a PhaseNode('pre') so it runs before the entrypoint and never
 * appears in the routing graph.
 */

import type { CartographerState } from '../CartographerState.ts';
import { Sources } from '../services.ts';
import { EventStreamSource } from '../services/EventStreamSource.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region seed-events-node
export class SeedEventsNode extends ScalarNode<CartographerState, 'done'> {
  readonly 'name' = 'seed';
  // A `PhaseNode('pre')` runs before the entrypoint and never appears in the
  // routing graph, so this output token is never consumed — but the node still
  // needs a concrete, inhabited port to return rather than an empty `never`.
  readonly 'outputs' = ['done'] as const;

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'done'>> {
    if (state.useStreamingSource) {
      const count = state.streamCount > 0 ? state.streamCount : undefined;
      state.sources = EventStreamSource.streamTyped(state.eventConfig, count);
    } else {
      state.sources = await Sources.buildTypedFeed(state.eventConfig);
    }
    return NodeOutputBuilder.of('done');
  }
}

export const seedEvents = new SeedEventsNode();
// #endregion seed-events-node

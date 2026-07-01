/**
 * RoutedChatStreamChunk: one incremental delta, stamped with the routing
 * key and node/DAG source that produced it.
 *
 * `ChatStreamChunkType` ({delta}) is what a dumb adapter pushes — it carries
 * no routing information because adapters never know about concurrent runs
 * or which node/DAG invoked them. `RoutingStreamSink` decorates the
 * per-execution sink handed to the adapter: it receives plain
 * `ChatStreamChunkType` pushes and forwards each one to a shared downstream
 * sink as a `RoutedChatStreamChunkType`, stamped with `routeKey` (the
 * demultiplexing key for the run) and `source` (the dag/node that produced
 * it). A single shared sink — for example a `StreamChannel` feeding a
 * routing DAG that scatters by `routeKey` — can then separate concurrent
 * runs' chunks even though they all land in one sink.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * JSON Schema for `RoutedChatStreamChunk`. Validates a single streamed text
 * delta tagged with its route key and originating dag/node.
 */
export const RoutedChatStreamChunkSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/RoutedChatStreamChunk',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['routeKey', 'delta', 'source'],
  'properties': {
    'routeKey': { 'type': 'string' },
    'delta': { 'type': 'string' },
    'source': {
      'type': 'object',
      'required': ['dagName', 'nodeName'],
      'properties': {
        'dagName': { 'type': 'string' },
        'nodeName': { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `RoutedChatStreamChunkSchema` via `json-schema-to-ts`. */
export type RoutedChatStreamChunkType = FromSchema<typeof RoutedChatStreamChunkSchema>;

/**
 * Static factory for `RoutedChatStreamChunkType`.
 *
 * @example
 * ```ts
 * downstream.push(
 *   RoutedChatStreamChunkBuilder.of(routeKey, 'Hello', { dagName: 'chat', nodeName: 'call-model' }),
 * );
 * ```
 */
export class RoutedChatStreamChunkBuilder {
  private constructor() { /* static class */ }

  /**
   * Construct a `RoutedChatStreamChunkType` from a route key, a text delta,
   * and the dag/node that produced it.
   *
   * @param routeKey - The demultiplexing key for the run that produced `delta`.
   * @param delta - The text fragment produced since the previous chunk.
   * @param source - The dag/node that produced this chunk.
   */
  static of(
    routeKey: string,
    delta: string,
    source: RoutedChatStreamChunkType['source'],
  ): RoutedChatStreamChunkType {
    return { routeKey, delta, source };
  }
}

/**
 * RoutingStreamSink: per-execution decorator that stamps every chunk pushed
 * by a dumb adapter with a routing key and source before forwarding it to a
 * shared downstream sink.
 *
 * `BaseAdapter.chatStream` pushes plain `ChatStreamChunkType` ({delta})
 * values — adapters never know about concurrent runs or which node/DAG
 * invoked them. `CallModelNode.executeOne` constructs a fresh
 * `RoutingStreamSink` per execution (via `RoutingStreamSink.of`), wraps the
 * node's shared `this.sink` as its downstream, and hands the wrapper to
 * `adapter.chatStream`. Each pushed `{delta}` becomes a self-describing
 * `RoutedChatStreamChunkType` (`routeKey` + `source`) at the downstream sink,
 * so one shared sink — for example a `StreamChannel` feeding a routing DAG
 * that scatters by `routeKey` — demultiplexes concurrent runs correctly.
 */

import type { StreamSinkInterface } from '../contracts/StreamSinkInterface.js';
import type { ChatStreamChunkType } from '../entities/adapter/ChatStreamChunk.js';
import { RoutedChatStreamChunkBuilder } from '../entities/adapter/RoutedChatStreamChunk.js';
import type { RoutedChatStreamChunkType } from '../entities/adapter/RoutedChatStreamChunk.js';

export class RoutingStreamSink implements StreamSinkInterface<ChatStreamChunkType> {
  private constructor(
    private readonly downstream: StreamSinkInterface<RoutedChatStreamChunkType>,
    private readonly routeKey: string,
    private readonly source: RoutedChatStreamChunkType['source'],
  ) { /* use RoutingStreamSink.of */ }

  /** Forward a plain adapter chunk to `downstream`, stamped with `routeKey` and `source`. */
  async push(chunk: ChatStreamChunkType): Promise<void> {
    await this.downstream.push(RoutedChatStreamChunkBuilder.of(this.routeKey, chunk.delta, this.source));
  }

  /**
   * Construct a `RoutingStreamSink` for one execution.
   *
   * @param downstream - The shared sink every routed chunk is forwarded to.
   * @param routeKey - The demultiplexing key for this run.
   * @param source - The dag/node producing chunks in this run.
   */
  static of(
    downstream: StreamSinkInterface<RoutedChatStreamChunkType>,
    routeKey: string,
    source: RoutedChatStreamChunkType['source'],
  ): RoutingStreamSink {
    return new RoutingStreamSink(downstream, routeKey, source);
  }
}

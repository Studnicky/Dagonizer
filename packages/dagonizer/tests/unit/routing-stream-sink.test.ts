/**
 * Tests for `RoutingStreamSink`: the per-execution decorator that stamps
 * routing information onto chunks pushed by a dumb adapter before forwarding
 * them to a shared downstream sink.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RoutingStreamSink } from '../../src/adapter/RoutingStreamSink.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';
import { ChatStreamChunk } from '../../src/entities/adapter/ChatStreamChunk.js';
import type { RoutedChatStreamChunkType } from '../../src/entities/adapter/RoutedChatStreamChunk.js';

class CollectingSink implements StreamSinkInterface<RoutedChatStreamChunkType> {
  readonly received: RoutedChatStreamChunkType[] = [];

  async push(item: RoutedChatStreamChunkType): Promise<void> {
    this.received.push(item);
  }
}

void describe('RoutingStreamSink: unit', () => {
  void it('stamps routeKey and source onto every forwarded chunk', async () => {
    const downstream = new CollectingSink();
    const source = { 'dagName': 'chat-dag', 'nodeName': 'call-model' };
    const routing = RoutingStreamSink.of(downstream, 'run-1', source);

    await routing.push(ChatStreamChunk.create('Hello'));
    await routing.push(ChatStreamChunk.create(' world'));

    assert.deepEqual(downstream.received, [
      { 'routeKey': 'run-1', 'delta': 'Hello', 'source': { 'dagName': 'chat-dag', 'nodeName': 'call-model' } },
      { 'routeKey': 'run-1', 'delta': ' world', 'source': { 'dagName': 'chat-dag', 'nodeName': 'call-model' } },
    ]);
  });

  void it('constructs distinct instances per execution with independent routeKeys', async () => {
    const downstream = new CollectingSink();
    const source = { 'dagName': 'chat-dag', 'nodeName': 'call-model' };
    const runA = RoutingStreamSink.of(downstream, 'run-a', source);
    const runB = RoutingStreamSink.of(downstream, 'run-b', source);

    await runA.push(ChatStreamChunk.create('A1'));
    await runB.push(ChatStreamChunk.create('B1'));
    await runA.push(ChatStreamChunk.create('A2'));

    assert.deepEqual(
      downstream.received.map((chunk) => [chunk.routeKey, chunk.delta]),
      [
        ['run-a', 'A1'],
        ['run-b', 'B1'],
        ['run-a', 'A2'],
      ],
    );
  });
});

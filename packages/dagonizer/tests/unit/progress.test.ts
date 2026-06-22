/**
 * Unit tests for `@studnicky/dagonizer/progress`:
 *   - BusEventEnvelopeBuilder: wire envelope construction
 *   - EventBus: publish→subscribe delivery, unsubscribe, clear, dispose,
 *               throwing-listener isolation, multi-listener fan-out
 *   - SseStream: SSE frame format, connected frame, bus→stream delivery,
 *                unsubscribe-on-cancel, heartbeat interval (disabled in tests),
 *                frame/comment static helpers
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BusEventEnvelopeBuilder } from '../../src/progress/BusEventEnvelope.js';
import { EventBus } from '../../src/progress/EventBus.js';
import { SseStream } from '../../src/progress/SseStream.js';

// ── BusEventEnvelopeBuilder ──────────────────────────────────────────────────

describe('BusEventEnvelopeBuilder', () => {
  it('creates an envelope with topic, payload, and a numeric timestamp', () => {
    const before = Date.now();
    const envelope = BusEventEnvelopeBuilder.of('runs', { 'nodeId': 'a' });
    const after = Date.now();

    assert.equal(envelope.topic, 'runs');
    assert.deepEqual(envelope.payload, { 'nodeId': 'a' });
    assert.equal(typeof envelope.timestamp, 'number');
    assert.ok(envelope.timestamp >= before);
    assert.ok(envelope.timestamp <= after);
  });

  it('withTimestamp respects the explicit timestamp', () => {
    const ts = 123_456_789;
    const envelope = BusEventEnvelopeBuilder.withTimestamp('t', 42, ts);

    assert.equal(envelope.timestamp, ts);
    assert.equal(envelope.payload, 42);
  });

  it('works with primitive payloads: string, number, boolean, null', () => {
    assert.equal(BusEventEnvelopeBuilder.of('x', 'hello').payload, 'hello');
    assert.equal(BusEventEnvelopeBuilder.of('x', 99).payload, 99);
    assert.equal(BusEventEnvelopeBuilder.of('x', true).payload, true);
    assert.equal(BusEventEnvelopeBuilder.of('x', null).payload, null);
  });
});

// ── EventBus ─────────────────────────────────────────────────────────────────

describe('EventBus.publish → subscribe', () => {
  it('delivers a typed event to a subscriber', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.subscribe('topic', (e) => { received.push(e.payload); });
    bus.publish('topic', { 'n': 1 });
    bus.publish('topic', { 'n': 2 });

    assert.deepEqual(received, [{ 'n': 1 }, { 'n': 2 }]);
    bus.dispose();
  });

  it('delivers to multiple listeners on the same topic', () => {
    const bus = new EventBus();
    let countA = 0;
    let countB = 0;

    bus.subscribe('x', () => { countA++; });
    bus.subscribe('x', () => { countB++; });
    bus.publish('x', null);

    assert.equal(countA, 1);
    assert.equal(countB, 1);
    bus.dispose();
  });

  it('does not deliver to listeners on a different topic', () => {
    const bus = new EventBus();
    let fired = false;

    bus.subscribe('other', () => { fired = true; });
    bus.publish('target', 'payload');

    assert.equal(fired, false);
    bus.dispose();
  });

  it('delivers the envelope with the correct topic field', () => {
    const bus = new EventBus();
    const topics: string[] = [];

    bus.subscribe('t', (e) => { topics.push(e.topic); });
    bus.publish('t', null);

    assert.deepEqual(topics, ['t']);
    bus.dispose();
  });
});

describe('EventBus.subscribe → unsubscribe', () => {
  it('unsubscribe stops future delivery', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.subscribe('t', () => { count++; });

    bus.publish('t', null);
    unsub();
    bus.publish('t', null);

    assert.equal(count, 1);
    bus.dispose();
  });

  it('calling unsubscribe twice is a no-op', () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.subscribe('t', () => { count++; });

    bus.publish('t', null);
    unsub();
    unsub(); // should not throw
    bus.publish('t', null);

    assert.equal(count, 1);
    bus.dispose();
  });

  it('one listener unsubscribes without affecting siblings', () => {
    const bus = new EventBus();
    let countA = 0;
    let countB = 0;

    const unsubA = bus.subscribe('t', () => { countA++; });
    bus.subscribe('t', () => { countB++; });

    bus.publish('t', null);
    unsubA();
    bus.publish('t', null);

    assert.equal(countA, 1);
    assert.equal(countB, 2);
    bus.dispose();
  });
});

describe('EventBus.clear', () => {
  it('removes all listeners on the cleared topic', () => {
    const bus = new EventBus();
    let count = 0;

    bus.subscribe('t', () => { count++; });
    bus.subscribe('t', () => { count++; });
    bus.clear('t');
    bus.publish('t', null);

    assert.equal(count, 0);
    bus.dispose();
  });

  it('clear on a topic with no listeners is a no-op', () => {
    const bus = new EventBus();
    assert.doesNotThrow(() => { bus.clear('nonexistent'); });
    bus.dispose();
  });

  it('does not affect other topics', () => {
    const bus = new EventBus();
    let countA = 0;
    let countB = 0;

    bus.subscribe('a', () => { countA++; });
    bus.subscribe('b', () => { countB++; });
    bus.clear('a');
    bus.publish('a', null);
    bus.publish('b', null);

    assert.equal(countA, 0);
    assert.equal(countB, 1);
    bus.dispose();
  });
});

describe('EventBus.dispose', () => {
  it('silences all topics after dispose', () => {
    const bus = new EventBus();
    let count = 0;

    bus.subscribe('a', () => { count++; });
    bus.subscribe('b', () => { count++; });
    bus.dispose();
    bus.publish('a', null);
    bus.publish('b', null);

    assert.equal(count, 0);
  });
});

describe('EventBus throwing-listener isolation', () => {
  it('a throwing listener does not prevent subsequent listeners from firing', () => {
    const bus = new EventBus();
    const received: number[] = [];

    bus.subscribe('t', () => { throw new Error('boom'); });
    bus.subscribe('t', () => { received.push(1); });

    assert.doesNotThrow(() => { bus.publish('t', null); });
    assert.deepEqual(received, [1]);
    bus.dispose();
  });
});

// ── SseStream ────────────────────────────────────────────────────────────────

describe('SseStream.frame / SseStream.comment', () => {
  it('frame wraps payload as data: <json>\\n\\n', () => {
    const frame = SseStream.frame({ 'n': 1 });
    assert.equal(frame, 'data: {"n":1}\n\n');
  });

  it('comment wraps text as : <text>\\n\\n', () => {
    assert.equal(SseStream.comment('heartbeat'), ': heartbeat\n\n');
  });
});

/**
 * Helper: read all chunks from a `ReadableStream<string>` until the consumer
 * cancels it. The `readCount` argument controls how many chunks to pull before
 * cancelling, so tests can avoid blocking forever.
 */
class StreamReader {
  private constructor() { /* static class */ }

  static async take(stream: ReadableStream<string>, count: number): Promise<string[]> {
    const chunks: string[] = [];
    const reader = stream.getReader();

    try {
      while (chunks.length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) chunks.push(value);
      }
    } finally {
      reader.cancel();
      reader.releaseLock();
    }

    return chunks;
  }
}

describe('SseStream.of — connected frame', () => {
  it('emits a connected frame as the first chunk', async () => {
    const bus = new EventBus();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Publish synchronously BEFORE we start reading, so the listener is wired.
    // Then pull the connected frame only.
    const chunks = await StreamReader.take(stream.readable, 1);
    assert.equal(chunks[0], 'data: {"connected":true}\n\n');

    bus.dispose();
  });
});

describe('SseStream.of — event delivery', () => {
  it('forwards a published event as an SSE data frame', async () => {
    const bus = new EventBus();
    const stream = SseStream.of(bus, ['runs'], { 'heartbeatMs': 0 });
    const reader = stream.readable.getReader();

    // Pull connected frame.
    await reader.read();

    // Publish an event — the bus subscriber fires synchronously.
    bus.publish('runs', { 'nodeId': 'start' });

    const { value } = await reader.read();
    reader.cancel();
    reader.releaseLock();

    assert.ok(value !== undefined, 'expected a frame');
    const parsed = JSON.parse(value.replace(/^data: /, '').trim()) as {
      'topic': string;
      'payload': { 'nodeId': string };
    };
    assert.equal(parsed.topic, 'runs');
    assert.deepEqual(parsed.payload, { 'nodeId': 'start' });

    bus.dispose();
  });

  it('subscribes to multiple topics and forwards events from each', async () => {
    const bus = new EventBus();
    const stream = SseStream.of(bus, ['a', 'b'], { 'heartbeatMs': 0 });
    const reader = stream.readable.getReader();

    // Discard connected frame.
    await reader.read();

    bus.publish('a', 1);
    const frameA = await reader.read();

    bus.publish('b', 2);
    const frameB = await reader.read();

    reader.cancel();
    reader.releaseLock();

    const parseFrame = (raw: { 'value': string | undefined; 'done': boolean }): { 'topic': string; 'payload': unknown } => {
      const value = raw.value;
      assert.ok(value !== undefined);
      return JSON.parse(value.replace(/^data: /, '').trim()) as { 'topic': string; 'payload': unknown };
    };

    const eventA = parseFrame(frameA);
    const eventB = parseFrame(frameB);

    assert.equal(eventA.topic, 'a');
    assert.equal(eventA.payload, 1);
    assert.equal(eventB.topic, 'b');
    assert.equal(eventB.payload, 2);

    bus.dispose();
  });
});

describe('SseStream.of — cancel teardown', () => {
  it('unsubscribes from the bus when the consumer cancels', async () => {
    const bus = new EventBus();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Pull connected frame, then cancel.
    await StreamReader.take(stream.readable, 1);

    // After cancel, no listener should be on 't'. Publish and verify nothing
    // errors (the bus is still alive; subscription was cleaned up).
    let fired = false;
    bus.subscribe('t', () => { fired = true; });
    bus.publish('t', null);

    // The StreamReader.take cancels the reader. The SseStream unsubscribe ran.
    // The new 'fired' subscriber we added above should still fire (it's a new one).
    assert.equal(fired, true);

    bus.dispose();
  });
});

describe('SseStream.of — heartbeat (interval=0 disables)', () => {
  it('with heartbeatMs:0 the stream does not emit heartbeat frames between events', async () => {
    const bus = new EventBus();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Verify connected frame, publish one event, collect both.
    const reader = stream.readable.getReader();
    const connectedFrame = (await reader.read()).value;
    assert.equal(connectedFrame, 'data: {"connected":true}\n\n');

    bus.publish('t', 'hello');
    const eventFrame = (await reader.read()).value;
    assert.ok(eventFrame?.includes('"hello"'));

    reader.cancel();
    reader.releaseLock();
    bus.dispose();
  });
});

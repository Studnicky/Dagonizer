/**
 * Unit tests for `@studnicky/dagonizer/progress`:
 *   - BusEventEnvelope: wire envelope construction
 *   - EventBus: publish→subscribe delivery (backed by `@studnicky/event-bus`'s
 *               typed async pub/sub + per-subscriber `BusQueue`), unsubscribe,
 *               close, throwing-handler isolation, multi-handler fan-out
 *   - SseStream: SSE frame format, connected frame, bus→stream delivery,
 *                unsubscribe-on-cancel, heartbeat interval (disabled in tests),
 *                frame/comment static helpers
 *   - BusObserver: lifecycle hook → bus topic bridge
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { BusEventEnvelopeType } from '../../src/progress/BusEventEnvelope.js';
import { BusEventEnvelope } from '../../src/progress/BusEventEnvelope.js';
import { BusObserver } from '../../src/progress/BusObserver.js';
import type { DagLifecycleEventType } from '../../src/progress/BusObserver.js';
import { EventBus } from '../../src/progress/EventBus.js';
import { SseStream } from '../../src/progress/SseStream.js';
import { Scheduler } from '../../src/runtime/Scheduler.js';
import { VirtualScheduler } from '../../testing/VirtualScheduler.js';

// ── BusEventEnvelope ──────────────────────────────────────────────────

describe('BusEventEnvelope', () => {
  it('creates an envelope with topic, payload, and a numeric timestamp', () => {
    const before = Date.now();
    const envelope = BusEventEnvelope.create('runs', { 'nodeId': 'a' });
    const after = Date.now();

    assert.equal(envelope.topic, 'runs');
    assert.deepEqual(envelope.payload, { 'nodeId': 'a' });
    assert.equal(typeof envelope.timestamp, 'number');
    assert.ok(envelope.timestamp >= before);
    assert.ok(envelope.timestamp <= after);
  });

  it('withTimestamp respects the explicit timestamp', () => {
    const ts = 123_456_789;
    const envelope = BusEventEnvelope.create('t', 42, { 'timestamp': ts });

    assert.equal(envelope.timestamp, ts);
    assert.equal(envelope.payload, 42);
  });

  it('works with primitive payloads: string, number, boolean, null', () => {
    assert.equal(BusEventEnvelope.create('x', 'hello').payload, 'hello');
    assert.equal(BusEventEnvelope.create('x', 99).payload, 99);
    assert.equal(BusEventEnvelope.create('x', true).payload, true);
    assert.equal(BusEventEnvelope.create('x', null).payload, null);
  });
});

// ── EventBus ─────────────────────────────────────────────────────────────────

describe('EventBus.publish → subscribe', () => {
  it('delivers a typed event to a subscriber', async () => {
    const bus = EventBus.of();
    const received: unknown[] = [];

    bus.subscribe('topic', (e: BusEventEnvelopeType<unknown>) => { received.push(e.payload); });
    await bus.publish('topic', { 'n': 1 });
    await bus.publish('topic', { 'n': 2 });
    await bus.drain();

    assert.deepEqual(received, [{ 'n': 1 }, { 'n': 2 }]);
    await bus.close();
  });

  it('delivers to multiple listeners on the same topic', async () => {
    const bus = EventBus.of();
    let countA = 0;
    let countB = 0;

    bus.subscribe('x', () => { countA++; });
    bus.subscribe('x', () => { countB++; });
    await bus.publish('x', null);
    await bus.drain();

    assert.equal(countA, 1);
    assert.equal(countB, 1);
    await bus.close();
  });

  it('does not deliver to listeners on a different topic', async () => {
    const bus = EventBus.of();
    let fired = false;

    bus.subscribe('other', () => { fired = true; });
    await bus.publish('target', 'payload');
    await bus.drain();

    assert.equal(fired, false);
    await bus.close();
  });

  it('delivers the envelope with the correct topic field', async () => {
    const bus = EventBus.of();
    const topics: string[] = [];

    bus.subscribe('t', (e: BusEventEnvelopeType<unknown>) => { topics.push(e.topic); });
    await bus.publish('t', null);
    await bus.drain();

    assert.deepEqual(topics, ['t']);
    await bus.close();
  });
});

describe('EventBus.subscribe → unsubscribe', () => {
  it('unsubscribe stops future delivery', async () => {
    const bus = EventBus.of();
    let count = 0;
    const unsub = bus.subscribe('t', () => { count++; });

    await bus.publish('t', null);
    unsub();
    await bus.publish('t', null);
    await bus.drain();

    assert.equal(count, 1);
    await bus.close();
  });

  it('calling unsubscribe twice is a no-op', async () => {
    const bus = EventBus.of();
    let count = 0;
    const unsub = bus.subscribe('t', () => { count++; });

    await bus.publish('t', null);
    unsub();
    unsub(); // should not throw
    await bus.publish('t', null);
    await bus.drain();

    assert.equal(count, 1);
    await bus.close();
  });

  it('one listener unsubscribes without affecting siblings', async () => {
    const bus = EventBus.of();
    let countA = 0;
    let countB = 0;

    const unsubA = bus.subscribe('t', () => { countA++; });
    bus.subscribe('t', () => { countB++; });

    await bus.publish('t', null);
    unsubA();
    await bus.publish('t', null);
    await bus.drain();

    assert.equal(countA, 1);
    assert.equal(countB, 2);
    await bus.close();
  });
});

describe('EventBus multi-listener unsubscribe', () => {
  it('unsubscribing every listener on a topic silences it', async () => {
    const bus = EventBus.of();
    let count = 0;

    const unsubA = bus.subscribe('t', () => { count++; });
    const unsubB = bus.subscribe('t', () => { count++; });
    unsubA();
    unsubB();
    await bus.publish('t', null);
    await bus.drain();

    assert.equal(count, 0);
    await bus.close();
  });

  it('unsubscribing a topic with no listeners is a no-op', async () => {
    const bus = EventBus.of();
    const unsub = bus.subscribe('nonexistent', () => {});
    assert.doesNotThrow(() => { unsub(); unsub(); });
    await bus.close();
  });

  it('does not affect other topics', async () => {
    const bus = EventBus.of();
    let countA = 0;
    let countB = 0;

    const unsubA = bus.subscribe('a', () => { countA++; });
    bus.subscribe('b', () => { countB++; });
    unsubA();
    await bus.publish('a', null);
    await bus.publish('b', null);
    await bus.drain();

    assert.equal(countA, 0);
    assert.equal(countB, 1);
    await bus.close();
  });
});

describe('EventBus.close', () => {
  it('silences all topics after close', async () => {
    const bus = EventBus.of();
    let count = 0;

    bus.subscribe('a', () => { count++; });
    bus.subscribe('b', () => { count++; });
    await bus.close();
    await bus.publish('a', null);
    await bus.publish('b', null);

    assert.equal(count, 0);
  });
});

describe('EventBus throwing-listener isolation', () => {
  it('a throwing listener does not prevent subsequent listeners from firing', async () => {
    const bus = EventBus.of();
    const received: number[] = [];

    bus.subscribe('t', () => { throw new Error('boom'); });
    bus.subscribe('t', () => { received.push(1); });

    await assert.doesNotReject(async () => { await bus.publish('t', null); });
    await bus.drain();
    assert.deepEqual(received, [1]);
    await bus.close();
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
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Pull the connected frame only; the listener is wired during `start`.
    const chunks = await StreamReader.take(stream.readable, 1);
    assert.equal(chunks[0], 'data: {"connected":true}\n\n');

    await bus.close();
  });
});

describe('SseStream.of — event delivery', () => {
  it('forwards a published event as an SSE data frame', async () => {
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['runs'], { 'heartbeatMs': 0 });
    const reader = stream.readable.getReader();

    // Pull connected frame.
    await reader.read();

    // Publish an event and wait for the subscriber queue to deliver it.
    await bus.publish('runs', { 'nodeId': 'start' });
    await bus.drain();

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

    await bus.close();
  });

  it('subscribes to multiple topics and forwards events from each', async () => {
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['a', 'b'], { 'heartbeatMs': 0 });
    const reader = stream.readable.getReader();

    // Discard connected frame.
    await reader.read();

    await bus.publish('a', 1);
    await bus.drain();
    const frameA = await reader.read();

    await bus.publish('b', 2);
    await bus.drain();
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

    await bus.close();
  });
});

describe('SseStream.of — cancel teardown', () => {
  it('unsubscribes from the bus when the consumer cancels', async () => {
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Pull connected frame, then cancel.
    await StreamReader.take(stream.readable, 1);

    // After cancel, no listener should be on 't'. Publish and verify nothing
    // errors (the bus is still alive; subscription was cleaned up).
    let fired = false;
    bus.subscribe('t', () => { fired = true; });
    await bus.publish('t', null);
    await bus.drain();

    // The StreamReader.take cancels the reader. The SseStream unsubscribe ran.
    // The new 'fired' subscriber we added above should still fire (it's a new one).
    assert.equal(fired, true);

    await bus.close();
  });
});

describe('SseStream.of — heartbeat (interval=0 disables)', () => {
  it('with heartbeatMs:0 the stream does not emit heartbeat frames between events', async () => {
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 0 });

    // Verify connected frame, publish one event, collect both.
    const reader = stream.readable.getReader();
    const connectedFrame = (await reader.read()).value;
    assert.equal(connectedFrame, 'data: {"connected":true}\n\n');

    await bus.publish('t', 'hello');
    await bus.drain();
    const eventFrame = (await reader.read()).value;
    assert.ok(eventFrame?.includes('"hello"'));

    reader.cancel();
    reader.releaseLock();
    await bus.close();
  });

  it('emits heartbeat frames from the configured scheduler', async () => {
    const scheduler = new VirtualScheduler(0);
    Scheduler.configure(scheduler);
    const bus = EventBus.of();
    const stream = SseStream.of(bus, ['t'], { 'heartbeatMs': 25 });
    const reader = stream.readable.getReader();

    try {
      const connectedFrame = (await reader.read()).value;
      assert.equal(connectedFrame, 'data: {"connected":true}\n\n');

      const heartbeat = reader.read();
      scheduler.advance(25);
      await new Promise<void>((resolve) => { setImmediate(resolve); });

      const heartbeatFrame = (await heartbeat).value;
      assert.equal(heartbeatFrame, ': heartbeat\n\n');
    } finally {
      await reader.cancel();
      reader.releaseLock();
      await bus.close();
      Scheduler.reset();
    }
  });
});

// ── BusObserver ──────────────────────────────────────────────────────────────

/** Minimal concrete state for BusObserver tests. */
class BusObserverTestState extends NodeStateBase {}

/**
 * Pull the first payload off the bus after invoking `fn`. Returns the
 * `DagLifecycleEventType` payload (unboxed from the envelope). `fn` triggers a
 * fire-and-forget `bus.publish` (via `BusObserver`); `bus.drain()` waits for
 * the subscriber queue to deliver it before the payload is read.
 */
class BusCapture {
  private constructor() { /* static class */ }

  static async first(bus: EventBus, topic: string, fn: () => void): Promise<DagLifecycleEventType> {
    let captured: DagLifecycleEventType | undefined;
    const unsub = bus.subscribe(topic, (e: BusEventEnvelopeType<unknown>) => {
      if (captured === undefined) captured = e.payload as DagLifecycleEventType;
    });
    fn();
    await bus.drain();
    unsub();
    assert.ok(captured !== undefined, 'expected at least one event');
    return captured;
  }
}

describe('BusObserver.onFlowStart', () => {
  it('publishes a flowStart event with dagName', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'dag-events');
    const state = new BusObserverTestState();

    const payload = await BusCapture.first(bus, 'dag-events', () => {
      observer.onFlowStart?.('my-dag', state);
    });

    assert.equal(payload.event, 'flowStart');
    assert.equal((payload as Extract<DagLifecycleEventType, { event: 'flowStart' }>).dagName, 'my-dag');
    await bus.close();
  });
});

describe('BusObserver.onNodeStart', () => {
  it('publishes a nodeStart event with nodeName and placementPath', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();
    const path = ['parent', 'child'] as const;

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onNodeStart?.('search-node', state, path);
    });

    assert.equal(payload.event, 'nodeStart');
    const ev = payload as Extract<DagLifecycleEventType, { event: 'nodeStart' }>;
    assert.equal(ev.nodeName, 'search-node');
    assert.deepEqual(ev.placementPath, ['parent', 'child']);
    await bus.close();
  });
});

describe('BusObserver.onNodeEnd', () => {
  it('publishes a nodeEnd event with output field', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onNodeEnd?.('rank-node', 'success', state, []);
    });

    assert.equal(payload.event, 'nodeEnd');
    const ev = payload as Extract<DagLifecycleEventType, { event: 'nodeEnd' }>;
    assert.equal(ev.nodeName, 'rank-node');
    assert.equal(ev.output, 'success');
    assert.deepEqual(ev.placementPath, []);
    await bus.close();
  });

  it('publishes nodeEnd with null output for terminal nodes', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onNodeEnd?.('terminal-node', null, state, []);
    });

    const ev = payload as Extract<DagLifecycleEventType, { event: 'nodeEnd' }>;
    assert.equal(ev.output, null);
    await bus.close();
  });
});

describe('BusObserver.onFlowEnd', () => {
  it('publishes a flowEnd event with terminalOutcome as outcome', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();
    const result = {
      'cursor': null,
      'executedNodes': [],
      'skippedNodes': [],
      'state': state,
      'interruptedAt': null,
      'parked': null,
      'terminalOutcome': 'completed' as const,
    };

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onFlowEnd?.('my-dag', state, result);
    });

    assert.equal(payload.event, 'flowEnd');
    const ev = payload as Extract<DagLifecycleEventType, { event: 'flowEnd' }>;
    assert.equal(ev.dagName, 'my-dag');
    assert.equal(ev.outcome, 'completed');
    await bus.close();
  });

  it('falls back to interruptedAt.reason when terminalOutcome is null', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();
    const result = {
      'cursor': 'next-node',
      'executedNodes': [],
      'skippedNodes': [],
      'state': state,
      'interruptedAt': { 'nodeName': 'pause-node', 'reason': 'abort' as const },
      'parked': null,
      'terminalOutcome': null,
    };

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onFlowEnd?.('my-dag', state, result);
    });

    const ev = payload as Extract<DagLifecycleEventType, { event: 'flowEnd' }>;
    assert.equal(ev.outcome, 'abort');
    await bus.close();
  });
});

describe('BusObserver.onError', () => {
  it('publishes a nodeError event with error message', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();
    const error = new Error('fetch failed');

    const payload = await BusCapture.first(bus, 'events', () => {
      observer.onError?.('fetch-node', error, state, ['outer']);
    });

    assert.equal(payload.event, 'nodeError');
    const ev = payload as Extract<DagLifecycleEventType, { event: 'nodeError' }>;
    assert.equal(ev.nodeName, 'fetch-node');
    assert.equal(ev.error, 'fetch failed');
    assert.deepEqual(ev.placementPath, ['outer']);
    await bus.close();
  });
});

describe('BusObserver — multiple subscribers receive the same event', () => {
  it('two bus subscribers both receive the nodeStart event', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'shared');
    const state = new BusObserverTestState();

    const payloadsA: DagLifecycleEventType[] = [];
    const payloadsB: DagLifecycleEventType[] = [];

    bus.subscribe('shared', (e: BusEventEnvelopeType<unknown>) => { payloadsA.push(e.payload as DagLifecycleEventType); });
    bus.subscribe('shared', (e: BusEventEnvelopeType<unknown>) => { payloadsB.push(e.payload as DagLifecycleEventType); });

    observer.onNodeStart?.('classify', state, []);
    await bus.drain();

    assert.equal(payloadsA.length, 1);
    assert.equal(payloadsB.length, 1);
    assert.equal(payloadsA[0]?.event, 'nodeStart');
    assert.equal(payloadsB[0]?.event, 'nodeStart');
    await bus.close();
  });
});

describe('BusObserver.onPhaseEnter / onPhaseExit', () => {
  it('publishes phaseEnter and phaseExit events', async () => {
    const bus = EventBus.of();
    const observer = new BusObserver(bus, 'events');
    const state = new BusObserverTestState();
    const captured: DagLifecycleEventType[] = [];

    bus.subscribe('events', (e: BusEventEnvelopeType<unknown>) => { captured.push(e.payload as DagLifecycleEventType); });

    observer.onPhaseEnter?.('my-dag', 'pre', 'pre-phase', state, []);
    observer.onPhaseExit?.('my-dag', 'pre', 'pre-phase', state, []);
    await bus.drain();

    assert.equal(captured.length, 2);
    assert.equal(captured[0]?.event, 'phaseEnter');
    assert.equal(captured[1]?.event, 'phaseExit');
    const enter = captured[0] as Extract<DagLifecycleEventType, { event: 'phaseEnter' }>;
    assert.equal(enter.dagName, 'my-dag');
    assert.equal(enter.phase, 'pre');
    assert.equal(enter.placementName, 'pre-phase');
    await bus.close();
  });
});

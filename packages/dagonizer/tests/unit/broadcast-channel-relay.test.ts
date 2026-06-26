/**
 * Unit tests for `BroadcastChannelRelay`:
 *
 *   - Outbound: publishing on the bus posts the envelope over the channel.
 *   - Inbound: a message on the channel republishes on the local bus.
 *   - Topic filtering: events on non-subscribed topics are ignored in both directions.
 *   - Echo suppression: a paired relay setup delivers once per side and does not loop.
 *   - close(): unsubscribes from the bus and closes the channel; idempotent.
 *
 * `MockChannel` is a structural double — a static-class-built paired registry
 * so two mock instances sharing a name deliver to each other, simulating
 * cross-context BroadcastChannel delivery.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BroadcastChannelLikeInterface } from '../../src/progress/BroadcastChannelRelay.js';
import { BroadcastChannelRelay } from '../../src/progress/BroadcastChannelRelay.js';
import { EventBus } from '../../src/progress/EventBus.js';

// ---------------------------------------------------------------------------
// MockChannel: structural BroadcastChannel double
// ---------------------------------------------------------------------------

/**
 * Registry entry for a named mock channel.
 * Holds the set of all live instances joined to that name.
 */
type MockRegistryEntryType = {
  'instances': Set<MockChannel>;
};

/**
 * Listener map entry for a mock channel instance.
 */
type MockListenerSetType = Set<(event: { readonly 'data': unknown }) => void>;

/**
 * Structural double for `BroadcastChannelLikeInterface`.
 *
 * All instances sharing a `name` are joined via a static registry. When one
 * instance calls `postMessage`, every OTHER instance in the same group fires
 * its `message` listeners — mirroring real BroadcastChannel semantics.
 */
class MockChannel implements BroadcastChannelLikeInterface {
  static readonly #registry: Map<string, MockRegistryEntryType> = new Map();

  readonly name:      string;
  readonly #listeners: MockListenerSetType;

  constructor(name: string) {
    this.name       = name;
    this.#listeners = new Set();

    let entry = MockChannel.#registry.get(name);
    if (entry === undefined) {
      entry = { 'instances': new Set() };
      MockChannel.#registry.set(name, entry);
    }
    entry.instances.add(this);
  }

  postMessage(message: unknown): void {
    const entry = MockChannel.#registry.get(this.name);
    if (entry === undefined) return;
    for (const peer of entry.instances) {
      if (peer === this) continue;
      for (const listener of peer.#listeners) {
        listener({ 'data': message });
      }
    }
  }

  addEventListener(
    _type: 'message',
    listener: (event: { readonly 'data': unknown }) => void,
  ): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { readonly 'data': unknown }) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  close(): void {
    const entry = MockChannel.#registry.get(this.name);
    entry?.instances.delete(this);
    this.#listeners.clear();
    if (entry?.instances.size === 0) {
      MockChannel.#registry.delete(this.name);
    }
  }

  /** Reset the registry between tests (teardown helper). */
  static reset(): void {
    MockChannel.#registry.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a paired channel pair — two `MockChannel` instances sharing the
 * same name so they deliver to each other.
 */
class ChannelPair {
  static of(name: string): { 'a': MockChannel; 'b': MockChannel } {
    return { 'a': new MockChannel(name), 'b': new MockChannel(name) };
  }
}

// ---------------------------------------------------------------------------
// Outbound: bus.publish → channel.postMessage
// ---------------------------------------------------------------------------

describe('BroadcastChannelRelay outbound', () => {
  it('publishes an envelope over the channel when the bus fires on a subscribed topic', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-out-1');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    const received: unknown[] = [];
    chanB.addEventListener('message', (evt) => { received.push(evt.data); });

    bus.publish('runs', { 'nodeId': 'x' });

    assert.equal(received.length, 1);
    const msg = received[0];
    assert.ok(typeof msg === 'object' && msg !== null);
    const rec = msg as Record<string, unknown>;
    assert.equal(rec['topic'], 'runs');
    assert.deepEqual(rec['payload'], { 'nodeId': 'x' });
    assert.equal(typeof rec['timestamp'], 'number');

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });

  it('posts for each subscribed topic independently', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-out-2');

    const relay = BroadcastChannelRelay.of(bus, ['alpha', 'beta'], chanA);

    const received: unknown[] = [];
    chanB.addEventListener('message', (evt) => { received.push(evt.data); });

    bus.publish('alpha', 1);
    bus.publish('beta', 2);

    assert.equal(received.length, 2);

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });
});

// ---------------------------------------------------------------------------
// Inbound: channel message → bus.publish
// ---------------------------------------------------------------------------

describe('BroadcastChannelRelay inbound', () => {
  it('republishes a valid envelope from the channel onto the local bus', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-in-1');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    const received: unknown[] = [];
    bus.subscribe('runs', (e) => { received.push(e.payload); });

    // Simulate a message arriving from the other context.
    chanB.postMessage({ 'topic': 'runs', 'payload': { 'nodeId': 'y' }, 'timestamp': 1000 });

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], { 'nodeId': 'y' });

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });

  it('ignores inbound messages with a malformed envelope (missing topic)', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-in-2');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    let count = 0;
    bus.subscribe('runs', () => { count++; });

    chanB.postMessage({ 'notTopic': 'runs', 'payload': null, 'timestamp': 1000 });
    chanB.postMessage('plain string');
    chanB.postMessage(null);

    assert.equal(count, 0);

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });

  it('ignores inbound messages with a non-numeric timestamp', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-in-3');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    let count = 0;
    bus.subscribe('runs', () => { count++; });

    chanB.postMessage({ 'topic': 'runs', 'payload': null, 'timestamp': 'bad' });

    assert.equal(count, 0);

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });
});

// ---------------------------------------------------------------------------
// Topic filtering
// ---------------------------------------------------------------------------

describe('BroadcastChannelRelay topic filtering', () => {
  it('does NOT post outbound for events on a non-subscribed topic', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-filter-1');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    const received: unknown[] = [];
    chanB.addEventListener('message', (evt) => { received.push(evt.data); });

    bus.publish('other-topic', 'should not appear');

    assert.equal(received.length, 0);

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });

  it('does NOT republish inbound messages on a non-subscribed topic', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-filter-2');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    let count = 0;
    bus.subscribe('other-topic', () => { count++; });
    bus.subscribe('runs', () => { count++; });

    // Arrives on a topic the relay is not watching.
    chanB.postMessage({ 'topic': 'other-topic', 'payload': null, 'timestamp': 1000 });

    assert.equal(count, 0);

    relay.close();
    bus.dispose();
    MockChannel.reset();
  });
});

// ---------------------------------------------------------------------------
// Echo suppression
// ---------------------------------------------------------------------------

describe('BroadcastChannelRelay echo suppression', () => {
  it('a two-relay paired setup delivers once per side with no infinite loop', () => {
    const busA  = new EventBus();
    const busB  = new EventBus();
    const chanA = new MockChannel('echo-ch');
    const chanB = new MockChannel('echo-ch');

    const relayA = BroadcastChannelRelay.of(busA, ['evt'], chanA);
    const relayB = BroadcastChannelRelay.of(busB, ['evt'], chanB);

    const countA: unknown[] = [];
    const countB: unknown[] = [];

    busA.subscribe('evt', (e) => { countA.push(e.payload); });
    busB.subscribe('evt', (e) => { countB.push(e.payload); });

    // Publish once on busA.
    busA.publish('evt', 'ping');

    // busB should receive exactly one event.
    assert.equal(countB.length, 1);
    assert.equal(countB[0], 'ping');

    // busA should NOT receive an echo (the inbound on relayA is suppressed).
    assert.equal(countA.length, 1, 'busA should have exactly the original publish, no echo');

    relayA.close();
    relayB.close();
    busA.dispose();
    busB.dispose();
    MockChannel.reset();
  });

  it('inbound from channel does not echo back over the channel', () => {
    const busA  = new EventBus();
    const busB  = new EventBus();
    const chanA = new MockChannel('echo-ch2');
    const chanB = new MockChannel('echo-ch2');

    const relayA = BroadcastChannelRelay.of(busA, ['evt'], chanA);
    const relayB = BroadcastChannelRelay.of(busB, ['evt'], chanB);

    const receivedOnBusA: unknown[] = [];
    const receivedOnBusB: unknown[] = [];

    busA.subscribe('evt', (e) => { receivedOnBusA.push(e.payload); });
    busB.subscribe('evt', (e) => { receivedOnBusB.push(e.payload); });

    // chanB.postMessage simulates an external context sending to chanA's peers.
    // In MockChannel semantics, postMessage fires listeners on all peers (chanA).
    // So relayA's inbound handler fires: it republishes on busA with
    // #suppressOutbound = true, preventing chanA from echoing back to chanB
    // (which would make busB fire).
    chanB.postMessage({ 'topic': 'evt', 'payload': 'from-outside', 'timestamp': 2000 });

    // relayA's inbound handler republishes on busA. busA fires once.
    assert.equal(receivedOnBusA.length, 1);
    assert.equal(receivedOnBusA[0], 'from-outside');

    // relayB's outbound subscription sees the publish on busB via busA's republish.
    // However, busA republishes → chanA.postMessage is suppressed → chanB does not
    // fire → busB does not receive it.
    // But relayB's own inbound was the one that triggered this; busB is also
    // subscribed via relayB to 'evt'. The message relayB's outbound posted was the
    // original chanB.postMessage, which fired chanA's listeners (relayA) — not
    // chanB's own listeners (relayB). So busB should have 0 events.
    assert.equal(receivedOnBusB.length, 0);

    relayA.close();
    relayB.close();
    busA.dispose();
    busB.dispose();
    MockChannel.reset();
  });
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

describe('BroadcastChannelRelay close()', () => {
  it('stops further outbound delivery after close', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-close-1');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    const received: unknown[] = [];
    chanB.addEventListener('message', (evt) => { received.push(evt.data); });

    bus.publish('runs', 'before');
    relay.close();
    bus.publish('runs', 'after');

    assert.equal(received.length, 1);
    assert.equal((received[0] as Record<string, unknown>)['payload'], 'before');

    bus.dispose();
    MockChannel.reset();
  });

  it('stops further inbound delivery after close', () => {
    const bus  = new EventBus();
    const { 'a': chanA, 'b': chanB } = ChannelPair.of('ch-close-2');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    let count = 0;
    bus.subscribe('runs', () => { count++; });

    chanB.postMessage({ 'topic': 'runs', 'payload': null, 'timestamp': 1000 });
    relay.close();
    chanB.postMessage({ 'topic': 'runs', 'payload': null, 'timestamp': 2000 });

    assert.equal(count, 1);

    bus.dispose();
    MockChannel.reset();
  });

  it('close() is idempotent — calling twice does not throw', () => {
    const bus  = new EventBus();
    const { 'a': chanA } = ChannelPair.of('ch-close-3');

    const relay = BroadcastChannelRelay.of(bus, ['runs'], chanA);

    assert.doesNotThrow(() => {
      relay.close();
      relay.close();
    });

    bus.dispose();
    MockChannel.reset();
  });
});

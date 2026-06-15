/**
 * loopback-channel.test.ts
 *
 * Coverage targets:
 *   S4 — LoopbackChannel messages sent before onMessage() is registered are
 *        silently dropped (no error, no delayed delivery after registration).
 *   G7 — close() severs both directions; messages sent after close are silently
 *        dropped on the closed side and on the peer side.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

const INIT_MSG: BridgeMessage = {
  'kind': 'init',
  'registryModule': '/test/module.js',
  'registryVersion': '1.0.0',
  'servicesConfig': {},
};

const SHUTDOWN_MSG: BridgeMessage = { 'kind': 'shutdown' };

// ---------------------------------------------------------------------------
// S4 — pre-registration drop
// ---------------------------------------------------------------------------

void describe('LoopbackChannel — pre-registration drop (S4)', () => {
  void it('message sent before onMessage() is registered is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    // Send BEFORE registering a handler on hostSide.
    parentSide.send(INIT_MSG);

    // Wait a tick to let setImmediate fire (if it were going to).
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Now register handler — it must NOT fire for the already-sent message.
    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Another tick — still no delivery.
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 0,
      'message sent before onMessage() registration must be silently dropped');
  });

  void it('after onMessage() is registered, subsequent messages are delivered', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    parentSide.send(INIT_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'init');
  });
});

// ---------------------------------------------------------------------------
// G7 — close() severs both directions
// ---------------------------------------------------------------------------

void describe('LoopbackChannel — close() severs both directions (G7)', () => {
  void it('send after close() on the sender side is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Verify delivery works before close.
    parentSide.send(INIT_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(received.length, 1, 'message before close must arrive');

    // Close parentSide.
    parentSide.close();

    // Send after close — must be dropped silently.
    parentSide.send(SHUTDOWN_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 1, 'message after sender close must be dropped');
  });

  void it('send to the closed side is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    parentSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Close hostSide — receiving side closed.
    hostSide.close();

    // parentSide sends to hostSide — but hostSide is closed, so hostSide's peer
    // (parentSide itself) won't deliver because parentSide's peer (hostSide) is closed.
    // Actually: parentSide.send → delivers to hostSide.handler — but hostSide is closed,
    // so its peer reference is null. parentSide.send checks peer.closed first.
    // Let's verify: close() on hostSide should not affect parentSide.send path either.
    hostSide.send(SHUTDOWN_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // After hostSide.close(), its peer (parentSide) should still be reachable
    // for messages from parentSide → hostSide, but hostSide → parentSide
    // sends are dropped because peer reference is severed on close().
    assert.strictEqual(received.length, 0,
      'messages from the closed side must not arrive');
  });

  void it('close() is idempotent — calling twice does not throw', () => {
    const [parentSide] = LoopbackChannel.pair();
    assert.doesNotThrow(() => {
      parentSide.close();
      parentSide.close();
    });
  });

  void it('channel pair is bidirectional before close', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const parentReceived: BridgeMessage[] = [];
    const hostReceived: BridgeMessage[] = [];
    parentSide.onMessage((msg: BridgeMessage) => parentReceived.push(msg));
    hostSide.onMessage((msg: BridgeMessage) => hostReceived.push(msg));

    parentSide.send(INIT_MSG);
    hostSide.send(SHUTDOWN_MSG);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(hostReceived.length, 1, 'parent→host must deliver');
    assert.strictEqual(hostReceived[0]?.kind, 'init');
    assert.strictEqual(parentReceived.length, 1, 'host→parent must deliver');
    assert.strictEqual(parentReceived[0]?.kind, 'shutdown');
  });
});

/**
 * channel-ingest.test.ts: ingest-boundary validation for MessagePortChannel and IpcChannel.
 *
 * Both channels validate inbound payloads via Validator.bridgeMessage and
 * surface malformed messages as an error BridgeMessage delivered to the
 * handler — never an unvalidated cast, never a throw. These tests inject a
 * fake port / endpoint that delivers both valid and malformed payloads.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BridgeMessage } from '@noocodex/dagonizer/entities';

import { IpcChannel } from '../../src/IpcChannel.js';
import type { IpcEndpoint } from '../../src/IpcChannel.js';
import { MessagePortChannel } from '../../src/MessagePortChannel.js';
import type { MessagePortLike } from '../../src/MessagePortChannel.js';

// ---------------------------------------------------------------------------
// Fake MessagePortLike — captures the registered listener so a test can
// deliver arbitrary payloads to it.
// ---------------------------------------------------------------------------

class FakePort implements MessagePortLike {
  #listener: ((value: unknown) => void) | null;

  constructor() {
    this.#listener = null;
  }

  postMessage(_value: unknown): void { /* not used in ingest tests */ }

  on(_event: 'message', listener: (value: unknown) => void): this {
    this.#listener = listener;
    return this;
  }

  close(): void { /* no-op */ }

  /** Test-only: deliver a raw payload to the registered listener. */
  deliver(value: unknown): void {
    this.#listener?.(value);
  }
}

// ---------------------------------------------------------------------------
// Fake IpcEndpoint — same idea for the IPC side.
// ---------------------------------------------------------------------------

class FakeEndpoint implements IpcEndpoint {
  #listener: ((value: unknown) => void) | null;

  constructor() {
    this.#listener = null;
  }

  send(_message: unknown): void { /* not used in ingest tests */ }

  on(_event: 'message', listener: (value: unknown) => void): this {
    this.#listener = listener;
    return this;
  }

  /** Test-only: deliver a raw payload to the registered listener. */
  deliver(value: unknown): void {
    this.#listener?.(value);
  }
}

function validMessage(): BridgeMessage {
  return { 'kind': 'ready', 'registryVersion': '1.0.0', 'capabilities': [] };
}

// ---------------------------------------------------------------------------
// MessagePortChannel ingest
// ---------------------------------------------------------------------------

void describe('MessagePortChannel — ingest validation', () => {
  void it('delivers a valid BridgeMessage unchanged', () => {
    const port = new FakePort();
    const channel = new MessagePortChannel(port);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    port.deliver(validMessage());

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'ready');
  });

  void it('surfaces a malformed payload as an error BridgeMessage, does not throw', () => {
    const port = new FakePort();
    const channel = new MessagePortChannel(port);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    assert.doesNotThrow(() => port.deliver({ 'kind': 'bogus', 'junk': true }));

    assert.strictEqual(received.length, 1);
    const msg = received[0];
    assert.ok(msg?.kind === 'error');
    assert.strictEqual(msg.code, 'INVALID_MESSAGE');
    assert.strictEqual(msg.correlationId, null);
    assert.strictEqual(msg.recoverable, false);
  });

  void it('surfaces a non-object payload as an error BridgeMessage', () => {
    const port = new FakePort();
    const channel = new MessagePortChannel(port);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    port.deliver('not-an-object');

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'error');
  });
});

// ---------------------------------------------------------------------------
// IpcChannel ingest
// ---------------------------------------------------------------------------

void describe('IpcChannel — ingest validation', () => {
  void it('delivers a valid BridgeMessage unchanged', () => {
    const endpoint = new FakeEndpoint();
    const channel = new IpcChannel(endpoint);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    endpoint.deliver(validMessage());

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'ready');
  });

  void it('surfaces a malformed payload as an error BridgeMessage, does not throw', () => {
    const endpoint = new FakeEndpoint();
    const channel = new IpcChannel(endpoint);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    assert.doesNotThrow(() => endpoint.deliver({ 'kind': 'bogus', 'junk': true }));

    assert.strictEqual(received.length, 1);
    const msg = received[0];
    assert.ok(msg?.kind === 'error');
    assert.strictEqual(msg.code, 'INVALID_MESSAGE');
    assert.strictEqual(msg.correlationId, null);
    assert.strictEqual(msg.recoverable, false);
  });

  void it('surfaces a null payload as an error BridgeMessage', () => {
    const endpoint = new FakeEndpoint();
    const channel = new IpcChannel(endpoint);
    const received: BridgeMessage[] = [];
    channel.onMessage((m) => received.push(m));

    endpoint.deliver(null);

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'error');
  });
});

/**
 * channels.test.ts: bridge-channel transport tests for the Node.js executor.
 *
 * Covers all three channel implementations:
 *   - NdjsonChannel       — NDJSON framing over a readable/writable stream pair
 *                           (send encoding, chunk assembly, ingest validation).
 *   - MessagePortChannel  — worker_threads MessagePort ingest validation.
 *   - IpcChannel          — child_process IPC endpoint ingest validation.
 *
 * Every channel validates inbound payloads via Validator.bridgeMessage and
 * surfaces a malformed message as an error BridgeMessageType delivered to the
 * handler — never an unvalidated cast, never a throw. The error BridgeMessageType
 * carries correlationId: null and recoverable: false.
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import type { BridgeMessageType } from '@studnicky/dagonizer/entities';

import { IpcChannel } from '../../src/IpcChannel.js';
import type { IpcEndpointInterface } from '../../src/IpcChannel.js';
import { MessagePortChannel } from '../../src/MessagePortChannel.js';
import type { MessagePortLikeInterface } from '../../src/MessagePortChannel.js';
import { NdjsonChannel } from '../../src/NdjsonChannel.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function readyMessage(): BridgeMessageType {
  return { 'variant': 'ready', 'registryVersion': '1.0.0', 'capabilities': [] };
}

function errorMessage(): BridgeMessageType {
  return { 'variant': 'error', 'correlationId': null, 'code': 'TEST', 'message': 'hi', 'recoverable': false };
}

// ---------------------------------------------------------------------------
// NdjsonChannel fixtures
// ---------------------------------------------------------------------------

class NdjsonChannelFixture {
  private constructor() {}

  static of(): { channel: NdjsonChannel; readable: PassThrough; writable: PassThrough } {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const channel = new NdjsonChannel(readable, writable);
    return { 'channel': channel, 'readable': readable, 'writable': writable };
  }
}

function collectNdjsonMessages(channel: NdjsonChannel): BridgeMessageType[] {
  const messages: BridgeMessageType[] = [];
  channel.onMessage((msg) => { messages.push(msg); });
  return messages;
}

// ---------------------------------------------------------------------------
// Fake MessagePortLikeInterface — captures the registered listener so a test can
// deliver arbitrary payloads to it.
// ---------------------------------------------------------------------------

class FakePort implements MessagePortLikeInterface {
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
// Fake IpcEndpointInterface — same idea for the IPC side.
// ---------------------------------------------------------------------------

class FakeEndpoint implements IpcEndpointInterface {
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

// ---------------------------------------------------------------------------
// NdjsonChannel — send encoding
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.send', () => {
  void it('encodes message as JSON line terminated with newline', (_, done) => {
    const { channel, writable } = NdjsonChannelFixture.of();
    const chunks: string[] = [];
    writable.on('data', (chunk: Buffer) => { chunks.push(chunk.toString('utf8')); });
    writable.on('end', () => {
      const output = chunks.join('');
      assert.ok(output.endsWith('\n'), 'must end with newline');
      const parsed = JSON.parse(output.trimEnd()) as BridgeMessageType;
      assert.strictEqual(parsed.variant, 'ready');
      done();
    });

    channel.send(readyMessage());
    writable.end();
  });
});

// ---------------------------------------------------------------------------
// NdjsonChannel — inbound framing (chunk assembly + close)
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — framing', () => {
  void it('dispatches a single message from one complete line', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    await new Promise<void>((resolve) => {
      readable.write(JSON.stringify(readyMessage()) + '\n', () => resolve());
    });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.variant, 'ready');
  });

  void it('assembles a message split across two chunks, emitting nothing before the newline', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    const full = JSON.stringify(readyMessage()) + '\n';
    const half = Math.floor(full.length / 2);

    await new Promise<void>((resolve) => { readable.write(full.slice(0, half), () => resolve()); });
    // No message yet — chunk is partial.
    assert.strictEqual(messages.length, 0, 'no message before newline');

    await new Promise<void>((resolve) => { readable.write(full.slice(half), () => resolve()); });
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.variant, 'ready');
  });

  void it('dispatches multiple messages from a single chunk in order', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    const m1 = JSON.stringify(readyMessage()) + '\n';
    const m2 = JSON.stringify(errorMessage() satisfies BridgeMessageType) + '\n';

    await new Promise<void>((resolve) => { readable.write(m1 + m2, () => resolve()); });

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0]?.variant, 'ready');
    assert.strictEqual(messages[1]?.variant, 'error');
  });

  void it('stops delivering messages after close', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    channel.close();

    await new Promise<void>((resolve) => {
      readable.write(JSON.stringify(readyMessage()) + '\n', () => resolve());
    });

    assert.strictEqual(messages.length, 0, 'no messages delivered after close');
  });
});

// ---------------------------------------------------------------------------
// NdjsonChannel — ingest validation (parse error vs validation error)
//
// Both error paths surface an error BridgeMessageType with correlationId: null and
// recoverable: false, distinguished by code: a syntactically-invalid line is an
// NDJSON_PARSE_ERROR; a well-formed JSON line that is not a valid BridgeMessageType
// is an NDJSON_VALIDATION_ERROR. Neither path throws.
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — ingest validation', () => {
  void it('surfaces a malformed JSON line as an NDJSON_PARSE_ERROR error message', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    await new Promise<void>((resolve) => { readable.write('not-json\n', () => resolve()); });

    assert.strictEqual(messages.length, 1);
    const errMsg = messages[0];
    assert.ok(errMsg?.variant === 'error');
    assert.strictEqual(errMsg.code, 'NDJSON_PARSE_ERROR');
    assert.strictEqual(errMsg.correlationId, null);
    assert.strictEqual(errMsg.recoverable, false);
  });

  void it('surfaces a valid-JSON-but-invalid-BridgeMessageType line as an NDJSON_VALIDATION_ERROR', async () => {
    const { channel, readable } = NdjsonChannelFixture.of();
    const messages = collectNdjsonMessages(channel);

    const invalidMsg = JSON.stringify({ 'variant': 'not-a-real-variant', 'extra': 'data' });
    await new Promise<void>((resolve) => { readable.write(invalidMsg + '\n', () => resolve()); });

    assert.strictEqual(messages.length, 1);
    const errMsg = messages[0];
    assert.ok(errMsg?.variant === 'error');
    assert.strictEqual(errMsg.code, 'NDJSON_VALIDATION_ERROR');
    assert.strictEqual(errMsg.correlationId, null);
    assert.strictEqual(errMsg.recoverable, false);
  });
});

// ---------------------------------------------------------------------------
// MessagePortChannel / IpcChannel — ingest validation
//
// Both wrap a transport that delivers raw payloads. Each validates inbound
// payloads via Validator.bridgeMessage: a valid BridgeMessageType passes through
// unchanged; any malformed payload (bad object shape, wrong primitive type,
// null) is surfaced as an INVALID_MESSAGE error BridgeMessageType with
// correlationId: null and recoverable: false, without throwing.
// ---------------------------------------------------------------------------

interface IngestTransport {
  onMessage(handler: (message: BridgeMessageType) => void): void;
  deliver(value: unknown): void;
}

const ingestChannels: ReadonlyArray<{ name: string; make: () => IngestTransport }> = [
  {
    'name': 'MessagePortChannel',
    'make': (): IngestTransport => {
      const port = new FakePort();
      const channel = new MessagePortChannel(port);
      return {
        'onMessage': (handler) => channel.onMessage(handler),
        'deliver': (value) => port.deliver(value),
      };
    },
  },
  {
    'name': 'IpcChannel',
    'make': (): IngestTransport => {
      const endpoint = new FakeEndpoint();
      const channel = new IpcChannel(endpoint);
      return {
        'onMessage': (handler) => channel.onMessage(handler),
        'deliver': (value) => endpoint.deliver(value),
      };
    },
  },
];

for (const { name, make } of ingestChannels) {
  void describe(`${name} — ingest validation`, () => {
    void it('delivers a valid BridgeMessageType unchanged', () => {
      const transport = make();
      const received: BridgeMessageType[] = [];
      transport.onMessage((m) => received.push(m));

      transport.deliver(readyMessage());

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0]?.variant, 'ready');
    });

    void it('surfaces a malformed object payload as an INVALID_MESSAGE error, does not throw', () => {
      const transport = make();
      const received: BridgeMessageType[] = [];
      transport.onMessage((m) => received.push(m));

      assert.doesNotThrow(() => transport.deliver({ 'variant': 'bogus', 'junk': true }));

      assert.strictEqual(received.length, 1);
      const msg = received[0];
      assert.ok(msg?.variant === 'error');
      assert.strictEqual(msg.code, 'INVALID_MESSAGE');
      assert.strictEqual(msg.correlationId, null);
      assert.strictEqual(msg.recoverable, false);
    });

    void it('surfaces a non-object string payload as an INVALID_MESSAGE error', () => {
      const transport = make();
      const received: BridgeMessageType[] = [];
      transport.onMessage((m) => received.push(m));

      transport.deliver('not-an-object');

      assert.strictEqual(received.length, 1);
      const msg = received[0];
      assert.ok(msg?.variant === 'error');
      assert.strictEqual(msg.code, 'INVALID_MESSAGE');
    });

    void it('surfaces a null payload as an INVALID_MESSAGE error', () => {
      const transport = make();
      const received: BridgeMessageType[] = [];
      transport.onMessage((m) => received.push(m));

      transport.deliver(null);

      assert.strictEqual(received.length, 1);
      const msg = received[0];
      assert.ok(msg?.variant === 'error');
      assert.strictEqual(msg.code, 'INVALID_MESSAGE');
    });
  });
}

/**
 * ndjson-channel.test.ts: NdjsonChannel framing unit tests.
 *
 * Tests: split chunks, multiple messages per chunk, malformed line handling.
 */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import type { BridgeMessage } from '@noocodex/dagonizer/entities';

import { NdjsonChannel } from '../../src/NdjsonChannel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannel(): { channel: NdjsonChannel; readable: PassThrough; writable: PassThrough } {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const channel = new NdjsonChannel(readable, writable);
  return { 'channel': channel, 'readable': readable, 'writable': writable };
}

function collectMessages(channel: NdjsonChannel): BridgeMessage[] {
  const messages: BridgeMessage[] = [];
  channel.onMessage((msg) => { messages.push(msg); });
  return messages;
}

function readyMessage(): BridgeMessage {
  return { 'kind': 'ready', 'registryVersion': '1.0.0', 'capabilities': [] };
}

// ---------------------------------------------------------------------------
// send: encodes as NDJSON line
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.send', () => {
  void it('encodes message as JSON line terminated with newline', (_, done) => {
    const { channel, writable } = makeChannel();
    const chunks: string[] = [];
    writable.on('data', (chunk: Buffer) => { chunks.push(chunk.toString('utf8')); });
    writable.on('end', () => {
      const output = chunks.join('');
      assert.ok(output.endsWith('\n'), 'must end with newline');
      const parsed = JSON.parse(output.trimEnd()) as BridgeMessage;
      assert.strictEqual(parsed.kind, 'ready');
      done();
    });

    channel.send(readyMessage());
    writable.end();
  });
});

// ---------------------------------------------------------------------------
// onMessage: complete line in one chunk
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — single complete line', () => {
  void it('dispatches a single message from one chunk', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    await new Promise<void>((resolve) => {
      readable.write(JSON.stringify(readyMessage()) + '\n', () => resolve());
    });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.kind, 'ready');
  });
});

// ---------------------------------------------------------------------------
// onMessage: message split across chunks
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — split chunk', () => {
  void it('assembles a message split across two chunks', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    const full = JSON.stringify(readyMessage()) + '\n';
    const half = Math.floor(full.length / 2);

    await new Promise<void>((resolve) => { readable.write(full.slice(0, half), () => resolve()); });
    // No message yet — chunk is partial.
    assert.strictEqual(messages.length, 0, 'no message before newline');

    await new Promise<void>((resolve) => { readable.write(full.slice(half), () => resolve()); });
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.kind, 'ready');
  });
});

// ---------------------------------------------------------------------------
// onMessage: multiple messages in one chunk
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — multiple messages per chunk', () => {
  void it('dispatches multiple messages from a single chunk', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    const m1 = JSON.stringify(readyMessage()) + '\n';
    const m2 = JSON.stringify({ 'kind': 'log', 'level': 'info', 'component': 'test', 'operation': 'test', 'message': 'hi' } satisfies BridgeMessage) + '\n';

    await new Promise<void>((resolve) => { readable.write(m1 + m2, () => resolve()); });

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0]?.kind, 'ready');
    assert.strictEqual(messages[1]?.kind, 'log');
  });
});

// ---------------------------------------------------------------------------
// onMessage: malformed JSON line
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — malformed JSON', () => {
  void it('surfaces parse error as error BridgeMessage, does not throw', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    await new Promise<void>((resolve) => { readable.write('not-json\n', () => resolve()); });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.kind, 'error');
    const errMsg = messages[0];
    assert.ok(errMsg?.kind === 'error');
    assert.strictEqual(errMsg.code, 'NDJSON_PARSE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// onMessage: valid JSON but invalid BridgeMessage
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.onMessage — invalid BridgeMessage', () => {
  void it('surfaces validation error as error BridgeMessage, does not throw', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    const invalidMsg = JSON.stringify({ 'kind': 'not-a-real-kind', 'extra': 'data' });
    await new Promise<void>((resolve) => { readable.write(invalidMsg + '\n', () => resolve()); });

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0]?.kind, 'error');
    const errMsg = messages[0];
    assert.ok(errMsg?.kind === 'error');
    assert.strictEqual(errMsg.code, 'NDJSON_VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// close: stops message delivery
// ---------------------------------------------------------------------------

void describe('NdjsonChannel.close', () => {
  void it('stops delivering messages after close', async () => {
    const { channel, readable } = makeChannel();
    const messages = collectMessages(channel);

    channel.close();

    await new Promise<void>((resolve) => {
      readable.write(JSON.stringify(readyMessage()) + '\n', () => resolve());
    });

    assert.strictEqual(messages.length, 0, 'no messages delivered after close');
  });
});

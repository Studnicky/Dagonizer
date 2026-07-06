/**
 * Tests for the BaseAdapter `systemPrompt` seam.
 *
 * A consumer-configured default system prompt is injected as the LEADING
 * message of any chat request that carries no system message of its own —
 * never overriding an explicit system turn, never producing a second one, and
 * never acting when no default is configured. Leading position is load-bearing:
 * the on-device backends (Chrome Prompt API, MLC WebLLM) reject a system
 * message at any non-zero index.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BaseAdapter,
  ChatRequest,
  ChatResponseMessage,
  ZERO_TOKEN_USAGE,
} from '../../src/adapter/index.js';
import type {
  AdapterCapabilitiesType,
  BaseAdapterOptionsType,
  ChatRequestType,
  ChatResponseType,
} from '../../src/adapter/index.js';

const CAPS: AdapterCapabilitiesType = { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false };

/** Concrete adapter that records the request handed to `performChat`. */
class RecordingAdapter extends BaseAdapter {
  seen: ChatRequestType | null = null;

  constructor(options: BaseAdapterOptionsType = {}) {
    super('recording', 'Recording test adapter', CAPS, options);
  }

  protected performChat(request: ChatRequestType): Promise<ChatResponseType> {
    this.seen = request;
    return Promise.resolve({
      'message':      ChatResponseMessage.create('ok', []),
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }
}

void describe('BaseAdapter systemPrompt seam', () => {
  void it('injects the default as the leading system message for a user-only request', async () => {
    const a = new RecordingAdapter({ 'systemPrompt': 'You are the Archivist.' });
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
    assert.deepEqual(a.seen?.messages, [
      { 'role': 'system', 'content': 'You are the Archivist.' },
      { 'role': 'user',   'content': 'Hello.' },
    ]);
  });

  void it('does not inject when no default is configured (empty string)', async () => {
    const a = new RecordingAdapter();
    await a.chat(ChatRequest.create({ 'messages': [{ 'role': 'user', 'content': 'Hello.' }] }));
    assert.deepEqual(a.seen?.messages, [{ 'role': 'user', 'content': 'Hello.' }]);
  });

  void it('never overrides or duplicates an explicit system message', async () => {
    const a = new RecordingAdapter({ 'systemPrompt': 'Default directive.' });
    await a.chat(ChatRequest.create({
      'messages': [
        { 'role': 'system', 'content': 'Caller persona.' },
        { 'role': 'user',   'content': 'Hello.' },
      ],
    }));
    assert.deepEqual(a.seen?.messages, [
      { 'role': 'system', 'content': 'Caller persona.' },
      { 'role': 'user',   'content': 'Hello.' },
    ]);
  });
});

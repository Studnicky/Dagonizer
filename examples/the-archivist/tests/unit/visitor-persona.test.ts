/**
 * visitor-persona.test.ts: regression test for the bootstrap suggestion calls.
 *
 * The Archivist greeting must run under the Archivist system persona, but the
 * sample visitor reply (and the starter query) must run under a *visitor*
 * persona — otherwise a weak model stays in the Archivist's voice and the
 * "sample visitor message" comes out as a second greeting.
 *
 * The mechanism: `BaseLlmClient.#textAsVisitor` prepends a `role: 'system'`
 * message, which makes `BaseAdapter.#withDefaultSystemPrompt` skip injecting
 * the adapter's baked-in Archivist persona. This test exercises the real gate
 * by recording the prepared request `BaseAdapter` hands to `performChat`.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BaseAdapter, ChatResponseMessageBuilder } from '@studnicky/dagonizer/adapter';
import type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
} from '@studnicky/dagonizer/adapter';

import { BaseLlmClient } from '../../providers/BaseLlmClient.ts';
import { prompts } from '../../providers/prompts.ts';

const CAPS: AdapterCapabilitiesType = { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false };

/**
 * Adapter that records the prepared request and returns a canned reply.
 * Constructed with the Archivist system persona, mirroring production, so the
 * test can prove which persona each call actually runs under.
 */
class RecordingAdapter extends BaseAdapter {
  lastMessages: readonly ChatMessageType[] = [];

  constructor() {
    super('recording', 'Recording', CAPS, { 'systemPrompt': prompts.systemPrompt() });
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    this.lastMessages = request.messages;
    return {
      'message': ChatResponseMessageBuilder.from('a visitor question', []),
      'finishReason': 'stop',
      'usage': { 'promptTokens': 0, 'completionTokens': 0 },
    };
  }
}

function systemContentOf(messages: readonly ChatMessageType[]): string {
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

void test('suggestVisitorReplyTo runs under the visitor persona, not the Archivist persona', async () => {
  const adapter = new RecordingAdapter();
  const client = new BaseLlmClient(adapter);
  await client.suggestVisitorReplyTo('Welcome to the shop. What brings you in?');

  assert.equal(systemContentOf(adapter.lastMessages), prompts.visitorPersona());
  assert.notEqual(systemContentOf(adapter.lastMessages), prompts.systemPrompt());
});

void test('suggestStarterQuery runs under the visitor persona', async () => {
  const adapter = new RecordingAdapter();
  const client = new BaseLlmClient(adapter);
  await client.suggestStarterQuery();

  assert.equal(systemContentOf(adapter.lastMessages), prompts.visitorPersona());
});

void test('suggestGreeting still runs under the Archivist persona', async () => {
  const adapter = new RecordingAdapter();
  const client = new BaseLlmClient(adapter);
  await client.suggestGreeting();

  // No system message in the request → BaseAdapter injects the Archivist persona.
  assert.equal(systemContentOf(adapter.lastMessages), prompts.systemPrompt());
});

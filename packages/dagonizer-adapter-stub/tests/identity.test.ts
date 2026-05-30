import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';

import { StubAdapter } from '../src/index.js';

const sampleRequest = (text = 'hi') => ChatRequestBuilder.from({
  'messages': [{ 'role': 'user' as const, 'content': text, 'toolCallId': '', 'toolName': '' }],
});

void test('StubAdapter returns the default response', async () => {
  const a = new StubAdapter({ 'defaultResponse': 'hello stub' });
  assert.equal(a.id, 'stub');
  const res = await a.chat(sampleRequest());
  assert.equal(res.message.kind, 'text');
  if (res.message.kind === 'text') assert.equal(res.message.content, 'hello stub');
});

void test('StubAdapter records every chat() invocation in arrival order', async () => {
  const a = new StubAdapter();
  await a.chat(sampleRequest('first'));
  await a.chat(sampleRequest('second'));
  assert.equal(a.invocations.length, 2);
  assert.equal(a.invocations[0]?.messages[0]?.content, 'first');
  assert.equal(a.invocations[1]?.messages[0]?.content, 'second');
});

void test('StubAdapter drains pre-seeded responses queue in FIFO order', async () => {
  const a = new StubAdapter({ 'responses': ['one', 'two'], 'defaultResponse': 'fallback' });
  const r1 = await a.chat(sampleRequest());
  const r2 = await a.chat(sampleRequest());
  const r3 = await a.chat(sampleRequest());
  if (r1.message.kind === 'text') assert.equal(r1.message.content, 'one');
  if (r2.message.kind === 'text') assert.equal(r2.message.content, 'two');
  // queue empty → falls back to defaultResponse
  if (r3.message.kind === 'text') assert.equal(r3.message.content, 'fallback');
});

void test('StubAdapter.enqueueResponse pushes onto the queue mid-test', async () => {
  const a = new StubAdapter({ 'defaultResponse': 'fallback' });
  a.enqueueResponse('queued');
  const r = await a.chat(sampleRequest());
  if (r.message.kind === 'text') assert.equal(r.message.content, 'queued');
});

void test('StubAdapter.setError makes next chat() throw and clears after one use', async () => {
  const a = new StubAdapter({ 'defaultResponse': 'ok' });
  a.setError(new Error('boom'));
  await assert.rejects(() => a.chat(sampleRequest()), /boom/);
  // Second call succeeds; error was one-shot.
  const r = await a.chat(sampleRequest());
  if (r.message.kind === 'text') assert.equal(r.message.content, 'ok');
});

void test('StubAdapter.probe always returns false (opt-in only, never wins a cascade)', async () => {
  const a = new StubAdapter();
  assert.equal(await a.probe(), false);
  // Re-arming queue + default response must not influence probe.
  a.enqueueResponse('queued');
  assert.equal(await a.probe(), false);
});

void test('StubAdapter.clear resets invocations, queue, and pending error', async () => {
  const a = new StubAdapter({ 'responses': ['first'], 'defaultResponse': 'fresh' });
  await a.chat(sampleRequest());
  a.setError(new Error('pending'));
  assert.equal(a.invocations.length, 1);
  a.clear();
  assert.equal(a.invocations.length, 0);
  // After clear() the queue is drained and error is cleared.
  const r = await a.chat(sampleRequest());
  if (r.message.kind === 'text') assert.equal(r.message.content, 'fresh');
});

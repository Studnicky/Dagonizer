import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { StubAdapter } from '../src/index.js';
import { ChatRequestBuilder } from '@noocodex/dagonizer/adapter';
void test('StubAdapter returns the default response', async () => {
  const a = new StubAdapter({ 'defaultResponse': 'hello stub' });
  assert.equal(a.id, 'stub');
  const res = await a.chat(ChatRequestBuilder.from({
    'messages': [{ 'role': 'user', 'content': 'hi', 'toolCallId': '', 'toolName': '' }],
  }));
  assert.equal(res.message.kind, 'text');
  if (res.message.kind === 'text') assert.equal(res.message.content, 'hello stub');
});

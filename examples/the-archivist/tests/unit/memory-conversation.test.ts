import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GRAPH_CONVERSATION, MemoryStore } from '../../memory/MemoryStore.ts';

void test('MemoryStore records conversation turns in the RDF conversation graph', () => {
  const store = new MemoryStore();

  store.recordConversationTurn({ 'role': 'archivist', 'text': 'Welcome in. What are you reading?', 'ts': 100 });
  store.recordConversationTurn({ 'role': 'visitor', 'text': 'Tell me about Sir Thursday', 'ts': 200 });

  assert.deepEqual(store.conversationTurns(10), [
    { 'role': 'archivist', 'text': 'Welcome in. What are you reading?', 'ts': 100 },
    { 'role': 'visitor', 'text': 'Tell me about Sir Thursday', 'ts': 200 },
  ]);
  assert.equal(store.count({ 'graph': GRAPH_CONVERSATION }), 10);
  assert.ok(store.graphs().some((graph) => graph.value === GRAPH_CONVERSATION.value));
});

void test('MemoryStore conversation turns round-trip through snapshots', async () => {
  const store = new MemoryStore();
  store.recordConversationTurn({ 'role': 'visitor', 'text': 'Anything like Neuromancer?', 'ts': 300 });

  const restored = new MemoryStore();
  await restored.restore(await store.snapshot());

  assert.deepEqual(restored.conversationTurns(10), [
    { 'role': 'visitor', 'text': 'Anything like Neuromancer?', 'ts': 300 },
  ]);
});

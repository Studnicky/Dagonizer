import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RecallContextNode } from '../src/index.js';
import type { Binding, SlotPattern, TripleStore } from '@noocodex/dagonizer/patterns';

class TestState {
  recalled: string[] = [];
  data: Record<string, unknown> = {};
  snapshotData(): Record<string, unknown> { return this.data; }
  restoreData(d: Record<string, unknown>): void { this.data = d; }
}

class TestRecall extends RecallContextNode<TestState, string> {
  readonly name = 'test-recall';
  readonly outputs = ['success', 'empty'] as const;
  protected buildQuery(_s: TestState): SlotPattern { return { 'subject': '?s' }; }
  protected mapBindings(rows: readonly Binding[]): readonly string[] { return rows.map((r) => r['s']?.value ?? ''); }
  protected applyRecall(s: TestState, items: readonly string[]): void { s.recalled = [...items]; }
}

void test('RecallContextNode reads + writes via the store', async () => {
  const node = new TestRecall();
  const state = new TestState();
  const mockStore = {
    'select': () => [{ 's': { 'termType': 'NamedNode', 'value': 'urn:test:a' } }],
    'assert': () => undefined,
    'ask': () => true,
    'count': () => 1,
    'clearGraph': () => undefined,
    'triples': function* () { /* empty */ },
  } as unknown as TripleStore;
  const ctx = { 'services': { 'memory': mockStore }, 'signal': new AbortController().signal } as unknown as Parameters<typeof node.execute>[1];
  const result = await node.execute(state, ctx);
  assert.equal(result.output, 'success');
  assert.deepEqual(state.recalled, ['urn:test:a']);
});

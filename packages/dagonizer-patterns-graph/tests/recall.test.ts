import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Batch } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';
import type { Binding, SlotPattern, TripleStoreInterface } from '@studnicky/dagonizer/patterns';

import { RecallContextNode } from '../src/index.js';


class TestState {
  recalled: string[] = [];
  data: Record<string, unknown> = {};
  snapshotData(): Record<string, unknown> { return this.data; }
  restoreData(d: Record<string, unknown>): void { this.data = d; }
}

class TestRecall extends RecallContextNode<TestState, string> {
  readonly name = 'test-recall';
  readonly outputs = ['success', 'empty'] as const;
  protected composeQuery(_s: TestState): SlotPattern { return { 'subject': '?s' }; }
  protected mapBindings(rows: readonly Binding[]): readonly string[] { return rows.map((r) => r['s']?.value ?? ''); }
  protected applyRecall(s: TestState, items: readonly string[]): void { s.recalled = [...items]; }
}

void test('RecallContextNode reads + writes via the store', async () => {
  const state = new TestState();
  const mockStore: TripleStoreInterface = {
    'select': () => [{ 's': { 'termType': 'NamedNode', 'value': 'urn:test:a' } }],
    'assert': () => undefined,
    'ask': () => true,
    'count': () => 1,
    'clearGraph': () => undefined,
    'triples': function* () { /* empty */ },
  };
  const node = new TestRecall(mockStore);
  const ctx = NodeContext.create('test-dag', 'test-recall', new AbortController().signal);
  const result = await node.execute(Batch.of(state), ctx);
  const successBatch = result.get('success');
  assert.ok(successBatch !== undefined);
  assert.equal(successBatch.size, 1);
  assert.deepEqual(state.recalled, ['urn:test:a']);
});

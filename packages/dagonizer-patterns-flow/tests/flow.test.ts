import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PredicateGateNode, DedupeByKeyNode } from '../src/index.js';

class TestState {
  ok = true;
  items: number[] = [];
  data: Record<string, unknown> = {};
  snapshotData(): Record<string, unknown> { return this.data; }
  restoreData(d: Record<string, unknown>): void { this.data = d; }
}

class TestGate extends PredicateGateNode<TestState> {
  readonly name = 'test-gate';
  protected predicate(s: TestState): boolean { return s.ok; }
}

class TestDedupe extends DedupeByKeyNode<TestState, number> {
  readonly name = 'test-dedupe';
  readonly outputs = ['success'] as const;
  protected readItems(s: TestState): readonly number[] { return s.items; }
  protected writeBack(s: TestState, items: readonly number[]): void { s.items = [...items]; }
  protected keyOf(n: number): string { return String(n); }
}

void test('PredicateGateNode routes pass/fail', async () => {
  const gate = new TestGate();
  const ctx = { 'services': undefined, 'signal': new AbortController().signal } as unknown as Parameters<typeof gate.execute>[1];

  const pass = await gate.execute({ 'ok': true } as TestState, ctx);
  assert.equal(pass.output, 'pass');

  const fail = await gate.execute({ 'ok': false } as TestState, ctx);
  assert.equal(fail.output, 'fail');
});

void test('DedupeByKeyNode collapses duplicates', async () => {
  const node = new TestDedupe();
  const state = new TestState();
  state.items = [1, 2, 2, 3, 3, 3];
  const ctx = { 'services': undefined, 'signal': new AbortController().signal } as unknown as Parameters<typeof node.execute>[1];
  await node.execute(state, ctx);
  assert.deepEqual(state.items, [1, 2, 3]);
});

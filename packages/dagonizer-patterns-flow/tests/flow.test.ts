import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Batch } from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

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
  const signal = new AbortController().signal;
  const ctx = NodeContextBuilder.of('test-dag', 'test-gate', signal, undefined);

  const passState = new TestState();
  passState.ok = true;
  const passResult = await gate.execute(Batch.of(passState), ctx);
  assert.equal(passResult.has('pass'), true);
  assert.equal(passResult.has('fail'), false);

  const failState = new TestState();
  failState.ok = false;
  const failResult = await gate.execute(Batch.of(failState), ctx);
  assert.equal(failResult.has('fail'), true);
  assert.equal(failResult.has('pass'), false);
});

void test('DedupeByKeyNode collapses duplicates', async () => {
  const node = new TestDedupe();
  const state = new TestState();
  state.items = [1, 2, 2, 3, 3, 3];
  const ctx = NodeContextBuilder.of('test-dag', 'test-dedupe', new AbortController().signal, undefined);
  await node.execute(Batch.of(state), ctx);
  assert.deepEqual(state.items, [1, 2, 3]);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Batch } from '@studnicky/dagonizer';
import type { ChatResponseType } from '@studnicky/dagonizer/adapter';

import { DecisionNode } from '../src/index.js';


class TestState {
  intent: 'yes' | 'no' = 'no';
  data: Record<string, unknown> = {};
  snapshotData(): Record<string, unknown> { return this.data; }
  restoreData(d: Record<string, unknown>): void { this.data = d; }
}

class TestDecision extends DecisionNode<TestState, 'yes' | 'no', 'yes' | 'no'> {
  readonly name = 'test-decision';
  readonly outputs = ['yes', 'no'] as const;
  protected composePrompt(_s: TestState): string { return 'choose'; }
  protected decodeChoice(c: string): 'yes' | 'no' { return c.toLowerCase().includes('y') ? 'yes' : 'no'; }
  protected routeFor(c: 'yes' | 'no'): 'yes' | 'no' { return c; }
  protected applyChoice(s: TestState, c: 'yes' | 'no'): void { s.intent = c; }
}

void test('DecisionNode routes by parsed choice + writes state', async () => {
  const node = new TestDecision();
  const state = new TestState();
  const mockResponse: ChatResponseType = {
    'message': { 'variant': 'text', 'content': 'yes please' },
    'finishReason': 'stop',
    'usage': { 'promptTokens': 0, 'completionTokens': 0 },
  };
  const ctx = {
    'services': { 'llm': { 'chat': async () => mockResponse } },
    'signal': new AbortController().signal,
  } as unknown as Parameters<typeof node.execute>[1];
  const result = await node.execute(Batch.of(state), ctx);
  assert.equal(result.has('yes'), true);
  assert.equal(result.has('no'), false);
  assert.equal(state.intent, 'yes');
});

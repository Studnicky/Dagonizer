/**
 * classify-intent-recommend-top-rated: unit tests for `ClassifyIntentNode`'s
 * dispatch of the raw `ClassifiedIntent` values into node output ports.
 *
 * Covers:
 *   • raw 'recommend' → 'recommend-top-rated' (rating-ranked branch)
 *   • raw 'search'    → 'on-topic' (unchanged)
 *   • raw 'describe'  → 'on-topic' (unchanged)
 *
 * Constructs `ClassifyIntentNode` directly with a stub `services` record
 * where `llm.classifyIntent` returns a controllable raw intent per test
 * case. Every other `LlmClientInterface` method is an unused rejected stub.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { Batch } from '@studnicky/dagonizer';
import { NodeContext } from '@studnicky/dagonizer/entities';

import { ArchivistState } from '../../ArchivistState.ts';
import { ClassifyIntentNode } from '../../nodes/classifyIntent.ts';
import type { ArchivistServices, ClassifiedIntent } from '../../services.ts';
import { MemoryStore } from '../../memory/MemoryStore.ts';

// ── Minimal fixtures ────────────────────────────────────────────────────────

const STUB_DEFINITION = {
  'name': 'stub', 'description': '', 'inputSchema': { 'type': 'object' as const },
  'outputSchema': { 'type': 'object' as const }, 'strict': false,
} satisfies ArchivistServices['webSearch']['definition'];

class NullTool {
  readonly definition = STUB_DEFINITION;
  async execute(): Promise<never> { return Promise.reject(new Error('stub')); }
}

/** Stub `LlmClientInterface`: `classifyIntent` returns a fixed raw intent per instance; every other method is an unused rejected stub. */
class FixedIntentLlm {
  readonly #intent: ClassifiedIntent;
  constructor(intent: ClassifiedIntent) { this.#intent = intent; }
  async classifyIntent(): Promise<ClassifiedIntent> { return this.#intent; }
  async extractTerms(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async decideTools(): Promise<never>          { return Promise.reject(new Error('stub')); }
  async rankCandidates(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async compose(): Promise<never>              { return Promise.reject(new Error('stub')); }
  async composeAuthor(): Promise<never>        { return Promise.reject(new Error('stub')); }
  async composeReviews(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async describeBook(): Promise<never>         { return Promise.reject(new Error('stub')); }
  async composeSimilar(): Promise<never>       { return Promise.reject(new Error('stub')); }
  async validate(): Promise<never>             { return Promise.reject(new Error('stub')); }
  async composeMemoryRecall(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async composeEmptyResponse(): Promise<never> { return Promise.reject(new Error('stub')); }
  async suggestStarterQuery(): Promise<never>  { return Promise.reject(new Error('stub')); }
  async suggestGreeting(): Promise<never>      { return Promise.reject(new Error('stub')); }
  async suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  async explainTool(): Promise<never>          { return Promise.reject(new Error('stub')); }
}

/** Builds a minimal stub `ArchivistServices` whose `llm.classifyIntent` returns a fixed raw intent. */
class ClassifyIntentFixture {
  static services(intent: ClassifiedIntent): ArchivistServices {
    return {
      'webSearch':        new NullTool(),
      'googleBooks':      new NullTool(),
      'subjectSearch':    new NullTool(),
      'wikipediaSummary': new NullTool(),
      'llm':              new FixedIntentLlm(intent),
      'memory':           new MemoryStore(),
      'embedder':         null,
      'nodeTimeouts':     {},
    };
  }

  static state(): ArchivistState {
    const state = new ArchivistState();
    state.query = 'recommend me a book';
    state.recalledContext = { ...state.recalledContext, 'summary': '' };
    state.conversation = [];
    return state;
  }

  static context() {
    return NodeContext.create('test-dag', 'classify-intent', new AbortController().signal);
  }

  static async execute(node: ClassifyIntentNode, state: ArchivistState) {
    const routed = await node.execute(Batch.of(state), ClassifyIntentFixture.context());
    for (const [output, batch] of routed) {
      if (batch.size > 0) return output;
    }
    return null;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

void test('ClassifyIntentNode: raw recommend → recommend-top-rated', async () => {
  const node = new ClassifyIntentNode(ClassifyIntentFixture.services('recommend'));
  const result = await ClassifyIntentFixture.execute(node, ClassifyIntentFixture.state());
  assert.equal(result, 'recommend-top-rated', 'recommend routes to the rating-ranked branch');
});

void test('ClassifyIntentNode: raw search → on-topic', async () => {
  const node = new ClassifyIntentNode(ClassifyIntentFixture.services('search'));
  const result = await ClassifyIntentFixture.execute(node, ClassifyIntentFixture.state());
  assert.equal(result, 'on-topic', 'search still routes to the general on-topic pipeline');
});

void test('ClassifyIntentNode: raw describe → on-topic', async () => {
  const node = new ClassifyIntentNode(ClassifyIntentFixture.services('describe'));
  const result = await ClassifyIntentFixture.execute(node, ClassifyIntentFixture.state());
  assert.equal(result, 'on-topic', 'describe still routes to the general on-topic pipeline');
});

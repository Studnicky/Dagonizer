/**
 * ClassifyMessageNode: unit tests for embedder-first triage with LLM recovery.
 *
 * Tests call `execute(Batch.of(state), context)` and inspect the non-empty
 * routed batch. Stub `DispatcherLlmInterface` / `DispatcherIntentInterface`
 * implementations let each test control the classification path precisely.
 *
 * Node 24 type-stripping: no enums, no namespaces, no decorators, no parameter
 * properties. Type annotations only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Batch } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer/types';

import { ClassifyMessageNode } from '../../../the-dispatcher/nodes/ClassifyMessageNode.ts';
import { DispatcherState } from '../../../the-dispatcher/DispatcherState.ts';
import type {
  ConversationTurnType,
} from '../../../the-dispatcher/DispatcherState.ts';
import type {
  DispatcherIntentInterface,
  DispatcherLlmInterface,
  DispatcherServices,
} from '../../../the-dispatcher/services.ts';

const CTX: NodeContextType = {
  'dagName': 'test',
  'nodeName': 'test',
  'signal': new AbortController().signal,
  'validateOutputs': false,
  'outputSchemaValidator': null,
};

type ClassifyOutput = 'routine' | 'escalate' | 'off-topic';

function routedOutput(
  routed: ReadonlyMap<ClassifyOutput, Batch<DispatcherState>>,
): ClassifyOutput | null {
  for (const [output, batch] of routed) {
    if (batch.size > 0) return output;
  }
  return null;
}

/** Stub LLM: returns a canned classification, or throws when configured to. */
class StubLlm implements DispatcherLlmInterface {
  readonly #result: 'routine' | 'escalate' | 'off-topic' | null;

  constructor(result: 'routine' | 'escalate' | 'off-topic' | null) {
    this.#result = result;
  }

  async classify(
    _message: string,
    _conversation: readonly ConversationTurnType[],
    _signal?: AbortSignal,
  ): Promise<'routine' | 'escalate' | 'off-topic'> {
    if (this.#result === null) throw new Error('llm unavailable');
    return this.#result;
  }

  async compose(
    _message: string,
    _conversation: readonly ConversationTurnType[],
    _signal?: AbortSignal,
  ): Promise<string> {
    return 'stubbed reply';
  }

  async warm(): Promise<void> {
    // No-op: warm-up has no observable effect on a stubbed classify()/compose().
  }
}

/** Stub intent classifier: returns a canned {intent, score} or null. */
class StubIntent implements DispatcherIntentInterface {
  readonly #result: { readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null;

  constructor(result: { readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null) {
    this.#result = result;
  }

  async classify(
    _message: string,
  ): Promise<{ readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null> {
    return this.#result;
  }
}

describe('ClassifyMessageNode', () => {
  it('trolley switch: humanMode routes to escalate regardless of content', async () => {
    const state = new DispatcherState();
    state.humanMode = true;
    state.message = 'anything at all';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent({ 'intent': 'routine', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'Human mode active — all messages routed to operator');
  });

  it('empty message routes to off-topic without classification', async () => {
    const state = new DispatcherState();
    state.message = '   ';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent({ 'intent': 'routine', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'off-topic');
  });

  it('embedder-first: confident "routine" verdict routes to routine', async () => {
    const state = new DispatcherState();
    state.message = 'what are your store hours?';
    const services: DispatcherServices = { 'llm': new StubLlm('escalate'), 'intent': new StubIntent({ 'intent': 'routine', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'routine');
  });

  it('embedder-first: confident "escalate" verdict routes to escalate with review reason', async () => {
    const state = new DispatcherState();
    state.message = 'I demand a refund immediately';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent({ 'intent': 'escalate', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'Agent determined this message requires human review.');
  });

  it('routes to LLM when embedder is below confidence floor (returns null)', async () => {
    const state = new DispatcherState();
    state.message = 'ambiguous message';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent(null) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'routine');
  });

  it('routes to LLM when no embedder is provisioned, and escalates on LLM failure', async () => {
    const state = new DispatcherState();
    state.message = 'a message';
    const services: DispatcherServices = { 'llm': new StubLlm(null), 'intent': null };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'LLM unavailable; escalated for safety');
  });

  it("classificationMode='llm': runs the LLM exclusively, never consulting the embedder", async () => {
    const state = new DispatcherState();
    state.message = 'what are your store hours?';
    state.classificationMode = 'llm';
    const throwingIntent: DispatcherIntentInterface = {
      async classify(): Promise<never> {
        throw new Error('intent must not be consulted in llm mode');
      },
    };
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': throwingIntent };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'routine');
  });

  it("classificationMode='llm': escalates with the safety reason when the LLM throws", async () => {
    const state = new DispatcherState();
    state.message = 'a message';
    state.classificationMode = 'llm';
    const services: DispatcherServices = { 'llm': new StubLlm(null), 'intent': null };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'LLM unavailable; escalated for safety');
  });

  it("classificationMode='embedder': confident 'routine' verdict routes to routine", async () => {
    const state = new DispatcherState();
    state.message = 'what are your store hours?';
    state.classificationMode = 'embedder';
    const services: DispatcherServices = { 'llm': new StubLlm('escalate'), 'intent': new StubIntent({ 'intent': 'routine', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'routine');
  });

  it("classificationMode='embedder': confident 'escalate' verdict routes to escalate with review reason", async () => {
    const state = new DispatcherState();
    state.message = 'I demand a refund immediately';
    state.classificationMode = 'embedder';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent({ 'intent': 'escalate', 'score': 0.9 }) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'Agent determined this message requires human review.');
  });

  it("classificationMode='embedder': below-floor verdict (null) routes to the LLM", async () => {
    const state = new DispatcherState();
    state.message = 'ambiguous message';
    state.classificationMode = 'embedder';
    const services: DispatcherServices = { 'llm': new StubLlm('routine'), 'intent': new StubIntent(null) };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'routine');
  });

  it("classificationMode='embedder': no embedder provisioned routes to the LLM, escalating on LLM failure", async () => {
    const state = new DispatcherState();
    state.message = 'a message';
    state.classificationMode = 'embedder';
    const services: DispatcherServices = { 'llm': new StubLlm(null), 'intent': null };
    const node = new ClassifyMessageNode(services);
    const result = await node.execute(Batch.of(state), CTX);
    assert.equal(routedOutput(result), 'escalate');
    assert.equal(state.escalationReason, 'LLM unavailable; escalated for safety');
  });
});

describe('DispatcherState classificationMode snapshot/restore', () => {
  it('round-trips classificationMode through snapshot() / restore()', () => {
    const state = new DispatcherState();
    state.classificationMode = 'llm';
    const snap = state.snapshot();
    const restored = DispatcherState.restore(snap);
    assert.equal(restored.classificationMode, 'llm');
  });

  it('defaults to \'embedder\' when the snapshot carries a garbage classificationMode', () => {
    const state = new DispatcherState();
    state.classificationMode = 'llm';
    const snap = { ...state.snapshot(), 'classificationMode': 'nonsense' };
    const restored = DispatcherState.restore(snap);
    assert.equal(restored.classificationMode, 'embedder');
  });
});

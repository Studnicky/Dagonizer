/**
 * DispatcherIntentClassifier: unit tests with a deterministic embedder.
 *
 * The classifier embeds three anchor descriptions at construction time
 * and then ranks every message by cosine similarity. The deterministic
 * embedder lets us pin each anchor to a known unit-axis vector and steer
 * the message embedding so a specific intent wins. This isolates the
 * cosine math and the confidence-floor logic from real embedding noise.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

import {
  DEFAULT_CONFIDENCE_FLOOR,
  DispatcherIntentClassifier,
  DISPATCHER_INTENT_DESCRIPTIONS,
  DISPATCHER_INTENT_LABELS,
} from '../../../the-dispatcher/providers/DispatcherIntentClassifier.ts';

const DIM = DISPATCHER_INTENT_LABELS.length;

/**
 * DeterministicEmbedder: assigns each known anchor a distinct unit-axis
 * vector. Messages are routed through a `queryVector` so individual tests
 * can prepare a deterministic input → output for a single call.
 */
class DeterministicEmbedder implements EmbedderInterface {
  readonly id = 'deterministic';
  readonly displayName = 'deterministic';
  readonly dimensions = DIM;
  readonly #queryVector: readonly number[];

  constructor(queryVector: readonly number[]) {
    this.#queryVector = queryVector;
  }

  async embed(text: string): Promise<readonly number[]> {
    // Anchor descriptions get a basis vector tied to their position;
    // anything else gets the queryVector under test.
    const anchorIndex = DISPATCHER_INTENT_LABELS.findIndex(
      (intent) => DISPATCHER_INTENT_DESCRIPTIONS[intent] === text,
    );
    if (anchorIndex === -1) return this.#queryVector;
    return IntentVectors.basisVector(anchorIndex);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const vectors: (readonly number[])[] = [];
    for (const text of texts) {
      vectors.push(await this.embed(text));
    }
    return vectors;
  }

  async probe(): Promise<boolean> { return true; }
  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async listModels(): Promise<readonly []> { return []; }
}

/** Vector helpers for deterministic DispatcherIntentClassifier tests. */
class IntentVectors {
  static basisVector(index: number): readonly number[] {
    const v: number[] = new Array<number>(DIM).fill(0);
    v[index] = 1;
    return v;
  }

  /** Lerp two basis vectors so the result aligns mostly with `dominant`. */
  static blend(dominantIndex: number, otherIndex: number, dominantWeight: number): readonly number[] {
    const v: number[] = new Array<number>(DIM).fill(0);
    v[dominantIndex] = dominantWeight;
    v[otherIndex] = 1 - dominantWeight;
    return v;
  }
}

void test('DispatcherIntentClassifier picks "routine" when the message embedding rides its axis', async () => {
  const targetIndex = DISPATCHER_INTENT_LABELS.indexOf('routine');
  assert.notEqual(targetIndex, -1);
  const embedder = new DeterministicEmbedder(IntentVectors.basisVector(targetIndex));
  const classifier = await DispatcherIntentClassifier.create(embedder);

  const result = await classifier.classify('what are your store hours?');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'routine');
  assert.equal(result?.score, 1);
});

void test('DispatcherIntentClassifier picks "escalate" when the message embedding rides its axis', async () => {
  const targetIndex = DISPATCHER_INTENT_LABELS.indexOf('escalate');
  assert.notEqual(targetIndex, -1);
  const embedder = new DeterministicEmbedder(IntentVectors.basisVector(targetIndex));
  const classifier = await DispatcherIntentClassifier.create(embedder);

  const result = await classifier.classify('I want a refund, this is unacceptable');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'escalate');
  assert.equal(result?.score, 1);
});

void test('DispatcherIntentClassifier picks "off-topic" when the message embedding rides its axis', async () => {
  const targetIndex = DISPATCHER_INTENT_LABELS.indexOf('off-topic');
  assert.notEqual(targetIndex, -1);
  const embedder = new DeterministicEmbedder(IntentVectors.basisVector(targetIndex));
  const classifier = await DispatcherIntentClassifier.create(embedder);

  const result = await classifier.classify('what is the weather like today?');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'off-topic');
  assert.equal(result?.score, 1);
});

void test('DispatcherIntentClassifier returns null when top score is below the confidence floor', async () => {
  // Message equally aligned with two anchors → max cosine = sqrt(0.5) ≈ 0.707.
  // Set floor above that so the classifier returns null.
  const a = DISPATCHER_INTENT_LABELS.indexOf('routine');
  const b = DISPATCHER_INTENT_LABELS.indexOf('escalate');
  const embedder = new DeterministicEmbedder(IntentVectors.blend(a, b, 0.5));
  const classifier = await DispatcherIntentClassifier.create(embedder);
  const result = await classifier.classify('q', 0.9);
  assert.equal(result, null);
});

void test('DispatcherIntentClassifier honours the default confidence floor', async () => {
  const dominant = DISPATCHER_INTENT_LABELS.indexOf('off-topic');
  const secondary = DISPATCHER_INTENT_LABELS.indexOf('routine');
  const embedder = new DeterministicEmbedder(IntentVectors.blend(dominant, secondary, 0.9));
  const classifier = await DispatcherIntentClassifier.create(embedder);
  const result = await classifier.classify('q');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'off-topic');
  assert.equal((result?.score ?? 0) > DEFAULT_CONFIDENCE_FLOOR, true);
});

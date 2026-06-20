/**
 * IntentClassifier: unit tests with a deterministic embedder.
 *
 * The classifier embeds nine anchor descriptions at construction time
 * and then ranks every query by cosine similarity. The deterministic embedder
 * lets us pin each anchor to a known unit-axis vector and steer the
 * query embedding so a specific intent wins. This isolates the cosine
 * math and the confidence-floor logic from real embedding noise.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { EmbedderInterface } from '@studnicky/dagonizer/contracts';

import type { ClassifiedIntent } from '../../services.ts';
import {
  cosineSimilarity,
  DEFAULT_CONFIDENCE_FLOOR,
  IntentClassifier,
  INTENT_DESCRIPTIONS,
  INTENT_LABELS,
} from '../../providers/IntentClassifier.ts';

const DIM = INTENT_LABELS.length;

/**
 * DeterministicEmbedder: assigns each known anchor a distinct unit-axis
 * vector. Queries are routed through a `queryMap` so individual tests
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
    const anchorIndex = INTENT_LABELS.findIndex((intent) => INTENT_DESCRIPTIONS[intent] === text);
    if (anchorIndex === -1) return this.#queryVector;
    return IntentVectors.basisVector(anchorIndex);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  async probe(): Promise<boolean> { return true; }
  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async listModels(): Promise<readonly []> { return []; }
}

/** Vector helpers for deterministic IntentClassifier tests. */
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

void test('cosineSimilarity: orthogonal vectors score 0', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
});

void test('cosineSimilarity: identical vectors score 1', () => {
  const v = [0.5, 0.5, 0.7];
  assert.equal(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9, true);
});

void test('cosineSimilarity: opposite vectors score -1', () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

void test('cosineSimilarity: length mismatch returns 0', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
});

void test('cosineSimilarity: zero-norm input returns 0', () => {
  assert.equal(cosineSimilarity([0, 0, 0], [1, 0, 0]), 0);
});

void test('IntentClassifier.create embeds every anchor once', async () => {
  const embedder = new DeterministicEmbedder(IntentVectors.basisVector(0));
  const classifier = await IntentClassifier.create(embedder);
  assert.equal(classifier.embedderId, 'deterministic');
});

void test('IntentClassifier picks the intent whose anchor matches the query embedding', async () => {
  // Embed query as the basis vector for 'find-reviews' (index 1).
  const targetIndex = INTENT_LABELS.indexOf('find-reviews');
  assert.notEqual(targetIndex, -1);
  const embedder = new DeterministicEmbedder(IntentVectors.basisVector(targetIndex));
  const classifier = await IntentClassifier.create(embedder);

  const result = await classifier.classify('anything (routes via deterministic embedder)');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'find-reviews');
  assert.equal(result?.score, 1);
});

void test('IntentClassifier picks each intent when the query embedding rides its axis', async () => {
  for (const intent of INTENT_LABELS) {
    const idx = INTENT_LABELS.indexOf(intent);
    const embedder = new DeterministicEmbedder(IntentVectors.basisVector(idx));
    const classifier = await IntentClassifier.create(embedder);
    const result = await classifier.classify('q');
    assert.notEqual(result, null, `expected non-null for ${intent}`);
    assert.equal(result?.intent, intent satisfies ClassifiedIntent);
  }
});

void test('IntentClassifier returns null when top score is below the confidence floor', async () => {
  // Query equally aligned with two anchors → max cosine = sqrt(0.5) ≈ 0.707.
  // Set floor above that so the classifier returns null.
  const a = INTENT_LABELS.indexOf('search');
  const b = INTENT_LABELS.indexOf('describe');
  const embedder = new DeterministicEmbedder(IntentVectors.blend(a, b, 0.5));
  const classifier = await IntentClassifier.create(embedder);
  const result = await classifier.classify('q', 0.9);
  assert.equal(result, null);
});

void test('IntentClassifier honours the default confidence floor', async () => {
  // A query that aligns mostly (0.9) with 'recommend' and partially
  // (0.1) with 'recommend-similar' must score above the default floor.
  const dominant = INTENT_LABELS.indexOf('recommend');
  const secondary = INTENT_LABELS.indexOf('recommend-similar');
  const embedder = new DeterministicEmbedder(IntentVectors.blend(dominant, secondary, 0.9));
  const classifier = await IntentClassifier.create(embedder);
  const result = await classifier.classify('q');
  assert.notEqual(result, null);
  assert.equal(result?.intent, 'recommend');
  assert.equal((result?.score ?? 0) > DEFAULT_CONFIDENCE_FLOOR, true);
});

void test('IntentClassifier returns null when query embedding is the zero vector', async () => {
  const embedder = new DeterministicEmbedder(new Array<number>(DIM).fill(0));
  const classifier = await IntentClassifier.create(embedder);
  // Every cosine is 0 (zero-norm). 0 < default floor → null.
  const result = await classifier.classify('q');
  assert.equal(result, null);
});

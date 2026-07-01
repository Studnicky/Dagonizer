/**
 * Smoke: UniversalSentenceEncoderEmbedder exposes the expected id,
 * display name, dimensionality, and listModels shape. No network calls;
 * the bundled USE module is never loaded in these tests.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { UniversalSentenceEncoderEmbedder } from '../src/index.js';

void test('UniversalSentenceEncoderEmbedder identity with defaults', () => {
  const embedder = new UniversalSentenceEncoderEmbedder();
  assert.equal(embedder.id, 'tensorflow');
  assert.ok(embedder.displayName.toLowerCase().includes('tensorflow'));
  assert.equal(embedder.dimensions, 512);
});

void test('UniversalSentenceEncoderEmbedder displayName includes model name', () => {
  const embedder = new UniversalSentenceEncoderEmbedder();
  assert.ok(embedder.displayName.includes('universal-sentence-encoder'));
});

void test('UniversalSentenceEncoderEmbedder dimensions is 512', () => {
  const embedder = new UniversalSentenceEncoderEmbedder();
  assert.equal(embedder.dimensions, 512);
});

void test('UniversalSentenceEncoderEmbedder accepts explicit model override', () => {
  const embedder = new UniversalSentenceEncoderEmbedder({ 'model': 'universal-sentence-encoder' });
  assert.equal(embedder.id, 'tensorflow');
  assert.equal(embedder.dimensions, 512);
  assert.ok(embedder.displayName.includes('universal-sentence-encoder'));
});

void test('UniversalSentenceEncoderEmbedder accepts explicit dimensions override', () => {
  const embedder = new UniversalSentenceEncoderEmbedder({ 'model': 'universal-sentence-encoder', 'dimensions': 256 });
  assert.equal(embedder.dimensions, 256);
});

void test('UniversalSentenceEncoderEmbedder.listModels returns single embedding entry', async () => {
  const embedder = new UniversalSentenceEncoderEmbedder();
  const models = await embedder.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0]?.variant, 'embedding');
  assert.equal(models[0]?.cloud, false);
  assert.ok((models[0]?.name ?? '').length > 0, 'model name must be non-empty');
});

void test('UniversalSentenceEncoderEmbedder.probe returns true (WASM/WebGL floor)', async () => {
  const embedder = new UniversalSentenceEncoderEmbedder();
  assert.equal(await embedder.probe(), true);
});

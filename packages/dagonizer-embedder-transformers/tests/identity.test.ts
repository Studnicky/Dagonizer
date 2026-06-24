/**
 * Smoke: TransformersEmbedder exposes the expected id, display name,
 * dimensionality, and listModels result. No network calls; no connect().
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { TransformersEmbedder } from '../src/index.js';

void test('TransformersEmbedder identity + default model + default dimensions', () => {
  const embedder = new TransformersEmbedder();
  assert.equal(embedder.id, 'transformers');
  assert.ok(embedder.displayName.includes('Transformers.js'));
  assert.ok(embedder.displayName.includes('Xenova/all-MiniLM-L6-v2'));
  assert.equal(embedder.dimensions, 384);
});

void test('TransformersEmbedder accepts explicit model override with known dimensions', () => {
  const embedder = new TransformersEmbedder({ 'model': 'Xenova/bge-small-en-v1.5' });
  assert.equal(embedder.dimensions, 384);
  assert.ok(embedder.displayName.includes('Xenova/bge-small-en-v1.5'));
});

void test('TransformersEmbedder accepts explicit dimensions override for unknown model', () => {
  const embedder = new TransformersEmbedder({ 'model': 'custom/model', 'dimensions': 768 });
  assert.equal(embedder.dimensions, 768);
  assert.ok(embedder.displayName.includes('custom/model'));
});

/**
 * Inline fixture mirroring `KNOWN_DIMENSIONS` in the source module. The source
 * derives its catalog from `Object.keys(KNOWN_DIMENSIONS)`; this fixture pins
 * the contract so a drift in the source ids fails here.
 */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  'Xenova/all-MiniLM-L6-v2':    384,
  'Xenova/bge-small-en-v1.5':   384,
  'Xenova/gte-small':            384,
};
const CURATED_IDS: readonly string[] = Object.keys(KNOWN_DIMENSIONS);

void test('TransformersEmbedder.listModels returns exactly the three curated ids regardless of selected model', async () => {
  const embedder = new TransformersEmbedder({ 'model': 'Xenova/gte-small' });
  const models = await embedder.listModels();
  assert.deepEqual(models.map((m) => m.name), CURATED_IDS);
});

void test('TransformersEmbedder.listModels marks every entry on-device embedding', async () => {
  const embedder = new TransformersEmbedder();
  const models = await embedder.listModels();
  for (const model of models) {
    assert.equal(model.variant, 'embedding');
    assert.equal(model.cloud, false);
  }
});

void test('TransformersEmbedder.listModels: every catalog id has a known-dimensions entry', async () => {
  const embedder = new TransformersEmbedder();
  const models = await embedder.listModels();
  for (const model of models) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(KNOWN_DIMENSIONS, model.name),
      `catalog id ${model.name} missing from KNOWN_DIMENSIONS`,
    );
  }
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WebLlmEmbedder } from '../src/index.js';

class NavigatorStub {
  private constructor() {}

  static install(nav: unknown): void {
    Object.assign(globalThis, { 'navigator': nav });
  }

  static remove(): void {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
}

void test('WebLlmEmbedder identity — defaults', () => {
  const e = new WebLlmEmbedder();
  assert.equal(e.id, 'web-llm');
  assert.equal(e.displayName, 'WebLLM (snowflake-arctic-embed-s-q0f32-MLC-b4)');
  assert.equal(e.dimensions, 384);
});

void test('WebLlmEmbedder identity — custom model', () => {
  const e = new WebLlmEmbedder({ 'model': 'snowflake-arctic-embed-m-q0f32-MLC-b4' });
  assert.equal(e.id, 'web-llm');
  assert.equal(e.displayName, 'WebLLM (snowflake-arctic-embed-m-q0f32-MLC-b4)');
  assert.equal(e.dimensions, 768);
});

void test('WebLlmEmbedder identity — dimensions override', () => {
  const e = new WebLlmEmbedder({ 'dimensions': 512 });
  assert.equal(e.dimensions, 512);
});

const EXPECTED_CATALOG_IDS: readonly string[] = [
  'snowflake-arctic-embed-m-q0f32-MLC-b32',
  'snowflake-arctic-embed-m-q0f32-MLC-b4',
  'snowflake-arctic-embed-s-q0f32-MLC-b32',
  'snowflake-arctic-embed-s-q0f32-MLC-b4',
];

void test('WebLlmEmbedder.listModels returns the full embedding catalog', async () => {
  const e = new WebLlmEmbedder();
  const models = await e.listModels();
  const names = models.map((m) => m.name).sort();
  assert.deepEqual(names, [...EXPECTED_CATALOG_IDS].sort());
});

void test('WebLlmEmbedder.listModels entries all have embedding/on-device shape', async () => {
  const e = new WebLlmEmbedder();
  const models = await e.listModels();
  assert.ok(models.length > 0, 'catalog must be non-empty');
  for (const m of models) {
    assert.equal(m.variant, 'embedding', `expected variant 'embedding' for ${m.name}`);
    assert.equal(m.cloud, false, `expected cloud false for ${m.name}`);
    assert.ok(m.name.length > 0, 'name must be non-empty');
  }
});

void test('WebLlmEmbedder.listModels is independent of the selected model', async () => {
  const a = new WebLlmEmbedder();
  const b = new WebLlmEmbedder({ 'model': 'snowflake-arctic-embed-m-q0f32-MLC-b4' });
  const namesA = (await a.listModels()).map((m) => m.name).sort();
  const namesB = (await b.listModels()).map((m) => m.name).sort();
  assert.deepEqual(namesA, namesB);
});

void test('WebLlmEmbedder.listModels includes the default model', async () => {
  const e = new WebLlmEmbedder();
  const models = await e.listModels();
  const found = models.some((m) => m.name === 'snowflake-arctic-embed-s-q0f32-MLC-b4');
  assert.ok(found, 'default model must appear in the catalog');
});

void test('every catalog id resolves to a known dimensionality', async () => {
  // Consistency: each catalog id must have a KNOWN_DIMENSIONS entry, which is
  // observable through the public API — constructing the embedder with that id
  // and no `dimensions` override auto-resolves the dimensionality from the map.
  const expectedDimensions: Readonly<Record<string, number>> = {
    'snowflake-arctic-embed-m-q0f32-MLC-b32': 768,
    'snowflake-arctic-embed-m-q0f32-MLC-b4': 768,
    'snowflake-arctic-embed-s-q0f32-MLC-b32': 384,
    'snowflake-arctic-embed-s-q0f32-MLC-b4': 384,
  };
  const catalog = await new WebLlmEmbedder().listModels();
  for (const m of catalog) {
    const expected = expectedDimensions[m.name];
    assert.ok(expected !== undefined, `catalog id ${m.name} has no KNOWN_DIMENSIONS entry`);
    const e = new WebLlmEmbedder({ 'model': m.name });
    assert.equal(e.dimensions, expected, `dimensions mismatch for ${m.name}`);
  }
});

void test('WebLlmEmbedder.probe returns false in node (no navigator)', async () => {
  NavigatorStub.remove();
  const e = new WebLlmEmbedder();
  assert.equal(await e.probe(), false);
});

void test('WebLlmEmbedder.probe returns false when navigator.gpu is missing', async () => {
  NavigatorStub.install({});
  const e = new WebLlmEmbedder();
  try {
    assert.equal(await e.probe(), false);
  } finally {
    NavigatorStub.remove();
  }
});

void test('WebLlmEmbedder.probe returns true when navigator.gpu is present', async () => {
  NavigatorStub.install({ 'gpu': {} });
  const e = new WebLlmEmbedder();
  try {
    assert.equal(await e.probe(), true);
  } finally {
    NavigatorStub.remove();
  }
});

/**
 * embedder-intent-classification: end-to-end proof that the REAL, fully
 * offline transformers embedder classifies visitor queries through the
 * genuine vector `IntentClassifier` — no regex shortcut, no network.
 *
 * This is the consistency guarantee: the exact mechanism that runs in the
 * browser (the bundled `TransformersEmbedder` loading the vendored
 * `Xenova/all-MiniLM-L6-v2` model with `env.allowRemoteModels = false`) is the
 * one exercised here. The classifier embeds the nine intent anchors once and
 * ranks each query by cosine similarity against them.
 *
 * The key assertion: a vague, title-less, topic-less "tell me a good story"
 * resolves to `recommend` (which routes to the rating-ranked top-rated branch),
 * while queries that carry a title or an author do NOT.
 *
 * Runs fully offline: the model weights are vendored under the embedder
 * package's `models/` directory (fetched once by its `pretest`/`prebuild`
 * `fetch-model` script) and `TransformersEmbedder` forces local-only loading.
 */

import { before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { TransformersEmbedder } from '@studnicky/dagonizer-embedder-transformers';

import { IntentClassifier } from '../../providers/IntentClassifier.ts';

describe('offline transformers embedder → IntentClassifier', () => {
  let classifier: IntentClassifier;

  before(async () => {
    const embedder = new TransformersEmbedder();
    await embedder.connect();
    classifier = await IntentClassifier.create(embedder);
  });

  it('classifies a vague "tell me a good story" as recommend', async () => {
    const result = await classifier.classify('tell me a good story');
    assert.notEqual(result, null, 'classification must clear the confidence floor');
    assert.equal(result?.intent, 'recommend');
  });

  it('classifies "what should I read?" as recommend', async () => {
    const result = await classifier.classify('what should I read?');
    assert.equal(result?.intent, 'recommend');
  });

  it('classifies "recommend a good book" as recommend', async () => {
    const result = await classifier.classify('recommend a good book');
    assert.equal(result?.intent, 'recommend');
  });

  it('does NOT classify a named-title query as recommend', async () => {
    const result = await classifier.classify('tell me about Dune');
    assert.notEqual(result?.intent, 'recommend');
  });

  it('does NOT classify an author query as recommend', async () => {
    const result = await classifier.classify('what did Murakami write?');
    assert.notEqual(result?.intent, 'recommend');
  });
});

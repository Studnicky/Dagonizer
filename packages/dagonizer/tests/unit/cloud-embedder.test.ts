import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CloudEmbedder } from '../../src/adapter/CloudEmbedder.js';
import { LlmError } from '../../src/adapter/LlmError.js';

const FIXED_VECTOR: readonly number[] = [0.4, 0.5, 0.6];
const FIXED_ENDPOINT = 'https://example.test/v1/embeddings';

/** Trivial fixture: fixed endpoint/requestInit, `vectorFrom` extracts `body.embedding`. */
class FakeCloudEmbedder extends CloudEmbedder {
  constructor() {
    super('fake-cloud', 'Fake Cloud', FIXED_VECTOR.length);
    this.setModel('fake-model');
  }

  protected endpoint(): string {
    return FIXED_ENDPOINT;
  }

  protected requestInit(text: string): RequestInit {
    return {
      'method': 'POST',
      'headers': { 'content-type': 'application/json', 'authorization': 'Bearer test-key' },
      'body': JSON.stringify({ 'input': text }),
    };
  }

  protected vectorFrom(body: unknown): readonly number[] {
    if (typeof body !== 'object' || body === null || !('embedding' in body) || !Array.isArray(body.embedding) || body.embedding.length === 0) {
      throw new LlmError('invalid or empty embedding vector', { 'reason': 'SCHEMA_VIOLATION', 'retryable': false });
    }
    return body.embedding;
  }
}

/** Fixture whose `vectorFrom` always rejects, to exercise error classification through `embed()`. */
class RejectingVectorEmbedder extends CloudEmbedder {
  constructor() {
    super('rejecting-cloud', 'Rejecting Cloud', FIXED_VECTOR.length, { 'maxAttempts': 1, 'baseDelayMs': 0 });
    this.setModel('fake-model');
  }

  protected endpoint(): string {
    return FIXED_ENDPOINT;
  }

  protected requestInit(): RequestInit {
    return { 'method': 'POST', 'headers': {}, 'body': '{}' };
  }

  protected vectorFrom(): readonly number[] {
    throw new LlmError('invalid or empty embedding vector', { 'reason': 'SCHEMA_VIOLATION', 'retryable': false });
  }
}

async function withFetch<T>(impl: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  const stub: typeof globalThis.fetch = (url, init) => impl(String(url), init ?? {});
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

void describe('CloudEmbedder', () => {
  void it('embed() posts to endpoint() with requestInit() and returns vectorFrom()\'s vector', async () => {
    let calledUrl = '';
    let calledInit: RequestInit = {};
    const embedder = new FakeCloudEmbedder();

    const vector = await withFetch(
      async (url, init) => {
        calledUrl = url;
        calledInit = init;
        return new Response(JSON.stringify({ 'embedding': FIXED_VECTOR }), {
          'status': 200,
          'headers': { 'content-type': 'application/json' },
        });
      },
      () => embedder.embed('hello'),
    );

    assert.deepEqual(vector, FIXED_VECTOR);
    assert.equal(calledUrl, FIXED_ENDPOINT);
    assert.equal(calledInit.method, 'POST');
    assert.equal(calledInit.body, JSON.stringify({ 'input': 'hello' }));
  });

  void it('classifies a vectorFrom() rejection as an LlmError through the retry envelope', async () => {
    const embedder = new RejectingVectorEmbedder();

    await withFetch(
      async () =>
        new Response(JSON.stringify({}), {
          'status': 200,
          'headers': { 'content-type': 'application/json' },
        }),
      () =>
        assert.rejects(
          () => embedder.embed('hello'),
          (err: unknown): err is LlmError => {
            if (!(err instanceof LlmError)) return false;
            assert.equal(err.classification.reason, 'SCHEMA_VIOLATION');
            assert.equal(err.classification.retryable, false);
            return true;
          },
        ),
    );
  });
});

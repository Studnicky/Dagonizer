/**
 * Tests for the LLM model discovery feature (Wave 1).
 *
 * Covers:
 *  - LlmModel entity schema + Validator.llmModel wiring
 *  - BaseAdapter default listModels (with and without constructor model)
 *  - selectChatModel selection rules (preferred, local-first, null)
 *  - model getter throws MODEL_NOT_FOUND when unset
 *  - model getter returns name after selectChatModel picks
 *  - selectChatModel skips embedding models
 *  - selectChatModel returns null when no chat model found
 *  - BaseEmbedder default listModels (with and without constructor model)
 *  - selectEmbeddingModel selection rules
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BaseAdapter } from '../../src/adapter/BaseAdapter.js';
import { BaseEmbedder } from '../../src/adapter/BaseEmbedder.js';
import { LlmError } from '../../src/adapter/LlmError.js';
import type { LlmModelType } from '../../src/entities/adapter/LlmModel.js';
import { LlmModelSchema } from '../../src/entities/adapter/LlmModel.js';
import { Validator } from '../../src/validation/Validator.js';

// ---------------------------------------------------------------------------
// Inline test adapter — overrides listModels to return a fixed catalogue
// ---------------------------------------------------------------------------

const FIXED_CATALOGUE: readonly LlmModelType[] = [
  { 'name': 'local-chat',      'variant': 'chat',      'cloud': false },
  { 'name': 'cloud-chat',      'variant': 'chat',      'cloud': true  },
  { 'name': 'local-embed',     'variant': 'embedding', 'cloud': false },
  { 'name': 'unknown-model',   'variant': 'unknown',   'cloud': false },
];

class TestAdapter extends BaseAdapter {
  constructor(model?: string) {
    super('test', 'TestAdapter', { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false }, model !== undefined ? { model } : {});
  }

  override async listModels(): Promise<readonly LlmModelType[]> {
    return FIXED_CATALOGUE;
  }

  protected override async performChat(): Promise<never> {
    throw new LlmError('not implemented', { 'reason': 'UNKNOWN', 'retryable': false });
  }
}

// ---------------------------------------------------------------------------
// Inline test embedder — overrides listModels to return a fixed catalogue
// ---------------------------------------------------------------------------

const EMBEDDING_CATALOGUE: readonly LlmModelType[] = [
  { 'name': 'nomic-embed',  'variant': 'embedding', 'cloud': false },
  { 'name': 'cloud-embed',  'variant': 'embedding', 'cloud': true  },
];

class TestEmbedder extends BaseEmbedder {
  constructor(model?: string) {
    super('test-embed', 'TestEmbedder', 768, model !== undefined ? { model } : {});
  }

  override async listModels(): Promise<readonly LlmModelType[]> {
    return EMBEDDING_CATALOGUE;
  }

  protected override async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
    return [0.1, 0.2];
  }
}

// ---------------------------------------------------------------------------
// Protected-exposing subclasses.
// These extend TestAdapter / TestEmbedder and expose the protected `model`
// getter as a public instance method so tests can verify its behavior without
// any cast.
// ---------------------------------------------------------------------------

/** Exposes the protected `model` getter on TestAdapter via a public method. */
class ExposedAdapter extends TestAdapter {
  readModel(): string {
    return this.model;
  }
}

/** Exposes the protected `model` getter on TestEmbedder via a public method. */
class ExposedEmbedder extends TestEmbedder {
  readModel(): string {
    return this.model;
  }
}

// ---------------------------------------------------------------------------
// LlmModel schema + Validator wiring
// ---------------------------------------------------------------------------

void describe('LlmModel entity + Validator.llmModel', () => {
  void it('Validator.llmModel validates a well-formed chat descriptor', () => {
    const value: unknown = { 'name': 'llama3', 'variant': 'chat', 'cloud': false };
    assert.ok(Validator.llmModel.is(value), 'should pass is()');
    const typed = Validator.llmModel.validate(value);
    assert.equal(typed.name, 'llama3');
    assert.equal(typed.variant, 'chat');
    assert.equal(typed.cloud, false);
  });

  void it('Validator.llmModel validates an embedding descriptor', () => {
    const value: unknown = { 'name': 'nomic-embed-text', 'variant': 'embedding', 'cloud': true };
    assert.ok(Validator.llmModel.is(value));
    const typed = Validator.llmModel.validate(value);
    assert.equal(typed.variant, 'embedding');
  });

  void it('Validator.llmModel rejects missing name', () => {
    const value: unknown = { 'variant': 'chat', 'cloud': false };
    assert.equal(Validator.llmModel.is(value), false);
  });

  void it('Validator.llmModel rejects invalid variant value', () => {
    const value: unknown = { 'name': 'model', 'variant': 'text', 'cloud': false };
    assert.equal(Validator.llmModel.is(value), false);
  });

  void it('Validator.llmModel rejects empty name string', () => {
    const value: unknown = { 'name': '', 'variant': 'chat', 'cloud': false };
    assert.equal(Validator.llmModel.is(value), false);
  });

  void it('LlmModelSchema has the correct $id', () => {
    assert.equal(LlmModelSchema.$id, 'https://noocodex.dev/schemas/dagonizer/adapter/LlmModel');
  });
});

// ---------------------------------------------------------------------------
// BaseAdapter default listModels
// ---------------------------------------------------------------------------

void describe('BaseAdapter default listModels', () => {
  void it('returns empty array when no model set at construction', async () => {
    // Use a plain BaseAdapter concrete subclass without overriding listModels
    class MinimalAdapter extends BaseAdapter {
      constructor() {
        super('minimal', 'Minimal', { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false });
      }
      protected override async performChat(): Promise<never> {
        throw new LlmError('not implemented', { 'reason': 'UNKNOWN', 'retryable': false });
      }
    }
    const adapter = new MinimalAdapter();
    const models = await adapter.listModels();
    assert.deepEqual(models, []);
  });

  void it('returns a single chat descriptor when model set at construction', async () => {
    class MinimalAdapter extends BaseAdapter {
      constructor() {
        super('minimal', 'Minimal', { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false }, { 'model': 'llama3' });
      }
      protected override async performChat(): Promise<never> {
        throw new LlmError('not implemented', { 'reason': 'UNKNOWN', 'retryable': false });
      }
    }
    const adapter = new MinimalAdapter();
    const models = await adapter.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.name, 'llama3');
    assert.equal(models[0]?.variant, 'chat');
    assert.equal(models[0]?.cloud, false);
  });
});

// ---------------------------------------------------------------------------
// selectChatModel selection logic
// ---------------------------------------------------------------------------

void describe('selectChatModel', () => {
  void it('prefers a local chat model over cloud when no preferred specified', async () => {
    const adapter = new TestAdapter();
    const selected = await adapter.selectChatModel();
    assert.equal(selected, 'local-chat');
  });

  void it('honors options.preferred when the model is in the chat list', async () => {
    const adapter = new TestAdapter();
    const selected = await adapter.selectChatModel({ 'preferred': 'cloud-chat' });
    assert.equal(selected, 'cloud-chat');
  });

  void it('falls back to local-first when preferred is not found in catalogue', async () => {
    const adapter = new TestAdapter();
    const selected = await adapter.selectChatModel({ 'preferred': 'nonexistent-model' });
    assert.equal(selected, 'local-chat');
  });

  void it('skips embedding-variant models entirely', async () => {
    // Catalogue has only embedding models
    class EmbedOnlyAdapter extends BaseAdapter {
      constructor() {
        super('embed-only', 'EmbedOnly', { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false });
      }
      override async listModels(): Promise<readonly LlmModelType[]> {
        return [{ 'name': 'embed-model', 'variant': 'embedding', 'cloud': false }];
      }
      protected override async performChat(): Promise<never> {
        throw new LlmError('not implemented', { 'reason': 'UNKNOWN', 'retryable': false });
      }
    }
    const adapter = new EmbedOnlyAdapter();
    const selected = await adapter.selectChatModel();
    assert.equal(selected, null, 'should return null when no chat models found');
  });

  void it('returns null when catalogue is empty, does not set a model', async () => {
    // EmptyExposedAdapter: exposes the protected model getter so we can verify it throws.
    class EmptyExposedAdapter extends BaseAdapter {
      constructor() {
        super('empty', 'Empty', { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false });
      }
      override async listModels(): Promise<readonly LlmModelType[]> {
        return [];
      }
      protected override async performChat(): Promise<never> {
        throw new LlmError('not implemented', { 'reason': 'UNKNOWN', 'retryable': false });
      }
      readModel(): string {
        return this.model;
      }
    }
    const adapter = new EmptyExposedAdapter();
    const selected = await adapter.selectChatModel();
    assert.equal(selected, null);
    // model getter should still throw because nothing was set.
    assert.throws(
      () => { adapter.readModel(); },
      (err) => {
        assert.ok(err instanceof LlmError);
        assert.equal(err.classification.reason, 'MODEL_NOT_FOUND');
        return true;
      },
    );
  });

  void it('model getter returns the selected name after selectChatModel picks', async () => {
    const adapter = new ExposedAdapter();
    const selected = await adapter.selectChatModel();
    assert.ok(selected !== null);
    assert.equal(adapter.readModel(), selected);
  });
});

// ---------------------------------------------------------------------------
// model getter throws when no model set
// ---------------------------------------------------------------------------

void describe('model getter', () => {
  void it('throws LlmError MODEL_NOT_FOUND when no model selected', () => {
    const adapter = new ExposedAdapter();
    assert.throws(
      () => { adapter.readModel(); },
      (err) => {
        assert.ok(err instanceof LlmError, 'should be LlmError');
        assert.equal(err.classification.reason, 'MODEL_NOT_FOUND');
        return true;
      },
    );
  });

  void it('does NOT throw when model passed at construction', () => {
    const adapter = new ExposedAdapter('llama3');
    assert.doesNotThrow(() => { adapter.readModel(); });
    assert.equal(adapter.readModel(), 'llama3');
  });
});

// ---------------------------------------------------------------------------
// BaseEmbedder default listModels
// ---------------------------------------------------------------------------

void describe('BaseEmbedder default listModels', () => {
  void it('returns empty array when no model set', async () => {
    class MinimalEmbedder extends BaseEmbedder {
      constructor() {
        super('min-embed', 'MinimalEmbedder', 512);
      }
      protected override async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
        return [];
      }
    }
    const embedder = new MinimalEmbedder();
    const models = await embedder.listModels();
    assert.deepEqual(models, []);
  });

  void it('returns a single embedding descriptor when model set at construction', async () => {
    class MinimalEmbedder extends BaseEmbedder {
      constructor() {
        super('min-embed', 'MinimalEmbedder', 512, { 'model': 'nomic-embed-text' });
      }
      protected override async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
        return [];
      }
    }
    const embedder = new MinimalEmbedder();
    const models = await embedder.listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0]?.name, 'nomic-embed-text');
    assert.equal(models[0]?.variant, 'embedding');
    assert.equal(models[0]?.cloud, false);
  });
});

// ---------------------------------------------------------------------------
// selectEmbeddingModel selection logic
// ---------------------------------------------------------------------------

void describe('selectEmbeddingModel', () => {
  void it('selects the first embedding model when no preferred specified', async () => {
    const embedder = new TestEmbedder();
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, 'nomic-embed');
  });

  void it('honors options.preferred when model is in the embedding list', async () => {
    const embedder = new TestEmbedder();
    const selected = await embedder.selectEmbeddingModel({ 'preferred': 'cloud-embed' });
    assert.equal(selected, 'cloud-embed');
  });

  void it('returns null when no embedding models in catalogue', async () => {
    class ChatOnlyEmbedder extends BaseEmbedder {
      constructor() {
        super('chat-only', 'ChatOnly', 256);
      }
      override async listModels(): Promise<readonly LlmModelType[]> {
        return [{ 'name': 'gpt-4o', 'variant': 'chat', 'cloud': true }];
      }
      protected override async performEmbed(_text: string, _signal: AbortSignal): Promise<readonly number[]> {
        return [];
      }
    }
    const embedder = new ChatOnlyEmbedder();
    const selected = await embedder.selectEmbeddingModel();
    assert.equal(selected, null);
  });

  void it('sets the model so subsequent calls can succeed', async () => {
    const embedder = new ExposedEmbedder();
    const selected = await embedder.selectEmbeddingModel();
    assert.ok(selected !== null);
    assert.doesNotThrow(() => { embedder.readModel(); });
  });
});

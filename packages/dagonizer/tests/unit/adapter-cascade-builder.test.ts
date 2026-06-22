/**
 * Unit tests for `LlmAdapterCascadeBuilder`.
 *
 * Verifies that the builder assembles a cascade from a catalogue, that
 * preference order is honoured (first entry wins when it probes true), and
 * that fallback to the next entry occurs when an earlier one fails to probe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AdapterDescriptorShapeType } from '../../src/adapter/AdapterDescriptor.js';
import { BaseAdapter } from '../../src/adapter/BaseAdapter.js';
import type {
  AdapterCapabilitiesType,
  ChatRequestType,
  ChatResponseType,
} from '../../src/adapter/LlmAdapter.js';
import { ZERO_TOKEN_USAGE } from '../../src/adapter/LlmAdapter.js';
import { LlmAdapterCascadeBuilder, type CatalogueEntryType } from '../../src/adapter/LlmAdapterCascadeBuilder.js';
import { LlmError } from '../../src/adapter/LlmError.js';

// ── Shared test capabilities ──────────────────────────────────────────────────

const FULL_CAPABILITIES: AdapterCapabilitiesType = {
  'toolUse':        'full',
  'structuredOutput': true,
  'jsonMode':       true,
};

// ── Test adapter stub ─────────────────────────────────────────────────────────

/**
 * Minimal concrete adapter. Probe result is fixed at construction.
 * Extends `BaseAdapter` per project contract; `performChat` is a no-op stub.
 */
class StubAdapter extends BaseAdapter {
  readonly #probeResult: boolean;

  constructor(id: string, probeResult: boolean) {
    super(id, id, FULL_CAPABILITIES);
    this.#probeResult = probeResult;
  }

  protected async performChat(_request: ChatRequestType): Promise<ChatResponseType> {
    return Promise.resolve({
      'message':      { 'variant': 'text', 'content': '' },
      'finishReason': 'stop',
      'usage':        ZERO_TOKEN_USAGE,
    });
  }

  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#probeResult);
  }
}

// ── TestCatalogue: static factory for catalogue entries ───────────────────────

/**
 * Static factory for `CatalogueEntryType` values used in tests.
 * Follows `noun.verb()` — no freestanding helper functions.
 */
class TestCatalogue {
  private constructor() { /* static class */ }

  static descriptor(provider: string, model: string): AdapterDescriptorShapeType {
    return {
      'provider':     provider,
      'model':        model,
      'capabilities': FULL_CAPABILITIES,
    };
  }

  static entry(provider: string, model: string, probeResult: boolean): CatalogueEntryType {
    return {
      'descriptor': TestCatalogue.descriptor(provider, model),
      'factory':    () => new StubAdapter(`${provider}:${model}`, probeResult),
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('LlmAdapterCascadeBuilder.build', () => {
  void it('returns a cascade that selects the first entry when it probes true', async () => {
    const catalogue: readonly CatalogueEntryType[] = [
      TestCatalogue.entry('provA', 'modelA', true),
      TestCatalogue.entry('provB', 'modelB', true),
    ];
    const cascade = LlmAdapterCascadeBuilder.build(catalogue);
    const adapter = await cascade.select();
    assert.equal(adapter.id, 'provA:modelA');
  });

  void it('falls back to the second entry when the first fails to probe', async () => {
    const catalogue: readonly CatalogueEntryType[] = [
      TestCatalogue.entry('cold', 'modelA', false),
      TestCatalogue.entry('warm', 'modelB', true),
    ];
    const cascade = LlmAdapterCascadeBuilder.build(catalogue);
    const adapter = await cascade.select();
    assert.equal(adapter.id, 'warm:modelB');
  });

  void it('throws NO_ADAPTER_AVAILABLE when every entry fails to probe', async () => {
    const catalogue: readonly CatalogueEntryType[] = [
      TestCatalogue.entry('a', 'm1', false),
      TestCatalogue.entry('b', 'm2', false),
    ];
    const cascade = LlmAdapterCascadeBuilder.build(catalogue);
    await assert.rejects(
      () => cascade.select(),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'NO_ADAPTER_AVAILABLE');
        assert.match(err.message, /a:m1 \(probe failed\)/u);
        assert.match(err.message, /b:m2 \(probe failed\)/u);
        return true;
      },
    );
  });

  void it('honours the catalogue order: third entry wins when first two fail', async () => {
    const catalogue: readonly CatalogueEntryType[] = [
      TestCatalogue.entry('p1', 'm', false),
      TestCatalogue.entry('p2', 'm', false),
      TestCatalogue.entry('p3', 'm', true),
    ];
    const cascade = LlmAdapterCascadeBuilder.build(catalogue);
    const adapter = await cascade.select();
    assert.equal(adapter.id, 'p3:m');
  });

  void it('throws NO_ADAPTER_AVAILABLE for an empty catalogue', async () => {
    const cascade = LlmAdapterCascadeBuilder.build([]);
    await assert.rejects(
      () => cascade.select(),
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'NO_ADAPTER_AVAILABLE');
        return true;
      },
    );
  });

  void it('registers each entry exactly once (duplicate provider+model throws)', () => {
    const catalogue: readonly CatalogueEntryType[] = [
      TestCatalogue.entry('same', 'model', true),
      TestCatalogue.entry('same', 'model', true),
    ];
    assert.throws(
      () => { LlmAdapterCascadeBuilder.build(catalogue); },
      (err: unknown): err is LlmError => {
        if (!(err instanceof LlmError)) return false;
        assert.equal(err.classification.reason, 'CONFIGURATION');
        assert.match(err.message, /duplicate registration/u);
        return true;
      },
    );
  });
});

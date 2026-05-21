/**
 * StubAdapter — offline canned-response adapter.
 *
 * Ships with no network or API-key requirement. The default implementation
 * returns a single placeholder message and emits no tool calls — useful
 * for CLI smoke tests, offline previews, and any scenario where the
 * dispatcher should run end-to-end without a real model.
 *
 * Per project standards, this class is the extension point: consumers
 * subclass and override `performChat` (or `respond` for the simple text
 * path) to inject domain-specific stub behavior. The Archivist example
 * does this to emit seed-library-grounded responses; see
 * `examples/the-archivist/providers/adapters/ArchivistStub.ts`.
 */

import { BaseAdapter } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';

export interface StubAdapterOptions {
  /** Per-prompt response. Defaults to a generic placeholder. */
  readonly defaultResponse?: string;
  readonly maxAttempts?: number;
}

export class StubAdapter extends BaseAdapter {
  readonly #defaultResponse: string;

  constructor(opts: StubAdapterOptions = {}) {
    super({
      'id': 'stub',
      'displayName': 'Canned responses (no real LLM)',
      // Stub does not actually call any model, but subclasses that emit
      // structured tool calls or JSON should advertise full capabilities
      // when relevant. Default declares 'none' so consumers know there's
      // no real intelligence behind the responses.
      'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
      'maxAttempts': opts.maxAttempts ?? 1,
    });
    this.#defaultResponse = opts.defaultResponse ?? '(stub adapter — no model attached)';
  }

  protected async performChat(_request: ChatRequest): Promise<ChatResponse> {
    return Promise.resolve({
      'message': { 'content': this.respond(_request) },
      'finishReason': 'stop',
    });
  }

  /**
   * Compose the response text. Override in subclasses to inject domain-
   * specific behavior (pattern-matching prompts, looking up data,
   * emitting tool calls, etc.). The default returns the configured
   * `defaultResponse` string.
   */
  protected respond(_request: ChatRequest): string {
    return this.#defaultResponse;
  }
}

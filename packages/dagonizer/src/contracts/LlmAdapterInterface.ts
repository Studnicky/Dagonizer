/**
 * LlmAdapterInterface: consumer-implemented contract for LLM transport plugins.
 *
 * Single source of truth for the interface declaration. Entity types
 * (`ChatRequestType`, `ChatResponse`, `AdapterCapabilitiesType`) live in
 * `src/entities/adapter/`; this file imports them directly — no dependency
 * on `src/adapter/`. `src/adapter/LlmAdapter.ts` re-exports `LlmAdapterInterface`
 * from here so `./adapter` consumers continue to see a single import path.
 */

import type { AdapterCapabilitiesType } from '../entities/adapter/AdapterCapabilities.js';
import type { ChatRequestType } from '../entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../entities/adapter/ChatResponse.js';

import type { AbortableOptionsType } from './AbortableOptionsType.js';

/** Implemented by every LLM provider adapter. */
export interface LlmAdapterInterface {
  /** Stable provider identifier (e.g. `'openai'`, `'anthropic'`, `'ollama'`). */
  readonly id: string;
  /** Human-readable label for logs and UI. */
  readonly displayName: string;
  /** Declared capabilities; the dispatcher consults these to route tool-call and structured-output paths. */
  readonly capabilities: AdapterCapabilitiesType;
  /** Send a chat request to the provider and resolve its response. */
  chat(request: ChatRequestType): Promise<ChatResponseType>;
  /**
   * Bring up any per-session state (model download, websocket handshake).
   * Adapters that don't need a session implement a no-op; `BaseAdapter`
   * provides a default empty implementation so consumers don't branch
   * on `connect` vs `undefined`.
   * `options.signal` cancels a long-running connect (e.g. model download).
   */
  connect(options?: AbortableOptionsType): Promise<void>;
  /**
   * Tear down any per-session state. No-op default on `BaseAdapter`.
   * `options.signal` can interrupt teardown when the caller needs
   * a time-bounded shutdown.
   */
  disconnect(options?: AbortableOptionsType): Promise<void>;
  /**
   * Quick availability check. Returns true when this adapter can plausibly
   * serve a chat call right now (credentials present, runtime backend
   * reachable, model available). Implementations MUST NOT throw on
   * transport failure; return false so a cascade can route around the
   * adapter and try the next preference.
   *
   * `BaseAdapter` ships a default that returns true; concrete adapters
   * override with a real probe (e.g. credential check, HEAD request,
   * `navigator.ml` feature detect).
   * `options.signal` aborts a long-running probe (e.g. HEAD request).
   */
  probe(options?: AbortableOptionsType): Promise<boolean>;
}

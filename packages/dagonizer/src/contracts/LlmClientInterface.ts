/**
 * LlmClientInterface: minimal chat contract every RAG-tier pattern needs.
 *
 * Any `LlmAdapterInterface` satisfies this interface (the adapter contract
 * shipped at `@studnicky/dagonizer/adapter` is structurally a superset).
 * Pattern bases accept the record shape `{ llm: LlmClientInterface }` so consumers
 * can pass either a raw adapter or a higher-level client wrapper.
 *
 * Concrete capability metadata (`adapter.capabilities`) is consulted by
 * the dispatcher and routing logic; pattern bases that need to branch
 * on capability should accept the full `LlmAdapterInterface` directly.
 */

import type { ChatRequestType } from '../entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../entities/adapter/ChatResponse.js';

export interface LlmClientInterface {
  /** Send a chat request and resolve its response. */
  chat(request: ChatRequestType): Promise<ChatResponseType>;
}

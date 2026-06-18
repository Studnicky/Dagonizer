/**
 * LlmClient: minimal chat contract every RAG-tier pattern needs.
 *
 * Any `LlmAdapter` satisfies this interface (the adapter contract
 * shipped at `@studnicky/dagonizer/adapter` is structurally a superset).
 * Pattern bases accept the bag shape `{ llm: LlmClient }` so consumers
 * can pass either a raw adapter or a higher-level client wrapper.
 *
 * Concrete capability metadata (`adapter.capabilities`) is consulted by
 * the dispatcher and routing logic; pattern bases that need to branch
 * on capability should accept the full `LlmAdapter` directly.
 */

import type { ChatRequest } from '../entities/adapter/ChatRequest.js';
import type { ChatResponse } from '../entities/adapter/ChatResponse.js';

export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

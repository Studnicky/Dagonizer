/**
 * composeMemoryResponse — LLM compose node for the recall-memories branch.
 *
 * Calls `context.services.llm.composeMemoryRecall(...)` with the
 * visitor's query, the structured `MemoryDigest` from `recallMemories`,
 * and the optional recalled-context summary. Stores the result in
 * `state.draft` so the shared `respondToVisitor` terminal can emit it.
 *
 * Kind: 'non-deterministic' — LLM output varies per call.
 * Output: 'drafted' — always routes forward.
 */

import type { ArchivistNode } from './ArchivistNode.ts';
import { COMPOSE_TIMEOUT_MS } from './composeResponse.ts';

export const composeMemoryResponse: ArchivistNode<'drafted'> = {
  'name':      'compose-memory-response',
  'kind':      'non-deterministic',
  'outputs':   ['drafted'],
  'timeoutMs': COMPOSE_TIMEOUT_MS,
  async execute(state, context) {
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    state.draft = await context.services.llm.composeMemoryRecall(
      state.query,
      state.memoryDigest,
      recalledSummary,
    );
    context.services.logger.info(
      `compose-memory-response: draft length=${String(state.draft.length)}`,
    );
    return { 'output': 'drafted' };
  },
};

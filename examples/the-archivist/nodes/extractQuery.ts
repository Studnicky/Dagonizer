/**
 * extractQuery — parse the raw question into structured search terms.
 *
 * The LLM returns a small array (`['cosmic horror', 'novella']`,
 * `['ursula le guin', 'fantasy']`) that the scouts use as input.
 *
 * Demonstrates: a plain `success` output and direct state mutation.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

export const extractQuery: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'extract-query',
  "outputs": ['success'],
  async execute(state, context) {
    state.terms = await context.services.llm.extractTerms(state.query);
    return { "output": 'success' };
  },
};

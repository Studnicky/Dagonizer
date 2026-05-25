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

/** Per-node timeout — generous for Gemini Nano's constrained-output path (20–60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

export const extractQuery: NodeInterface<ArchivistState, 'success', ArchivistServices> = {
  "name": 'extract-query',
  "outputs": ['success'],
  async execute(state, context) {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), NODE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    try {
      state.terms = await context.services.llm.extractTerms(state.query, signal);
      return { "output": 'success' };
    } catch (err) {
      // Salvage path: split on whitespace, drop short words, cap at 6.
      context.services.logger.warn(`extractQuery: timeout/error — falling through with defaults: ${err instanceof Error ? err.message : String(err)}`);
      state.terms = state.query.toLowerCase().split(/\s+/u).filter((t) => t.length > 2).slice(0, 6);
      return { "output": 'success' };
    } finally {
      clearTimeout(handle);
    }
  },
};

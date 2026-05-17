/**
 * scouts — data-acquisition nodes for the Archivist's multi-source fan-out.
 *
 * Three scouts, each wrapping one external tool:
 *
 *   openLibraryScout  — OpenLibrary `web_search_books` call; LLM-gated
 *                       via `state.toolPlan` (tool name: web_search_books).
 *   googleBooksScout  — Google Books `google_books_search` call; LLM-gated
 *                       via `state.toolPlan` (tool name: google_books_search).
 *   wikipediaScout    — Wikipedia `page/summary` enrichment; runs even
 *                       without a toolPlan entry, using `state.terms` as the
 *                       query, unless terms is empty.
 *
 * All three are non-deterministic (network + possible model-supplied args).
 * Each appends to `state.candidates` so the downstream merge step can
 * dedupe across sources via `CanonicalId.dedupe`.
 *
 * The legacy `webSearchScout` is preserved for backward compatibility with
 * any external consumer that registers it by name. New branches use the
 * three named scouts via the `parallel` DAG placement.
 */

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';
import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

const scoutRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   400,
});

// ── Legacy scout (kept for backward-compat; new branches use the three below) ─

export const webSearchScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":    'web-search-scout',
  "outputs": ['success', 'empty'],
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'web_search_books');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; limit?: number };
    const query = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.webSearch;
      context.services.logger.info(`web search: "${query}" (limit ${String(args.limit ?? 8)})`);
      const candidates = await scoutRetry.run(
        () => tool.execute({ query, "limit": args.limit ?? 8 }, context.signal),
        context.signal,
      );
      state.candidates = [...state.candidates, ...candidates];
      context.services.logger.info(`web search: ${String(candidates.length)} hits`);
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      state.collectError({
        "code":        'WEB_SEARCH_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'web-search-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      context.services.logger.warn(`web search failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// ── OpenLibrary scout ────────────────────────────────────────────────────────
// Gates on `state.toolPlan` for a `web_search_books` call. Writes to
// `state.candidates`. Non-deterministic (live network).

export const openLibraryScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":    'open-library-scout',
  "outputs": ['success', 'empty'],
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'web_search_books');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; limit?: number };
    const query = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.webSearch;
      context.services.logger.info(`openlibrary: "${query}" (limit ${String(args.limit ?? 8)})`);
      const candidates = await scoutRetry.run(
        () => tool.execute({ query, "limit": args.limit ?? 8 }, context.signal),
        context.signal,
      );
      state.candidates = [...state.candidates, ...candidates];
      context.services.logger.info(`openlibrary: ${String(candidates.length)} hits`);
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      state.collectError({
        "code":        'OPEN_LIBRARY_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'open-library-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      context.services.logger.warn(`openlibrary failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// ── Google Books scout ───────────────────────────────────────────────────────
// Gates on `state.toolPlan` for a `google_books_search` call. Writes to
// `state.candidates`. Non-deterministic (live network).

export const googleBooksScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":    'google-books-scout',
  "outputs": ['success', 'empty'],
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'google_books_search');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; maxResults?: number };
    const query = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.googleBooks;
      context.services.logger.info(`google-books: "${query}" (max ${String(args.maxResults ?? 8)})`);
      const candidates = await scoutRetry.run(
        () => tool.execute({ query, "maxResults": args.maxResults ?? 8 }, context.signal),
        context.signal,
      );
      state.candidates = [...state.candidates, ...candidates];
      context.services.logger.info(`google-books: ${String(candidates.length)} hits`);
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      state.collectError({
        "code":        'GOOGLE_BOOKS_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'google-books-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      context.services.logger.warn(`google-books failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// ── Wikipedia scout ──────────────────────────────────────────────────────────
// Enrichment-only. Runs even without a toolPlan entry — uses `state.terms`
// as the query. Skips only when terms is empty. Non-deterministic (live network).

export const wikipediaScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":    'wikipedia-scout',
  "outputs": ['success', 'empty'],
  async execute(state, context) {
    const query = state.terms.join(' ').trim();
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.wikipediaSummary;
      context.services.logger.info(`wikipedia: "${query}"`);
      const candidates = await scoutRetry.run(
        () => tool.execute({ query }, context.signal),
        context.signal,
      );
      state.candidates = [...state.candidates, ...candidates];
      context.services.logger.info(`wikipedia: ${String(candidates.length)} hits`);
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      state.collectError({
        "code":        'WIKIPEDIA_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'wikipedia-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      context.services.logger.warn(`wikipedia failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

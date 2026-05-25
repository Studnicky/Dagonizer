/**
 * scouts — data-acquisition nodes for the Archivist's multi-source fan-out.
 *
 * Three scouts, each wrapping one external tool:
 *
 *   openLibraryScout  — OpenLibrary `web_search_books` call; LLM-gated
 *                       via `state.toolPlan` (tool name: web_search_books).
 *   googleBooksScout  — Google Books `google_books_search` call; LLM-gated
 *                       via `state.toolPlan` (tool name: google_books_search).
 *   subjectScout      — OpenLibrary subject search; LLM-gated via
 *                       `state.toolPlan` (tool name: subject_search).
 *   wikipediaScout    — Wikipedia `page/summary` enrichment; runs even
 *                       without a toolPlan entry, using `state.terms` as the
 *                       query, unless terms is empty.
 *
 * All four are non-deterministic (network + possible model-supplied args).
 * Each appends to `state.candidates` so the downstream merge step can
 * dedupe across sources via `CanonicalId.dedupe`.
 *
 * The legacy `webSearchScout` is preserved for backward compatibility with
 * any external consumer that registers it by name. New branches use the
 * four named scouts via the `parallel` DAG placement.
 *
 * Query sanitisation:
 *   Every scout applies `unquote()` to the LLM-supplied query before
 *   passing it to the tool. This strips the outer matching quote pair
 *   that some models emit (e.g. `"strange house neil gaiman"` becomes
 *   `strange house neil gaiman`), which otherwise causes OpenLibrary to
 *   return zero hits for AND-matching against the literal quotes.
 *
 * Failure accumulation:
 *   When a scout errors or returns zero hits, it appends a sanitized
 *   one-liner to `state.failureCause`. `composeEmptyResponse` uses this
 *   to produce an in-character message that acknowledges what was tried.
 */

import type { ArchivistState } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import { UserLanguage } from '../language/UserLanguage.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';
import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

/**
 * Filter scout-returned candidates down to those in the visitor's
 * language. Candidates with no language metadata pass through (the
 * source did not report a language — degrade gracefully). Candidates
 * whose reported language array does NOT contain the target ISO 639-2
 * code are dropped.
 */
function filterByLanguage(
  candidates: readonly Candidate[],
  userLanguage: string,
): readonly Candidate[] {
  const target = UserLanguage.toIso6392(userLanguage);
  return candidates.filter((c) => {
    const langs = c.book.languages;
    if (langs === undefined || langs.length === 0) return true;
    return langs.includes(target);
  });
}

// #region scout-retry
const scoutRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   400,
});
// #endregion scout-retry

/**
 * Strip outer matching quote pairs from a string. Handles straight double
 * quotes, straight single quotes, and guillemets. Returns the inner content
 * when a matching pair is detected; returns the trimmed original otherwise.
 *
 * Examples:
 *   unquote('"strange house neil gaiman"') → 'strange house neil gaiman'
 *   unquote("'foo'")                        → 'foo'
 *   unquote('«bar»')                        → 'bar'
 *   unquote('no quotes')                    → 'no quotes'
 */
function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  if (t.startsWith('«') && t.endsWith('»')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

// ── Query shaping per scout ─────────────────────────────────────────────────
//
// Each scout operates on a different index / search engine, so the query form
// that performs best differs per backend. All shaping is deterministic (no LLM
// involvement) and applied to `state.terms` after the extract-query node has
// already distilled the visitor's prose into catalog keywords.
//
// OpenLibrary (keyword search, `q=`): join all terms — keyword AND-match works
//   well with multiple short terms. No transformation needed.
//
// Google Books (`q=`): same join — full-text keyword search, identical behaviour
//   to OpenLibrary keyword path. No transformation needed.
//
// Subject Search (OpenLibrary `subject=`): the subject facet is indexed from
//   Library of Congress Subject Headings (LCSH), which are single-concept
//   headings. Long concatenations ("existentialism science fiction") almost
//   never match an LCSH heading. Strategy: pick the LONGEST term from
//   `state.terms` (heuristic: more letters = more specific) and use it alone.
//   Falls back to `state.terms[0]` when all terms are the same length.
//
// Wikipedia (page/summary title): the REST endpoint resolves exact article
//   titles and common redirects. Proper nouns (author names, book titles)
//   surface the right article. Strategy: if any term starts with an uppercase
//   letter (likely a proper noun — "Neuromancer", "Philip K. Dick"), use the
//   first such term alone. Otherwise join all terms as a best-effort phrase.

/** Pick the most-specific (longest) term for LCSH subject search. */
function pickSubjectTerm(terms: readonly string[]): string {
  if (terms.length === 0) return '';
  return terms.reduce((best, t) => (t.length > best.length ? t : best), terms[0] ?? '');
}

/** Pick the first capitalised term for Wikipedia proper-noun lookup. */
function pickWikipediaQuery(terms: readonly string[]): string {
  const properNoun = terms.find((t) => /^\p{Lu}/u.test(t));
  return properNoun ?? terms.join(' ');
}

// ── Legacy scout (kept for backward-compat; new branches use the four below) ─

export const webSearchScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":      'web-search-scout',
  "outputs":   ['success', 'empty'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'web_search_books');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; limit?: number };
    const rawQuery = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    const query = unquote(rawQuery);
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.webSearch;
      const lang = UserLanguage.toIso6392(state.userLanguage);
      const rawCandidates = await scoutRetry.run(
        () => tool.execute({ query, "limit": args.limit ?? 8, "lang": lang }, context.signal),
        context.signal,
      );
      const candidates = filterByLanguage(rawCandidates, state.userLanguage);
      state.candidates = [...state.candidates, ...candidates];
      const firstWsTitle = rawCandidates[0]?.book.title ?? '—';
      context.services.logger.info(`web-search GET https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${String(args.limit ?? 8)} → ${String(rawCandidates.length)} hits, first: "${firstWsTitle}" (${String(rawCandidates.length - candidates.length)} dropped by language filter)`);
      if (candidates.length === 0) {
        state.failureCause += `OpenLibrary: 0 hits for "${query}". `;
      }
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      const msg = error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100);
      state.collectError({
        "code":        'WEB_SEARCH_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'web-search-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      state.failureCause += `OpenLibrary: error — ${msg}. `;
      context.services.logger.warn(`web search failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// #region signal-scout
// ── OpenLibrary scout ────────────────────────────────────────────────────────
// Gates on `state.toolPlan` for a `web_search_books` call. Writes to
// `state.candidates`. Non-deterministic (live network).

export const openLibraryScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":      'open-library-scout',
  "outputs":   ['success', 'empty'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'web_search_books');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; limit?: number };
    const rawQuery = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    const query = unquote(rawQuery);
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.webSearch;
      const lang = UserLanguage.toIso6392(state.userLanguage);
      const rawCandidates = await scoutRetry.run(
        () => tool.execute({ query, "limit": args.limit ?? 8, "lang": lang }, context.signal),
        context.signal,
      );
      const candidates = filterByLanguage(rawCandidates, state.userLanguage);
      state.candidates = [...state.candidates, ...candidates];
      const firstTitle = rawCandidates[0]?.book.title ?? '—';
      context.services.logger.info(`openlibrary GET https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${String(args.limit ?? 8)} → ${String(rawCandidates.length)} hits, first: "${firstTitle}" (${String(rawCandidates.length - candidates.length)} dropped by language filter)`);
      if (candidates.length === 0) {
        state.failureCause += `OpenLibrary: 0 hits for "${query}". `;
      }
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      const msg = error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100);
      state.collectError({
        "code":        'OPEN_LIBRARY_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'open-library-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      state.failureCause += `OpenLibrary: error — ${msg}. `;
      context.services.logger.warn(`openlibrary failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};
// #endregion signal-scout

// ── Google Books scout ───────────────────────────────────────────────────────
// Gates on `state.toolPlan` for a `google_books_search` call. Writes to
// `state.candidates`. Non-deterministic (live network).

export const googleBooksScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":      'google-books-scout',
  "outputs":   ['success', 'empty'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'google_books_search');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { query?: string; maxResults?: number };
    const rawQuery = typeof args.query === 'string' && args.query.length > 0
      ? args.query
      : state.terms.join(' ');
    const query = unquote(rawQuery);
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.googleBooks;
      const langRestrict = UserLanguage.normalize(state.userLanguage);
      const rawCandidates = await scoutRetry.run(
        () => tool.execute({ query, "maxResults": args.maxResults ?? 8, "langRestrict": langRestrict }, context.signal),
        context.signal,
      );
      const candidates = filterByLanguage(rawCandidates, state.userLanguage);
      state.candidates = [...state.candidates, ...candidates];
      const firstGbTitle = rawCandidates[0]?.book.title ?? '—';
      context.services.logger.info(`google-books GET https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${String(args.maxResults ?? 8)} → ${String(rawCandidates.length)} hits, first: "${firstGbTitle}" (${String(rawCandidates.length - candidates.length)} dropped by language filter)`);
      if (candidates.length === 0) {
        state.failureCause += `Google Books: 0 hits for "${query}". `;
      }
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      const msg = error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100);
      state.collectError({
        "code":        'GOOGLE_BOOKS_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'google-books-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      state.failureCause += `Google Books: error — ${msg}. `;
      context.services.logger.warn(`google-books failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// ── Subject search scout ─────────────────────────────────────────────────
// Gates on `state.toolPlan` for a `subject_search` call. Writes to
// `state.candidates`. Non-deterministic (live network + LLM-supplied args).

export const subjectScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":      'subject-scout',
  "outputs":   ['success', 'empty'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    const planned = state.toolPlan.find((call) => call.name === 'subject_search');
    if (planned === undefined) return { "output": 'empty' };
    const args = planned.arguments as { subject?: string; limit?: number };
    // Subject shaping: LCSH subject facet performs best with a single focused
    // term. Pick the longest term from state.terms (most-specific heuristic).
    // Falls back to args.subject if the LLM supplied one (already focused).
    const rawSubject = typeof args.subject === 'string' && args.subject.length > 0
      ? args.subject
      : pickSubjectTerm(state.terms);
    const subject = unquote(rawSubject);
    if (subject.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.subjectSearch;
      const lang = UserLanguage.toIso6392(state.userLanguage);
      const rawCandidates = await scoutRetry.run(
        () => tool.execute({ subject, "limit": args.limit ?? 8, "lang": lang }, context.signal),
        context.signal,
      );
      const candidates = filterByLanguage(rawCandidates, state.userLanguage);
      state.candidates = [...state.candidates, ...candidates];
      const firstSubjectTitle = rawCandidates[0]?.book.title ?? '—';
      context.services.logger.info(`subject-search GET https://openlibrary.org/search.json?subject=${encodeURIComponent(subject)}&limit=${String(args.limit ?? 8)} → ${String(rawCandidates.length)} hits, first: "${firstSubjectTitle}" (${String(rawCandidates.length - candidates.length)} dropped by language filter)`);
      if (candidates.length === 0) {
        state.failureCause += `Subject search: 0 hits for "${subject}". `;
      }
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      const msg = error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100);
      state.collectError({
        "code":        'SUBJECT_SEARCH_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'subject-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      state.failureCause += `Subject search: error — ${msg}. `;
      context.services.logger.warn(`subject-search failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

// ── Wikipedia scout ──────────────────────────────────────────────────────────
// Enrichment-only. Runs even without a toolPlan entry — uses `state.terms`
// as the query. Skips only when terms is empty. Non-deterministic (live network).

export const wikipediaScout: NodeInterface<ArchivistState, 'success' | 'empty', ArchivistServices> = {
  "name":      'wikipedia-scout',
  "outputs":   ['success', 'empty'],
  "timeoutMs": 60_000,
  async execute(state, context) {
    // Wikipedia shaping: the REST summary endpoint resolves exact article
    // titles best. Prefer the first capitalised term (proper noun heuristic
    // — "Neuromancer", "Philip K. Dick"). Fall back to joining all terms.
    const query = pickWikipediaQuery(state.terms).trim();
    if (query.length === 0) return { "output": 'empty' };
    try {
      const tool = context.services.wikipediaSummary;
      const lang = UserLanguage.normalize(state.userLanguage);
      const wikiTitle = encodeURIComponent(query.replace(/\s+/gu, '_'));
      const rawCandidates = await scoutRetry.run(
        () => tool.execute({ query, "lang": lang }, context.signal),
        context.signal,
      );
      const candidates = filterByLanguage(rawCandidates, state.userLanguage);
      state.candidates = [...state.candidates, ...candidates];
      const firstWikiTitle = rawCandidates[0]?.book.title ?? '—';
      context.services.logger.info(`wikipedia GET https://${lang}.wikipedia.org/api/rest_v1/page/summary/${wikiTitle} → ${String(rawCandidates.length)} hits, first: "${firstWikiTitle}" (${String(rawCandidates.length - candidates.length)} dropped by language filter)`);
      if (candidates.length === 0) {
        state.failureCause += `Wikipedia: 0 hits for "${query}". `;
      }
      return { "output": candidates.length > 0 ? 'success' : 'empty' };
    } catch (error) {
      const msg = error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100);
      state.collectError({
        "code":        'WIKIPEDIA_FAILED',
        "message":     error instanceof Error ? error.message : String(error),
        "operation":   'wikipedia-scout',
        "recoverable": true,
        "timestamp":   new Date().toISOString(),
      });
      state.failureCause += `Wikipedia: error — ${msg}. `;
      context.services.logger.warn(`wikipedia failed: ${String(error)}`);
      return { "output": 'empty' };
    }
  },
};

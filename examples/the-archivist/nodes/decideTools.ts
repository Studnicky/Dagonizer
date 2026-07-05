/**
 * decideTools: non-deterministic node that asks the LLM which tools
 * (if any) to invoke for this query.
 *
 * The LLM receives the tool definitions via the adapter's native
 * channel (Gemini API's `functionDeclarations`, the browser built-in model's
 * `responseConstraint`, WebLLM's `response_format`. There is no
 * tool-listing in the prompt itself; the API enforces the shape.
 *
 * Outputs:
 *   'tools':    LLM asked for ≥1 tool; `state.toolPlan` populated.
 *   'no-tools': LLM is confident the local catalog suffices.
 *
 * Downstream gating:
 *   openLibraryScout checks `state.toolPlan` for a `web_search_books`
 *   entry and short-circuits to 'empty' when absent.
 *   googleBooksScout checks for `google_books_search` and short-circuits
 *   to 'empty' when absent.
 *   subjectScout checks for `subject_search` and short-circuits to 'empty'
 *   when absent.
 *
 * Per-intent tool advertisement:
 *   find-reviews      → OpenLibrary + GoogleBooks + SubjectSearch
 *   lookup-author     → OpenLibrary + GoogleBooks + SubjectSearch
 *   recommend-similar → OpenLibrary + GoogleBooks + SubjectSearch
 *   describe-book     → OpenLibrary + SubjectSearch
 *   general on-topic  → OpenLibrary + SubjectSearch
 *
 * Safety net: for FULL_CATALOG_INTENTS, if the LLM omits any of the three
 * primary catalog tools, the safety net appends the missing entries using
 * the same query text so all scouts run.
 */

import { Batch, MonadicNode, NodeOutputBuilder, RoutedBatchBuilder } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

/**
 * Intents that require the full three-source catalog.
 * The safety net enforces all three when the LLM is too conservative.
 */
const FULL_CATALOG_INTENTS = new Set(['find-reviews', 'lookup-author', 'recommend-similar']);

/** All three primary catalog tool names (Wikipedia runs unconditionally). */
const FULL_CATALOG_TOOL_NAMES = ['web_search_books', 'google_books_search', 'subject_search'] as const;

type ToolCall = { readonly name: string; readonly arguments: Record<string, unknown> };

/**
 * Result of a deterministic-shortcut pattern match. `null` when no
 * pattern fires; the LLM path runs as usual. Otherwise carries the
 * pre-populated tool plan and the named pattern for the log.
 */
interface ShortcutMatch {
  readonly pattern: string;
  readonly calls:   readonly ToolCall[];
}

const SHORTCUT_LIMIT = 8;

// ISBN-10 / ISBN-13 detection. Both formats (with or without hyphens).
// OpenLibrary's ?q= field handles both as a high-priority identifier lookup.
const ISBN_RE         = /\b(97[89]-?\d-?\d{2,5}-?\d{2,7}-?\d|\d{9}[\dXx]|97[89]\d{10})\b/u;
const AUTHOR_HINT_RE  = /\b(?:by|author|wrote|written\s+by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/iu;
const QUOTED_TITLE_RE = /^\s*['""']([^'""']+)['""']\s*$/u;
const PROPER_NOUN_RE  = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/u;
const TOPIC_RE        = /^(?:books?|works|literature|stories|novels)\s+(?:about|on)\s+(\S.*)$/iu;
const BROWSING_RE     = /^(?:do\s+you\s+have|what\s+(?:do\s+you\s+have|titles\s+do\s+you\s+have)|show\s+me|recommend)/iu;

const FULL_SCOUT_PLAN: readonly ToolCall[] = [
  { 'name': 'web_search_books',    'arguments': { 'limit': SHORTCUT_LIMIT } },
  { 'name': 'google_books_search', 'arguments': { 'maxResults': SHORTCUT_LIMIT } },
  { 'name': 'subject_search',      'arguments': { 'limit': SHORTCUT_LIMIT } },
  { 'name': 'wikipedia_summary',   'arguments': {} },
];

/**
 * ShortcutMatcher: deterministic pattern matching for common query shapes.
 * Static methods only; no instance state.
 */
export class ShortcutMatcher {
  /**
   * Safety-net post-processor: for full-catalog intents, ensure the tool plan
   * contains all three primary sources. Missing tools are appended using the
   * same query string the LLM chose (or the raw visitor query as fallback).
   */
  static enforceFullCatalog(
    calls: readonly ToolCall[],
    query: string,
  ): readonly ToolCall[] {
    // Derive the preferred query from the first tool call that has one.
    const firstQueryValue = calls.find((c) => typeof c.arguments['query'] === 'string')?.arguments['query'];
    const firstQuery: string | undefined = typeof firstQueryValue === 'string' ? firstQueryValue : undefined;
    const fallbackQuery = firstQuery ?? query;

    const names = new Set(calls.map((c) => c.name));
    const additions: ToolCall[] = [];

    if (!names.has('web_search_books')) {
      additions.push({ 'name': 'web_search_books',   'arguments': { 'query': fallbackQuery, 'limit': 8 } });
    }
    if (!names.has('google_books_search')) {
      additions.push({ 'name': 'google_books_search', 'arguments': { 'query': fallbackQuery, 'maxResults': 8 } });
    }
    if (!names.has('subject_search')) {
      additions.push({ 'name': 'subject_search',      'arguments': { 'subject': fallbackQuery, 'limit': 8 } });
    }

    return additions.length > 0 ? [...calls, ...additions] : calls;
  }

  /**
   * Detect whether the visitor query matches one of the deterministic
   * shortcut patterns. Returns the populated tool plan when a pattern
   * fires; otherwise `null`. The LLM call is bypassed only when this
   * returns non-null.
   *
   *   - isbn-lookup          → direct OpenLibrary ISBN lookup
   *   - author-lookup        → full 4-scout plan with typed author arg
   *   - quoted-single-title  → wikipedia first then web_search_books
   *   - topic-or-subject     → subject_search + web_search_books with typed subject arg
   *   - catalog-browsing     → full 4-scout plan
   */
  static match(query: string, intent: string): ShortcutMatch | null {
    const trimmed = query.trim();
    if (trimmed.length === 0) return null;

    // 0. ISBN-10 / ISBN-13 detection. Both formats (with or without hyphens).
    //    OpenLibrary's ?q= field handles both as a high-priority identifier lookup.
    const isbnMatch = trimmed.match(ISBN_RE);
    if (isbnMatch !== null) {
      const isbn = isbnMatch[1] ?? isbnMatch[0];
      return {
        'pattern': 'isbn-lookup',
        'calls': [
          { 'name': 'web_search_books', 'arguments': { 'isbn': isbn, 'limit': 1 } },
        ],
      };
    }

    // 1. Author lookup: either an explicit "by X Y" pattern OR
    //    lookup-author intent with a multi-word capitalised proper noun.
    //    Carry the captured author name as a typed arg so the scout uses
    //    OpenLibrary's ?author= axis instead of falling back to keyword query.
    const authorMatch = trimmed.match(AUTHOR_HINT_RE);
    if (authorMatch !== null ||
        (intent === 'lookup-author' && PROPER_NOUN_RE.test(trimmed))) {
      const authorName = authorMatch !== null
        ? (authorMatch[1] ?? '')
        : (trimmed.match(PROPER_NOUN_RE)?.[1] ?? trimmed);
      return {
        'pattern': 'author-lookup',
        'calls': [
          { 'name': 'web_search_books',    'arguments': { 'author': authorName, 'limit': SHORTCUT_LIMIT } },
          { 'name': 'google_books_search', 'arguments': { 'author': authorName, 'maxResults': SHORTCUT_LIMIT } },
          { 'name': 'subject_search',      'arguments': { 'limit': SHORTCUT_LIMIT } },
          { 'name': 'wikipedia_summary',   'arguments': { 'query': authorName } },
        ],
      };
    }

    // 2. Quoted single title: "X Y Z" style; route to wikipedia first.
    if (QUOTED_TITLE_RE.test(trimmed)) {
      return {
        'pattern': 'quoted-single-title',
        'calls': [
          { 'name': 'wikipedia_summary',  'arguments': {} },
          { 'name': 'web_search_books',   'arguments': { 'limit': SHORTCUT_LIMIT } },
        ],
      };
    }

    // 2b. describe-book intent with exactly one capitalised multi-word phrase.
    if (intent === 'describe-book') {
      const matches = trimmed.match(new RegExp(PROPER_NOUN_RE.source, 'gu'));
      if (matches !== null && matches.length === 1) {
        return {
          'pattern': 'single-title-describe',
          'calls': [
            { 'name': 'wikipedia_summary',  'arguments': {} },
            { 'name': 'web_search_books',   'arguments': { 'limit': SHORTCUT_LIMIT } },
          ],
        };
      }
    }

    // 3. Topic / subject: "books about X" etc.
    //    Capture the topic term and pass it as a typed subject arg so scouts
    //    use OpenLibrary's ?subject= axis and the subject facet directly.
    const topicMatch = trimmed.match(TOPIC_RE);
    if (topicMatch !== null) {
      const topicTerm = (topicMatch[1] ?? '').trim();
      return {
        'pattern': 'topic-or-subject',
        'calls': [
          { 'name': 'subject_search',   'arguments': { 'subject': topicTerm, 'limit': SHORTCUT_LIMIT } },
          { 'name': 'web_search_books', 'arguments': { 'subject': topicTerm, 'limit': SHORTCUT_LIMIT } },
        ],
      };
    }

    // 4. Catalog browsing: "do you have...", "show me...", "recommend..."
    if (BROWSING_RE.test(trimmed)) {
      return { 'pattern': 'catalog-browsing', 'calls': FULL_SCOUT_PLAN };
    }

    return null;
  }
}

/** Per-node timeout: generous for Gemini Nano's constrained-output path (20-60 s typical). */
const NODE_TIMEOUT_MS = 30_000;

/** Total attempts (initial + retries) before routing to salvage. */
const RETRY_BUDGET = 2;

export class DecideToolsNode extends MonadicNode<ArchivistState, 'tools' | 'no-tools' | 'retry' | 'salvage'> {
  private readonly services: ArchivistServices;
  readonly name = 'decide-tools';
  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  readonly outputs = ['tools', 'no-tools', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'tools' | 'no-tools' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'tools':    { 'type': 'object' },
      'no-tools': { 'type': 'object' },
      'retry':    { 'type': 'object' },
      'salvage':  { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const toolsItems: ItemType<ArchivistState>[] = [];
    const noToolsItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      // ── Deterministic shortcut prelude ────────────────────────────────────
      // Pattern-match common query shapes (author lookup, single quoted title,
      // "books about X", catalog browsing). When a pattern fires, populate
      // state.toolPlan directly and skip the LLM round-trip. The existing
      // safety nets only fire on LLM-path output, so shortcuts don't need them.
      const shortcut = ShortcutMatcher.match(state.query, state.intent);
      if (shortcut !== null) {
        state.toolPlan = shortcut.calls;
        state.clearAttempts(context.nodeName);
        const result = NodeOutputBuilder.of('tools');
        for (const error of result.errors) state.collectError(error);
        toolsItems.push(item);
        continue;
      }

      const isFullCatalog = FULL_CATALOG_INTENTS.has(state.intent);
      const available = isFullCatalog
        ? [this.services.webSearch.definition, this.services.googleBooks.definition, this.services.subjectSearch.definition]
        : [this.services.webSearch.definition, this.services.subjectSearch.definition];

      const controller = new AbortController();
      const handle = setTimeout(() => controller.abort(new Error('node-timeout')), this.services.nodeTimeouts[context.nodeName] ?? NODE_TIMEOUT_MS);
      const signal = AbortSignal.any([context.signal, controller.signal]);

      try {
        let calls = await this.services.llm.decideTools(state.query, available, signal);
        // LLM responded; the retry budget for this placement is spent.
        state.clearAttempts(context.nodeName);

        // Safety net (Option B): if the LLM returned fewer than all three
        // catalog tools for a full-catalog intent, add the missing ones so
        // all scouts run across all sources.
        if (isFullCatalog) {
          calls = ShortcutMatcher.enforceFullCatalog(calls, state.query);
        }

        // Safety net for on-topic intent with a sparse tool plan: force the full
        // four-scout set. WebLLM and Gemini Nano have unreliable structured output
        // so the LLM may under-propose tools; the scouts run in parallel so the
        // cost of running all four is bounded.
        //
        // Arguments intentionally omit `query` / `subject`. Each scout falls back
        // to `state.terms.join(' ')` (the keywords produced by `extract-query`)
        // when its query arg is missing. Passing `state.query` here would make
        // OpenLibrary search for the literal visitor sentence; 0 hits.
        if (!isFullCatalog && state.intent === 'search' && calls.length < 2) {
          calls = [
            { 'name': 'web_search_books',    'arguments': { 'limit': 8 } },
            { 'name': 'google_books_search', 'arguments': { 'maxResults': 8 } },
            { 'name': 'subject_search',      'arguments': { 'limit': 8 } },
            { 'name': 'wikipedia_summary',   'arguments': {} },
          ];
        } else if (!isFullCatalog && calls.length === 0) {
          // Minimal safety net for other non-full-catalog intents: ensure at least
          // web_search_books is in the plan so openLibraryScout runs.
          calls = [{ 'name': 'web_search_books', 'arguments': { 'limit': 8 } }];
        }

        state.toolPlan = calls;
        if (calls.length > 0) {
          const result = NodeOutputBuilder.of('tools');
          for (const error of result.errors) state.collectError(error);
          toolsItems.push(item);
        } else {
          state.failureCause += 'ToolInterface plan: no tools selected. ';
          const result = NodeOutputBuilder.of('no-tools');
          for (const error of result.errors) state.collectError(error);
          noToolsItems.push(item);
        }
      } catch (err) {
        // External cancellation / run deadline propagates unchanged.
        if (context.signal.aborted) throw err;
        // Node-local timeout or LLM failure -> retry budget decides the flow. The
        // minimal-plan fallback lives in decide-tools-salvage, not here.
        if (state.withinRetryBudget(context.nodeName, RETRY_BUDGET)) {
          const result = NodeOutputBuilder.of('retry');
          for (const error of result.errors) state.collectError(error);
          retryItems.push(item);
        } else {
          state.clearAttempts(context.nodeName);
          const result = NodeOutputBuilder.of('salvage');
          for (const error of result.errors) state.collectError(error);
          salvageItems.push(item);
        }
      } finally {
        clearTimeout(handle);
      }
    }

    const routes: Array<readonly ['tools' | 'no-tools' | 'retry' | 'salvage', Batch<ArchivistState>]> = [];
    if (toolsItems.length > 0) routes.push(['tools', Batch.from(toolsItems)]);
    if (noToolsItems.length > 0) routes.push(['no-tools', Batch.from(noToolsItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (salvageItems.length > 0) routes.push(['salvage', Batch.from(salvageItems)]);
    return RoutedBatchBuilder.from(routes);
  }
}

// Export tool names list for tests / documentation.
export { FULL_CATALOG_TOOL_NAMES };

export type { ShortcutMatch };

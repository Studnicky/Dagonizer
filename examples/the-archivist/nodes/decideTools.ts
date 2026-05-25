/**
 * decideTools — non-deterministic node that asks the LLM which tools
 * (if any) to invoke for this query.
 *
 * The LLM receives the tool definitions via the adapter's native
 * channel — Gemini API's `functionDeclarations`, the browser built-in model's
 * `responseConstraint`, WebLLM's `response_format`. There is no
 * tool-listing in the prompt itself; the API enforces the shape.
 *
 * Outputs:
 *   'tools'    — LLM asked for ≥1 tool. `state.toolPlan` populated.
 *   'no-tools' — LLM is confident the local catalog suffices.
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
 *   legacy on-topic   → OpenLibrary + SubjectSearch
 *
 * Safety net: for FULL_CATALOG_INTENTS, if the LLM omits any of the three
 * primary catalog tools, the safety net appends the missing entries using
 * the same query text so the fan-out actually fans out.
 */

import { GoogleBooksTool } from '@noocodex/dagonizer-tool-googlebooks';
import { OpenLibrarySearchTool } from '@noocodex/dagonizer-tool-openlibrary';
import { SubjectSearchTool } from '@noocodex/dagonizer-tool-openlibrary';

import type { ArchivistNode } from './ArchivistNode.ts';

/**
 * Intents that require the full three-source catalog.
 * The safety net enforces all three when the LLM is too conservative.
 */
const FULL_CATALOG_INTENTS = new Set(['find-reviews', 'lookup-author', 'recommend-similar']);

/** All three primary catalog tool names (Wikipedia runs unconditionally). */
const FULL_CATALOG_TOOL_NAMES = ['web_search_books', 'google_books_search', 'subject_search'] as const;

type ToolCall = { readonly name: string; readonly arguments: Record<string, unknown> };

/**
 * Safety-net post-processor: for full-catalog intents, ensure the tool plan
 * contains all three primary sources. Missing tools are appended using the
 * same query string the LLM chose (or the raw visitor query as fallback).
 */
function enforceFullCatalog(
  calls: readonly ToolCall[],
  query: string,
): readonly ToolCall[] {
  // Derive the preferred query from the first tool call that has one.
  const firstQuery = calls.find((c) => typeof c.arguments['query'] === 'string')?.arguments['query'] as string | undefined;
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

export const decideTools: ArchivistNode<'tools' | 'no-tools'> = {
  'name': 'decide-tools',
  'kind': 'non-deterministic',
  'outputs': ['tools', 'no-tools'],
  async execute(state, context) {
    const isFullCatalog = FULL_CATALOG_INTENTS.has(state.intent);
    const available = isFullCatalog
      ? [OpenLibrarySearchTool.definition, GoogleBooksTool.definition, SubjectSearchTool.definition]
      : [OpenLibrarySearchTool.definition, SubjectSearchTool.definition];
    try {
      let calls = await context.services.llm.decideTools(state.query, available);

      // Safety net (Option B): if the LLM returned fewer than all three
      // catalog tools for a full-catalog intent, add the missing ones so
      // the fan-out actually fans out across all sources.
      if (isFullCatalog) {
        const hadCount = calls.length;
        calls = enforceFullCatalog(calls, state.query);
        if (calls.length > hadCount) {
          const added = calls.slice(hadCount).map((c) => c.name);
          context.services.logger.info(`decideTools safety-net added: ${added.join(', ')}`);
        }
      }

      // Safety net for on-topic intent with a sparse tool plan: force the full
      // four-scout set. WebLLM and Gemini Nano have unreliable structured output
      // so the LLM may under-propose tools; the scouts run in parallel so the
      // cost of running all four is bounded.
      if (!isFullCatalog && state.intent === 'on-topic' && calls.length < 2) {
        const fallbackQuery = calls.find((c) => typeof c.arguments['query'] === 'string')?.arguments['query'] as string | undefined ?? state.query;
        calls = [
          { 'name': 'web_search_books',    'arguments': { 'query': fallbackQuery, 'limit': 8 } },
          { 'name': 'google_books_search', 'arguments': { 'query': fallbackQuery, 'maxResults': 8 } },
          { 'name': 'subject_search',      'arguments': { 'subject': fallbackQuery, 'limit': 8 } },
          { 'name': 'wikipedia_summary',   'arguments': { 'query': fallbackQuery } },
        ];
        context.services.logger.info('decideTools safety-net: forced all four scouts for sparse on-topic plan');
      } else if (!isFullCatalog && calls.length === 0) {
        // Minimal safety net for other non-full-catalog intents: ensure at least
        // web_search_books is in the plan so openLibraryScout runs.
        calls = [{ 'name': 'web_search_books', 'arguments': { 'query': state.query, 'limit': 8 } }];
        context.services.logger.info('decideTools safety-net: added web_search_books (LLM emitted empty plan)');
      }

      state.toolPlan = calls;
      if (calls.length > 0) {
        context.services.logger.info(
          `tool plan: ${calls.map((c) => c.name).join(', ')}`,
        );
        return { 'output': 'tools' };
      }

      state.failureCause += 'Tool plan: no tools selected. ';
      return { 'output': 'no-tools' };
    } catch (err) {
      // Tool decision is best-effort — collect the failure and fall
      // through to the local catalog so the run still completes.
      state.collectError({
        'code':        'DECIDE_TOOLS_FAILED',
        'message':     err instanceof Error ? err.message : String(err),
        'operation':   'decide-tools',
        'recoverable': true,
        'timestamp':   new Date().toISOString(),
      });
      context.services.logger.warn(`decideTools failed: ${String(err)}`);
      state.failureCause += `Tool decision failed: ${err instanceof Error ? err.message.slice(0, 80) : 'unknown error'}. `;
      return { 'output': 'no-tools' };
    }
  },
};

// Export tool names list for tests / documentation.
export { FULL_CATALOG_TOOL_NAMES };

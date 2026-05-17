/**
 * decideTools — non-deterministic node that asks the LLM which tools
 * (if any) to invoke for this query.
 *
 * The LLM receives the tool definitions via the adapter's native
 * channel — Gemini API's `functionDeclarations`, Gemini Nano's
 * `responseConstraint`, WebLLM's `response_format`. There is no
 * tool-listing in the prompt itself; the API enforces the shape.
 *
 * Outputs:
 *   'tools'    — LLM asked for ≥1 tool. `state.toolPlan` populated.
 *   'no-tools' — LLM is confident the local catalog suffices.
 *
 * Downstream gating:
 *   webSearchScout checks `state.toolPlan` for a `web_search_books`
 *   entry and short-circuits to 'empty' when absent.
 *   findReviews checks for `google_books_search` and short-circuits
 *   to 'empty' when absent.
 *
 * Per-intent tool advertisement:
 *   find-reviews      → OpenLibrary + GoogleBooks (rating signals needed)
 *   lookup-author     → OpenLibrary + GoogleBooks (author pages complement each other)
 *   recommend-similar → OpenLibrary + GoogleBooks (broad catalog wins)
 *   describe-book     → OpenLibrary only (single-title lookup; OL metadata is authoritative)
 *   legacy on-topic   → OpenLibrary only
 */

import { GoogleBooksTool } from '../tools/GoogleBooksTool.ts';
import { OpenLibrarySearchTool } from '../tools/OpenLibrarySearchTool.ts';
import { SubjectSearchTool } from '../tools/SubjectSearchTool.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

/**
 * Intents that benefit from the full tool set (OpenLibrary + GoogleBooks +
 * SubjectSearch). SubjectSearch is included in every intent so the LLM can
 * always pick it when the visitor describes a book thematically.
 */
const DUAL_CATALOG_INTENTS = new Set(['find-reviews', 'lookup-author', 'recommend-similar']);

export const decideTools: ArchivistNode<'tools' | 'no-tools'> = {
  'name': 'decide-tools',
  'kind': 'non-deterministic',
  'outputs': ['tools', 'no-tools'],
  async execute(state, context) {
    const available = DUAL_CATALOG_INTENTS.has(state.intent)
      ? [OpenLibrarySearchTool.definition, GoogleBooksTool.definition, SubjectSearchTool.definition]
      : [OpenLibrarySearchTool.definition, SubjectSearchTool.definition];
    try {
      const calls = await context.services.llm.decideTools(state.query, available);
      state.toolPlan = calls;
      if (calls.length > 0) {
        context.services.logger.info(
          `tool plan: ${calls.map((c) => c.name).join(', ')}`,
        );
        return { 'output': 'tools' };
      }
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
      return { 'output': 'no-tools' };
    }
  },
};

/**
 * composeResponse + validateResponse — the LLM compose/validate loop.
 *
 * `composeResponse` produces a prose answer from the shortlist.
 * `validateResponse` runs a soft quality check (length, citations,
 * tone). On failure the dispatcher routes back through compose up to
 * `MAX_COMPOSE_ATTEMPTS` — a deliberate retry loop modeled in the DAG
 * itself rather than inside a single node.
 *
 * RetryPolicy on composeResponse: the underlying LLM call may fail with
 * a transient network or rate-limit error before returning a draft at all.
 * The policy retries up to 2 extra attempts (maxAttempts=2, so 2 total
 * tries) with exponential backoff so one flaky call does not surface as a
 * DAG-level failure. This is distinct from the DAG-level compose→validate
 * →retry loop, which handles schema-violation or low-quality drafts after
 * a successful LLM completion.
 *
 * Demonstrates: the parameterised `services` context, state-mutation
 * gating (`state.approved`), and a routing decision that re-enters an
 * earlier node (loop) bounded by a counter on state.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { Candidate } from '../entities/Book.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';
import { BackoffStrategy, RetryPolicy } from '@noocodex/dagonizer/runtime';

/**
 * RetryPolicy for transient LLM call failures inside composeResponse.
 * Retries the compose call up to 2 times before propagating the error.
 */
const composeRetry = new RetryPolicy({
  "maxAttempts": 2,
  "strategy":    BackoffStrategy.EXPONENTIAL,
  "baseDelay":   500,
});

const MAX_COMPOSE_ATTEMPTS = 3;

/** Default wall-clock budget for the compose phase (ms). Overridden at runtime by the runner. */
export const COMPOSE_TIMEOUT_MS = 60_000;

export const composeResponse: NodeInterface<ArchivistState, 'drafted', ArchivistServices> = {
  "name": 'compose-response',
  "outputs": ['drafted'],
  "timeoutMs": COMPOSE_TIMEOUT_MS,
  async execute(state, context) {
    state.attempts['compose'] = (state.attempts['compose'] ?? 0) + 1;
    const llm = context.services.llm;
    const prior = state.priorContext.length > 0 ? state.priorContext : undefined;
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    // Each per-intent branch keeps the same `compose-response` node
    // (the retry loop and validate-response wiring stays one
    // implementation), and dispatches to the intent-flavoured prompt
    // builder so the LLM gets the right directives + framing.
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;
    const composeCall = (): Promise<string> => {
      switch (state.intent) {
        case 'lookup-author':     return llm.composeAuthor(state.query, state.shortlist, prior, recalledSummary, conversation);
        case 'find-reviews':      return llm.composeReviews(state.query, state.shortlist, prior, recalledSummary, conversation);
        case 'describe-book':     return llm.describeBook(state.query, state.shortlist, prior, recalledSummary, conversation);
        case 'recommend-similar': return llm.composeSimilar(state.query, state.shortlist, prior, recalledSummary, conversation);
        default:                  return llm.compose(state.query, state.shortlist, prior, recalledSummary, conversation);
      }
    };
    state.draft = await composeRetry.run(composeCall, context.signal);
    if (state.priorContext.length > 0) {
      context.services.logger.info(`compose: ${String(state.priorContext.length)} prior facts in context`);
    }
    return { "output": 'drafted' };
  },
};

/**
 * Detect candidate named-entity spans in a draft.
 *
 *   - Capitalised multi-word phrases (titles like "House of Leaves",
 *     authors like "Mark Z Danielewski"). Allows lowercase joiners
 *     `of/the/de/von/and/&` between capitalised tokens to keep titles
 *     like "Lord of the Rings" intact.
 *   - Italicised titles in `*…*` markdown spans.
 *
 * Returns the raw matched strings, de-duplicated, preserving order.
 */
export function detectEntities(draft: string): readonly string[] {
  const found = new Map<string, true>();
  // Capitalised tokens: a leading word and one or more trailing capitalised
  // words, optionally with lowercase joiners (of/the/de/von/&/and) BETWEEN
  // capitalised tokens. The trailing token must be capitalised — joiners
  // never end a match, so "House of Leaves and Piranesi" splits cleanly.
  // Single-letter middle initials (e.g. "Mark Z Danielewski") are allowed.
  const capToken = '[A-Z](?:[a-z\']+|\\.?)';                    // CapWord or initial
  const joiner   = '(?:of|the|de|von|and|&)';                   // lowercase joiners
  const capitalRe = new RegExp(
    `\\b(${capToken}(?:\\s+(?:${joiner}\\s+)?${capToken})+)\\b`,
    'gu',
  );
  const italicRe = /\*([^*\n]{2,80})\*/gu;
  for (const m of draft.matchAll(capitalRe)) {
    const span = (m[1] ?? '').trim();
    if (span.length > 0) found.set(span, true);
  }
  for (const m of draft.matchAll(italicRe)) {
    const span = (m[1] ?? '').trim();
    if (span.length > 0) found.set(span, true);
  }
  return [...found.keys()];
}

/**
 * Anti-hallucination check. Returns either `'ok'` or a failure cause
 * string describing the first hallucinated title found. Caller routes
 * accordingly.
 *
 *   1. Tokenise named-entity spans in the draft.
 *   2. For each entity, check substring-match (case-insensitive) against
 *      every title in shortlist + priorCandidates.
 *   3. If unmatched AND entity has > 2 words (heuristic: book titles
 *      tend to be longer than 2 words), flag as hallucination.
 *   4. Bias-check — when the shortlist is non-empty and the draft names
 *      NO book from it, the response is "compose-was-lazy" and gets
 *      flagged too.
 */
export function antiHallucinationCheck(
  draft: string,
  shortlist: readonly Candidate[],
  priorCandidates: readonly Candidate[],
): { readonly status: 'pass' | 'fail'; readonly count: number; readonly cause: string } {
  const knownTitles: readonly string[] = [
    ...shortlist.map((c) => c.book.title.toLowerCase()),
    ...priorCandidates.map((c) => c.book.title.toLowerCase()),
  ];
  const entities = detectEntities(draft);
  let checked = 0;
  for (const entity of entities) {
    const words = entity.trim().split(/\s+/u);
    if (words.length <= 2) continue; // skip likely author / proper-noun shortish spans
    checked++;
    const needle = entity.toLowerCase();
    const matched = knownTitles.some((t) => t.includes(needle) || needle.includes(t));
    if (!matched) {
      return {
        'status': 'fail',
        'count':  checked,
        'cause':  `Hallucinated title: "${entity}". Use only books from the shortlist. `,
      };
    }
  }

  // Bias-check: shortlist non-empty but draft mentions no shortlist title.
  if (shortlist.length > 0) {
    const draftLower = draft.toLowerCase();
    const mentioned = shortlist.some((c) => {
      const title = c.book.title.toLowerCase();
      return title.length > 0 && draftLower.includes(title);
    });
    if (!mentioned) {
      return {
        'status': 'fail',
        'count':  checked,
        'cause':  'Draft references no book from the shortlist. Cite at least one shortlist title. ',
      };
    }
  }

  return { 'status': 'pass', 'count': checked, 'cause': '' };
}

export const validateResponse: NodeInterface<
  ArchivistState,
  'approved' | 'retry' | 'exhausted',
  ArchivistServices
> = {
  "name": 'validate-response',
  "outputs": ['approved', 'retry', 'exhausted'],
  async execute(state, context) {
    // ── Deterministic anti-hallucination pre-check ───────────────────────
    // Runs BEFORE the LLM validator. When it fails we force a retry
    // without paying for an LLM round-trip — and we accumulate a
    // failureCause so the next compose attempt knows what to fix.
    const antiHal = antiHallucinationCheck(state.draft, state.shortlist, state.priorCandidates);
    if (antiHal.status === 'fail') {
      context.services.logger.warn(`validate-anti-hallucination: FAIL — ${antiHal.cause.trim()}`);
      state.failureCause += antiHal.cause;
      state.approved = false;
      if ((state.attempts['compose'] ?? 0) >= MAX_COMPOSE_ATTEMPTS) {
        context.services.logger.warn('compose attempts exhausted (anti-hallucination)');
        return { "output": 'exhausted' };
      }
      return { "output": 'retry' };
    }
    context.services.logger.info(`validate-anti-hallucination: PASS (${String(antiHal.count)} entities checked)`);

    const ok = await context.services.llm.validate(state.draft, state.shortlist);
    state.approved = ok;
    if (ok) return { "output": 'approved' };
    if ((state.attempts['compose'] ?? 0) >= MAX_COMPOSE_ATTEMPTS) {
      context.services.logger.warn('compose attempts exhausted');
      return { "output": 'exhausted' };
    }
    return { "output": 'retry' };
  },
};

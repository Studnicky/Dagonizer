/**
 * composeResponse + validateResponse: the LLM compose/validate loop.
 *
 * `composeResponse` produces a prose answer from the shortlist.
 * `validateResponse` runs a soft quality check (length, citations,
 * tone). On a low-quality draft it routes back through compose up to
 * `MAX_COMPOSE_ATTEMPTS`; a retry loop modeled in the DAG, not inside a node.
 *
 * Compose failures (a flaky LLM call that throws, or the node's own deadline
 * firing on a slow call) share that flow shape: `composeResponse` arms its own
 * deadline (the compose methods are signal-aware, so the abort cancels the
 * in-flight call), catches, and routes `retry` (the DAG loops back, bounded by
 * the same `compose` budget) or `salvage` once the budget is spent. No in-node
 * `RetryPolicy`, no engine `timeoutMs` crutch.
 *
 * Demonstrates: the parameterised `services` context, state-mutation gating
 * (`state.approved`), and retry/salvage as a flow shape over a state-held
 * budget.
 */


import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType } from '@studnicky/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';
import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistServices } from '../services.ts';

const MAX_COMPOSE_ATTEMPTS = 3;

/** Default wall-clock budget for the compose phase (ms). Overridden at runtime by the runner. */
export const COMPOSE_TIMEOUT_MS = 60_000;

export class ComposeResponseNode extends ScalarNode<ArchivistState, 'drafted' | 'retry' | 'salvage', ArchivistServices> {
  readonly name = 'compose-response';
  readonly outputs = ['drafted', 'retry', 'salvage'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    state.recordAttempt('compose');
    const llm = context.services.llm;
    const prior = state.priorContext.length > 0 ? state.priorContext : undefined;
    const recalledSummary = state.recalledContext.summary.length > 0
      ? state.recalledContext.summary
      : undefined;
    const conversation = state.conversation.length > 0 ? state.conversation : undefined;

    // Own deadline so a slow LLM is a flow decision (retry/salvage), not an
    // engine hard-fail. The compose methods are signal-aware, so the abort
    // cancels the in-flight call.
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(new Error('node-timeout')), context.services.nodeTimeouts[context.nodeName] ?? COMPOSE_TIMEOUT_MS);
    const signal = AbortSignal.any([context.signal, controller.signal]);

    // Each per-intent branch keeps the same `compose-response` node
    // (the retry loop and validate-response wiring stays one
    // implementation), and dispatches to the intent-flavoured prompt
    // builder so the LLM gets the right directives + framing.
    const composeCall = (): Promise<string> => {
      switch (state.intent) {
        case 'lookup-author':     return llm.composeAuthor(state.query, state.shortlist, prior, recalledSummary, conversation, signal);
        case 'find-reviews':      return llm.composeReviews(state.query, state.shortlist, prior, recalledSummary, conversation, signal);
        case 'describe-book':     return llm.describeBook(state.query, state.shortlist, prior, recalledSummary, conversation, signal);
        case 'recommend-similar': return llm.composeSimilar(state.query, state.shortlist, prior, recalledSummary, conversation, signal);
        default:                  return llm.compose(state.query, state.shortlist, prior, recalledSummary, conversation, signal);
      }
    };
    try {
      state.draft = await composeCall();
      if (state.priorContext.length > 0) {
      }
      return NodeOutputBuilder.of('drafted');
    } catch (err) {
      // External cancellation / run deadline propagates unchanged.
      if (context.signal.aborted) throw err;
      // Own timeout or transient compose failure → retry budget decides the
      // flow. The attempt was already recorded above, so read the count.
      if (state.retriesFor('compose') < MAX_COMPOSE_ATTEMPTS) {
        return NodeOutputBuilder.of('retry');
      }
      return NodeOutputBuilder.of('salvage');
    } finally {
      clearTimeout(handle);
    }
  }
}

/**
 * ResponseAnalysis: static methods for draft quality analysis.
 *
 * detectEntities: detect candidate named-entity spans in a draft.
 * antiHallucinationCheck: verify draft entities against known shortlist.
 */
export class ResponseAnalysis {
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
  static detectEntities(draft: string): readonly string[] {
    const found = new Map<string, true>();
    // Capitalised tokens: a leading word and one or more trailing capitalised
    // words, optionally with lowercase joiners (of/the/de/von/&/and) BETWEEN
    // capitalised tokens. The trailing token must be capitalised; joiners
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
   *   4. Bias-check: when the shortlist is non-empty and the draft names
   *      NO book from it, the response is "compose-was-lazy" and gets
   *      flagged too.
   */
  static antiHallucinationCheck(
    draft: string,
    shortlist: readonly CandidateType[],
    priorCandidates: readonly CandidateType[],
  ): { readonly status: 'pass' | 'fail'; readonly count: number; readonly cause: string } {
    const knownTitles: readonly string[] = [
      ...shortlist.map((c) => c.book.identity.title.toLowerCase()),
      ...priorCandidates.map((c) => c.book.identity.title.toLowerCase()),
    ];
    const entities = ResponseAnalysis.detectEntities(draft);
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
        const title = c.book.identity.title.toLowerCase();
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
}

export class ValidateResponseNode extends ScalarNode<
  ArchivistState,
  'approved' | 'retry' | 'exhausted',
  ArchivistServices
> {
  readonly name = 'validate-response';
  readonly outputs = ['approved', 'retry', 'exhausted'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextType<ArchivistServices>) {
    // ── Deterministic anti-hallucination pre-check ───────────────────────
    // Runs BEFORE the LLM validator. When it fails we force a retry
    // without paying for an LLM round-trip; we accumulate a
    // failureCause so the next compose attempt knows what to fix.
    const antiHal = ResponseAnalysis.antiHallucinationCheck(state.draft, state.shortlist, state.priorCandidates);
    if (antiHal.status === 'fail') {
      state.failureCause += antiHal.cause;
      state.approvalState = 'rejected';
      if (state.retriesFor('compose') >= MAX_COMPOSE_ATTEMPTS) {
        return NodeOutputBuilder.of('exhausted');
      }
      return NodeOutputBuilder.of('retry');
    }

    const ok = await context.services.llm.validate(state.draft, state.shortlist);
    state.approvalState = ok ? 'approved' : 'rejected';
    if (ok) return NodeOutputBuilder.of('approved');
    if (state.retriesFor('compose') >= MAX_COMPOSE_ATTEMPTS) {
      return NodeOutputBuilder.of('exhausted');
    }
    return NodeOutputBuilder.of('retry');
  }
}

/** Singleton node instances referenced by the DAG wiring. */
export const composeResponse = new ComposeResponseNode();
export const validateResponse = new ValidateResponseNode();

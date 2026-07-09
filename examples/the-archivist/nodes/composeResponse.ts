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
 *
 * `DraftShape` detects JSON-shaped drafts (a failure mode of weak on-device
 * models like Gemini Nano) and strips them to plain text so a repair hint
 * can be threaded into the next compose attempt via the dedicated repairHint
 * compose argument.
 *
 * `ShortlistDigest` produces a deterministic prose summary from the shortlist
 * when the validate loop is exhausted with non-empty results; ensures the
 * visitor always sees real book titles rather than a silent bad draft.
 */


import { Batch, MonadicNode, NodeOutput, ReasoningStep, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { Signal } from '@studnicky/signal';

import type { ArchivistState, ConversationTurn } from '../ArchivistState.ts';
import type { CandidateType } from '../entities/Book.ts';
import type { ArchivistServices } from '../services.ts';

const MAX_COMPOSE_ATTEMPTS = 3;

/** Default wall-clock budget for the compose phase (ms). Overridden at runtime by the runner. */
export const COMPOSE_TIMEOUT_MS = 60_000;

/**
 * Static helpers for detecting and stripping JSON-shaped compose drafts.
 *
 * Weak on-device models (Gemini Nano) sometimes return their response as
 * a raw JSON object or inside a code fence instead of flowing prose.
 * `isJson` catches that pattern; `strip` converts the JSON structure to
 * readable plain text so a repair directive can be threaded into the next
 * compose attempt via `state.failureCause`.
 */
export class DraftShape {
  /** Matches a draft whose entire body is a single code fence (``` or ```json). */
  private static readonly FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/u;
  /** Fraction of inner fenced content above which the draft is considered JSON-shaped. */
  private static readonly FENCE_THRESHOLD = 0.6;

  /**
   * Returns `true` when the draft is JSON-shaped:
   *   - The full draft is a single code fence whose inner content exceeds
   *     60% of the total trimmed length, OR
   *   - The body (after stripping any surrounding fence) parses as a JSON
   *     array or object.
   */
  static isJson(draft: string): boolean {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return false;

    const fenceMatch = DraftShape.FENCE_RE.exec(trimmed);
    const inner = fenceMatch !== null ? (fenceMatch[1] ?? '').trim() : '';

    if (fenceMatch !== null && inner.length > 0 &&
        inner.length / trimmed.length > DraftShape.FENCE_THRESHOLD) {
      return true;
    }

    const body = inner.length > 0 ? inner : trimmed;
    if ((body.startsWith('{') && body.endsWith('}')) ||
        (body.startsWith('[') && body.endsWith(']'))) {
      try {
        const parsed: unknown = JSON.parse(body);
        return typeof parsed === 'object' && parsed !== null;
      } catch { /* not valid JSON */ }
    }
    return false;
  }

  /**
   * Returns clean human-readable text from a JSON-shaped draft.
   * Strips code fences, extracts string values from the JSON structure
   * (joining with ". "), and otherwise removes all JSON-special
   * characters when the body is not parseable.
   */
  static strip(draft: string): string {
    const trimmed = draft.trim();
    const fenceMatch = DraftShape.FENCE_RE.exec(trimmed);
    const body = fenceMatch !== null
      ? (fenceMatch[1] ?? '').trim()
      : trimmed;

    if ((body.startsWith('{') && body.endsWith('}')) ||
        (body.startsWith('[') && body.endsWith(']'))) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (DraftShape.isPlainObject(parsed) || Array.isArray(parsed)) {
          const strings = DraftShape.gatherStrings(parsed);
          if (strings.length > 0) return strings.join('. ');
        }
      } catch { /* not valid JSON, fall through */ }
    }

    return body.replace(/[{}[\]"\\]/gu, ' ').replace(/\s+/gu, ' ').trim();
  }

  private static isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  private static gatherStrings(val: unknown): string[] {
    if (typeof val === 'string') return val.length > 0 ? [val] : [];
    if (typeof val === 'number' || typeof val === 'boolean') return [String(val)];
    if (Array.isArray(val)) return val.flatMap((v: unknown) => DraftShape.gatherStrings(v));
    if (DraftShape.isPlainObject(val)) {
      return Object.values(val).flatMap((v: unknown) => DraftShape.gatherStrings(v));
    }
    return [];
  }
}

/**
 * Produces a deterministic prose summary from a non-empty shortlist.
 * Used by `ValidateResponseNode` when the compose/validate loop is exhausted
 * but real catalog records exist — ensures the visitor always sees real book
 * titles rather than a silent bad or hallucinated draft.
 */
class ShortlistDigest {
  private static readonly MAX_TITLES = 3;

  /**
   * Returns 1–2 sentences naming titles, authors, and publication years
   * from the top of the shortlist. Caller guarantees `shortlist.length > 0`.
   */
  static summarize(shortlist: readonly CandidateType[]): string {
    const top = shortlist.slice(0, ShortlistDigest.MAX_TITLES);
    const items = top.map((c) => {
      const { title, authors } = c.book.identity;
      const year = c.book.publication.firstPublishYear;
      const firstAuthor = authors[0];
      const author =
        firstAuthor !== undefined && firstAuthor.length > 0 ? firstAuthor : undefined;
      const yearPart = year !== null ? ` (${String(year)})` : '';
      return author !== undefined
        ? `"${title}" by ${author}${yearPart}`
        : `"${title}"${yearPart}`;
    });
    const list = items.join(', ');
    const extra =
      shortlist.length > ShortlistDigest.MAX_TITLES
        ? ` and ${String(shortlist.length - ShortlistDigest.MAX_TITLES)} more`
        : '';
    const lead = shortlist.length === 1 ? 'I found one match' : 'I found some matches';
    return `${lead}: ${list}${extra}. Ask me about any of these and I can tell you more.`;
  }
}

export class ComposeResponseNode extends MonadicNode<ArchivistState, 'drafted' | 'retry' | 'salvage'> {
  private readonly services: ArchivistServices;
  readonly name = 'compose-response';
  readonly '@id' = 'urn:noocodec:node:compose-response';
  readonly outputs = ['drafted', 'retry', 'salvage'] as const;

  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  override get outputSchema(): Record<'drafted' | 'retry' | 'salvage', SchemaObjectType> {
    return {
      'drafted': { 'type': 'object' },
      'retry':   { 'type': 'object' },
      'salvage': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, context: NodeContextType) {
    const draftedItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const salvageItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      state.recordAttempt('compose');
      const llm = this.services.llm;
      const prior = state.priorContext.length > 0 ? state.priorContext : undefined;
      const recalledSummary = state.recalledContext.summary.length > 0
        ? state.recalledContext.summary
        : undefined;
      // Accumulated repair guidance (JSON-format directive from a prior attempt,
      // anti-hallucination cause from the validator) rides its own dedicated
      // compose argument so the recalled-memory channel stays pure.
      const repairHint = state.failureCause.trim();
      const conversation = state.conversation.length > 0 ? state.conversation : undefined;

      // Own deadline so a slow LLM is a flow decision (retry/salvage), not an
      // engine hard-fail. The compose methods are signal-aware, so the abort
      // cancels the in-flight call.
      const signal = Signal.compose({
        'deadlineMs': this.services.nodeTimeouts[context.nodeName] ?? COMPOSE_TIMEOUT_MS,
        'signal':     context.signal,
      });

      // Each per-intent branch keeps the same `compose-response` node
      // (the retry loop and validate-response wiring stays one
      // implementation), and dispatches to the intent-flavoured prompt
      // builder so the LLM gets the right directives + framing.
      type ComposeMethod = (
        query: string,
        shortlist: readonly CandidateType[],
        prior: readonly { variant: string; text: string }[] | undefined,
        recalledSummary: string | undefined,
        conversation: readonly ConversationTurn[] | undefined,
        signal: AbortSignal,
        repairHint: string,
      ) => Promise<string>;
      const composeDispatch: Partial<Record<string, ComposeMethod>> = {
        'lookup-author':     (q, sl, p, rs, cv, sig, rh) => llm.composeAuthor(q, sl, p, rs, cv, sig, rh),
        'find-reviews':      (q, sl, p, rs, cv, sig, rh) => llm.composeReviews(q, sl, p, rs, cv, sig, rh),
        'describe-book':     (q, sl, p, rs, cv, sig, rh) => llm.describeBook(q, sl, p, rs, cv, sig, rh),
        'recommend-similar': (q, sl, p, rs, cv, sig, rh) => llm.composeSimilar(q, sl, p, rs, cv, sig, rh),
      };
      const composeFn: ComposeMethod = composeDispatch[state.intent] ??
        ((q, sl, p, rs, cv, sig, rh) => llm.compose(q, sl, p, rs, cv, sig, rh));
      try {
        const draft = await composeFn(state.query, state.shortlist, prior, recalledSummary, conversation, signal, repairHint);
        // Guard: an empty draft is a fabrication gap; route to retry/salvage
        // so the validate-response node does not receive an empty string.
        if (draft.length === 0) {
          const result = NodeOutput.create(state.retriesFor('compose') < MAX_COMPOSE_ATTEMPTS ? 'retry' : 'salvage');
          for (const error of result.errors) state.collectError(error);
          if (result.output === 'retry') {
            retryItems.push(item);
          } else {
            salvageItems.push(item);
          }
          continue;
        }
        // Guard: a JSON-shaped draft is a format failure for weak on-device models.
        // Strip the structure to plain text, record the repair directive in
        // failureCause so the next attempt receives prose guidance via the
        // dedicated repairHint compose argument, and route retry/salvage via the
        // compose budget.
        if (DraftShape.isJson(draft)) {
          const stripped = DraftShape.strip(draft);
          state.failureCause +=
            'A previous attempt returned raw JSON instead of prose. ' +
            'Write only flowing prose; no code blocks, no JSON. ' +
            `Data in plain text: ${stripped}. `;
          const result = NodeOutput.create(state.retriesFor('compose') < MAX_COMPOSE_ATTEMPTS ? 'retry' : 'salvage');
          for (const error of result.errors) state.collectError(error);
          if (result.output === 'retry') {
            retryItems.push(item);
          } else {
            salvageItems.push(item);
          }
          continue;
        }
        // A non-terminal `.thought` kind: this draft still has to clear
        // validate-response, which can route back here on rejection (another
        // draft, another attempt). `.final` is reserved for the attempt that
        // is actually accepted, so retries never accumulate multiple 'final'
        // reasoning steps in the same run.
        state.reasoning = [...state.reasoning, ReasoningStep.create({ 'kind': 'thought', 'text': `composed response for intent '${state.intent}' from ${String(state.shortlist.length)} shortlisted candidates` })];
        state.draft = draft;
        const result = NodeOutput.create('drafted');
        for (const error of result.errors) state.collectError(error);
        draftedItems.push(item);
      } catch (err) {
        // External cancellation / run deadline propagates unchanged.
        if (context.signal.aborted) throw err;
        // Own timeout or transient compose failure -> retry budget decides the
        // flow. The attempt was already recorded above, so read the count.
        const result = NodeOutput.create(state.retriesFor('compose') < MAX_COMPOSE_ATTEMPTS ? 'retry' : 'salvage');
        for (const error of result.errors) state.collectError(error);
        if (result.output === 'retry') {
          retryItems.push(item);
        } else {
          salvageItems.push(item);
        }
      }
    }

    const routes: Array<readonly ['drafted' | 'retry' | 'salvage', Batch<ArchivistState>]> = [];
    if (draftedItems.length > 0) routes.push(['drafted', Batch.from(draftedItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (salvageItems.length > 0) routes.push(['salvage', Batch.from(salvageItems)]);
    return RoutedBatch.create(routes);
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

export class ValidateResponseNode extends MonadicNode<
  ArchivistState,
  'approved' | 'retry' | 'exhausted'
> {
  private readonly services: ArchivistServices;
  readonly name = 'validate-response';
  readonly '@id' = 'urn:noocodec:node:validate-response';
  readonly outputs = ['approved', 'retry', 'exhausted'] as const;

  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }
  override get outputSchema(): Record<'approved' | 'retry' | 'exhausted', SchemaObjectType> {
    return {
      'approved':  { 'type': 'object' },
      'retry':     { 'type': 'object' },
      'exhausted': { 'type': 'object' },
    };
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    const approvedItems: ItemType<ArchivistState>[] = [];
    const retryItems: ItemType<ArchivistState>[] = [];
    const exhaustedItems: ItemType<ArchivistState>[] = [];

    for (const item of batch) {
      const { state } = item;
      // ── Deterministic anti-hallucination pre-check ───────────────────────
      // Runs BEFORE the LLM validator. When it fails we force a retry
      // without paying for an LLM round-trip; we accumulate a
      // failureCause so the next compose attempt knows what to fix.
      const antiHal = ResponseAnalysis.antiHallucinationCheck(state.draft, state.shortlist, state.priorCandidates);
      if (antiHal.status === 'fail') {
        state.failureCause += antiHal.cause;
        state.approvalState = 'rejected';
        if (state.retriesFor('compose') >= MAX_COMPOSE_ATTEMPTS) {
          // Budget exhausted: replace a bad draft with a deterministic summary
          // when the shortlist has real records, so the visitor always sees titles.
          if (state.shortlist.length > 0) {
            state.draft = ShortlistDigest.summarize(state.shortlist);
          }
          const result = NodeOutput.create('exhausted');
          for (const error of result.errors) state.collectError(error);
          exhaustedItems.push(item);
        } else {
          const result = NodeOutput.create('retry');
          for (const error of result.errors) state.collectError(error);
          retryItems.push(item);
        }
        continue;
      }

      const ok = await this.services.llm.validate(state.draft, state.shortlist);
      state.approvalState = ok ? 'approved' : 'rejected';
      if (ok) {
        const result = NodeOutput.create('approved');
        for (const error of result.errors) state.collectError(error);
        approvedItems.push(item);
        continue;
      }
      if (state.retriesFor('compose') >= MAX_COMPOSE_ATTEMPTS) {
        // Budget exhausted: replace a bad draft with a deterministic summary
        // when the shortlist has real records, so the visitor always sees titles.
        if (state.shortlist.length > 0) {
          state.draft = ShortlistDigest.summarize(state.shortlist);
        }
        const result = NodeOutput.create('exhausted');
        for (const error of result.errors) state.collectError(error);
        exhaustedItems.push(item);
      } else {
        const result = NodeOutput.create('retry');
        for (const error of result.errors) state.collectError(error);
        retryItems.push(item);
      }
    }

    const routes: Array<readonly ['approved' | 'retry' | 'exhausted', Batch<ArchivistState>]> = [];
    if (approvedItems.length > 0) routes.push(['approved', Batch.from(approvedItems)]);
    if (retryItems.length > 0) routes.push(['retry', Batch.from(retryItems)]);
    if (exhaustedItems.length > 0) routes.push(['exhausted', Batch.from(exhaustedItems)]);
    return RoutedBatch.create(routes);
  }
}

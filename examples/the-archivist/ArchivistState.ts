/**
 * ArchivistState: the clipboard the Archivist's nodes mutate.
 *
 * Carries the visitor's question, the parsed intent, scout candidates,
 * the merged shortlist, the draft response, and per-execution counters.
 * Extends `NodeStateBase` so the dispatcher owns the lifecycle FSM and
 * Graph JSON-LD round-trips for `Checkpoint.capture` / `ckpt.restoreState`.
 */

import type { CandidateType } from './entities/Book.ts';
import type { BookWorksetItemType } from './nodes/buildBookWorksets.ts';

import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/types';
import type { ReasoningStepType } from '@studnicky/dagonizer';
import { Validator } from '@studnicky/dagonizer/validation';
import { CandidateSchema } from '@studnicky/dagonizer-book-entities';

/**
 * A single turn in the visitor–archivist conversation.
 * Stored on `ArchivistState.conversation` and injected into LLM prompts
 * so the model can resolve pronouns and follow-ups across turns.
 */
export interface ConversationTurn {
  readonly role: 'visitor' | 'archivist';
  readonly text: string;
  readonly ts: number;
}


/**
 * A roll-up of everything the Archivist has accumulated in its memory
 * store across all prior runs, produced by `recallMemories` and consumed
 * by `composeMemoryResponse`.
 */
export interface MemoryDigest {
  /** Total distinct books recorded across all runs. */
  readonly bookCount: number;
  /** Total visitor queries issued across all runs. */
  readonly queryCount: number;
  /** Up to the last 10 distinct shortlisted books (most-recent first). */
  readonly recentBooks: ReadonlyArray<{ readonly title: string; readonly author: string }>;
  /** Intent distribution: how many times each intent was classified. */
  readonly intentBreakdown: ReadonlyArray<{ readonly intent: string; readonly count: number }>;
  /** 1–2 sentence LLM-ready summary of the digest. */
  readonly summary: string;
}

/**
 * Prior-context facts recalled from the memory graph before classification.
 * `summary` is an LLM-ready 1–2 sentence hint; the structured arrays are
 * available directly on `state.recalledContext` for downstream nodes.
 */
export interface RecalledContext {
  /** Intents the classifier returned for similar prior queries. */
  readonly priorIntents: ReadonlyArray<{
    readonly query: string;
    readonly intent: string;
    readonly ts: string;
  }>;
  /** Books seen in recent state graphs (shortlisted candidates). */
  readonly recentCandidates: ReadonlyArray<CandidateType>;
  /** Prior queries that overlap with the current query text. */
  readonly similarPriorQueries: ReadonlyArray<{
    readonly query: string;
    readonly ts: string;
  }>;
  /** Reasoning steps recalled from prior runs' PROV graphs. */
  readonly priorReasoning: ReadonlyArray<{ readonly text: string; readonly kind: string }>;
  /** 1–2 sentence LLM-ready hint; empty string when nothing was recalled. */
  readonly summary: string;
}

/** What the visitor asked the Archivist to do. */
export type ArchivistIntent =
  | 'lookup-author'      // visitor named an author and wants their body of work
  | 'find-reviews'       // visitor wants opinions / reviews / what readers think
  | 'describe-book'      // visitor named a specific title and wants a description
  | 'recommend-similar'  // visitor wants something like a previous read
  | 'recall-memories'    // visitor asked what the agent has seen / remembered
  | 'search'             // visitor named a title / author / ISBN (generic search)
  | 'describe'           // visitor described a book without naming it
  | 'recommend'          // visitor asked for a generic recommendation
  | 'off-topic';         // visitor wandered: not a book query and not memory-related

export class ArchivistState extends NodeStateBase {
  private static readonly candidateValidator = Validator.compile<CandidateType>(CandidateSchema);
  /** Raw question the visitor submitted. */
  query = '';
  /**
   * Visitor's device language as an ISO 639-1 code (e.g. `'en'`,
   * `'ja'`). Drives every LLM prompt's response-language directive
   * and the language filter scouts apply to upstream results. Set by
   * the entrypoint from `UserLanguage.detect()` (or a URL override);
   * defaulted to `'en'` so existing call sites stay correct.
   */
  userLanguage: string = 'en';
  /** Parsed intent; set by `classifyIntent`. */
  intent: ArchivistIntent = 'search';
  /** Structured query terms; set by `extractQuery`. */
  terms: readonly string[] = [];
  /** Candidates returned by each scout, partitioned by source. */
  candidates: readonly CandidateType[] = [];
  /** Final shortlist after merge + dedupe + rank. */
  shortlist: readonly CandidateType[] = [];
  /** The Archivist's draft response. */
  draft = '';
  /**
   * Validation lifecycle state for the current draft.
   *   'pending'  — not yet validated (initial state, reset by preRunSetup)
   *   'approved' — LLM validator accepted the draft
   *   'rejected' — validator rejected (retry or salvage path follows)
   */
  approvalState: 'pending' | 'approved' | 'rejected' = 'pending';
  /**
   * ToolInterface plan emitted by the LLM via `decideTools`. The DAG inspects
   * this to gate the optional scouts (web search runs only when the
   * LLM asked for it). Empty = no tools needed.
   */
  toolPlan: ReadonlyArray<{ readonly name: string; readonly arguments: Record<string, unknown> }> = [];
  /**
   * Per-run identifier. Used to subject every triple we write so the
   * recall node can `SELECT` other runs' facts without re-reading the
   * current run's findings.
   */
  runId: string = '';
  /**
   * Sanitized one-liner description of why the search produced no
   * results. Accumulated by scouts and gate nodes; consumed by
   * `composeEmptyResponse` to craft an in-character failure message.
   * Empty string when no failure has been recorded.
   */
  failureCause = '';
  /**
   * Prior-context facts the recall node SELECTs out of memory before
   * compose. Each entry has a `variant` (e.g. 'prior-query',
   * 'prior-recommendation') and free-text content the LLM can cite.
   */
  priorContext: ReadonlyArray<{ readonly variant: string; readonly text: string }> = [];
  /**
   * Structured context recalled from the unified memory graph by
   * `recallContext` (runs before `classifyIntent`). The `summary` field
   * is injected into the classifier prompt; all fields are available to
   * downstream nodes (decideTools, composeResponse).
   */
  recalledContext: RecalledContext = {
    'priorIntents':        [],
    'recentCandidates':    [],
    'similarPriorQueries': [],
    'priorReasoning':      [],
    'summary':             '',
  };
  /**
   * The N most recent turns of the conversation (visitor + archivist),
   * sliced from the runner's display buffer and injected here before each
   * run. The runner controls the window size; nodes read this to thread
   * prior context into LLM prompts for pronoun resolution and continuity.
   * Always initialised to `[]`; never undefined (V8 shape stability).
   */
  conversation: readonly ConversationTurn[] = [];
  /**
   * Prior shortlisted candidates loaded from memory by `recallContext`
   * (cap 5, low Jaccard) and overridden by `recallCandidates` inside the
   * `book-search-scatter` embedded-DAG (cap 10, Jaccard >= 0.35).
   * `mergeCandidates` uses this pool when live scouts return zero.
   * Always initialized; never undefined (V8 shape stability).
   */
  priorCandidates: readonly CandidateType[] = [];
  /**
   * Scatter workset built by BuildBookWorksetsNode before each scatter fan-out.
   * Each entry carries a registered tool DAG IRI and the call
   * arguments to pass to it. The scatter placement reads `dagIri` through an
   * item-scoped DagReference to resolve the body DAG at runtime.
   * Written fresh before every scatter; always array-typed (never undefined).
   */
  bookWorksets: ReadonlyArray<BookWorksetItemType> = [];
  /**
   * The agent's own reasoning steps, accumulated across the current run via
   * `ReasoningStep.create(...)`. Each step is provenance-linked by
   * `RdfProvObserver.recordReasoning` into the PROV graph. Always
   * initialized; never undefined (V8 shape stability).
   */
  reasoning: readonly ReasoningStepType[] = [];

  /**
   * Memory roll-up produced by `recallMemories` for the `recall-memories`
   * intent. Empty/zero-valued when the intent is not `recall-memories`.
   */
  memoryDigest: MemoryDigest = {
    'bookCount':       0,
    'queryCount':      0,
    'recentBooks':     [],
    'intentBreakdown': [],
    'summary':         '',
  };

  // #region clone
  override clone(): this {
    const copy = super.clone(); // new Constructor() + _metadata copy from base
    copy.query        = this.query;
    copy.userLanguage = this.userLanguage;
    copy.intent       = this.intent;
    copy.terms      = [...this.terms];
    copy.candidates = [...this.candidates];
    copy.shortlist  = [...this.shortlist];
    copy.draft      = this.draft;
    copy.approvalState = this.approvalState;
    copy.toolPlan     = [...this.toolPlan];
    copy.runId        = this.runId;
    copy.failureCause = this.failureCause;
    copy.priorContext = [...this.priorContext];
    copy.recalledContext = {
      'priorIntents':        [...this.recalledContext.priorIntents],
      'recentCandidates':    [...this.recalledContext.recentCandidates],
      'similarPriorQueries': [...this.recalledContext.similarPriorQueries],
      'priorReasoning':      [...this.recalledContext.priorReasoning],
      'summary':             this.recalledContext.summary,
    };
    copy.conversation      = [...this.conversation];
    copy.priorCandidates   = [...this.priorCandidates];
    copy.bookWorksets      = [...this.bookWorksets];
    copy.reasoning         = [...this.reasoning];
    copy.memoryDigest = {
      'bookCount':       this.memoryDigest.bookCount,
      'queryCount':      this.memoryDigest.queryCount,
      'recentBooks':     [...this.memoryDigest.recentBooks],
      'intentBreakdown': [...this.memoryDigest.intentBreakdown],
      'summary':         this.memoryDigest.summary,
    };
    return copy;
  }
  // #endregion clone

  // #region snapshot-restore

  // #region snapshot-helpers
  static candidateToJson(c: CandidateType): JsonObjectType {
    const book: JsonObjectType = {
      "isbn":    c.book.identity.isbn,
      "title":   c.book.identity.title,
      "authors": [...c.book.identity.authors],
      "price":   { "amount": c.book.availability.price.amount, "currency": c.book.availability.price.currency },
      // Null-sentinel fields are omitted when null, so the wire shape carries a
      // key only when a real value exists (not an explicit `null`).
      ...(c.book.publication.summary !== null               ? { "summary": c.book.publication.summary }                 : {}),
      ...(c.book.publication.firstPublishYear !== null      ? { "firstPublishYear": c.book.publication.firstPublishYear } : {}),
      ...(c.book.publication.subjects.length > 0           ? { "subjects": [...c.book.publication.subjects] }          : {}),
      ...(c.book.publication.publishers.length > 0         ? { "publishers": [...c.book.publication.publishers] }      : {}),
      ...(c.book.availability.inStock !== null              ? { "inStock": c.book.availability.inStock }                 : {}),
      ...(c.book.publication.languages.length > 0          ? { "languages": [...c.book.publication.languages] }        : {}),
    };
    // notes values are Record<string, unknown>; serialize only JSON-safe primitives.
    const notesOut: JsonObjectType = {};
    if (c.notes !== undefined) {
      for (const [k, v] of Object.entries(c.notes)) {
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          notesOut[k] = v;
        }
      }
    }
    return {
      "book":   book,
      "score":  c.score,
      "source": c.source,
      ...(c.reason !== undefined ? { "reason": c.reason } : {}),
      ...(c.notes !== undefined  ? { "notes": notesOut }  : {}),
    };
  }

  static priorIntentToJson(p: RecalledContext['priorIntents'][number]): JsonObjectType {
    return { "query": p.query, "intent": p.intent, "ts": p.ts };
  }

  static priorQueryToJson(q: RecalledContext['similarPriorQueries'][number]): JsonObjectType {
    return { "query": q.query, "ts": q.ts };
  }

  static turnToJson(t: ConversationTurn): JsonObjectType {
    return { "role": t.role, "text": t.text, "ts": t.ts };
  }

  static priorReasoningToJson(p: RecalledContext['priorReasoning'][number]): JsonObjectType {
    return { "text": p.text, "kind": p.kind };
  }

  /**
   * `ReasoningStepType.action.args` is `Record<string, unknown>` at the
   * construction boundary; serialize only JSON-safe primitives, mirroring
   * `candidateToJson`'s `notesOut` sanitizer.
   */
  static reasoningStepToJson(step: ReasoningStepType): JsonObjectType {
    if (step.kind === 'action') {
      const argsOut: JsonObjectType = {};
      for (const [k, v] of Object.entries(step.args)) {
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          argsOut[k] = v;
        }
      }
      return { "kind": step.kind, "tool": step.tool, "args": argsOut };
    }
    if (step.kind === 'observation') {
      return { "kind": step.kind, "output": step.output };
    }
    return { "kind": step.kind, "text": step.text };
  }
  // #endregion snapshot-helpers


  // #region type-guards

  static filterCandidates(arr: unknown[]): CandidateType[] {
    const out: CandidateType[] = [];
    for (const item of arr) {
      if (ArchivistState.isCandidate(item)) out.push(item);
    }
    return out;
  }

  static filterPriorIntents(arr: unknown[]): RecalledContext['priorIntents'] {
    const out: RecalledContext['priorIntents'][number][] = [];
    for (const item of arr) {
      if (ArchivistState.isPriorIntent(item)) out.push(item);
    }
    return out;
  }

  static filterSimilarPriorQueries(arr: unknown[]): RecalledContext['similarPriorQueries'] {
    const out: RecalledContext['similarPriorQueries'][number][] = [];
    for (const item of arr) {
      if (ArchivistState.isSimilarPriorQuery(item)) out.push(item);
    }
    return out;
  }

  static filterConversationTurns(arr: unknown[]): ConversationTurn[] {
    const out: ConversationTurn[] = [];
    for (const item of arr) {
      if (ArchivistState.isConversationTurn(item)) out.push(item);
    }
    return out;
  }

  static filterBookWorksetItems(arr: unknown[]): BookWorksetItemType[] {
    const out: BookWorksetItemType[] = [];
    for (const item of arr) {
      if (ArchivistState.isBookWorksetItem(item)) out.push(item);
    }
    return out;
  }

  static filterPriorReasoning(arr: unknown[]): RecalledContext['priorReasoning'] {
    const out: RecalledContext['priorReasoning'][number][] = [];
    for (const item of arr) {
      if (ArchivistState.isPriorReasoning(item)) out.push(item);
    }
    return out;
  }

  static filterReasoningSteps(arr: unknown[]): ReasoningStepType[] {
    const out: ReasoningStepType[] = [];
    for (const item of arr) {
      if (ArchivistState.isReasoningStep(item)) out.push(item);
    }
    return out;
  }

  static filterRecentBooks(arr: unknown[]): MemoryDigest['recentBooks'] {
    const out: MemoryDigest['recentBooks'][number][] = [];
    for (const item of arr) {
      if (ArchivistState.isRecentBook(item)) out.push(item);
    }
    return out;
  }

  static filterIntentBreakdown(arr: unknown[]): MemoryDigest['intentBreakdown'] {
    const out: MemoryDigest['intentBreakdown'][number][] = [];
    for (const item of arr) {
      if (ArchivistState.isIntentBreakdownEntry(item)) out.push(item);
    }
    return out;
  }

  static isIntent(v: unknown): v is ArchivistIntent {
    return v === 'lookup-author'
      || v === 'find-reviews'
      || v === 'describe-book'
      || v === 'recommend-similar'
      || v === 'recall-memories'
      || v === 'search'
      || v === 'describe'
      || v === 'recommend'
      || v === 'off-topic';
  }

  private static isCandidate(v: unknown): v is CandidateType {
    return ArchivistState.candidateValidator.is(v);
  }

  private static isPriorIntent(v: unknown): v is RecalledContext['priorIntents'][number] {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('query' in v && 'intent' in v && 'ts' in v)) return false;
    return typeof v.query === 'string'
      && typeof v.intent === 'string'
      && typeof v.ts === 'string';
  }

  private static isSimilarPriorQuery(v: unknown): v is RecalledContext['similarPriorQueries'][number] {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('query' in v && 'ts' in v)) return false;
    return typeof v.query === 'string' && typeof v.ts === 'string';
  }

  private static isConversationTurn(v: unknown): v is ConversationTurn {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('role' in v && 'text' in v && 'ts' in v)) return false;
    return (v.role === 'visitor' || v.role === 'archivist')
      && typeof v.text === 'string'
      && typeof v.ts === 'number';
  }

  private static isBookWorksetItem(v: unknown): v is BookWorksetItemType {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('dagIri' in v && 'arguments' in v)) return false;
    return typeof v.dagIri === 'string'
      && typeof v.arguments === 'object'
      && v.arguments !== null
      && !Array.isArray(v.arguments);
  }

  private static isRecentBook(v: unknown): v is MemoryDigest['recentBooks'][number] {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('title' in v && 'author' in v)) return false;
    return typeof v.title === 'string' && typeof v.author === 'string';
  }

  private static isIntentBreakdownEntry(v: unknown): v is MemoryDigest['intentBreakdown'][number] {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('intent' in v && 'count' in v)) return false;
    return typeof v.intent === 'string' && typeof v.count === 'number';
  }

  private static isPriorReasoning(v: unknown): v is RecalledContext['priorReasoning'][number] {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('text' in v && 'kind' in v)) return false;
    return typeof v.text === 'string' && typeof v.kind === 'string';
  }

  private static isReasoningStep(v: unknown): v is ReasoningStepType {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    if (!('kind' in v)) return false;
    if (v.kind === 'thought' || v.kind === 'final') {
      return 'text' in v && typeof v.text === 'string';
    }
    if (v.kind === 'action') {
      return 'tool' in v && typeof v.tool === 'string'
        && 'args' in v && typeof v.args === 'object' && v.args !== null && !Array.isArray(v.args);
    }
    if (v.kind === 'observation') {
      return 'output' in v && typeof v.output === 'string';
    }
    return false;
  }
  // #endregion type-guards
}
